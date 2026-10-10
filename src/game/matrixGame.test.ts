import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { expectEquilibrium } from '../test/equilibrium'
import { solveMatrixGame } from './matrixGame'

const close = (a: number[], b: number[]) => {
  a.forEach((x, i) => {
    expect(x).toBeCloseTo(b[i], 6)
  })
}

describe('行列ゲームの解', () => {
  it('じゃんけんは三等分、価値0', () => {
    const s = solveMatrixGame([
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ])
    expect(s.value).toBeCloseTo(0, 6)
    close(s.row, [1 / 3, 1 / 3, 1 / 3])
    close(s.col, [1 / 3, 1 / 3, 1 / 3])
  })
  it('勝ち幅の違う三すくみ', () => {
    // A は C に 4.5、C は D に 4、D は A に 3 勝つ。頻度は A:4, D:4.5, C:3 に比例
    const s = solveMatrixGame([
      [0, -3, 4.5],
      [3, 0, -4],
      [-4.5, 4, 0],
    ])
    close(s.row, [4 / 11.5, 4.5 / 11.5, 3 / 11.5])
  })
  it('支配される手は選ばない', () => {
    const s = solveMatrixGame([
      [3, 2],
      [1, 0],
    ])
    expect(s.value).toBeCloseTo(2, 6)
    close(s.row, [1, 0])
    close(s.col, [0, 1])
  })
  it('非正方の行列', () => {
    const s = solveMatrixGame([[1, -1, 2]])
    expect(s.value).toBeCloseTo(-1, 6)
    close(s.col, [0, 1, 0])
  })
})

describe('行列ゲームの解の性質', () => {
  const matrixArb = fc
    .record({ m: fc.integer({ min: 1, max: 8 }), n: fc.integer({ min: 1, max: 8 }) })
    .chain(({ m, n }) =>
      fc.array(fc.array(fc.integer({ min: -40, max: 40 }), { minLength: n, maxLength: n }), {
        minLength: m,
        maxLength: m,
      }),
    )
  it('乱数の行列でも、返す戦略は均衡になっている', () => {
    fc.assert(
      fc.property(matrixArb, (A) => {
        expectEquilibrium(A, solveMatrixGame(A))
      }),
      { numRuns: 500 },
    )
  })
  it('同じ値が並ぶ退化した行列でも循環せずに解ける', () => {
    fc.assert(
      fc.property(
        matrixArb.map((A) => A.map((r) => r.map((v) => Math.sign(v)))),
        (A) => {
          expectEquilibrium(A, solveMatrixGame(A))
        },
      ),
      { numRuns: 500 },
    )
  })
  it('行と列を入れ替えて符号を反転すると、価値も反転する', () => {
    fc.assert(
      fc.property(matrixArb, (A) => {
        const T = A[0].map((_, j) => A.map((r) => -r[j]))
        expect(solveMatrixGame(T).value).toBeCloseTo(-solveMatrixGame(A).value, 6)
      }),
      { numRuns: 200 },
    )
  })
  it('空の行列は例外', () => {
    expect(() => solveMatrixGame([])).toThrow()
    expect(() => solveMatrixGame([[]])).toThrow()
  })
})
