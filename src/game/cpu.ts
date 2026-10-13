// CPUの思考。
// 公開されている情報だけを使い、二ステップの同時手番を最適戦略で解く。
// 難易度は、最適戦略からどれだけ外れた手を混ぜるかで調整する。
// 無意味なパスはどの強さでも選ばない。弱さは、パス以外の手の選び方で出す。
// どのステップでも、ほかの行動に弱く支配されるパスだけを候補から外す。相手が守りを残していて、自分も焼ける攻撃が防がれうるときのように、意味のあるパスは残す。
// 候補を絞るのは二人とも同じなので、つよいが解く均衡は、この絞った行列ゲームの均衡になる。
// 先読みはターンの終わりまで。次のターンに持ち越すものは、体力に換算した見積もりで足す。
// ターンの中で起きることに乱数は無いので、一ステップの得点は、双方の行動を解決した盤から一つに決まる。
// 行列ゲームが大きいときは、全ての要素を求めずに、必要な行と列だけを足していく double oracle で同じ均衡を求める。
// 要素一つに二ステップ目まで解く一ステップ目では、これで求める要素が数分の一に減る。

import { type At, dominatedLazily, flipped, LazyMatrix, solveLazily } from './doubleOracle'
import { type MatrixSolution, solveMatrixGame } from './matrixGame'
import { freeDice, legalActions, resolveTrusted } from './rules'
import type { Action, GameState, PlayerIndex, Rng } from './types'

/**
 * CPU の考え方の版。考え方を変えたら上げる。強さの評価の記録は、この版ごとに分けて取り直す
 */
export const CPU_VERSION = 5

/** 次のターンに持ち越すものを、体力に換算した見積もり */
export interface Estimates {
  /** 次のターンへ持ち越したダイス1個 */
  carry: number
  /** 相手が次のターンの一ステップ目に置けない目を残したこと */
  freeze: number
}

/** 見積もりの既定値。違う見積もりの CPU どうしを戦わせて、確かめながら決める */
export const ESTIMATES: Estimates = { carry: 1.5, freeze: 0.5 }

export type Level = 'easy' | 'normal' | 'hard'

export const LEVEL_NAMES: Record<Level, string> = {
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'つよい',
}

/** 倒した、倒されたことをダメージ差より重く見る */
export const KILL_BONUS = 30

interface StepGame {
  a0: Action[]
  a1: Action[]
  payoff: number[][] // プレイヤー0から見た得点
}

/**
 * 得点の比較で同じとみなす幅。二ステップ目の価値は行列ゲームを解いた小数で、同じ局面でも手の並びが違うと末の桁がずれる。
 * そのずれで、本当は同点の手を「上回る」と判定しないようにする
 */
const EPS = 1e-9

/**
 * 行 i が、ほかのどれかの行に弱く支配されているか。
 * 相手のどの手に対しても得点が同じか上で、少なくとも一つの手で上回る行があれば支配されている
 */
export function weaklyDominated(payoff: number[][], i: number): boolean {
  return payoff.some(
    (row, r) => r !== i && row.every((v, j) => v >= payoff[i][j] - EPS) && row.some((v, j) => v > payoff[i][j] + EPS),
  )
}

/** 行列ゲームの行と列を入れ替え、符号を反転する。相手から見た行列ゲームになる */
function flip(g: StepGame): StepGame {
  return { a0: g.a1, a1: g.a0, payoff: g.a1.map((_, j) => g.a0.map((_, i) => -g.payoff[i][j])) }
}

/** 行の側のパスが弱く支配されていれば、その行の番号。外すものが無ければ -1 */
function dominatedPass(g: StepGame): number {
  const i = g.a0.findIndex((a) => a.kind === 'pass')
  return i >= 0 && weaklyDominated(g.payoff, i) ? i : -1
}

/**
 * 二人それぞれについて、弱く支配されるパスを外す。どちらも元の行列ゲームで判定して同時に外し、席による差を作らない。
 * 支配された手は、支配する手に替えても損をしないので、外しても零和の行列ゲームの価値は変わらない
 */
function prune(g: StepGame): StepGame {
  const row = dominatedPass(g)
  const col = dominatedPass(flip(g))
  return {
    a0: g.a0.filter((_, i) => i !== row),
    a1: g.a1.filter((_, j) => j !== col),
    payoff: g.payoff.filter((_, i) => i !== row).map((r) => r.filter((_, j) => j !== col)),
  }
}

function stateKey(s: GameState): string {
  return JSON.stringify([
    s.step,
    s.players.map((p) => [
      p.hp,
      freeDice(p)
        .map((i) => p.roll[i])
        .sort(),
      [...p.usedCards].sort(),
      p.chant,
      [...p.deck].sort(),
      p.frozen,
      p.burned,
      p.carry,
      p.last,
      [...p.acted].sort(),
    ]),
  ])
}

