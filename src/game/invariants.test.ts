// どのカードにも、これから足すカードにも成り立つべき性質。
// 乱数で大量の局面と行動を作って確かめる。カードを足したら何もしなくてもここで検査される。
// 局面は、二人ともスターターのものと、選べるカードから5枚ずつ持ち込んだものの両方から作る。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { deckArb, dieArb, playArb, playRandom, poolStateArb, stateArb, swapSeats } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, type ActionKind, kindsOfCard, UNHURT } from './cards'
import {
  actionDice,
  actionKey,
  burnOf,
  clash,
  ctxOf,
  diceValues,
  extraDiceOf,
  isLegal,
  legalActions,
  movesOf,
  newGame,
  nextTurn,
  partsOf,
  placeableDice,
  resolveStep,
  stepDamage,
  strikes,
  turnOver,
} from './rules'
import { filled, MARK_SLOT, readsMark, requiredSlots, slotsOf } from './slots'
import type { Action, GameState, Move, Play, PlayerIndex, StepReport } from './types'
import { DEFAULT_CONFIG, WILD } from './types'

const seedArb = fc.integer({ min: 1, max: 2 ** 31 - 1 })

/** スターターどうしの局面か、選べるカードから5枚ずつ持ち込んだ局面 */
const anyStateArb: fc.Arbitrary<GameState> = fc.oneof(stateArb, poolStateArb)

/** 局面と、その局面の双方の合法手から一つずつと、振り足すダイスの目 */
const anyPlayArb = playArb(anyStateArb)

/** 双方の様子 */
const ctxs = (s: GameState) => [ctxOf(s, 0), ctxOf(s, 1)] as const

/** 双方が起こす効果 */
const movesOfBoth = (s: GameState, acts: [Action, Action]): [Move[], Move[]] => [
  movesOf(s.players[0], acts[0]),
  movesOf(s.players[1], acts[1]),
]

/** 効果の定義 */
const defOf = (m: Move) => ACTION_DEFS[m.kind]

/** 先に当たる効果か */
const fast = (m: Move) => !!defOf(m).fast

/** 倒れて起きなかった効果を除いた、起きた効果 */
const liveOf = (moves: Move[], cancelled: boolean) => (cancelled ? moves.filter(fast) : moves)

/** 記録から、who の起きた効果 */
const liveIn = (r: StepReport, who: PlayerIndex) => liveOf(r.moves[who], r.cancelled[who])

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** 目の中で一番大きいもの。無ければ null */
const largest = (xs: number[]) => (xs.length === 0 ? null : Math.max(...xs))

const other = (i: PlayerIndex): PlayerIndex => (i === 0 ? 1 : 0)

/** 行動の種類と、その行動に置ける個数の目 */
const kindWithValsArb = fc
  .constantFrom(...ACTION_KINDS)
  .chain((kind) =>
    fc
      .constantFrom(...ACTION_DEFS[kind].dice)
      .chain((n) => fc.tuple(fc.constant(kind), fc.array(dieArb, { minLength: n, maxLength: n }))),
  )

/**
 * 局面と、行動の種類と、その行の置き場ごとのダイスと、置き場の並べ替え。
 * 空けた置き場、使い終わったダイス、同じダイスの重複も混ぜて、合法でない置き方も作る
 */
const placedArb = anyStateArb.chain((s) =>
  fc.constantFrom(...ACTION_KINDS).chain((kind) => {
    const n = slotsOf(ACTION_DEFS[kind])
    const slots = [...Array(n).keys()]
    const dice = [...Array(Math.max(s.players[0].roll.length, s.players[1].roll.length)).keys()]
    return fc.tuple(
      fc.constant(s),
      fc.constant(kind),
      fc.array(fc.constantFrom(null, ...dice), { minLength: n, maxLength: n }),
      fc.shuffledSubarray(slots, { minLength: n, maxLength: n }),
    )
  }),
)

/** 威力と、障壁が減らす量と、自分が焼ける量 */
const effectOf = (kind: ActionKind, vals: number[]) => [
  ACTION_DEFS[kind].power?.(vals, UNHURT),
  ACTION_DEFS[kind].guard?.(vals),
  ACTION_DEFS[kind].burn?.(vals),
]

