// ロビーの Durable Object。一つだけ置き、部屋の一覧を持つ。部屋の Durable Object から知らせを受けて書き換え、
// つながっている画面に一覧を送る。中身は lobby.ts の純粋な関数に任せる。

import { DurableObject } from 'cloudflare:workers'
import type { LobbyMessage, LobbyRoom } from '../online/protocol'
import { dropRoom, listRooms, putRoom, type Rooms } from './lobby'

const KEY = 'rooms'

export class Lobby extends DurableObject<Env> {
  private rooms: Rooms = {}

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // 画面がつながりを保つために送る ping には、起こさずに pong を返す
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    ctx.blockConcurrencyWhile(async () => {
      this.rooms = (await ctx.storage.get<Rooms>(KEY)) ?? {}
    })
  }

  /** 画面から WebSocket でつなぐ。つないだらすぐ今の一覧を送る */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 })
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.send(JSON.stringify(this.message()))
    return new Response(null, { status: 101, webSocket: client })
  }

  /** 部屋の一行を足すか書き換える。部屋の Durable Object から呼ぶ */
  async put(room: LobbyRoom): Promise<void> {
    await this.save(putRoom(this.rooms, room))
  }

  /** 部屋の一行を消す。部屋の Durable Object から呼ぶ */
  async drop(id: string): Promise<void> {
    await this.save(dropRoom(this.rooms, id))
  }

  /** 画面からの知らせは受けない。一覧は送るだけ */
  async webSocketMessage(): Promise<void> {}

  private message(): LobbyMessage {
    return { type: 'rooms', rooms: listRooms(this.rooms) }
  }

  private async save(next: Rooms): Promise<void> {
    this.rooms = next
    await this.ctx.storage.put(KEY, next)
    const text = JSON.stringify(this.message())
    for (const w of this.ctx.getWebSockets()) {
      try {
        w.send(text)
      } catch {
        // 閉じかけの WebSocket には送れない
      }
    }
  }
}
