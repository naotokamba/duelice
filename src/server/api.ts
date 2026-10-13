// 部屋を作る、入るときに画面から届く中身を確かめる純粋な関数。入口 src/server.ts はこれを呼んで、部屋の Durable Object に渡すだけにする。

import { type Config, DEFAULT_CONFIG } from '../game/types'
import { cleanName, validCode } from '../online/protocol'

/** 部屋の名前の形。英小文字と数字の8文字。これ以外の名前では Durable Object を作らない */
const ROOM_ID = /^[a-z0-9]{8}$/

export function validRoomId(id: string): boolean {
  return ROOM_ID.test(id)
}

/** 部屋の名前を、0 以上 1 未満の乱数 8 個から作る */
export function roomIdFrom(random: readonly number[]): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return random.map((r) => letters[Math.floor(r * letters.length)]).join('')
}

export interface CreateRequest {
  name: string
  code: string
  /** 開発のテストだけ。1ステップの持ち時間を短くする */
  stepMs?: number
  /** 開発のテストだけ。体力を少なくして早く決着させる */
  config?: Config
}

export interface JoinRequest {
  name: string
  code: string
}

/** 名前と合言葉を確かめる。どちらかが正しくなければ null */
export function parseJoin(body: unknown): JoinRequest | null {
  const { name, code } = Object(body) as { name?: unknown; code?: unknown }
  if (typeof name !== 'string' || typeof code !== 'string') return null
  const clean = cleanName(name)
  if (clean === null || !validCode(code)) return null
  return { name: clean, code }
}

/**
 * 部屋を作る中身を確かめる。dev のときだけ、テストのための持ち時間 stepMs と体力 hp を受け付ける。
 * 本番では送られてきても無視する
 */
export function parseCreate(body: unknown, dev: boolean): CreateRequest | null {
  const join = parseJoin(body)
  if (!join) return null
  if (!dev) return join
  const { stepMs, hp } = body as { stepMs?: unknown; hp?: unknown }
  const request: CreateRequest = { ...join }
  if (positive(stepMs)) request.stepMs = stepMs
  if (positive(hp)) request.config = { ...DEFAULT_CONFIG, maxHp: hp }
  return request
}

/** 正の整数か */
function positive(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) > 0
}