describe('合法手の列挙', () => {
  it('列挙された手は全て合法で、何もしないが必ず含まれる', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const acts = legalActions(s, who)
          expect(acts[0]).toEqual({ kind: 'pass' })
          for (const a of acts) expect(isLegal(s, who, a)).toBe(true)
        }
      }),
    )
  })
  it('同じ手とみなす鍵は重複しない', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const keys = legalActions(s, who).map((a) => actionKey(s, who, a))
          expect(new Set(keys).size).toBe(keys.length)
        }
      }),
    )
  })
  /** n 個の置き場の、空けるか、dice のどれかを置くかの全ての組 */
  const allSlots = (n: number, dice: number[]): (number | null)[][] =>
    n === 0 ? [[]] : allSlots(n - 1, dice).flatMap((rest) => [null, ...dice].map((d) => [d, ...rest]))
  /** 好きな目のダイスを置いた置き場に、1から6のどれかを選ぶ全ての組。凍らされた目も試す */
  const allSets = (s: GameState, who: PlayerIndex, dice: (number | null)[]): ((number | null)[] | undefined)[] => {
    const wild = dice.map((d) => d !== null && s.players[who].roll[d] === WILD)
    if (!wild.includes(true)) return [undefined]
    let out: (number | null)[][] = [[]]
    for (const w of wild)
      out = out.flatMap((rest) => (w ? [1, 2, 3, 4, 5, 6].map((v) => [...rest, v]) : [[...rest, null]]))
    return out
  }
  /** カードの行動一つの、合法な置き方の全て。行動の回数を増やすカードは、一緒に使う行動が無いので入らない */
  const allPlays = (s: GameState, who: PlayerIndex): Play[] =>
    ACTION_KINDS.flatMap((kind) =>
      allSlots(slotsOf(ACTION_DEFS[kind]), [...s.players[who].roll.keys()]).flatMap((dice) =>
        allSets(s, who, dice).map((set): Play => (set ? { kind, dice, set } : { kind, dice })),
      ),
    )
  it('列挙から漏れた合法手は無い。全ての置き場に、空けるかどのダイスを置くかと、好きな目のダイスの目を全て試して、合法なら同じ手が列挙にある', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const listed = new Set(legalActions(s, who).map((a) => actionKey(s, who, a)))
          for (const a of allPlays(s, who)) {
            if (!isLegal(s, who, a)) continue
            expect(listed.has(actionKey(s, who, a))).toBe(true)
          }
        }
      }),
      { numRuns: 60 },
    )
  }, 30_000)
  it('行動の回数を増やすカードで一緒に使う手も、合法なら同じ手が列挙にある', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          if (!p.deck.flatMap(kindsOfCard).some((k) => ACTION_DEFS[k].multi)) continue
          const listed = new Set(legalActions(s, who).map((a) => actionKey(s, who, a)))
          // 一緒に使う候補は、それだけで合法な置き方。一つは全てを、二つの組は多すぎれば間を飛ばして試す
          const plays = allPlays(s, who)
          const singles = plays.filter((x) => isLegal(s, who, x))
          const tops = plays.filter((x) => ACTION_DEFS[x.kind].multi)
          const pairs = singles.flatMap((x, i) => singles.slice(i + 1).map((y) => [x, y]))
          const stride = Math.max(1, Math.floor(pairs.length / 400))
          const sets = [...singles.map((x) => [x]), ...pairs.filter((_, k) => k % stride === 0)]
          for (const top of tops) {
            for (const more of sets) {
              const a: Action = { ...top, with: more }
              if (!isLegal(s, who, a)) continue
              expect(listed.has(actionKey(s, who, a))).toBe(true)
            }
          }
        }
      }),
      { numRuns: 40 },
    )
  }, 30_000)
  it('同じ手とみなした行動は、相手がどう動いても同じ盤になる。どのダイスを使ったかは問わず、残った目の組だけが効く', () => {
    /** 解決した後の盤のうち、次のステップに効くもの */
    const board = (before: GameState, after: GameState, who: PlayerIndex, a: Action) => {
      const p = after.players[who]
      const forged = movesOf(before.players[who], a).some((m) => defOf(m).transmute)
      const rest = before.step === 2 || forged ? null : p.roll.filter((_, i) => !p.usedDice.includes(i)).sort()
      return {
        hp: after.players.map((x) => x.hp),
        rest,
        mine: [
          p.burned,
          p.chant,
          p.carry,
          [...p.usedCards].sort(),
          [...p.acted].sort(),
          p.last.map((m) => m.kind).sort(),
        ],
        theirs: after.players[other(who)].frozen,
        winner: after.winner,
      }
    }
    fc.assert(
      fc.property(anyStateArb, fc.nat(), (s, pick) => {
        for (const who of [0, 1] as const) {
          const theirs = legalActions(s, other(who))
          const answer = theirs[pick % theirs.length]
          const byKey = new Map<string, Action[]>()
          for (const a of allPlays(s, who).filter((x) => isLegal(s, who, x))) {
            const key = actionKey(s, who, a)
            byKey.set(key, [...(byKey.get(key) ?? []), a])
          }
          for (const same of byKey.values()) {
            const [a, b] = [same[0], same[same.length - 1]]
            const acts = (x: Action): [Action, Action] => (who === 0 ? [x, answer] : [answer, x])
            // 振り足すダイスは同じ目にそろえる
            const extra = (x: Action): [number[], number[]] => {
              const e = [
                Array(extraDiceOf(s, 0, acts(x)[0])).fill(3),
                Array(extraDiceOf(s, 1, acts(x)[1])).fill(3),
              ] as [number[], number[]]
              return e
            }
            const ra = resolveStep(s, acts(a), extra(a))
            const rb = resolveStep(s, acts(b), extra(b))
            expect(board(s, rb, who, b)).toEqual(board(s, ra, who, a))
          }
        }
      }),
      { numRuns: 40 },
    )
  }, 30_000)
  it('持ち込んでいないカードの行動は合法でない', () => {
    fc.assert(
      fc.property(placedArb, ([s, kind, dice]) => {
        for (const who of [0, 1] as const) {
          if (!s.players[who].deck.includes(ACTION_DEFS[kind].card)) expect(isLegal(s, who, { kind, dice })).toBe(false)
        }
      }),
    )
  })
  it('凍らされた目のダイスを置いた行動は合法でない', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          expect(placeableDice(p).every((i) => p.roll[i] !== p.frozen && !p.usedDice.includes(i))).toBe(true)
          for (const a of legalActions(s, who)) expect(diceValues(p, a)).not.toContain(p.frozen)
          // 好きな目のダイスに、凍らされた目は選べない
          for (const a of legalActions(s, who))
            for (const x of partsOf(a)) expect(x.set ?? []).not.toContain(p.frozen ?? 'none')
        }
      }),
    )
  })
  it('同じ手とみなした行動は効果も同じ。印の置き場の目を値にする行動は印の目を残して、ほかの行動は目を全て並べ替えても変わらない', () => {
    fc.assert(
      fc.property(kindWithValsArb, ([kind, vals]) => {
        const keep = readsMark(ACTION_DEFS[kind]) ? 1 : 0
        const moved = [...vals.slice(0, keep), ...vals.slice(keep).reverse()]
        expect(effectOf(kind, moved)).toEqual(effectOf(kind, vals))
      }),
    )
  })
  it('行動の長さはその行の置き場の数。合わなければ合法でない', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          for (const a of legalActions(s, who)) {
            if (a.kind === 'pass') continue
            expect(a.dice.length).toBe(slotsOf(ACTION_DEFS[a.kind]))
            expect(isLegal(s, who, { kind: a.kind, dice: [...a.dice, null] })).toBe(false)
            expect(isLegal(s, who, { kind: a.kind, dice: a.dice.slice(1) })).toBe(false)
          }
        }
      }),
    )
  })
})

