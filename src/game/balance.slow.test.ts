// バランスの記録。通常のテストには含めず pnpm test:balance で走らせる。
// ルールやカードを変えると、ここの数字が変わる。意図した変更なら pnpm test:balance -u で更新し、
// 差分をコミットに含める。意図しない変更なら、どこかでルールが壊れている。

import { describe, expect, it } from 'vitest'
import { makeState } from '../test/helpers'
import { ACTION_KINDS } from './cards'
import { Thinker } from './cpu'
import { solveMatrixGame } from './matrixGame'

const ROLLS: number[][] = []
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) for (let c = b; c <= 6; c++) ROLLS.push([a, b, c])
/** 並べ替えを区別したときの出方の数 */
const weight = (r: number[]) => [0, 6, 3, 1][4 - new Set(r).size]

describe('バランス', () => {
  it('HP満タンの一ステップ目で、つよいCPUが各行動を選ぶ頻度と、読み合いが起きない局面の割合', () => {
    const t = new Thinker()
    const freq: Record<string, number> = Object.fromEntries([...ACTION_KINDS, 'pass'].map((k) => [k, 0]))
    let total = 0
    let pure = 0
    let firstValue = 0
    for (const r0 of ROLLS)
      for (const r1 of ROLLS) {
        const s = makeState({ roll: r0 }, { roll: r1 })
        const w = weight(r0) * weight(r1)
        const opts = t.analyze(s, 0, 'hard')
        for (const o of opts) freq[o.action.kind] += w * o.prob
        // 最適戦略がほぼ一択なら、読み合いは起きていない
        if (Math.max(...opts.map((o) => o.prob)) > 0.99) pure += w
        firstValue += w * solveMatrixGame(t.game(s, 0).payoff).value
        total += w
      }
    const round = (x: number) => Math.round(x * 1000) / 1000
    const report = {
      firstStepFrequency: Object.fromEntries(Object.entries(freq).map(([k, v]) => [k, round(v / total)])),
      pureStrategyRate: round(pure / total),
      // 対称なゲームなので0になるはず
      seatAdvantage: round(firstValue / total),
    }
    expect(report.seatAdvantage).toBe(0)
    expect(JSON.stringify(report, null, 2)).toMatchSnapshot()
  })
})
