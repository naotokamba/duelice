// 行列ゲームの解が本当に均衡になっているかの検査。
// 解き方に依存せず、答えの性質だけを見る。

import { expect } from 'vitest'
import type { MatrixSolution } from '../game/matrixGame'

const TOL = 1e-6

export function expectEquilibrium(payoff: number[][], sol: MatrixSolution) {
  const { row, col, value } = sol
  expect(row).toHaveLength(payoff.length)
  expect(col).toHaveLength(payoff[0].length)
  for (const p of [...row, ...col]) expect(p).toBeGreaterThanOrEqual(-TOL)
  expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  expect(col.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  const scale = Math.max(1, ...payoff.flat().map(Math.abs))
  // 行の戦略は、列がどの手を選んでも value 以上を保証する
  for (let j = 0; j < payoff[0].length; j++) {
    const v = payoff.reduce((acc, r, i) => acc + r[j] * row[i], 0)
    expect(v).toBeGreaterThanOrEqual(value - TOL * scale)
  }
  // 列の戦略は、行がどの手を選んでも value 以下に抑える
  for (let i = 0; i < payoff.length; i++) {
    const v = payoff[i].reduce((acc, x, j) => acc + x * col[j], 0)
    expect(v).toBeLessThanOrEqual(value + TOL * scale)
  }
}