describe('置き場', () => {
  it('空けられない置き場が一つでも空なら合法でない。空けられない置き場は行の前にあり、印の置き場もそこに入る', () => {
    fc.assert(
      fc.property(placedArb, ([s, kind, dice]) => {
        const def = ACTION_DEFS[kind]
        if (readsMark(def)) expect(MARK_SLOT).toBeLessThan(requiredSlots(def))
        fc.pre(dice.slice(0, requiredSlots(def)).includes(null))
        for (const who of [0, 1] as const) expect(isLegal(s, who, { kind, dice })).toBe(false)
      }),
    )
  })
  it('印の置き場を持たない行動は、空けられない置き場を埋めたままダイスを置き場の間で動かせば、合法かどうかも効果も同じ手かどうかも変わらない', () => {
    fc.assert(
      fc.property(placedArb, ([s, kind, dice, order]) => {
        const def = ACTION_DEFS[kind]
        fc.pre(!readsMark(def))
        const a: Action = { kind, dice }
        const b: Action = { kind, dice: order.map((k) => dice[k]) }
        const filled = (xs: (number | null)[]) => xs.slice(0, requiredSlots(def)).every((d) => d !== null)
        fc.pre(filled(a.dice) && filled(b.dice))
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          expect(isLegal(s, who, b)).toBe(isLegal(s, who, a))
          if (!isLegal(s, who, a)) continue
          expect(effectOf(kind, diceValues(p, b))).toEqual(effectOf(kind, diceValues(p, a)))
          expect(actionKey(s, who, b)).toBe(actionKey(s, who, a))
        }
      }),
    )
  })
  it('印の置き場を持つ行動は、印の置き場が空なら合法でなく、印の置き場の目を残してほかを動かしても、合法かどうかも効果も変わらない', () => {
    fc.assert(
      fc.property(placedArb, ([s, kind, dice, order]) => {
        fc.pre(readsMark(ACTION_DEFS[kind]))
        const a: Action = { kind, dice }
        // 印の置き場はそのままにして、ほかの置き場の中だけで並べ替える
        const others = order.filter((k) => k !== MARK_SLOT)
        const rest = dice.map((_, k) => k).filter((k) => k !== MARK_SLOT)
        const moved = [...dice]
        rest.forEach((k, i) => {
          moved[k] = dice[others[i]]
        })
        const b: Action = { kind, dice: moved }
        for (const who of [0, 1] as const) if (dice[MARK_SLOT] === null) expect(isLegal(s, who, a)).toBe(false)
        // 点線の枠との間で動かすと、空けられない置き場が空くことがある。それは上の性質で見る
        const filled = (xs: (number | null)[]) => xs.slice(0, requiredSlots(ACTION_DEFS[kind])).every((d) => d !== null)
        fc.pre(filled(a.dice) && filled(b.dice))
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          expect(isLegal(s, who, b)).toBe(isLegal(s, who, a))
          if (!isLegal(s, who, a)) continue
          // 合法なら、置き場の順に並べた目の最初が印の置き場の目になる
          expect(diceValues(p, a)[0]).toBe(p.roll[dice[MARK_SLOT] ?? -1])
          expect(effectOf(kind, diceValues(p, b))).toEqual(effectOf(kind, diceValues(p, a)))
          expect(actionKey(s, who, b)).toBe(actionKey(s, who, a))
        }
      }),
    )
  })
})

