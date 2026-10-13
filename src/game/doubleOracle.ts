// 要素を求めるのが重い、二人零和の行列ゲームを、必要な要素だけを求めて解く。
// 要素は at(i, j) で求め、行プレイヤーの得点を返す。同じ要素を何度求めても同じ値になること。
// 行と列の一部に絞った部分ゲームを解き、相手のその混合戦略への最善応答が部分ゲームの外にあれば足す、を繰り返す（double oracle）。
// 足すものが無くなったとき、部分ゲームの均衡は、元の行列ゲーム全体でも均衡になっている。
// 最善応答は相手の混合戦略の支えの要素だけで決まるので、求める要素は、行の数と列の数に支えの大きさを掛けた程度で済む。

import { type MatrixSolution, solveMatrixGame } from './matrixGame'

/** 得点の比較で同じとみなす幅。cpu.ts の弱い支配と同じ */
const EPS = 1e-9

/** 一度の繰り返しで部分ゲームに足す、最善応答の行と列の数の上限 */
const ADD = 3

/** 求めた要素を覚える行列ゲーム。求めていない要素は NaN で持つ */
export class LazyMatrix {
  readonly rows: number
  readonly cols: number
  private cells: Float64Array
  private value: (i: number, j: number) => number
  /** 求めた要素の数 */
  computed = 0

  constructor(rows: number, cols: number, value: (i: number, j: number) => number) {
    this.rows = rows
    this.cols = cols
    this.value = value
    this.cells = new Float64Array(rows * cols).fill(Number.NaN)
  }

  at(i: number, j: number): number {
    const k = i * this.cols + j
    let v = this.cells[k]
    if (Number.isNaN(v)) {
      v = this.value(i, j)
      this.cells[k] = v
      this.computed++
    }
    return v
  }

  /** 全ての要素を並べた行列 */
  full(): number[][] {
    return Array.from({ length: this.rows }, (_, i) => Array.from({ length: this.cols }, (_, j) => this.at(i, j)))
  }
}

/** 行の側から見た要素の求め方。列の側から見るときは、行と列を入れ替えて符号を反転する */
export type At = (i: number, j: number) => number

/** 行と列を入れ替え、符号を反転した求め方。列プレイヤーから見た行列ゲームになる */
export const flipped =
  (at: At): At =>
  (i, j) =>
    -at(j, i)

/**
 * rows 行 cols 列の行列ゲームで、行 i が、ほかのどれかの行に弱く支配されているか。cpu.ts の weaklyDominated と同じ判定。
 * 行 i を全て求めたうえで、ほかの行は、行 i を下回る列が見つかったところで止める。
 * 行 i の得点の高い列から比べると、支配しない行は早く見分けられる
 */
export function dominatedLazily(rows: number, cols: number, at: At, i: number): boolean {
  const target = Array.from({ length: cols }, (_, j) => at(i, j))
  const order = target.map((_, j) => j).sort((a, b) => target[b] - target[a])
  for (let r = 0; r < rows; r++) {
    if (r === i) continue
    let strict = false
    let covers = true
    for (const j of order) {
      const v = at(r, j)
      if (v < target[j] - EPS) {
        covers = false
        break
      }
      if (v > target[j] + EPS) strict = true
    }
    if (covers && strict) return true
  }
  return false
}

/** 行列ゲーム全体の均衡と、その均衡での全ての行と列の期待得点 */
export interface Equilibrium extends MatrixSolution {
  /** 候補の行それぞれの、列の混合戦略に対する期待得点。候補でない行は NaN */
  rowEv: number[]
  /** 候補の列それぞれの、行の混合戦略に対する、行プレイヤーの期待得点。候補でない列は NaN */
  colEv: number[]
  /** 均衡での賭け金。双方が混合戦略で選んだときの、得点と価値の差の絶対値の平均 */
  stakes: number
}

/** 混合戦略の支え。確率が正の番号と、その確率 */
function support(index: number[], probs: number[]): [number, number][] {
  return index.map((k, n): [number, number] => [k, probs[n]]).filter(([, p]) => p > 0)
}

/**
 * rows 行 cols 列の行列ゲームを、候補の行 rowsIn と列 colsIn に絞って、double oracle で解く。
 * 戻り値の row と col は全ての行と列の長さで、候補でない行と列の確率は0。
 * 返す混合戦略の組は、候補の行と列の行列ゲーム全体で、どちらも相手への最善応答から EPS の内にある
 */
export function solveLazily(rows: number, cols: number, at: At, rowsIn: number[], colsIn: number[]): Equilibrium {
  // 最初の部分ゲーム。最初の列への最善の行と、その行への最善の列から始める
  const c0 = colsIn[0]
  const r0 = argBest(rowsIn, (i) => at(i, c0), 1)
  const c1 = argBest(colsIn, (j) => at(r0, j), -1)
  const R = [r0]
  const C = c1 === c0 ? [c0] : [c0, c1]
  for (;;) {
    const sub = solveMatrixGame(R.map((i) => C.map((j) => at(i, j))))
    const ys = support(C, sub.col)
    const xs = support(R, sub.row)
    const rowEv = new Array<number>(rows).fill(Number.NaN)
    const colEv = new Array<number>(cols).fill(Number.NaN)
    for (const i of rowsIn) rowEv[i] = ys.reduce((acc, [j, p]) => acc + p * at(i, j), 0)
    for (const j of colsIn) colEv[j] = xs.reduce((acc, [i, p]) => acc + p * at(i, j), 0)
    // 部分ゲームの外で、今の相手の混合戦略を上回る行と列。部分ゲームの中の行と列は、部分ゲームの均衡で上回らない
    const inR = new Set(R)
    const inC = new Set(C)
    const moreRows = rowsIn
      .filter((i) => !inR.has(i) && rowEv[i] > sub.value + EPS)
      .sort((a, b) => rowEv[b] - rowEv[a])
      .slice(0, ADD)
    const moreCols = colsIn
      .filter((j) => !inC.has(j) && colEv[j] < sub.value - EPS)
      .sort((a, b) => colEv[a] - colEv[b])
      .slice(0, ADD)
    if (moreRows.length === 0 && moreCols.length === 0) {
      const row = new Array<number>(rows).fill(0)
      const col = new Array<number>(cols).fill(0)
      for (const [i, p] of xs) row[i] = p
      for (const [j, p] of ys) col[j] = p
      let stakes = 0
      for (const [i, p] of xs) for (const [j, q] of ys) stakes += p * q * Math.abs(at(i, j) - sub.value)
      return { value: sub.value, row, col, rowEv, colEv, stakes }
    }
    R.push(...moreRows)
    C.push(...moreCols)
  }
}

/** items の中で、score が sign の向きに最もよいもの。同じなら先のもの */
function argBest(items: number[], score: (k: number) => number, sign: 1 | -1): number {
  let best = items[0]
  let bestScore = sign * score(best)
  for (const k of items.slice(1)) {
    const v = sign * score(k)
    if (v > bestScore) {
      best = k
      bestScore = v
    }
  }
  return best
}