/** 一ステップ解決したときのプレイヤー0から見た得点 */
function stepScore(next: GameState): number {
  const last = next.history[next.history.length - 1]
  let v = last.damage[1] - last.damage[0]
  if (next.winner === 0) v += KILL_BONUS
  if (next.winner === 1) v -= KILL_BONUS
  return v
}

/** 一ステップの行列ゲームの、要素を全て求めて解く大きさの上限。これより大きければ double oracle で必要な要素だけを求める */
export const FULL_LIMIT = 400

/** 今のステップの行列ゲームを、指定したプレイヤーの視点で解いた結果 */
export interface Solved {
  /** 自分の候補の行動。弱く支配されるパスは外してある */
  mine: Action[]
  /** 相手の候補の行動 */
  theirs: Action[]
  /** 自分から見た価値と、自分 row と相手 col の均衡の混合戦略 */
  sol: MatrixSolution
  /** 自分の行動それぞれの、相手の均衡の混合戦略に対する期待得点 */
  ev: number[]
  /** 均衡での賭け金。双方が均衡の混合戦略で選んだときの、得点と価値の差の絶対値の平均 */
  stakes: number
}

/** 要素を求めたときに覚える一ステップの行列ゲーム。プレイヤー0から見た得点 */
interface LazyStep {
  a0: Action[]
  a1: Action[]
  m: LazyMatrix
}

export class Thinker {
  private step2Cache = new Map<string, number>()
  private legalCache = new Map<string, Action[]>()
  private estimates: Estimates
  private fullLimit: number

  /** fullLimit は、要素を全て求めて解く行列ゲームの大きさの上限。テストでは 0 にして、いつも double oracle で解かせる */
  constructor(estimates: Estimates = ESTIMATES, fullLimit = FULL_LIMIT) {
    this.estimates = estimates
    this.fullLimit = fullLimit
  }

  /**
   * who の合法手。自分の盤だけで決まるので、同じ盤なら覚えた手を返す。
   * 一ステップ目の組ごとに二ステップ目を解くと、同じ自分の盤が相手の手の数だけ現れる
   */
  private legal(s: GameState, who: PlayerIndex): Action[] {
    const p = s.players[who]
    const key = JSON.stringify([
      s.step,
      s.config.maxHp,
      p.roll,
      p.usedDice,
      p.frozen,
      p.deck,
      p.usedCards,
      p.chant,
      p.last,
    ])
    const hit = this.legalCache.get(key)
    if (hit) return hit
    const list = legalActions(s, who)
    this.legalCache.set(key, list)
    return list
  }

  /**
   * ターンの終わりの盤で、次のターンに持ち越すものの見積もり。プレイヤー0から見た得点。
   * 持ち越したダイスと、相手に残した凍結を数える。決着していれば次のターンは無いので数えない
   */
  private carried(s: GameState): number {
    if (s.winner !== null) return 0
    const { carry, freeze } = this.estimates
    const [p0, p1] = s.players
    const held = (p0.carry === null ? 0 : carry) - (p1.carry === null ? 0 : carry)
    const frozen = (p1.frozen === null ? 0 : freeze) - (p0.frozen === null ? 0 : freeze)
    return held + frozen
  }

  /**
   * 二ステップ目の価値。弱く支配される手を外しても零和の行列ゲームの価値は変わらないので、パスを外さずに価値だけを求める。
   * 二ステップ目の行列ゲームは一手で決まる局面が多く、double oracle なら要素の一部を求めるだけで済む
   */
  private step2Value(s: GameState): number {
    if (s.winner !== null) return 0
    const key = stateKey(s)
    const hit = this.step2Cache.get(key)
    if (hit !== undefined) return hit
    const { m } = this.lazyStep2(s)
    const v = solveLazily(m.rows, m.cols, (i, j) => m.at(i, j), range(m.rows), range(m.cols)).value
    this.step2Cache.set(key, v)
    return v
  }

  private lazyStep2(s: GameState): LazyStep {
    return this.lazy(s, (next) => stepScore(next) + this.carried(next))
  }

  /**
   * 今のステップの行列ゲーム。先読みは今のステップの記録しか読まないので、これまでの記録を外した盤から読む。
   * 解決のたびに記録を写す手間が、長い対局でも増えない
   */
  private lazyStep(s: GameState): LazyStep {
    const root = s.history.length === 0 ? s : { ...s, history: [] }
    return root.step === 1 ? this.lazy(root, (next) => stepScore(next) + this.step2Value(next)) : this.lazyStep2(root)
  }

  /** 二人の候補の組ごとに一ステップ解決し、score で得点を付ける行列ゲーム。要素は求めたときに覚える */
  private lazy(s: GameState, score: (next: GameState) => number): LazyStep {
    const a0 = this.legal(s, 0)
    const a1 = this.legal(s, 1)
    return { a0, a1, m: new LazyMatrix(a0.length, a1.length, (i, j) => score(resolveTrusted(s, [a0[i], a1[j]]))) }
  }