describe('カード面', () => {
  it('カード面に X や Y の記号を書かない行動は、目ではなく置いた個数で値が決まる。カードに数で書けるのはこのため', () => {
    fc.assert(
      fc.property(kindWithValsArb, ([kind, vals]) => {
        const { face } = ACTION_DEFS[kind]
        fc.pre(face.mark === undefined && face.sum === undefined)
        expect(effectOf(kind, vals)).toEqual(
          effectOf(
            kind,
            vals.map(() => 1),
          ),
        )
      }),
    )
  })
})

describe('ダメージ', () => {
  it('ダメージは負にならず、何もしない同士では0', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const [d0, d1] = stepDamage(movesOfBoth(s, acts), ctxs(s))
        expect(d0).toBeGreaterThanOrEqual(0)
        expect(d1).toBeGreaterThanOrEqual(0)
        expect(stepDamage([[], []])).toEqual([0, 0])
      }),
    )
  })
  it('攻撃しない側が相手に与えるダメージは、守りが返した分と、構えが返した攻撃だけ。相手が自分で自分が焼けた分は除く', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const moves = movesOfBoth(s, acts)
        const c = clash(moves, ctxs(s))
        for (const i of [0, 1] as const) {
          if (moves[i].some((m) => defOf(m).power)) continue
          const returned = sum(c.strikes.filter((x) => x.from === i).map((x) => x.dealt))
          const reflected = sum(
            c.strikes.filter((x) => x.outcome === 'reflected' && x.to === other(i)).map((x) => x.dealt),
          )
          expect(c.damage[other(i)] - c.burn[other(i)]).toBe(returned + reflected)
          // 返すのは返す性質を持つ守りと、攻撃を返す構えだけ
          if (!moves[i].some((m) => defOf(m).thorns)) expect(returned).toBe(0)
          if (!moves[i].some((m) => defOf(m).reflects)) expect(reflected).toBe(0)
        }
      }),
    )
  })
  it('自分も焼けるのは、自分も焼ける効果と、相手の攻撃を一つも返さなかった返す構えだけで、受ける量は置いた目から決まる。焼けた分は受けたダメージに入る', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const moves = movesOfBoth(s, acts)
        const c = clash(moves, ctxs(s))
        const all = burnOf(moves)
        for (const i of [0, 1] as const) {
          const live = liveOf(moves[i], c.cancelled[i])
          expect(c.live[i]).toEqual(live)
          const returned = c.strikes.some((x) => x.outcome === 'reflected' && x.from === other(i))
          const miss = returned ? 0 : sum(live.map((m) => defOf(m).missBurn?.(m.vals) ?? 0))
          expect(c.burn[i]).toBe(sum(live.map((m) => defOf(m).burn?.(m.vals) ?? 0)) + miss)
          expect(c.damage[i]).toBeGreaterThanOrEqual(c.burn[i])
          // 倒れる前の効果から決まる焼ける分は、起きた効果から決まる焼ける分と同じか多い
          expect(all[i]).toBeGreaterThanOrEqual(c.burn[i] - miss)
        }
      }),
    )
  })
  it('攻撃は起きた攻撃の効果の数だけあり、行方は受けた側の構えで決まる。先に当たる攻撃が前に並ぶ', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const moves = movesOfBoth(s, acts)
        const c = clash(moves, ctxs(s))
        const list = c.strikes.filter((x) => x.outcome !== 'returned')
        // 先に当たる攻撃と、それへの返しが、ほかの攻撃より前に並ぶ
        const phases = c.strikes.map((x) => x.phase)
        expect(phases).toEqual([...phases].sort((a, b) => (a === b ? 0 : a === 'fast' ? -1 : 1)))
        for (const phase of ['fast', 'main'] as const) {
          // その時に起きている効果。先に当たる攻撃の時は全て、ほかの攻撃の時は倒れて起きなかった効果を除く
          const now = phase === 'fast' ? moves : c.live
          const here = list.filter((x) => x.phase === phase)
          const want = ([0, 1] as const).flatMap((from) =>
            now[from].filter((m) => defOf(m).power && fast(m) === (phase === 'fast')).map((m) => ({ from, m })),
          )
          expect(here.map((x) => [x.from, x.kind])).toEqual(want.map(({ from, m }) => [from, m.kind]))
          here.forEach((x, k) => {
            const { m } = want[k]
            const def = defOf(m)
            const answer = now[other(x.from)]
            expect(x.power).toBe(def.power?.(m.vals, ctxOf(s, x.from)))
            expect(x.dealt).toBeGreaterThanOrEqual(0)
            expect(x.dealt).toBeLessThanOrEqual(x.power)
            if (answer.some((b) => defOf(b).reflects) && !def.piercing) {
              // 構えに返された攻撃は、放った側にそのまま当たる
              expect(x).toMatchObject({ outcome: 'reflected', to: x.from, dealt: x.power })
              return
            }
            const guards = answer.some((b) => defOf(b).guard)
            const stance = guards || answer.some((b) => defOf(b).reflects)
            expect(x.outcome).toBe(guards && !def.piercing ? 'guarded' : stance ? 'pierced' : 'hit')
            expect(x.to).toBe(other(x.from))
            // 障壁に削られなければ威力のまま
            if (x.outcome !== 'guarded') expect(x.dealt).toBe(x.power)
          })
        }
        for (const d of [0, 1] as const) {
          // 守りが減らした量の合計は、守りの量の合計と、減らせる攻撃の威力の合計の小さい方
          const guarded = list.filter((x) => x.to === d && x.outcome === 'guarded')
          const total = sum(moves[d].map((m) => defOf(m).guard?.(m.vals) ?? 0))
          const cut = sum(guarded.map((x) => x.power - x.dealt))
          expect(cut).toBe(Math.min(total, sum(guarded.map((x) => x.power))))
          // 守りが返すのは、減らせる攻撃を受けたときだけ。返す性質を持つ守りごとに一度、最初に受けた時に返す
          const returns = c.strikes.filter((x) => x.outcome === 'returned' && x.from === d)
          const backs = guarded.length === 0 ? [] : liveOf(moves[d], false).filter((m) => defOf(m).thorns)
          expect(returns).toEqual(
            backs.map((m) => ({
              from: d,
              kind: m.kind,
              power: defOf(m).thorns,
              outcome: 'returned',
              to: other(d),
              dealt: defOf(m).thorns,
              phase: guarded[0].phase,
            })),
          )
          // 守りきったかは、減らせる攻撃を一つ以上受けて、全て0にしたか
          expect(c.blocked[d]).toBe(guarded.length > 0 && guarded.every((x) => x.dealt === 0))
        }
      }),
    )
  })
  it('倒れて効果が起きないのは、先に当たる攻撃だけを放った側でない側が、先に当たる攻撃で体力が0以下になったときだけ', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const moves = movesOfBoth(s, acts)
        const c = clash(moves, ctxs(s))
        for (const i of [0, 1] as const) {
          const first = sum(c.strikes.filter((x) => x.phase === 'fast' && x.to === i).map((x) => x.dealt))
          const allFast = moves[i].length > 0 && moves[i].every(fast)
          expect(c.cancelled[i]).toBe(!allFast && s.players[i].hp - first <= 0)
        }
      }),
    )
  })
  it('席を入れ替えるとダメージも入れ替わる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const [m0, m1] = movesOfBoth(s, acts)
        const [c0, c1] = ctxs(s)
        const [d0, d1] = stepDamage([m0, m1], [c0, c1])
        expect(stepDamage([m1, m0], [c1, c0])).toEqual([d1, d0])
      }),
    )
  })
  it('様子を渡さなければ、双方とも体力が満タンとみなす', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const moves = movesOfBoth(s, acts)
        const full = { hp: DEFAULT_CONFIG.maxHp, maxHp: DEFAULT_CONFIG.maxHp }
        expect(strikes(moves)).toEqual(strikes(moves, [full, full]))
      }),
    )
  })
})

