// どのカードにも、これから足すカードにも成り立つべき性質。
// 乱数で大量の局面と行動を作って確かめる。カードを足したら何もしなくてもここで検査される。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { dieArb, playRandom, stateArb, swapSeats } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, type ActionKind } from './cards'
import {
  actionDice,
  actionKey,
  diceValues,
  isLegal,
  legalActions,
  newGame,
  nextTurn,
  resolveStep,
  stepDamage,
  strikes,
  turnOver,
} from './rules'
import { MARK_SLOT, readsMark, requiredSlots, slotsOf } from './slots'
import type { Action } from './types'

const seedArb = fc.integer({ min: 1, max: 2 ** 31 - 1 })

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
const placedArb = stateArb.chain((s) =>
  fc.constantFrom(...ACTION_KINDS).chain((kind) => {
    const n = slotsOf(ACTION_DEFS[kind])
    const slots = [...Array(n).keys()]
    return fc.tuple(
      fc.constant(s),
      fc.constant(kind),
      fc.array(fc.constantFrom(null, 0, 1, 2), { minLength: n, maxLength: n }),
      fc.shuffledSubarray(slots, { minLength: n, maxLength: n }),
    )
  }),
)

/** 威力と、障壁が減らす量 */
const effectOf = (kind: ActionKind, vals: number[]) => [
  ACTION_DEFS[kind].power?.(vals),
  ACTION_DEFS[kind].guard?.(vals),
]

/** 局面と、その局面の双方の合法手から一つずつ */
const stateWithActsArb = stateArb.chain((s) =>
  fc
    .tuple(fc.constantFrom(...legalActions(s, 0)), fc.constantFrom(...legalActions(s, 1)))
    .map(([a0, a1]) => ({ s, acts: [a0, a1] as [Action, Action] })),
)

describe('合法手の列挙', () => {
  it('列挙された手は全て合法で、何もしないが必ず含まれる', () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        for (const who of [0, 1] as const) {
          const acts = legalActions(s, who)
          expect(acts[0]).toEqual({ kind: 'pass' })
          for (const a of acts) expect(isLegal(s, who, a)).toBe(true)
        }
      }),
    )
  })
  it('同じ種類と同じ目の組み合わせは重複しない。印の置き場の目を値にする行動は、印の置き場の目も見て区別する', () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        for (const who of [0, 1] as const) {
          const keys = legalActions(s, who).map((a) => actionKey(s.players[who], a))
          expect(new Set(keys).size).toBe(keys.length)
        }
      }),
    )
  })
  it('列挙から漏れた合法手は無い。全ての置き場に、空けるかどのダイスを置くかを全て試して、合法なら同じ手が列挙にある', () => {
    /** n 個の置き場の、空けるかダイス 0 から 2 を置くかの全ての組 */
    const allSlots = (n: number): (number | null)[][] =>
      n === 0 ? [[]] : allSlots(n - 1).flatMap((rest) => [null, 0, 1, 2].map((d) => [d, ...rest]))
    fc.assert(
      fc.property(stateArb, (s) => {
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          const listed = new Set(legalActions(s, who).map((a) => actionKey(p, a)))
          for (const kind of ACTION_KINDS) {
            for (const dice of allSlots(slotsOf(ACTION_DEFS[kind]))) {
              const a: Action = { kind, dice }
              if (!isLegal(s, who, a)) continue
              expect(listed.has(actionKey(p, a))).toBe(true)
            }
          }
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
      fc.property(stateArb, (s) => {
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
          expect(actionKey(p, b)).toBe(actionKey(p, a))
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
          expect(actionKey(p, b)).toBe(actionKey(p, a))
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
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const vals: [number[], number[]] = [diceValues(s.players[0], acts[0]), diceValues(s.players[1], acts[1])]
        const [d0, d1] = stepDamage(vals, acts)
        expect(d0).toBeGreaterThanOrEqual(0)
        expect(d1).toBeGreaterThanOrEqual(0)
        expect(stepDamage([[], []], [{ kind: 'pass' }, { kind: 'pass' }])).toEqual([0, 0])
      }),
    )
  })
  it('攻撃しない側は相手にダメージを与えない。反射は除く', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const vals: [number[], number[]] = [diceValues(s.players[0], acts[0]), diceValues(s.players[1], acts[1])]
        const dmg = stepDamage(vals, acts)
        for (const i of [0, 1] as const) {
          const a = acts[i]
          const def = a.kind === 'pass' ? undefined : ACTION_DEFS[a.kind]
          if (!def?.power && !def?.reflects) expect(dmg[1 - i]).toBe(0)
        }
      }),
    )
  })
  it('攻撃は攻撃した行動の数だけあり、行方は受けた側の構えで決まる', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const vals: [number[], number[]] = [diceValues(s.players[0], acts[0]), diceValues(s.players[1], acts[1])]
        const list = strikes(vals, acts)
        const attackers = ([0, 1] as const).filter((i) => {
          const a = acts[i]
          return a.kind !== 'pass' && !!ACTION_DEFS[a.kind].power
        })
        expect(list.map((x) => x.from)).toEqual(attackers)
        for (const x of list) {
          const def = ACTION_DEFS[x.kind]
          const other = x.from === 0 ? 1 : 0
          const b = acts[other]
          const bdef = b.kind === 'pass' ? undefined : ACTION_DEFS[b.kind]
          expect(x.power).toBe(def.power?.(vals[x.from]))
          expect(x.dealt).toBeGreaterThanOrEqual(0)
          expect(x.dealt).toBeLessThanOrEqual(x.power)
          const expected = bdef?.reflects ? 'reflected' : bdef?.guard ? (def.piercing ? 'pierced' : 'guarded') : 'hit'
          expect(x.outcome).toBe(expected)
          expect(x.to).toBe(x.outcome === 'reflected' ? x.from : other)
          if (x.outcome !== 'guarded') expect(x.dealt).toBe(x.power)
        }
      }),
    )
  })
  it('席を入れ替えるとダメージも入れ替わる', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const vals: [number[], number[]] = [diceValues(s.players[0], acts[0]), diceValues(s.players[1], acts[1])]
        const [d0, d1] = stepDamage(vals, acts)
        expect(stepDamage([vals[1], vals[0]], [acts[1], acts[0]])).toEqual([d1, d0])
      }),
    )
  })
})

