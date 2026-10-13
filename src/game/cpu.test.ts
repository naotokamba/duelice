import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { expectEquilibrium } from '../test/equilibrium'
import { makeState, rollArb, seeded } from '../test/helpers'
import { CARD_ORDER } from './cards'
import { KILL_BONUS, LEVEL_NAMES, type Level, Thinker, weaklyDominated } from './cpu'
import { solveMatrixGame } from './matrixGame'
import { isLegal, legalActions, newGame, nextTurn, resolveStep, turnOver } from './rules'
import type { GameState } from './types'

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
    // 相手は残り3で、風壁はもう使った。炎撃でも魔弾でも倒せる。2点の氷礫では倒せない
    const s = makeState({ roll: [1, 2, 3], hp: 3, usedDice: [0], usedCards: ['barrier'] }, { roll: [6, 6, 1] }, 2)
    const best = t.analyze(s, 1, 'hard').sort((a, b) => b.prob - a.prob)[0]
    expect(['flameStrike', 'bullet']).toContain(best.action.kind)
  })
  it('同じ乱数なら同じ手を選ぶ', () => {
    const s = makeState({ roll: [6, 5, 2] }, { roll: [3, 3, 6] })
    for (const level of LEVELS) {
      expect(new Thinker().decide(s, 0, level, seeded(3))).toEqual(new Thinker().decide(s, 0, level, seeded(3)))
    }
  })
})

