// テスト用の道具。本番コードからは使わない

import fc from 'fast-check'
import { ACTION_DEFS } from '../game/cards'
import { legalActions, newGame, nextTurn, resolveStep, turnOver } from '../game/rules'
import type { Action, ActionKind, ChantState, GameState, PlayerState, Rng } from '../game/types'
import { DEFAULT_CONFIG } from '../game/types'

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

export interface SeatSetup {
  roll: number[]
  hp?: number
  usedDice?: number[]
  usedCards?: PlayerState['usedCards']
  chant?: ChantState
}

/** 任意の局面を作る */
export function makeState(a: SeatSetup, b: SeatSetup, step: 1 | 2 = 1): GameState {
  const seat = (s: SeatSetup): PlayerState => ({
    hp: s.hp ?? DEFAULT_CONFIG.maxHp,
    roll: s.roll,
    usedDice: s.usedDice ?? [],
    usedCards: s.usedCards ?? [],
    chant: s.chant ?? 'none',
  })
  return { config: DEFAULT_CONFIG, turn: 1, step, players: [seat(a), seat(b)], history: [], winner: null }
}

/** 値だけで行動を作る。dice の位置は 0 から順に振る */
export function act(kind: ActionKind | 'pass', n = 0): Action {
  if (kind === 'pass') return { kind: 'pass' }
  return { kind, dice: Array.from({ length: n || ACTION_DEFS[kind].dice[0] }, (_, i) => i) }
}

export const dieArb = fc.integer({ min: 1, max: 6 })
export const rollArb = fc.array(dieArb, { minLength: 3, maxLength: 3 })

/** 合法手を乱数で選び続けて、途中の局面を全て返す */
export function playRandom(seed: number, maxSteps = 60): { states: GameState[]; picks: [Action, Action][] } {
  const rng = seeded(seed)
  let s = newGame(rng)
  const states = [s]
  const picks: [Action, Action][] = []
  for (let i = 0; i < maxSteps && s.winner === null; i++) {
    const pick = (who: 0 | 1) => {
      const acts = legalActions(s, who)
      return acts[Math.floor(rng() * acts.length)]
    }
    const pair: [Action, Action] = [pick(0), pick(1)]
    picks.push(pair)
    s = resolveStep(s, pair)
    states.push(s)
    if (s.winner === null && turnOver(s)) {
      s = nextTurn(s, rng)
      states.push(s)
    }
  }
  return { states, picks }
}

/** 左右の席を入れ替えた局面 */
export function swapSeats(s: GameState): GameState {
  return {
    ...s,
    players: [s.players[1], s.players[0]],
    winner: s.winner === null || s.winner === 'draw' ? s.winner : s.winner === 0 ? 1 : 0,
  }
}