describe('効果', () => {
  it('行動が起こす効果は、カードの行動ごとに置いた目で並び、もう一度出す行動は直前のステップの効果に置き換わる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        for (const i of [0, 1] as const) {
          const p = s.players[i]
          const want = partsOf(acts[i]).flatMap((x) =>
            ACTION_DEFS[x.kind].echo
              ? p.last.map((m) => ({ ...m, echoed: true }))
              : [{ kind: x.kind, vals: diceValues(p, { ...x, with: undefined }) }],
          )
          expect(movesOf(p, acts[i])).toEqual(want)
          // 置いた目は、全てのカードの行動の目を置いた順につないだもの
          expect(diceValues(p, acts[i])).toEqual(
            partsOf(acts[i]).flatMap((x) => diceValues(p, { ...x, with: undefined })),
          )
          // 好きな目のダイスには、選んだ目が入る
          for (const x of partsOf(acts[i])) {
            const vals = diceValues(p, { ...x, with: undefined })
            filled(x.dice).forEach((d, k) => {
              if (p.roll[d] !== WILD) expect(vals[k]).toBe(p.roll[d])
              else expect(vals[k]).toBeGreaterThanOrEqual(1)
            })
          }
        }
      }),
    )
  })
})

describe('状態の更新', () => {
  it('解決すると、HPはダメージ分だけ減り、起きた行動の使ったダイスとカードと効果が記録される', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const report = next.history[next.history.length - 1]
        expect(report.moves).toEqual(movesOfBoth(s, acts))
        for (const i of [0, 1] as const) {
          const before = s.players[i]
          const after = next.players[i]
          expect(after.hp).toBe(before.hp - report.damage[i])
          expect(new Set(after.usedDice).size).toBe(after.usedDice.length)
          expect(new Set(after.usedCards).size).toBe(after.usedCards.length)
          const a = acts[i]
          const happened = a.kind !== 'pass' && !report.cancelled[i]
          const live = liveIn(report, i)
          const forged = happened && s.step === 1 && live.some((m) => defOf(m).transmute)
          if (forged) {
            // 好きな目のダイスを得たら、残ったダイスは全て捨て、後ろに好きな目のダイスが加わる
            const n = Math.max(...live.map((m) => defOf(m).transmute ?? 0))
            expect(after.roll).toEqual([...before.roll, ...extra[i], ...Array(n).fill(WILD)])
            expect([...after.usedDice].sort((x, y) => x - y)).toEqual([...before.roll, ...extra[i]].map((_, k) => k))
          } else if (happened) {
            // 防ぎきって戻ったダイスは、戻る守りに置いたダイスで、使っていないことになる
            const back = partsOf(a)
              .filter((x) => ACTION_DEFS[x.kind].refund && report.refunded[i])
              .flatMap((x) => filled(x.dice))
            expect(after.usedDice).toEqual([...before.usedDice, ...actionDice(a).filter((d) => !back.includes(d))])
            // 振り足したダイスは、起きた行動のものだけ後ろに加わる
            expect(after.roll).toEqual([...before.roll, ...extra[i]])
          } else {
            expect(after.usedDice).toEqual(before.usedDice)
            expect(after.roll).toEqual(before.roll)
          }
          if (happened) for (const x of partsOf(a)) expect(after.usedCards).toContain(ACTION_DEFS[x.kind].card)
          else expect(after.usedCards).toEqual(before.usedCards)
          // 焼けた分は、ステップとターンの終わりの分を足していく
          expect(after.burned).toBe(before.burned + report.burn[i] + report.endBurn[i])
          // 凍らされるのは、相手が凍らせる効果を起こしたときだけで、その目は凍らせる効果の印の置き場の目の大きい方
          const by = liveIn(report, other(i)).filter((m) => defOf(m).freezes)
          expect(after.frozen).toBe(largest(by.map((m) => m.vals[0])))
          // 持ち越すのは、持ち越す効果を起こしたときだけ
          const carried = happened ? live.filter((m) => defOf(m).carries) : []
          expect(after.carry).toBe(largest(carried.map((m) => m.vals[0])) ?? before.carry)
          // 直前の効果は、起きた効果から、行動の回数を増やす効果を除いたもの。もう一度出したかの印は残さない
          const last = happened ? live.filter((m) => !defOf(m).multi).map((m) => ({ kind: m.kind, vals: m.vals })) : []
          expect(after.last).toEqual(last)
          // このターンに起きた効果は、起きた効果の分だけ増える
          expect(after.acted).toEqual(happened ? [...before.acted, ...live.map((m) => m.kind)] : before.acted)
          // ダイスが戻るのは、戻る守りを使って、障壁で減る攻撃を一つ以上受け、全て防ぎきったときだけ
          const blocked = report.strikes.filter((x) => x.to === i && x.outcome === 'guarded' && x.phase !== 'end')
          const fullyBlocked = blocked.length > 0 && blocked.every((x) => x.dealt === 0)
          expect(report.refunded[i]).toBe(
            happened && fullyBlocked && partsOf(a).some((x) => ACTION_DEFS[x.kind].refund),
          )
        }
        expect(next.step).toBe(2)
        // 記録の攻撃とダメージは、効果から決まるものと一致する
        const c = clash(report.moves, ctxs(s))
        expect(report.strikes.filter((x) => x.phase !== 'end')).toEqual(c.strikes)
        expect(report.burn).toEqual(c.burn)
        expect(report.cancelled).toEqual(c.cancelled)
        const late = report.strikes.filter((x) => x.phase === 'end')
        for (const i of [0, 1] as const) {
          const taken = sum(late.filter((x) => x.to === i).map((x) => x.dealt))
          expect(report.damage[i]).toBe(c.damage[i] + report.endBurn[i] + taken)
        }
        expect(report.extra).toEqual(extra)
        expect(report.values).toEqual([diceValues(s.players[0], acts[0]), diceValues(s.players[1], acts[1])])
      }),
    )
  })
  it('ターンの終わりに起きることは、二ステップ目にだけ起き、そのターンに起きた効果から決まる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const report = next.history[next.history.length - 1]
        const late = report.strikes.filter((x) => x.phase === 'end')
        if (s.step === 1) {
          expect(report.endBurn).toEqual([0, 0])
          expect(late).toEqual([])
          return
        }
        for (const i of [0, 1] as const) {
          const defs = next.players[i].acted.map((k) => ACTION_DEFS[k])
          expect(report.endBurn[i]).toBe(sum(defs.map((d) => d.endBurn ?? 0)))
          // 延焼の性質は、このターンに焼けた分の全てに倍率を掛けて、減らされずに、起こした回数だけ与える
          const mine = late.filter((x) => x.from === i)
          const rates = defs.flatMap((d) => (d.ignite ? [d.ignite] : []))
          expect(mine.map((x) => x.dealt)).toEqual(rates.map((r) => next.players[i].burned * r))
          for (const x of mine) expect(x).toMatchObject({ outcome: 'hit', to: other(i) })
        }
      }),
    )
  })
  it('勝敗はHPと一致する。同時に0以下なら体力の残りが多い方が勝ち、同じなら引き分け', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const [a, b] = next.players.map((p) => p.hp)
        const dead = [a <= 0, b <= 0]
        const both = a === b ? 'draw' : a > b ? 0 : 1
        const expected = dead[0] && dead[1] ? both : dead[0] ? 1 : dead[1] ? 0 : null
        expect(next.winner).toBe(expected)
      }),
    )
  })
  it('席を入れ替えて解決すると、結果も入れ替わる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const a = resolveStep(s, acts, extra)
        const b = resolveStep(swapSeats(s), [acts[1], acts[0]], [extra[1], extra[0]])
        expect(swapSeats(b).players).toEqual(a.players)
        expect(swapSeats(b).winner).toEqual(a.winner)
      }),
    )
  })
  it('詠唱の状態は、起きた詠唱の効果と発動の行動でしか変わらず、詠唱は相手が詠唱を崩す効果を起こしたときだけ崩れる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const report = next.history[next.history.length - 1]
        for (const i of [0, 1] as const) {
          const happened = acts[i].kind !== 'pass' && !report.cancelled[i]
          const chanted = happened && liveIn(report, i).some((m) => defOf(m).chant)
          const disrupted = liveIn(report, other(i)).some((m) => defOf(m).disrupts)
          const cast = happened && partsOf(acts[i]).some((x) => ACTION_DEFS[x.kind].needsCharge)
          const want = cast ? 'none' : chanted ? (disrupted ? 'broken' : 'charged') : s.players[i].chant
          expect(next.players[i].chant).toBe(want)
          // 詠唱の結果は、詠唱が起きた側だけに記録する
          expect(report.chants[i]).toBe(chanted ? (disrupted ? 'broken' : 'kept') : null)
        }
      }),
    )
  })
  it('元の状態を書き換えない', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const snapshot = structuredClone(s)
        resolveStep(s, acts, extra)
        expect(s).toEqual(snapshot)
      }),
    )
  })
})