describe('無意味なパス', () => {
  /** そのステップで、使えるダイスとカードを適当に減らした局面 */
  const used = fc.subarray([0, 1, 2])
  const cards = fc.subarray([...CARD_ORDER])
  const step2Arb = fc
    .record({ r0: rollArb, r1: rollArb, d0: used, d1: used, c0: cards, c1: cards, h0: fc.integer({ min: 1, max: 20 }) })
    .map(({ r0, r1, d0, d1, c0, c1, h0 }) =>
      makeState({ roll: r0, usedDice: d0, usedCards: c0, hp: h0 }, { roll: r1, usedDice: d1, usedCards: c1 }, 2),
    )

  /**
   * 二ステップ目の、パスを外す前の行列ゲームを who から見て組み立てる。CPU とは別に、公開されている手順だけで作る。
   * 得点は与えたダメージの差で、倒した、倒されたときは CPU と同じ重みを足す
   */
  function fullStep2(s: GameState, who: 0 | 1): { mine: ReturnType<typeof legalActions>; payoff: number[][] } {
    const other = who === 0 ? 1 : 0
    const mine = legalActions(s, who)
    const payoff = mine.map((x) =>
      legalActions(s, other).map((y) => {
        const next = resolveStep(s, who === 0 ? [x, y] : [y, x])
        const taken = next.history[next.history.length - 1].damage
        const bonus = next.winner === who ? KILL_BONUS : next.winner === other ? -KILL_BONUS : 0
        return taken[other] - taken[who] + bonus
      }),
    )
    return { mine, payoff }
  }

  it('二ステップ目も、ほかの行動に弱く支配されるパスだけを外す', () => {
    const t = new Thinker()
    fc.assert(
      fc.property(step2Arb, fc.constantFrom(0, 1) as fc.Arbitrary<0 | 1>, (s, who) => {
        const full = fullStep2(s, who)
        const pass = full.mine.findIndex((a) => a.kind === 'pass')
        const dominated = weaklyDominated(full.payoff, pass)
        for (const level of LEVELS) {
          const opts = t.analyze(s, who, level)
          expect(opts.some((o) => o.action.kind === 'pass')).toBe(!dominated)
          // 何も使えないときはパスだけになる
          if (full.mine.length === 1) expect(opts.map((o) => [o.action.kind, o.prob])).toEqual([['pass', 1]])
        }
      }),
      { numRuns: 200 },
    )
  })

  it('二ステップ目に、相手が風壁を残していれば、自分も焼ける攻撃を防がれうるのでパスも混ぜる', () => {
    // 自分は風壁も氷礫も使えず、5 と 2 で撃てるのは自分も焼ける炎撃だけ。相手は残った 6 で風壁を張れる。
    // 撃って防がれると自分も焼けたうえに3を返されるので、つよいもパスを混ぜる。手が絞られた局面を、盤を直接作って確かめる
    const s = makeState(
      { roll: [3, 5, 2], usedDice: [0], usedCards: ['barrier', 'interrupt'] },
      { roll: [6, 1, 4], usedDice: [1, 2], usedCards: ['flameStrike'] },
      2,
    )
    const pass = new Thinker().analyze(s, 0, 'hard').find((o) => o.action.kind === 'pass')
    expect(pass?.prob).toBeGreaterThan(0)
  })

  it('相手が風壁を使い切っていれば、氷礫が通る二ステップ目のパスは選ばない', () => {
    // 相手は風壁を使い切っている。1個の氷礫は代償なしに2点当てるので、どの手に対してもパスより上
    const s = makeState(
      { roll: [6, 6, 3], usedDice: [0], usedCards: ['barrier'] },
      { roll: [6, 6, 3], usedDice: [0], usedCards: ['barrier'] },
      2,
    )
    for (const level of LEVELS) {
      expect(new Thinker().analyze(s, 0, level).some((o) => o.action.kind === 'pass')).toBe(false)
    }
  })

  /**
   * HP満タンの一ステップ目の、パスを外す前の行列ゲーム。CPU とは別に、公開されている手順だけで組み立てる。
   * 一ステップ目では誰も倒れないので、得点は与えたダメージの差と、二ステップ目の価値の和になる
   */
  function fullStep1(t: Thinker, s: GameState): { a0: ReturnType<typeof legalActions>; payoff: number[][] } {
    const a0 = legalActions(s, 0)
    const a1 = legalActions(s, 1)
    const payoff = a0.map((x) =>
      a1.map((y) => {
        const next = resolveStep(s, [x, y])
        const [taken0, taken1] = next.history[0].damage
        return taken1 - taken0 + solveMatrixGame(t.game(next, 0).payoff).value
      }),
    )
    return { a0, payoff }
  }

  it('一ステップ目は、ほかの行動に弱く支配されるパスだけを外す', () => {
    const t = new Thinker()
    fc.assert(
      fc.property(rollArb, rollArb, (r0, r1) => {
        const s = makeState({ roll: r0 }, { roll: r1 })
        const full = fullStep1(t, s)
        const pass = full.a0.findIndex((a) => a.kind === 'pass')
        const dominated = weaklyDominated(full.payoff, pass)
        for (const level of LEVELS) {
          expect(t.analyze(s, 0, level).some((o) => o.action.kind === 'pass')).toBe(!dominated)
        }
      }),
      { numRuns: 40 },
    )
    // 局面ごとに二ステップ目まで全部解くので重い。CI の遅い機械でも時間内に終わるように長めに待つ
  }, 30_000)

  it('一ステップ目に、どの手にも支配されないパスは候補に残る', () => {
    // 1,1,6 対 1,1,3 では、パスはほかの手に支配されない。つよいは選ばなくても候補に残し、ふつうは少し混ぜる
    const s = makeState({ roll: [1, 1, 6] }, { roll: [1, 1, 3] })
    const t = new Thinker()
    expect(t.analyze(s, 0, 'hard').some((o) => o.action.kind === 'pass')).toBe(true)
    expect(t.analyze(s, 0, 'normal').find((o) => o.action.kind === 'pass')?.prob).toBeGreaterThan(0)
  })

  it('弱い支配は、どの列でも同じか上で、少なくとも一つの列で上回る行があること', () => {
    expect(
      weaklyDominated(
        [
          [1, 2],
          [1, 3],
        ],
        0,
      ),
    ).toBe(true)
    expect(
      weaklyDominated(
        [
          [1, 2],
          [1, 2],
        ],
        0,
      ),
    ).toBe(false)
    expect(
      weaklyDominated(
        [
          [1, 2],
          [2, 1],
        ],
        0,
      ),
    ).toBe(false)
    expect(
      weaklyDominated(
        [
          [0, 0],
          [5, -1],
          [1, 0],
        ],
        0,
      ),
    ).toBe(true)
    expect(weaklyDominated([[3]], 0)).toBe(false)
    // 解いた小数の末の桁のずれは同点とみなす
    expect(
      weaklyDominated(
        [
          [1, 2],
          [1 + 1e-15, 2],
        ],
        0,
      ),
    ).toBe(false)
    expect(
      weaklyDominated(
        [
          [1, 2],
          [1 - 1e-15, 3],
        ],
        0,
      ),
    ).toBe(true)
  })
})
