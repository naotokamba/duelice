// テスト用の道具。本番コードからは使わない

import fc from 'fast-check'
import { ACTION_DEFS, type ActionKind, type CardId, DECK_SIZE, kindsOfCard, POOL, STARTER } from '../game/cards'
import { type Match, newMatch, submit } from '../game/match'
import { type Decks, legalActions, STARTER_DECKS } from '../game/rules'
import { slotsOf } from '../game/slots'
import type { Action, ChantState, GameState, Move, PlayerState, Rng } from '../game/types'
import { DEFAULT_CONFIG, WILD } from '../game/types'

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
  last?: Move[]
  /** 省くと、使ったカードの行動の種類 */
  acted?: PlayerState['acted']
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
    last: s.last ?? [],
    acted: s.acted ?? (s.usedCards ?? []).flatMap(kindsOfCard),
  })
  return { config: DEFAULT_CONFIG, turn: 1, step, players: [seat(a), seat(b)], history: [], winner: null }
}

/** カードの行動を一つずつ出したときの効果。置いた目をそのまま効果の目にする。もう一度出す行動の置き換えはしない */
export function movesFor(
  vals: readonly [readonly number[], readonly number[]],
  acts: readonly [Action, Action],
): [Move[], Move[]] {
  const one = (a: Action, v: readonly number[]): Move[] => (a.kind === 'pass' ? [] : [{ kind: a.kind, vals: [...v] }])
  return [one(acts[0], vals[0]), one(acts[1], vals[1])]
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

/** 置ける個数の目。同じ目が要る行動には、それを満たす目を作る */
const valsArb = (kind: ActionKind): fc.Arbitrary<number[]> => {
  const def = ACTION_DEFS[kind]
  return fc.constantFrom(...def.dice).chain((n) => {
    if (def.sameValues) return dieArb.map((v) => Array<number>(n).fill(v))
    return fc.array(dieArb, { minLength: n, maxLength: n })
  })
}

/** 直前のステップの効果になりうるもの。デッキのカードの効果を0から2個。行動の回数を増やす効果と、もう一度出す行動そのものは入らない */
const lastArb = (deck: readonly CardId[]): fc.Arbitrary<Move[]> => {
  const kinds = deck.flatMap(kindsOfCard).filter((k) => !ACTION_DEFS[k].multi && !ACTION_DEFS[k].echo)
  if (kinds.length === 0) return fc.constant([])
  return fc.array(
    fc.constantFrom(...kinds).chain((kind) => valsArb(kind).map((vals): Move => ({ kind, vals }))),
    { maxLength: 2 },
  )
}

/** 詠唱する行動を持つカード */
const chants = (card: CardId) => kindsOfCard(card).some((k) => ACTION_DEFS[k].chant)

/** 一人の席。効果で足したダイスや持ち越しでダイスが3個より多いこともある */
const seatArb = (step2: boolean, pool: boolean) =>
  (pool ? deckArb : fc.constant([...STARTER])).chain((deck) =>
    fc
      .record({
        roll: pool ? fc.array(dieArb, { minLength: 3, maxLength: 6 }) : rollArb,
        hp: fc.integer({ min: 1, max: 20 }),
        used: fc.integer({ min: 0, max: 2 }),
        pick: fc.nat(),
        chant: fc.constantFrom<ChantState>('none', 'charged', 'broken'),
        frozen: pool ? fc.option(dieArb) : fc.constant(null),
        burned: pool ? fc.integer({ min: 0, max: 12 }) : fc.constant(0),
        carry: pool ? fc.option(dieArb) : fc.constant(null),
        last: pool ? lastArb(deck) : fc.constant<Move[]>([]),
        wild: pool && step2 ? fc.integer({ min: 0, max: 3 }) : fc.constant(0),
      })
      .map((r): SeatSetup => {
        if (!step2) return { roll: r.roll, hp: r.hp, deck, frozen: r.frozen, carry: r.carry, last: r.last }
        // 一ステップ目に使ったカードは1枚で、使ったダイスは前から数える。詠唱の状態は詠唱できるカードを使ったときだけ
        // 好きな目のダイスを得たなら、振ったダイスは全て使い終わり、後ろに好きな目のダイスが加わる
        const card = deck[r.pick % deck.length]
        const used = r.wild > 0 ? r.roll.length : Math.min(r.used, r.roll.length - 1)
        return {
          roll: [...r.roll, ...Array<number>(r.wild).fill(WILD)],
          hp: r.hp,
          deck,
          usedDice: [...Array(used).keys()],
          usedCards: used > 0 ? [card] : [],
          chant: chants(card) && used === 1 ? r.chant : 'none',
          frozen: r.frozen,
          burned: r.burned,
          carry: r.carry,
          last: r.last,
        }
      }),
  )

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

/** 局面と、双方の合法手から一つずつ。resolveStep にそのまま渡せる */
export interface Play {
  s: GameState
  acts: [Action, Action]
}

/** base の局面から、双方の合法手を一つずつ選ぶ */
export function playArb(base: fc.Arbitrary<GameState>): fc.Arbitrary<Play> {
  return base.chain((s) =>
    fc
      .tuple(fc.constantFrom(...legalActions(s, 0)), fc.constantFrom(...legalActions(s, 1)))
      .map(([a0, a1]): Play => ({ s, acts: [a0, a1] })),
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
