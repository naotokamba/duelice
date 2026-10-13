// 評価の一局。二人ともつよいCPUで、持ち込んだ5枚どうしを最後まで戦わせ、勝敗と、面白さの目安を数える。
// ダイスとCPUの迷いには別々の乱数を使う。席を入れ替えた二局で同じ種を使うと、同じダイスで戦うことになり、ぶれが減る。

import type { CardId } from '../game/cards'
import { ACTION_DEFS } from '../game/cards'
import { ESTIMATES, type Estimates, Thinker } from '../game/cpu'
import { newMatch, submit } from '../game/match'
import { DEFAULT_CONFIG, type GameState, type PlayerIndex, type Rng } from '../game/types'

/** 再現できる乱数 */
export function seeded(seed: number): Rng {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}

/** 一人の席で数えたもの */
export interface SeatStats {
  /** 一ステップ目と二ステップ目に選んだ回数 */
  steps: [number, number]
  /** 最適戦略がほぼ一択で、読み合いが無かった回数 */
  forced: [number, number]
  /** カードごとの、使ったステップの数 */
  cards: Partial<Record<CardId, number>>
  /** 一ステップ目に使ったカードごとのステップの数 */
  first: Partial<Record<CardId, number>>
  passes: number
}

/** 一局の結果 */
export interface GameRecord {
  /** 勝った席。引き分けは draw。上限のターンで決着しなければ draw */
  winner: PlayerIndex | 'draw'
  turns: number
  hp: [number, number]
  seats: [SeatStats, SeatStats]
  /** ステップごとの賭け金の合計。読みが外れたときに動く得点の、最適戦略での平均 */
  stakes: [number, number]
}

/** 決着しないまま続く対局を止めるターン */
export const TURN_LIMIT = 40

/** 最適戦略の確率がこれを超えたら、一択とみなす */
const PURE = 0.99

const emptySeat = (): SeatStats => ({ steps: [0, 0], forced: [0, 0], cards: {}, first: {}, passes: 0 })

/** 確率に従って一つ選ぶ */
function sample(probs: number[], rng: Rng): number {
  let r = rng()
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i]
    if (r <= 0) return i
  }
  return probs.length - 1
}

/**
 * 均衡での賭け金。双方が最適戦略で選んだときの、得点と価値の差の絶対値の平均。
 * 読みが当たるか外れるかで、どれだけ得点が動くかを表す
 */
export function stakesOf(payoff: number[][], row: number[], col: number[], value: number): number {
  let sum = 0
  payoff.forEach((r, i) => {
    r.forEach((v, j) => {
      sum += row[i] * col[j] * Math.abs(v - value)
    })
  })
  return sum
}

/**
 * decks の二人を、つよいCPUどうしで最後まで戦わせる。席0が decks[0]。
 * estimates は席ごとの見積もりで、省くと二人とも既定の見積もり。visit には、行動を選ぶ前の盤を順に渡す
 */
export function playGame(
  decks: [readonly CardId[], readonly CardId[]],
  seed: number,
  estimates: [Estimates, Estimates] = [ESTIMATES, ESTIMATES],
  visit?: (state: GameState) => void,
): GameRecord {
  const dice = seeded(seed)
  const mind = seeded(seed ^ 0x5bd1e995)
  let m = newMatch(dice, DEFAULT_CONFIG, decks)
  // 見積もりが同じなら一つの CPU で二人分を解く。行列ゲームは席0から見て一度だけ作る
  const same = estimates[0] === estimates[1]
  const thinkers = same ? [new Thinker(estimates[0])] : estimates.map((e) => new Thinker(e))
  const seats: [SeatStats, SeatStats] = [emptySeat(), emptySeat()]
  const stakes: [number, number] = [0, 0]
  const pick = (state: GameState) => {
    if (same) {
      const g = thinkers[0].solve(state, 0)
      stakes[state.step - 1] += stakesOf(g.payoff, g.sol.row, g.sol.col, g.sol.value)
      return [
        { action: g.mine[sample(g.sol.row, mind)], probs: g.sol.row },
        { action: g.theirs[sample(g.sol.col, mind)], probs: g.sol.col },
      ]
    }
    return ([0, 1] as const).map((who) => {
      const g = thinkers[who].solve(state, who)
      if (who === 0) stakes[state.step - 1] += stakesOf(g.payoff, g.sol.row, g.sol.col, g.sol.value)
      return { action: g.mine[sample(g.sol.row, mind)], probs: g.sol.row }
    })
  }
  while (m.state.winner === null && m.state.turn <= TURN_LIMIT) {
    const state = m.state
    const step = state.step - 1
    visit?.(state)
    const picks = pick(state)
    picks.forEach(({ action, probs }, who) => {
      const seat = seats[who]
      seat.steps[step]++
      if (Math.max(...probs) > PURE) seat.forced[step]++
      if (action.kind === 'pass') seat.passes++
      else {
        const card = ACTION_DEFS[action.kind].card
        seat.cards[card] = (seat.cards[card] ?? 0) + 1
        if (step === 0) seat.first[card] = (seat.first[card] ?? 0) + 1
      }
    })
    const first = submit(m, 0, picks[0].action, dice)
    if (!first.ok) throw new Error(`席0の行動を受け付けなかった: ${first.reason}`)
    const done = submit(first.match, 1, picks[1].action, dice)
    if (!done.ok) throw new Error(`席1の行動を受け付けなかった: ${done.reason}`)
    m = done.match
  }
  const { state } = m
  return {
    winner: state.winner ?? 'draw',
    turns: state.history.at(-1)?.turn ?? 0,
    hp: [state.players[0].hp, state.players[1].hp],
    seats,
    stakes,
  }
}
