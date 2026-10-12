// どのカードにも、これから足すカードにも成り立つべき性質。
// 乱数で大量の局面と行動を作って確かめる。カードを足したら何もしなくてもここで検査される。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { dieArb, makeState, playRandom, rollArb, swapSeats } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, CARD_ORDER } from './cards'
import {
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
import type { Action, CardId, ChantState, GameState } from './types'

const seedArb = fc.integer({ min: 1, max: 2 ** 31 - 1 })

/** 一ステップ目または二ステップ目の、ありうる局面 */
const stateArb: fc.Arbitrary<GameState> = fc
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

/** 行動の種類と、その行動に置ける個数の目 */
const kindWithValsArb = fc
  .constantFrom(...ACTION_KINDS)
  .chain((kind) =>
    fc
      .constantFrom(...ACTION_DEFS[kind].dice)
      .chain((n) => fc.tuple(fc.constant(kind), fc.array(dieArb, { minLength: n, maxLength: n }))),
  )

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
  it('同じ種類と同じ目の組み合わせは重複しない。置き場の順に意味のある行動は、最初の目も見て区別する', () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        for (const who of [0, 1] as const) {
          const keys = legalActions(s, who).map((a) => actionKey(s.players[who], a))
          expect(new Set(keys).size).toBe(keys.length)
        }
      }),
    )
  })
  it('列挙から漏れた合法手は無い。全てのダイスの並びを試して、合法なら同じ手が列挙にある', () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          const listed = new Set(legalActions(s, who).map((a) => actionKey(p, a)))
          for (const kind of ACTION_KINDS) {
            for (const i of [0, 1, 2])
              for (const j of [0, 1, 2]) {
                for (const dice of [[i], [i, j]]) {
                  const a: Action = { kind, dice }
                  if (!isLegal(s, who, a)) continue
                  expect(listed.has(actionKey(p, a))).toBe(true)
                }
              }
          }
        }
      }),
    )
  })
  it('同じ手とみなした行動は効果も同じ。順に意味の無い行動は目を並べ替えても、順に意味のある行動は最初の目を残して並べ替えても変わらない', () => {
    fc.assert(
      fc.property(kindWithValsArb, ([kind, vals]) => {
        const def = ACTION_DEFS[kind]
        const keep = def.ordered ? 1 : 0
        const moved = [...vals.slice(0, keep), ...vals.slice(keep).reverse()]
        const effect = (v: number[]) => [def.power?.(v), def.guard?.(v)]
        expect(effect(moved)).toEqual(effect(vals))
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
            expect(after.usedDice).toEqual(expect.arrayContaining(a.dice))
            expect(after.usedCards).toContain(ACTION_DEFS[a.kind].card)
          }
          expect(after.roll).toEqual(before.roll)
        }
        expect(next.step).toBe(2)
        expect(report.lines.length).toBeGreaterThanOrEqual(2)
      }),
    )
  })
  it('勝敗はHPと一致する', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const next = resolveStep(s, acts)
        const dead = next.players.map((p) => p.hp <= 0)
        const expected = dead[0] && dead[1] ? 'draw' : dead[0] ? 1 : dead[1] ? 0 : null
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
  it('公開の文は、双方について一行ずつ、あなたと相手の順に並ぶ', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const { lines } = resolveStep(s, acts).history.at(-1) ?? { lines: [] }
        expect(lines[0]).toMatch(/^あなた/)
        expect(lines[1]).toMatch(/^相手/)
        for (const l of lines) expect(l).toMatch(/\S/)
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
