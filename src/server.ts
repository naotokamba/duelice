// Worker の入口。オンライン対戦の /api だけをここで受け、ほかは TanStack Start に任せる。
// Durable Object のクラスは、wrangler が見つけられるようにここから export する。
//   GET  /api/lobby                   ロビーの WebSocket。部屋の一覧が届く
//   POST /api/rooms                   部屋を作る。{ name, code } を受け、{ id, token } を返す
//   POST /api/rooms/:id/join          部屋に入る。{ name, code } を受け、{ token } か { error } を返す
//   GET  /api/rooms/:id/ws?token=...  部屋の WebSocket。席の合言葉 token でつなぐ

import handler from '@tanstack/react-start/server-entry'
import type { JoinError } from './online/protocol'
import { parseCreate, parseJoin, roomIdFrom, validRoomId } from './server/api'

export { Lobby } from './server/lobby-object'
export { Room } from './server/room-object'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const refuse = (error: JoinError, status: number) => json({ error }, status)

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function randoms(n: number): number[] {
  return [...crypto.getRandomValues(new Uint32Array(n))].map((x) => x / 2 ** 32)
}

async function create(request: Request, env: Env): Promise<Response> {
  const args = parseCreate(await body(request), import.meta.env.DEV)
  if (!args) return refuse('bad', 400)
  const token = crypto.randomUUID()
  // 名前がぶつかったら作り直す。8文字なので、ほとんど一度で済む
  for (let i = 0; i < 3; i++) {
    const id = roomIdFrom(randoms(8))
    if (await env.ROOM.getByName(id).create({ ...args, id, token })) return json({ id, token })
  }
  return json({ error: 'busy' }, 503)
}

async function join(request: Request, env: Env, id: string): Promise<Response> {
  const args = parseJoin(await body(request))
  if (!args) return refuse('bad', 400)
  const token = crypto.randomUUID()
  const r = await env.ROOM.getByName(id).join({ ...args, token })
  if (r !== 'ok') return refuse(r, r === 'gone' ? 404 : 409)
  return json({ token })
}

async function api(request: Request, env: Env, path: string[]): Promise<Response> {
  const method = request.method
  if (path.length === 1 && path[0] === 'lobby' && method === 'GET') return env.LOBBY.getByName('lobby').fetch(request)
  if (path[0] !== 'rooms') return new Response('not found', { status: 404 })
  if (path.length === 1 && method === 'POST') return create(request, env)
  const id = path[1] ?? ''
  if (!validRoomId(id)) return refuse('gone', 404)
  if (path.length === 3 && path[2] === 'join' && method === 'POST') return join(request, env, id)
  if (path.length === 3 && path[2] === 'ws' && method === 'GET') return env.ROOM.getByName(id).fetch(request)
  return new Response('not found', { status: 404 })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return api(request, env, url.pathname.slice('/api/'.length).split('/'))
    return handler.fetch(request)
  },
} satisfies ExportedHandler<Env>
