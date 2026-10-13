// 評価の数え方。勝率の信頼区間と、対戦の結果からデッキの強さを求める Bradley–Terry の当てはめ。
// どれも純粋な関数で、eval/stats.test.ts で確かめる。

/** 勝ちを1、引き分けを0.5、負けを0と数えた勝率と、その 95% の Wilson 区間 */
export interface Rate {
  /** 勝ち点の合計。引き分けは0.5 */
  score: number
  n: number
  rate: number
  lo: number
  hi: number
}

/** 95% の区間に使う標準正規分布の分位点 */
const Z = 1.96

export function wilson(score: number, n: number, z = Z): Rate {
  if (n === 0) return { score, n, rate: 0.5, lo: 0, hi: 1 }
  const p = score / n
  const z2 = z * z
  const center = (p + z2 / (2 * n)) / (1 + z2 / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
  return { score, n, rate: p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) }
}

/** 区間が 0.5 をまたぐ。勝ち越しか負け越しか、まだ言えない */
export const close = (r: Rate) => r.lo < 0.5 && r.hi > 0.5

/** 一つの組の対戦結果。a から見た勝ち点の合計と対戦数 */
export interface PairResult {
  a: string
  b: string
  /** a の勝ち点。引き分けは0.5 */
  score: number
  n: number
}

/**
 * Bradley–Terry の強さを当てはめる。強さは Elo の目盛りで返し、全体の平均を0にそろえる。
 * 全勝や全敗のデッキの強さが無限に飛ばないよう、どのデッキも平均の強さの仮の相手と prior 回引き分けたことにする。
 * 当てはめは MM 法で、変化が tol より小さくなるか iterations 回で止める
 */
export function bradleyTerry(results: PairResult[], prior = 1, iterations = 2000, tol = 1e-9): Map<string, number> {
  const ids = [...new Set(results.flatMap((r) => [r.a, r.b]))]
  const index = new Map(ids.map((id, i) => [id, i]))
  const wins = new Array<number>(ids.length).fill(prior / 2)
  const games: Map<number, number>[] = ids.map(() => new Map())
  const add = (i: number, j: number, n: number) => games[i].set(j, (games[i].get(j) ?? 0) + n)
  for (const r of results) {
    const i = index.get(r.a) as number
    const j = index.get(r.b) as number
    wins[i] += r.score
    wins[j] += r.n - r.score
    add(i, j, r.n)
    add(j, i, r.n)
  }
  let p = new Array<number>(ids.length).fill(1)
  for (let it = 0; it < iterations; it++) {
    const next = p.map((pi, i) => {
      // 仮の相手は強さ1で、prior 回対戦した
      let denom = prior / (pi + 1)
      for (const [j, n] of games[i]) denom += n / (pi + p[j])
      return wins[i] / denom
    })
    const g = Math.exp(next.reduce((acc, v) => acc + Math.log(v), 0) / next.length)
    const scaled = next.map((v) => v / g)
    const change = Math.max(...scaled.map((v, i) => Math.abs(Math.log(v) - Math.log(p[i]))))
    p = scaled
    if (change < tol) break
  }
  return new Map(ids.map((id, i) => [id, (400 * Math.log(p[i])) / Math.LN10]))
}

/** Elo の差から、強い側の期待勝率 */
export const expected = (diff: number) => 1 / (1 + 10 ** (-diff / 400))

/** 平均。空なら NaN */
export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
