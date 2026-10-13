// 部屋の Durable Object。一部屋に一つ。中身は room.ts の純粋な関数に任せ、ここは保存、WebSocket、アラーム、ロビーへの知らせだけをする。
// WebSocket は休止できる受け方で持ち、休止から戻ったら保存した様子から組み直す。

import { DurableObject } from 'cloudflare:workers'
import type { Config, PlayerIndex } from '../game/types'
import type { ClientMessage, RoomMessage } from '../online/protocol'
import type { Lobby } from './lobby-object'
import {
  act,
  again,
  asAction,
  createRoom,
  joinRoom,
  leave,
  lobbyRoom,
  nextAlarm,
  type RoomState,
  resignRoom,
  seatOf,
  setOnline,
  snapshot,
  tick,
} from './room'

/** 乱数。サーバで振るので、暗号の乱数から作る */
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32

const KEY = 'room'

/** WebSocket に覚えさせる、つないだ人の席の合言葉 */
interface Attachment {
  token: string
}

export class Room extends DurableObject<Env> {
  private state: RoomState | null = null
  /** ロビーに最後に知らせた一行。変わったときだけ知らせる */
  private listed: string | null = null
  /** ロビーへの知らせを、出した順に届けるための列 */
  private toLobby: Promise<void> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>(KEY)) ?? null
    })
  }

  /** 部屋を作る。同じ名前の部屋がもうあれば断る */
  async create(args: {
    id: string
    code: string
    name: string
    token: string
    stepMs?: number
    config?: Config
  }): Promise<boolean> {
    if (this.state) return false
    await this.save(createRoom({ ...args, now: Date.now() }))
    return true
  }

  /** 二人目が入る */
  async join(args: { name: string; code: string; token: string }): Promise<'ok' | 'code' | 'full' | 'gone'> {
    if (!this.state) return 'gone'
    const r = joinRoom(this.state, { ...args, now: Date.now(), rng })
    if (!r.ok) return r.reason
    await this.save(r.state)
    return 'ok'
  }

  /** 画面から WebSocket でつなぐ。席の合言葉が合わなければ、部屋が無いと伝えて閉じる */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 })
    const token = new URL(request.url).searchParams.get('token') ?? ''
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ token } satisfies Attachment)
    if (!this.state || seatOf(this.state, token) === null) {
      send(server, { type: 'gone' })
      server.close(4404, 'gone')
    } else {
      await this.save(this.presence())
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const s = this.state
    const seat = s && seatOf(s, tokenOf(ws))
    if (!s || seat === null || seat === undefined) return
    const msg = parse(raw)
    if (!msg) return
    const now = Date.now()
    if (msg.type === 'act') {
      const action = asAction(msg.action)
      const r = action ? act(s, seat, action, rng, now) : ({ ok: false, reason: 'illegal' } as const)
      if (!r.ok) send(ws, { type: 'rejected', reason: r.reason })
      else await this.save(r.state)
    } else if (msg.type === 'resign') {
      await this.save(resignRoom(s, seat))
    } else if (msg.type === 'again') {
      await this.save(again(s, seat, rng, now))
    } else if (msg.type === 'leave') {
      // 出た人の画面には、もう部屋が無いと伝える。残った人には新しい様子を送る
      const r = leave(s, seat, now)
      for (const w of this.sockets(tokenOf(ws))) {
        send(w, { type: 'gone' })
        w.close(1000, 'left')
      }
      if (r.deleted) await this.remove()
      else await this.save(setOnline(r.state, this.onlineOf(r.state, ws), now))
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    if (this.state) await this.save(setOnline(this.state, this.onlineOf(this.state, ws), Date.now()))
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  /** 持ち時間の期限か、誰もいない部屋を消す時刻が来た */
  async alarm(): Promise<void> {
    if (!this.state) return
    const r = tick(this.state, Date.now())
    if (r.deleted) await this.remove()
    else await this.save(r.state)
  }

  /** 今つながっている画面から、席ごとのつながりを書き換えた様子 */
  private presence(): RoomState {
    const s = this.state as RoomState
    return setOnline(s, this.onlineOf(s), Date.now())
  }

  /** 席ごとに、開いている WebSocket があるか。閉じかけの closing は数えない */
  private onlineOf(s: RoomState, closing?: WebSocket): [boolean, boolean] {
    const open = this.ctx.getWebSockets().filter((w) => w !== closing && w.readyState === WebSocket.OPEN)
    const has = (i: PlayerIndex) => {
      const token = s.seats[i]?.token
      return token !== undefined && open.some((w) => tokenOf(w) === token)
    }
    return [has(0), has(1)]
  }

  /** 席の合言葉 token でつないでいる WebSocket */
  private sockets(token: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((w) => tokenOf(w) === token)
  }

  /** 様子を保存し、つながっている画面に送り、アラームを張り直し、ロビーに知らせる */
  private async save(next: RoomState): Promise<void> {
    this.state = next
    await this.ctx.storage.put(KEY, next)
    const at = nextAlarm(next)
    if (at === null) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(at)
    const now = Date.now()
    for (const w of this.ctx.getWebSockets()) {
      const seat = seatOf(next, tokenOf(w))
      if (seat !== null) send(w, snapshot(next, seat, now))
    }
    const row = lobbyRoom(next)
    const listed = JSON.stringify(row)
    if (listed === this.listed) return
    this.listed = listed
    await this.tellLobby((lobby) => (row ? lobby.put(row) : lobby.drop(next.id)))
  }

  /** ロビーに知らせる。前の知らせが届いてから送り、順が入れ替わって消えた部屋が残らないようにする */
  private tellLobby(call: (lobby: DurableObjectStub<Lobby>) => Promise<void>): Promise<void> {
    this.toLobby = this.toLobby
      .then(() => call(this.env.LOBBY.getByName('lobby')))
      .catch(() => {
        // 届かなかったら、次に様子が変わったときに送り直す
        this.listed = null
      })
    return this.toLobby
  }

  /** 部屋を消す。残っている画面には部屋が無いと伝える */
  private async remove(): Promise<void> {
    const id = this.state?.id
    this.state = null
    for (const w of this.ctx.getWebSockets()) {
      send(w, { type: 'gone' })
      w.close(4404, 'gone')
    }
    this.listed = null
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    if (id) await this.tellLobby((lobby) => lobby.drop(id))
  }
}

function tokenOf(ws: WebSocket): string {
  return (ws.deserializeAttachment() as Attachment | null)?.token ?? ''
}

function send(ws: WebSocket, msg: RoomMessage): void {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    // 閉じかけの WebSocket には送れない。つながりは閉じたときに書き換える
  }
}

function parse(raw: string | ArrayBuffer): ClientMessage | null {
  try {
    const msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as ClientMessage
    return typeof msg === 'object' && msg !== null && typeof msg.type === 'string' ? msg : null
  } catch {
    return null
  }
}
