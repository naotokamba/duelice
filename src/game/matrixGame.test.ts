import { describe, expect, it } from 'vitest'
import { solveMatrixGame } from './matrixGame'

const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6))

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
