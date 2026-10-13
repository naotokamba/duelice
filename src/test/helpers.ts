// テスト用の道具。本番コードからは使わない

import fc from 'fast-check'
import { ACTION_DEFS, type ActionKind, type CardId, DECK_SIZE, kindsOfCard, POOL, STARTER } from '../game/cards'
import { type Match, newMatch, submit } from '../game/match'
import { type Decks, extraDiceOf, legalActions, STARTER_DECKS } from '../game/rules'
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
  /** 省くとスターター */
  deck?: readonly CardId[]
  frozen?: number | null
  burned?: number
  carry?: number | null
}

/** 任意の局面を作る */
export function makeState(a: SeatSetup, b: SeatSetup, step: 1 | 2 = 1): GameState {
  const seat = (s: SeatSetup): PlayerState => ({
    hp: s.hp ?? DEFAULT_CONFIG.maxHp,
    roll: s.roll,
    usedDice: s.usedDice ?? [],
    usedCards: s.usedCards ?? [],
    chant: s.chant ?? 'none',
    deck: [...(s.deck ?? STARTER)],
    frozen: s.frozen ?? null,
    burned: s.burned ?? 0,
    carry: s.carry ?? null,
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

/** 選べるカードから互いに違う5枚 */
export const deckArb: fc.Arbitrary<CardId[]> = fc.shuffledSubarray([...POOL], {
  minLength: DECK_SIZE,
  maxLength: DECK_SIZE,
})

/** 詠唱する行動を持つカード */
const chants = (card: CardId) => kindsOfCard(card).some((k) => ACTION_DEFS[k].chant)

/** 一人の席。振り足しや持ち越しでダイスが3個より多いこともある */
const seatArb = (step2: boolean, pool: boolean) =>
  fc
    .record({
      deck: pool ? deckArb : fc.constant([...STARTER]),
      roll: pool ? fc.array(dieArb, { minLength: 3, maxLength: 6 }) : rollArb,
      hp: fc.integer({ min: 1, max: 20 }),
      used: fc.integer({ min: 0, max: 2 }),
      pick: fc.nat(),
      chant: fc.constantFrom<ChantState>('none', 'charged', 'broken'),
      frozen: pool ? fc.option(dieArb) : fc.constant(null),
      burned: pool ? fc.integer({ min: 0, max: 12 }) : fc.constant(0),
      carry: pool ? fc.option(dieArb) : fc.constant(null),
    })
    .map((r): SeatSetup => {
      if (!step2) return { roll: r.roll, hp: r.hp, deck: r.deck, frozen: r.frozen, carry: r.carry }
      // 一ステップ目に使ったカードは1枚で、使ったダイスは前から数える。詠唱の状態は詠唱できるカードを使ったときだけ
      const card = r.deck[r.pick % r.deck.length]
      const used = Math.min(r.used, r.roll.length - 1)
      return {
        roll: r.roll,
        hp: r.hp,
        deck: r.deck,
        usedDice: [...Array(used).keys()],
        usedCards: used > 0 ? [card] : [],
        chant: chants(card) && used === 1 ? r.chant : 'none',
        frozen: r.frozen,
        burned: r.burned,
        carry: r.carry,
      }
    })

/** 局面。pool なら選べるカードから選んだ5枚で、そうでなければ二人ともスターター */
const gameArb = (pool: boolean): fc.Arbitrary<GameState> =>
  fc
    .boolean()
    .chain((step2) =>
      fc.tuple(seatArb(step2, pool), seatArb(step2, pool)).map(([a, b]) => makeState(a, b, step2 ? 2 : 1)),
    )

/** 一ステップ目または二ステップ目の、二人ともスターターのありうる局面 */
export const stateArb: fc.Arbitrary<GameState> = gameArb(false)

/** 一ステップ目または二ステップ目の、選べるカードから5枚ずつ持ち込んだ局面 */
export const poolStateArb: fc.Arbitrary<GameState> = gameArb(true)

/** 局面と、双方の合法手から一つずつと、振り足すダイスの目。resolveStep にそのまま渡せる */
export interface Play {
  s: GameState
  acts: [Action, Action]
  extra: [number[], number[]]
}

/** base の局面から、双方の合法手を一つずつ選び、振り足す行動にはその数だけダイスの目を添える */
export function playArb(base: fc.Arbitrary<GameState>): fc.Arbitrary<Play> {
  const extraArb = (a: Action) => fc.array(dieArb, { minLength: extraDiceOf(a), maxLength: extraDiceOf(a) })
  return base.chain((s) =>
    fc
      .tuple(fc.constantFrom(...legalActions(s, 0)), fc.constantFrom(...legalActions(s, 1)))
      .chain(([a0, a1]) =>
        fc.tuple(extraArb(a0), extraArb(a1)).map(([e0, e1]): Play => ({ s, acts: [a0, a1], extra: [e0, e1] })),
      ),
  )
}

/**
 * 合法手を乱数で選び続けて、対局を進める。途中の盤を全て返す。
 * ターンの終わりは、解決した直後の盤と、振り直した次のターンの盤の両方を入れる
 */
export function playRandom(
  seed: number,
  maxSteps = 60,
  decks: Decks = STARTER_DECKS,
): { states: GameState[]; picks: [Action, Action][] } {
  const rng = seeded(seed)
  let m: Match = newMatch(rng, DEFAULT_CONFIG, decks)
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
