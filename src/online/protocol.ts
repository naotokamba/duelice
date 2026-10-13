// オンライン対戦の取り決め。サーバ src/server と画面 src/components の両方が読む、やりとりの形と決まった数だけを置く。
// サーバは席0と席1のまま送り、画面は自分の席から見た形に入れ替えて使う。

import type { MatchView, Rejection, Resolution } from '../game/match'
import type { Action, PlayerIndex } from '../game/types'

/** 名前の長さの上限。数えるのは見た目の文字の数 */
export const NAME_MAX = 12

/** 1ステップの持ち時間。これを過ぎても行動を出していない側の負け */
export const STEP_MS = 60_000

/**
 * 解決してから次のステップの持ち時間を数え始めるまでの猶予。公開の演出と、次のステップを知らせる帯の分。
 * 画面の演出の長さがこれを超えないことは、画面のテストで確かめる
 */
export const REVEAL_GRACE_MS = 7_000

/** 対局が始まってから最初のステップの持ち時間を数え始めるまでの猶予。最初のターンを知らせる帯の分 */
export const START_GRACE_MS = 2_000

/** 対局していない部屋に誰もつながっていなくなってから、部屋を消すまでの猶予。再読み込みでつなぎ直す間は消さない */
export const EMPTY_GRACE_MS = 15_000

/** 部屋の様子。相手を待っている、対局中、決着した */
export type RoomStatus = 'waiting' | 'playing' | 'over'

/** 決着の理由。体力、持ち時間切れ、降参 */
export type EndReason = 'hp' | 'timeout' | 'resign'

/** ロビーの一覧の一行 */
export interface LobbyRoom {
  id: string
  /** 部屋を作った人の名前 */
  host: string
  /** 相手を待っているか、二人そろっているか */
  status: 'waiting' | 'playing'
  createdAt: number
}

/** ロビーがつながっている画面に送る、部屋の一覧 */
export interface LobbyMessage {
  type: 'rooms'
  rooms: LobbyRoom[]
}

/** 部屋が、席についている一人に送る様子。席の順のまま送る */
export interface RoomSnapshot {
  type: 'room'
  id: string
  /** 入るための合言葉。席についている人にだけ送る */
  code: string
  /** 受け取る人の席 */
  seat: PlayerIndex
  names: [string | null, string | null]
  online: [boolean, boolean]
  status: RoomStatus
  /** 部屋で何局目か。新しい対局になったら画面は卓を作り直す */
  matchNo: number
  /** 受け取る人に見せてよい対局の様子。相手を待っている間は null */
  view: MatchView | null
  /** この対局で一番新しい解決。n はこの対局で何回目の解決か。画面は新しいものだけを公開する */
  last: { n: number; resolution: Resolution } | null
  /** 今のステップの持ち時間の期限。サーバの時計の時刻 */
  deadline: number | null
  /** 1ステップの持ち時間 */
  stepMs: number
  /** 送った時のサーバの時計の時刻。画面は自分の時計とのずれをこれで直す */
  now: number
  end: { reason: EndReason } | null
  /** 決着した後に、もう一戦を押したか */
  again: [boolean, boolean]
}

/** 部屋からの知らせ。様子、受け付けなかった行動、部屋がもう無いこと */
export type RoomMessage = RoomSnapshot | { type: 'rejected'; reason: Rejection } | { type: 'gone' }

/** 画面から部屋への知らせ。行動を出す、降参する、もう一戦、部屋を出る */
export type ClientMessage = { type: 'act'; action: Action } | { type: 'resign' } | { type: 'again' } | { type: 'leave' }

/** 部屋を作る、入るときに断る理由。合言葉が違う、満席、部屋が無い、名前や合言葉の形が正しくない */
export type JoinError = 'code' | 'full' | 'gone' | 'bad'

/** 名前を整える。前後の空白を除き、空か長すぎれば null */
export function cleanName(raw: string): string | null {
  const name = raw.trim()
  const length = [...name].length
  return length === 0 || length > NAME_MAX ? null : name
}

/** 合言葉は半角数字4桁 */
export function validCode(code: string): boolean {
  return /^\d{4}$/.test(code)
}