describe('状態の更新', () => {
  it('解決すると、HPはダメージ分だけ減り、使ったダイスとカードが記録される', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const next = resolveStep(s, acts)
        const report = next.history[next.history.length - 1]
        for (const i of [0, 1] as const) {
          const before = s.players[i]
          const after = next.players[i]
          expect(after.hp).toBe(before.hp - report.damage[i])
          expect(new Set(after.usedDice).size).toBe(after.usedDice.length)
          expect(new Set(after.usedCards).size).toBe(after.usedCards.length)
          const a = acts[i]
          if (a.kind !== 'pass') {
            expect(after.usedDice).toEqual(expect.arrayContaining(actionDice(a)))
            expect(after.usedCards).toContain(ACTION_DEFS[a.kind].card)
          }
          expect(after.roll).toEqual(before.roll)
        }
        expect(next.step).toBe(2)
        // 記録の攻撃とダメージは、行動から決まるものと一致する
        expect(report.strikes).toEqual(strikes(report.values, acts))
        expect(report.damage).toEqual(stepDamage(report.values, acts))
      }),
    )
  })
  it('勝敗はHPと一致する。同時に0以下なら体力の残りが多い方が勝ち、同じなら引き分け', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const next = resolveStep(s, acts)
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
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const a = resolveStep(s, acts)
        const b = resolveStep(swapSeats(s), [acts[1], acts[0]])
        expect(swapSeats(b).players).toEqual(a.players)
        expect(swapSeats(b).winner).toEqual(a.winner)
      }),
    )
  })
  it('詠唱の状態は、詠唱と発動の行動でしか変わらない', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const next = resolveStep(s, acts)
        for (const i of [0, 1] as const) {
          const a = acts[i]
          const def = a.kind === 'pass' ? undefined : ACTION_DEFS[a.kind]
          if (def?.chant) expect(['charged', 'broken']).toContain(next.players[i].chant)
          else if (def?.needsCharge) expect(next.players[i].chant).toBe('none')
          else expect(next.players[i].chant).toBe(s.players[i].chant)
        }
      }),
    )
  })
  it('詠唱の結果は、詠唱した側だけに記録され、詠唱の状態と一致する', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const next = resolveStep(s, acts)
        const report = next.history[next.history.length - 1]
        for (const i of [0, 1] as const) {
          const a = acts[i]
          const chanted = a.kind !== 'pass' && !!ACTION_DEFS[a.kind].chant
          const want = chanted ? (next.players[i].chant === 'broken' ? 'broken' : 'kept') : null
          expect(report.chants[i]).toBe(want)
        }
      }),
    )
  })
  it('元の状態を書き換えない', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const snapshot = structuredClone(s)
        resolveStep(s, acts)
        expect(s).toEqual(snapshot)
      }),
    )
  })
})

describe('対局全体', () => {
  it('乱数の手で最後まで進めても、規則が壊れない', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const { states } = playRandom(seed)
        for (const s of states) {
          for (const p of s.players) {
            expect(p.roll).toHaveLength(s.config.diceCount)
            expect(p.roll.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true)
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
      fc.property(seedArb, (seed) => {
        expect(playRandom(seed)).toEqual(playRandom(seed))
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
})
