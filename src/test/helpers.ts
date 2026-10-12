// テスト用の道具。本番コードからは使わない

import fc from 'fast-check'
import { ACTION_DEFS, type ActionKind, CARD_ORDER, type CardId } from '../game/cards'
import { type Match, newMatch, submit } from '../game/match'
import { legalActions } from '../game/rules'
import { slotsOf } from '../game/slots'
import type { Action, ChantState, GameState, PlayerState, Rng } from '../game/types'
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

/** 値だけで行動を作る。ダイス 0 から順に n 個を、前の置き場から詰めて置く */
export function actionOf(kind: ActionKind | 'pass', n = 0): Action {
  if (kind === 'pass') return { kind: 'pass' }
  const def = ACTION_DEFS[kind]
  const count = n || def.dice[0]
  return { kind, dice: Array.from({ length: slotsOf(def) }, (_, i) => (i < count ? i : null)) }
}

export const dieArb = fc.integer({ min: 1, max: 6 })
export const rollArb = fc.array(dieArb, { minLength: 3, maxLength: 3 })

/** 一ステップ目または二ステップ目の、ありうる局面 */
export const stateArb: fc.Arbitrary<GameState> = fc
  .record({
    r0: rollArb,
    r1: rollArb,
    hp0: fc.integer({ min: 1, max: 20 }),
    hp1: fc.integer({ min: 1, max: 20 }),
    step2: fc.boolean(),
    used0: fc.subarray([0, 1, 2], { maxLength: 2 }),
    used1: fc.subarray([0, 1, 2], { maxLength: 2 }),
    card0: fc.constantFrom<CardId>(...CARD_ORDER),
    card1: fc.constantFrom<CardId>(...CARD_ORDER),
    chant0: fc.constantFrom<ChantState>('none', 'charged', 'broken'),
    chant1: fc.constantFrom<ChantState>('none', 'charged', 'broken'),
  })
  .map((r) => {
    if (!r.step2) return makeState({ roll: r.r0, hp: r.hp0 }, { roll: r.r1, hp: r.hp1 }, 1)
    const seat = (roll: number[], hp: number, used: number[], card: CardId, chant: ChantState) => ({
      roll,
      hp,
      usedDice: used,
      usedCards: used.length > 0 ? [card] : [],
      chant: card === 'spear' && used.length === 1 ? chant : 'none',
    })
    return makeState(seat(r.r0, r.hp0, r.used0, r.card0, r.chant0), seat(r.r1, r.hp1, r.used1, r.card1, r.chant1), 2)
  })

/**
 * 合法手を乱数で選び続けて、対局を進める。途中の盤を全て返す。
 * ターンの終わりは、解決した直後の盤と、振り直した次のターンの盤の両方を入れる
 */
export function playRandom(seed: number, maxSteps = 60): { states: GameState[]; picks: [Action, Action][] } {
  const rng = seeded(seed)
  let m: Match = newMatch(rng)
  const states = [m.state]
  const picks: [Action, Action][] = []
  for (let i = 0; i < maxSteps && m.state.winner === null; i++) {
    const pick = (who: 0 | 1) => {
      const acts = legalActions(m.state, who)
      return acts[Math.floor(rng() * acts.length)]
    }
    const pair: [Action, Action] = [pick(0), pick(1)]
    picks.push(pair)
    const first = submit(m, 0, pair[0], rng)
    if (!first.ok) throw new Error(first.reason)
    const done = submit(first.match, 1, pair[1], rng)
    if (!done.ok || !done.resolved) throw new Error('解決しなかった')
    states.push(done.resolved.state)
    if (done.match.state !== done.resolved.state) states.push(done.match.state)
    m = done.match
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
