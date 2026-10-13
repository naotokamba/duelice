// オンライン対戦の画面のテストの道具。ブラウザの WebSocket と fetch を偽物に差し替え、
// サーバの代わりに、本物のサーバと同じ部屋の純粋な関数 src/server/room.ts で様子を作って画面へ送る。

import { act } from '@testing-library/react'
import { vi } from 'vitest'
import type { Match } from '../game/match'
import type { PlayerIndex } from '../game/types'
import type { ClientMessage, LobbyMessage, LobbyRoom } from '../online/protocol'
import {
  again,
  createRoom,
  joinRoom,
  leave,
  act as play,
  type RoomState,
  resignRoom,
  seatOf,
  setOnline,
  snapshot,
} from '../server/room'
import { makeState, seeded } from './helpers'

/** 偽の WebSocket。作られた順に all に並ぶ。テストからつながった、届いた、切れたを起こす */
export class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static all: FakeSocket[] = []

  readyState = FakeSocket.CONNECTING
  /** 画面が送った知らせ。ping はそのまま、ほかは読んだ形で並べる */
  sent: unknown[] = []
  /** 画面が閉じたときの理由。閉じていなければ null */
  closedWith: number | null = null
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }

  send(data: string) {
    this.sent.push(data === 'ping' ? data : JSON.parse(data))
  }

  close(code = 1000) {
    this.closedWith = code
    this.readyState = FakeSocket.CLOSED
  }

  /** つながった */
  open() {
    act(() => {
      this.readyState = FakeSocket.OPEN
      this.onopen?.()
    })
    return this
  }

  /** サーバから知らせが届いた */
  receive(msg: unknown) {
    act(() => this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) }))
  }

  /** サーバ側から切れた */
  drop(code = 1006) {
    act(() => {
      this.readyState = FakeSocket.CLOSED
      this.onclose?.({ code })
    })
  }

  /** 画面が送った知らせのうち、ping でないもの */
  messages(): ClientMessage[] {
    return this.sent.filter((m): m is ClientMessage => m !== 'ping')
  }
}

/** 偽の WebSocket と fetch に差し替える。fetch の返事は respond が決める */
export function fakeNetwork(respond: (url: string, body: unknown) => unknown = () => ({})) {
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const answer = respond(url, body)
    if (answer instanceof Error) throw answer
    return { json: async () => answer }
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** 道に path を含む、一番新しい WebSocket */
export function socketTo(path: string): FakeSocket {
  const s = FakeSocket.all.filter((x) => x.url.includes(path)).at(-1)
  if (!s) throw new Error(`${path} への WebSocket が無い`)
  return s
}

/** ロビーの一覧を送る */
export function sendRooms(rooms: LobbyRoom[]) {
  socketTo('/api/lobby').receive({ type: 'rooms', rooms } satisfies LobbyMessage)
}

/** 席0にあお、席1にあかが座り、ダイスを決めた対局が始まった部屋。二人ともつながっている */
export function startedRoom({ hp = 20, stepMs = 60_000, now = Date.now() } = {}): RoomState {
  const config = { maxHp: hp, diceCount: 3 }
  const made = createRoom({ id: 'room0001', code: '1234', name: 'あお', token: 'host', now, stepMs, config })
  const joined = joinRoom(made, { name: 'あか', code: '1234', token: 'guest', now, rng: seeded(1) })
  if (!joined.ok) throw new Error('入れなかった')
  const state = { ...makeState({ roll: [6, 6, 1], hp }, { roll: [5, 5, 2], hp }), config }
  const match: Match = { state, pending: [null, null] }
  return setOnline({ ...joined.state, match }, [true, true], now)
}

/**
 * サーバの代わり。部屋の様子を持ち、席の合言葉 token で座っている画面の WebSocket に様子を送る。
 * 画面が送った知らせは pump で、本物のサーバと同じ純粋な関数に通す。相手の席の操作は other で行う
 */
export function fakeRoom(room: RoomState, token: string) {
  let state = room
  const rng = seeded(7)
  const socket = () => socketTo('/api/rooms/')
  const mine = (): PlayerIndex => {
    const seat = seatOf(state, token)
    if (seat === null) throw new Error('画面の席が無い')
    return seat
  }
  /** 今の様子を送る。もう席が無ければ、部屋が無いと送る */
  const push = () => {
    const seat = seatOf(state, token)
    socket().receive(seat === null ? { type: 'gone' } : snapshot(state, seat, Date.now()))
  }
  const apply = (who: PlayerIndex, msg: ClientMessage) => {
    const now = Date.now()
    if (msg.type === 'act') {
      const r = play(state, who, msg.action, rng, now)
      if (r.ok) state = r.state
      else if (who === mine()) socket().receive({ type: 'rejected', reason: r.reason })
    } else if (msg.type === 'resign') state = resignRoom(state, who)
    else if (msg.type === 'again') state = again(state, who, rng, now)
    else state = leave(state, who, now).state
  }
  return {
    get state() {
      return state
    },
    /** 様子を書き換えて送る */
    set(next: RoomState) {
      state = next
      push()
    },
    push,
    /** 画面が送った知らせを受け、新しい様子を送る */
    pump() {
      const s = socket()
      const msgs = s.messages()
      s.sent = []
      for (const m of msgs) apply(mine(), m)
      push()
    },
    /** 相手の席の知らせを受け、新しい様子を送る */
    other(msg: ClientMessage) {
      apply(mine() === 0 ? 1 : 0, msg)
      push()
    },
  }
}
