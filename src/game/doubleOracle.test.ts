import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { expectEquilibrium } from '../test/equilibrium'
import { weaklyDominated } from './cpu'
import { dominatedLazily, flipped, LazyMatrix, solveLazily } from './doubleOracle'
import { solveMatrixGame } from './matrixGame'

/** 同点が起きやすい、小さい整数の行列 */
const matrixArb = fc.tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 })).chain(([m, n]) =>
  fc.array(fc.array(fc.integer({ min: -5, max: 5 }), { minLength: n, maxLength: n }), {
    minLength: m,
    maxLength: m,
  }),
)

const range = (n: number) => Array.from({ length: n }, (_, k) => k)

/** 行列から要素を求める関数。求めた回数も数える */
function counted(A: number[][]) {
  const calls = { n: 0 }
  const at = (i: number, j: number) => {
    calls.n++
    return A[i][j]
  }
  return { at, calls }
}

describe('double oracle', () => {
  it('全ての行と列を候補にすれば、全ての要素を求めて解いた価値と同じ価値の均衡になる', () => {
    fc.assert(
      fc.property(matrixArb, (A) => {
        const e = solveLazily(A.length, A[0].length, (i, j) => A[i][j], range(A.length), range(A[0].length))
        expect(e.value).toBeCloseTo(solveMatrixGame(A).value, 9)
        expectEquilibrium(A, e)
      }),
      { numRuns: 300 },
    )
  })

  it('候補に絞れば、その行と列だけの行列ゲームの均衡になり、候補の外の確率は0', () => {
    fc.assert(
      fc.property(
        matrixArb.chain((A) =>
          fc.tuple(
            fc.constant(A),
            fc.shuffledSubarray(range(A.length), { minLength: 1 }),
            fc.shuffledSubarray(range(A[0].length), { minLength: 1 }),
          ),
        ),
        ([A, rowsIn, colsIn]) => {
          const R = [...rowsIn].sort((a, b) => a - b)
          const C = [...colsIn].sort((a, b) => a - b)
          const e = solveLazily(A.length, A[0].length, (i, j) => A[i][j], R, C)
          const sub = R.map((i) => C.map((j) => A[i][j]))
          expect(e.value).toBeCloseTo(solveMatrixGame(sub).value, 9)
          expectEquilibrium(sub, { value: e.value, row: R.map((i) => e.row[i]), col: C.map((j) => e.col[j]) })
          range(A.length).forEach((i) => {
            if (!R.includes(i)) {
              expect(e.row[i]).toBe(0)
              expect(e.rowEv[i]).toBeNaN()
            }
          })
          range(A[0].length).forEach((j) => {
            if (!C.includes(j)) {
              expect(e.col[j]).toBe(0)
              expect(e.colEv[j]).toBeNaN()
            }
          })
        },
      ),
      { numRuns: 300 },
    )
  })

  it('候補の行と列の期待得点は、相手の混合戦略に対する得点の平均で、賭け金は価値からのずれの平均', () => {
    fc.assert(
      fc.property(matrixArb, (A) => {
        const e = solveLazily(A.length, A[0].length, (i, j) => A[i][j], range(A.length), range(A[0].length))
        A.forEach((r, i) => {
          expect(e.rowEv[i]).toBeCloseTo(
            r.reduce((acc, v, j) => acc + v * e.col[j], 0),
            9,
          )
        })
        A[0].forEach((_, j) => {
          expect(e.colEv[j]).toBeCloseTo(
            A.reduce((acc, r, i) => acc + r[j] * e.row[i], 0),
            9,
          )
        })
        let stakes = 0
        A.forEach((r, i) => {
          r.forEach((v, j) => {
            stakes += e.row[i] * e.col[j] * Math.abs(v - e.value)
          })
        })
        expect(e.stakes).toBeCloseTo(stakes, 9)
      }),
      { numRuns: 200 },
    )
  })

  it('一つの手が全てに勝る大きい行列ゲームは、要素の一部だけを求めて解く', () => {
    // 行 7 は全ての列で 1、ほかは 0。列プレイヤーはどれを選んでも同じなので、行 7 を見つければ終わる
    const A = range(40).map((i) => range(40).map(() => (i === 7 ? 1 : 0)))
    const { at, calls } = counted(A)
    const e = solveLazily(40, 40, at, range(40), range(40))
    expect(e.value).toBe(1)
    expect(e.row[7]).toBe(1)
    expect(calls.n).toBeLessThan((40 * 40) / 4)
  })

  it('じゃんけんは全ての手を混ぜる', () => {
    const A = [
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ]
    const e = solveLazily(3, 3, (i, j) => A[i][j], range(3), range(3))
    expect(e.value).toBeCloseTo(0, 9)
    for (const p of [...e.row, ...e.col]) expect(p).toBeCloseTo(1 / 3, 9)
  })
})

describe('弱い支配を、要素を必要なだけ求めて見分ける', () => {
  it('全ての要素を見る判定と同じ答えになる', () => {
    fc.assert(
      fc.property(matrixArb, (A) => {
        A.forEach((_, i) => {
          expect(dominatedLazily(A.length, A[0].length, (r, j) => A[r][j], i)).toBe(weaklyDominated(A, i))
        })
      }),
      { numRuns: 300 },
    )
  })

  it('支配しない行は、下回る列が見つかったところで止める', () => {
    // 行 0 は列 0 で 9 を取り、ほかの行はどれも列 0 で下回る。行 0 の得点の高い列から比べるので、ほかの行は一つずつ見れば済む
    const A = range(10).map((i) => range(10).map((j) => (i === 0 ? (j === 0 ? 9 : 0) : 1)))
    const { at, calls } = counted(A)
    expect(dominatedLazily(10, 10, at, 0)).toBe(false)
    expect(calls.n).toBe(10 + 9)
  })

  it('列の側は、入れ替えて符号を反転して見る', () => {
    const A = [
      [1, 2],
      [3, 4],
    ]
    const at = flipped((i, j) => A[i][j])
    expect(at(1, 0)).toBe(-2)
    // 列 1 は列 0 より行プレイヤーの得点が常に高いので、列プレイヤーには弱く支配される
    expect(dominatedLazily(2, 2, at, 1)).toBe(true)
    expect(dominatedLazily(2, 2, at, 0)).toBe(false)
  })
})

describe('要素を覚える行列', () => {
  it('同じ要素は一度だけ求め、全てを並べると元の行列になる', () => {
    const A = [
      [1, 2, 3],
      [4, 5, 6],
    ]
    const { at, calls } = counted(A)
    const m = new LazyMatrix(2, 3, at)
    expect(m.at(1, 2)).toBe(6)
    expect(m.at(1, 2)).toBe(6)
    expect(calls.n).toBe(1)
    expect(m.computed).toBe(1)
    expect(m.full()).toEqual(A)
    expect(calls.n).toBe(6)
  })
})
