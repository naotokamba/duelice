import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { expectEquilibrium } from '../test/equilibrium'
import { makeState, rollArb, seeded } from '../test/helpers'
import { LEVEL_NAMES, type Level, Thinker } from './cpu'
import { solveMatrixGame } from './matrixGame'
import { isLegal, newGame, nextTurn, resolveStep, turnOver } from './rules'

const LEVELS = Object.keys(LEVEL_NAMES) as Level[]

describe('CPU', () => {
  it('どの強さでも常に合法手を選び、対局が最後まで進む', () => {
    for (const [l0, l1] of [
      ['hard', 'easy'],
      ['normal', 'normal'],
    ] as const) {
      const rng = seeded(7)
      const t = new Thinker()
      let s = newGame(rng)
      for (let k = 0; k < 40 && s.winner === null; k++) {
        const a0 = t.decide(s, 0, l0, rng)
        const a1 = t.decide(s, 1, l1, rng)
        expect(isLegal(s, 0, a0)).toBe(true)
        expect(isLegal(s, 1, a1)).toBe(true)
        s = resolveStep(s, [a0, a1])
        if (s.winner === null && turnOver(s)) s = nextTurn(s, rng)
      }
    }
  })
  it('確率は0以上で合計は1', () => {
    const t = new Thinker()
    fc.assert(
      fc.property(rollArb, rollArb, fc.constantFrom(...LEVELS), (r0, r1, level) => {
        const opts = t.analyze(makeState({ roll: r0 }, { roll: r1 }), 1, level)
        for (const o of opts) expect(o.prob).toBeGreaterThanOrEqual(-1e-9)
        expect(opts.reduce((a, o) => a + o.prob, 0)).toBeCloseTo(1, 6)
      }),
      { numRuns: 30 },
    )
  })
  it('つよいは、そのステップの行列ゲームの均衡になっている', () => {
    const t = new Thinker()
    fc.assert(
      fc.property(
        rollArb,
        rollArb,
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (r0, r1, h0, h1) => {
          const s = makeState({ roll: r0, hp: h0 }, { roll: r1, hp: h1 })
          for (const who of [0, 1] as const) {
            const g = t.game(s, who)
            expectEquilibrium(g.payoff, solveMatrixGame(g.payoff))
            const probs = t.analyze(s, who, 'hard').map((o) => o.prob)
            expect(probs).toEqual(solveMatrixGame(g.payoff).row)
          }
        },
      ),
      { numRuns: 20 },
    )
  })
  it('二人の視点の行列ゲームは、符号を反転した転置になっている', () => {
    const t = new Thinker()
    const s = makeState({ roll: [6, 5, 2] }, { roll: [3, 3, 6] })
    const g0 = t.game(s, 0)
    const g1 = t.game(s, 1)
    g1.payoff.forEach((r, j) => {
      r.forEach((v, i) => {
        expect(v).toBeCloseTo(-g0.payoff[i][j], 9)
      })
    })
    expect(g1.mine).toEqual(g0.theirs)
    expect(solveMatrixGame(g1.payoff).value).toBeCloseTo(-solveMatrixGame(g0.payoff).value, 6)
  })
  it('同じ目と同じHPなら、どちらの席でも価値は0', () => {
    const t = new Thinker()
    const s = makeState({ roll: [6, 4, 4] }, { roll: [6, 4, 4] })
    expect(solveMatrixGame(t.game(s, 0).payoff).value).toBeCloseTo(0, 6)
  })
  it('つよいはやさしいより期待得点が高いか同じ', () => {
    const t = new Thinker()
    fc.assert(
      fc.property(rollArb, rollArb, (r0, r1) => {
        const s = makeState({ roll: r0 }, { roll: r1 })
        const g = t.game(s, 0)
        const col = solveMatrixGame(g.payoff).col
        const score = (level: Level) =>
          t
            .analyze(s, 0, level)
            .reduce((acc, o, i) => acc + o.prob * g.payoff[i].reduce((a, v, j) => a + v * col[j], 0), 0)
        expect(score('hard')).toBeGreaterThanOrEqual(score('normal') - 1e-6)
        expect(score('normal')).toBeGreaterThanOrEqual(score('easy') - 1e-6)
      }),
      { numRuns: 20 },
    )
  })
  it('倒し切れるときは倒しに行く', () => {
    const t = new Thinker()
    // 相手は残り3でゾロ目なし。魔弾2個なら障壁も関係なく3点で倒せる
    const s = makeState({ roll: [1, 2, 3], hp: 3 }, { roll: [6, 6, 1] })
    const best = t.analyze(s, 1, 'hard').sort((a, b) => b.prob - a.prob)[0]
    expect(best.action.kind === 'fireball' || best.action.kind === 'bullet').toBe(true)
  })
  it('同じ乱数なら同じ手を選ぶ', () => {
    const s = makeState({ roll: [6, 5, 2] }, { roll: [3, 3, 6] })
    for (const level of LEVELS) {
      expect(new Thinker().decide(s, 0, level, seeded(3))).toEqual(new Thinker().decide(s, 0, level, seeded(3)))
    }
  })
})