describe('対局全体', () => {
  it('乱数の手で最後まで進めても、規則が壊れない', () => {
    fc.assert(
      fc.property(seedArb, fc.option(fc.tuple(deckArb, deckArb), { nil: undefined }), (seed, decks) => {
        const { states } = playRandom(seed, 60, decks)
        for (const s of states) {
          for (const p of s.players) {
            // 持ち越すと1個、振り足すと2個ずつ、好きな目のダイスを得ると3個増える
            expect(p.roll.length).toBeGreaterThanOrEqual(s.config.diceCount)
            expect(p.roll.length).toBeLessThanOrEqual(s.config.diceCount + 5)
            if (!decks) expect(p.roll).toHaveLength(s.config.diceCount)
            expect(p.roll.every((v) => Number.isInteger(v) && v >= WILD && v <= 6)).toBe(true)
            // 好きな目のダイスは二ステップ目にだけある
            if (s.step === 1) expect(p.roll).not.toContain(WILD)
            expect(p.usedDice.every((i) => i >= 0 && i < p.roll.length)).toBe(true)
            expect(p.hp).toBeLessThanOrEqual(s.config.maxHp)
          }
          // ターンとステップの記録は時系列順
          s.history.forEach((r, i) => {
            if (i === 0) return
            const prev = s.history[i - 1]
            expect(r.turn * 2 + r.step).toBeGreaterThan(prev.turn * 2 + prev.step)
          })
        }
      }),
      { numRuns: 50 },
    )
  })
  it('同じ乱数の種なら同じ対局になる', () => {
    fc.assert(
      fc.property(seedArb, fc.option(fc.tuple(deckArb, deckArb), { nil: undefined }), (seed, decks) => {
        expect(playRandom(seed, 60, decks)).toEqual(playRandom(seed, 60, decks))
      }),
      { numRuns: 20 },
    )
  })
  it('二ステップで一ターンが終わり、次のターンに進む', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        let rng = seed
        const r = () => {
          rng = (rng * 16807) % 2147483647
          return rng / 2147483647
        }
        let s = newGame(r)
        expect(turnOver(s)).toBe(false)
        s = resolveStep(s, [{ kind: 'pass' }, { kind: 'pass' }])
        expect(turnOver(s)).toBe(false)
        s = resolveStep(s, [{ kind: 'pass' }, { kind: 'pass' }])
        expect(turnOver(s)).toBe(true)
        s = nextTurn(s, r)
        expect([s.turn, s.step]).toEqual([2, 1])
      }),
      { numRuns: 20 },
    )
  })
  it('次のターンには、持ち越した目が振ったダイスの後ろに加わり、焼けた分と持ち越しと起きた効果は消え、凍結と直前の効果は残る', () => {
    fc.assert(
      fc.property(poolStateArb, seedArb, (s, seed) => {
        const next = nextTurn(s, () => (seed % 1000) / 1000)
        for (const i of [0, 1] as const) {
          const before = s.players[i]
          const after = next.players[i]
          const carried = before.carry === null ? [] : [before.carry]
          expect(after.roll.slice(DEFAULT_CONFIG.diceCount)).toEqual(carried)
          expect(after.roll).toHaveLength(DEFAULT_CONFIG.diceCount + carried.length)
          expect([after.usedDice, after.usedCards, after.burned, after.carry, after.acted]).toEqual([
            [],
            [],
            0,
            null,
            [],
          ])
          expect(after.frozen).toBe(before.frozen)
          expect(after.last).toEqual(before.last)
          expect(after.deck).toEqual(before.deck)
        }
      }),
    )
  })
})
