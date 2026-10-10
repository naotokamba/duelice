// 二人零和の行列ゲームを単体法で解く。
// payoff[i][j] は行プレイヤーが i、列プレイヤーが j を選んだときの行プレイヤーの得点。
// 戻り値は均衡での価値と、行と列それぞれの混合戦略。

export interface MatrixSolution {
  value: number
  row: number[]
  col: number[]
}

const EPS = 1e-9

export function solveMatrixGame(payoff: number[][]): MatrixSolution {
  const m = payoff.length
  const n = payoff[0]?.length ?? 0
  if (m === 0 || n === 0) throw new Error('空の行列')

  // 全要素を正にずらす。価値は後で戻す
  let min = Infinity
  for (const r of payoff) for (const v of r) min = Math.min(min, v)
  const shift = min <= 0 ? 1 - min : 0
  const A = payoff.map((r) => r.map((v) => v + shift))

  // 列プレイヤー側の問題: maximize Σw  s.t.  A w ≤ 1, w ≥ 0
  // 表: m 行の制約 + 目的行。列は w の n 個 + スラック m 個 + 右辺
  const width = n + m + 1
  const T: number[][] = []
  for (let i = 0; i < m; i++) {
    const row = new Array(width).fill(0)
    for (let j = 0; j < n; j++) row[j] = A[i][j]
    row[n + i] = 1
    row[width - 1] = 1
    T.push(row)
  }
  const obj = new Array(width).fill(0)
  for (let j = 0; j < n; j++) obj[j] = -1
  T.push(obj)
  const basis = Array.from({ length: m }, (_, i) => n + i)

  let solved = false
  for (let iter = 0; iter < 10000; iter++) {
    // ブランドの規則: 目的行で負の係数を持つ最小の列を選ぶ
    let enter = -1
    for (let j = 0; j < width - 1; j++) {
      if (T[m][j] < -EPS) {
        enter = j
        break
      }
    }
    if (enter === -1) {
      solved = true
      break
    }
    let leave = -1
    let best = Infinity
    for (let i = 0; i < m; i++) {
      if (T[i][enter] > EPS) {
        const ratio = T[i][width - 1] / T[i][enter]
        if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[leave])) {
          best = ratio
          leave = i
        }
      }
    }
    if (leave === -1) throw new Error('非有界')
    const piv = T[leave][enter]
    for (let j = 0; j < width; j++) T[leave][j] /= piv
    for (let i = 0; i <= m; i++) {
      if (i === leave) continue
      const f = T[i][enter]
      if (Math.abs(f) < EPS) continue
      for (let j = 0; j < width; j++) T[i][j] -= f * T[leave][j]
    }
    basis[leave] = enter
  }

  // ブランドの規則で循環はしないので、ここに来るのは想定外の不具合
  if (!solved) throw new Error('反復の上限に達した')

  const w = new Array(n).fill(0)
  for (let i = 0; i < m; i++) if (basis[i] < n) w[basis[i]] = T[i][width - 1]
  const sumW = w.reduce((a, b) => a + b, 0)
  const v = 1 / sumW
  const col = w.map((x) => Math.max(0, x * v))
  const u = Array.from({ length: m }, (_, i) => Math.max(0, T[m][n + i]))
  const row = u.map((x) => x * v)
  return { value: v - shift, row: normalize(row), col: normalize(col) }
}

function normalize(p: number[]): number[] {
  const s = p.reduce((a, b) => a + b, 0)
  return s > 0 ? p.map((x) => x / s) : p.map(() => 1 / p.length)
}