  /** 今のステップの行列ゲームを、全ての要素を求めて、指定したプレイヤーの視点で返す。弱く支配されるパスは外す */
  game(s: GameState, who: PlayerIndex): { mine: Action[]; theirs: Action[]; payoff: number[][] } {
    const g0 = prune(fullOf(this.lazyStep(s)))
    const g = who === 0 ? g0 : flip(g0)
    return { mine: g.a0, theirs: g.a1, payoff: g.payoff }
  }

  /**
   * 今のステップの行列ゲームを、指定したプレイヤーの視点で解く。sol.row が自分の、sol.col が相手の均衡の混合戦略。
   * 小さい行列ゲームは全ての要素を求めて解く。大きければ、パスが弱く支配されるかを必要な要素だけで確かめてから、double oracle で解く
   */
  solve(s: GameState, who: PlayerIndex): Solved {
    const g = this.lazyStep(s)
    if (g.m.rows * g.m.cols <= this.fullLimit) {
      const full = prune(fullOf(g))
      const { a0: mine, a1: theirs, payoff } = who === 0 ? full : flip(full)
      const sol = solveMatrixGame(payoff)
      const ev = payoff.map((row) => row.reduce((acc, v, j) => acc + v * sol.col[j], 0))
      return { mine, theirs, sol, ev, stakes: stakesOf(payoff, sol.row, sol.col, sol.value) }
    }
    // パスを外すかは、二人ともプレイヤー0から見た元の行列ゲームで決める
    const at: At = (i, j) => g.m.at(i, j)
    const rows = keptRows(g.a0, g.m.rows, g.m.cols, at)
    const cols = keptRows(g.a1, g.m.cols, g.m.rows, flipped(at))
    const [mineAll, theirsAll, mineIn, theirsIn, view] =
      who === 0 ? [g.a0, g.a1, rows, cols, at] : [g.a1, g.a0, cols, rows, flipped(at)]
    const e = solveLazily(mineAll.length, theirsAll.length, view, mineIn, theirsIn)
    return {
      mine: mineIn.map((i) => mineAll[i]),
      theirs: theirsIn.map((j) => theirsAll[j]),
      sol: { value: e.value, row: mineIn.map((i) => e.row[i]), col: theirsIn.map((j) => e.col[j]) },
      ev: mineIn.map((i) => e.rowEv[i]),
      stakes: e.stakes,
    }
  }

  /** 各行動を選ぶ確率と、その行動の期待得点 */
  analyze(s: GameState, who: PlayerIndex, level: Level): Options {
    const { mine, sol, ev } = this.solve(s, who)
    let probs: number[]
    if (level === 'hard') probs = sol.row
    else {
      // 期待得点の差が大きいほど最善手に寄る。読み合いが重い今の5枚で、ふつうがつよいに4割弱勝つように合わせた値
      const tau = level === 'normal' ? 3 : 4
      const best = Math.max(...ev)
      const soft = ev.map((v) => Math.exp((v - best) / tau))
      const sum = soft.reduce((a, b) => a + b, 0)
      const softmax = soft.map((v) => v / sum)
      probs = level === 'normal' ? softmax.map((p, i) => 0.5 * p + 0.5 * sol.row[i]) : softmax
    }
    return mine.map((action, i) => ({ action, prob: probs[i], ev: ev[i] }))
  }

  decide(s: GameState, who: PlayerIndex, level: Level, rng: Rng): Action {
    return pick(this.analyze(s, who, level), rng)
  }
}

/** 行動ごとの確率と期待得点。analyze の結果 */
export type Options = { action: Action; prob: number; ev: number }[]

/** 確率に従って行動を一つ選ぶ。乱数は一度だけ引く。考えるのを別の所で済ませたときも、同じ乱数なら decide と同じ手になる */
export function pick(options: Options, rng: Rng): Action {
  let r = rng()
  for (const o of options) {
    r -= o.prob
    if (r <= 0) return o.action
  }
  return options[options.length - 1].action
}

/** 0 から n − 1 までの番号 */
const range = (n: number) => Array.from({ length: n }, (_, k) => k)

/** 全ての要素を求めた行列ゲーム */
function fullOf(g: LazyStep): StepGame {
  return { a0: g.a0, a1: g.a1, payoff: g.m.full() }
}

/** 行の側の候補の番号。弱く支配されるパスを外す。判定は prune と同じで、要素は確かめるのに要るものだけを求める */
function keptRows(actions: Action[], rows: number, cols: number, at: At): number[] {
  const pass = actions.findIndex((a) => a.kind === 'pass')
  const drop = pass >= 0 && dominatedLazily(rows, cols, at, pass) ? pass : -1
  return range(rows).filter((i) => i !== drop)
}

/**
 * 均衡での賭け金。双方が混合戦略で選んだときの、得点と価値の差の絶対値の平均。
 * 読みが当たるか外れるかで、どれだけ得点が動くかを表す
 */
export function stakesOf(payoff: number[][], row: number[], col: number[], value: number): number {
  let sum = 0
  payoff.forEach((r, i) => {
    r.forEach((v, j) => {
      sum += row[i] * col[j] * Math.abs(v - value)
    })
  })
  return sum
}
