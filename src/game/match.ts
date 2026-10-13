// 対局の進行。オンライン対戦ではサーバがこれをそのまま動かし、手元の対戦では画面がこれを動かす。
// 双方の行動を一つずつ受け取り、両方そろったらステップを解決し、ターンの終わりなら振り直して次のターンへ進める。
// 出す順は問わない。出した行動は、両方そろって公開されるまで相手には見せない。
// 演出の時間や画面の都合はここに持たない。画面は解決の結果を受け取り、自分の都合で見せる。

import {
  type Decks,
  extraDiceOf,
  isLegal,
  newGame,
  nextTurn,
  resolveStep,
  rollDice,
  STARTER_DECKS,
  turnOver,
} from './rules'
import type { Action, Config, GameState, PlayerIndex, Rng, StepReport } from './types'
import { DEFAULT_CONFIG } from './types'

export interface Match {
  /** 今の盤。決着していなければ、次に行動を出すステップを指す */
  state: GameState
  /** 今のステップに出した行動。出していなければ null。両方そろうまで相手には見せない */
  pending: [Action | null, Action | null]
}

/** ステップを解決した結果 */
export interface Resolution {
  /** 解決した直後の盤。ターンの終わりでも、振り直して次のターンへ進める前の盤 */
  state: GameState
  report: StepReport
}

/** 行動を受け付けなかった理由。決着している、このステップにはもう出した、合法でない */
export type Rejection = 'over' | 'already' | 'illegal'

export type Submitted = { ok: true; match: Match; resolved: Resolution | null } | { ok: false; reason: Rejection }

/** 対局を始める。decks は双方が持ち込む5枚で、省くと二人ともスターター */
export function newMatch(rng: Rng, config: Config = DEFAULT_CONFIG, decks: Decks = STARTER_DECKS): Match {
  return { state: newGame(rng, config, decks), pending: [null, null] }
}

/**
 * who の行動を受け付ける。両方そろったらステップを解決し、ターンの終わりなら振り直して次のターンへ進める。
 * rng は、ダイスを振り足す行動があればそのダイスを振るときと、振り直すときだけ使う
 */
export function submit(match: Match, who: PlayerIndex, action: Action, rng: Rng): Submitted {
  const { state, pending } = match
  if (state.winner !== null) return { ok: false, reason: 'over' }
  if (pending[who] !== null) return { ok: false, reason: 'already' }
  if (!isLegal(state, who, action)) return { ok: false, reason: 'illegal' }
  const both: [Action | null, Action | null] = [...pending]
  both[who] = action
  const [a0, a1] = both
  if (a0 === null || a1 === null) return { ok: true, match: { state, pending: both }, resolved: null }
  const extra: [number[], number[]] = [rollDice(extraDiceOf(a0), rng), rollDice(extraDiceOf(a1), rng)]
  const after = resolveStep(state, [a0, a1], extra)
  const report = after.history[after.history.length - 1]
  const next = after.winner === null && turnOver(after) ? nextTurn(after, rng) : after
  return { ok: true, match: { state: next, pending: [null, null] }, resolved: { state: after, report } }
}

/** who が降参する。相手の勝ちで決着し、出していた行動は捨てる */
export function resign(match: Match, who: PlayerIndex): Match {
  return forfeit(match, [who])
}

/**
 * losers の側を負けにして決着させる。両方とも負けなら引き分け。出していた行動は捨てる。
 * 持ち時間の切れた側を負けにするのに使う。決着した後と、誰も負けにしないときは何も変えない
 */
export function forfeit(match: Match, losers: readonly PlayerIndex[]): Match {
  if (match.state.winner !== null || losers.length === 0) return match
  const both = losers.includes(0) && losers.includes(1)
  const winner = both ? 'draw' : losers[0] === 0 ? 1 : 0
  return { state: { ...match.state, winner }, pending: [null, null] }
}

/** who に見せてよい対局の様子。相手がまだ公開していない行動は、出したかどうかだけを伝える */
export interface MatchView {
  state: GameState
  /** 自分が今のステップに出した行動 */
  mine: Action | null
  /** 相手が今のステップの行動をもう出したか */
  opponentReady: boolean
}

export function viewFor(match: Match, who: PlayerIndex): MatchView {
  return {
    state: match.state,
    mine: match.pending[who],
    opponentReady: match.pending[who === 0 ? 1 : 0] !== null,
  }
}
