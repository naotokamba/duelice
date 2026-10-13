// オンライン対戦のサーバとのやりとり。部屋を作る、合言葉で入る、WebSocket の行き先を、サーバの入口 src/server.ts に合わせて書く。

import type { JoinError } from '../online/protocol'
import type { Session } from './onlineStore'

/** 部屋に入れたらその席、入れなければ理由。サーバにつながらなければ network */
export type Entered = { ok: true; session: Session } | { ok: false; error: JoinError | 'network' }

/** 開発のテストだけ。作る部屋の持ち時間と体力。本番のサーバは無視する */
export interface RoomOptions {
  stepMs?: number
  hp?: number
}

const ERRORS: readonly string[] = ['code', 'full', 'gone', 'bad'] satisfies JoinError[]

async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function refused(r: Record<string, unknown> | null): Entered {
  const error = r?.error
  return { ok: false, error: typeof error === 'string' && ERRORS.includes(error) ? (error as JoinError) : 'network' }
}

/** 部屋を作り、作った人の席に着く */
export async function createRoom(body: { name: string; code: string } & RoomOptions): Promise<Entered> {
  const r = await post('/api/rooms', body)
  if (typeof r?.id === 'string' && typeof r.token === 'string')
    return { ok: true, session: { id: r.id, token: r.token } }
  return refused(r)
}

/** 合言葉で部屋に入る */
export async function joinRoom(id: string, body: { name: string; code: string }): Promise<Entered> {
  const r = await post(`/api/rooms/${encodeURIComponent(id)}/join`, body)
  if (typeof r?.token === 'string') return { ok: true, session: { id, token: r.token } }
  return refused(r)
}

/** 今の画面と同じ場所の WebSocket の行き先 */
export function socketUrl(path: string): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`
}

export const lobbyPath = '/api/lobby'
export const roomPath = (s: Session) => `/api/rooms/${encodeURIComponent(s.id)}/ws?token=${encodeURIComponent(s.token)}`
