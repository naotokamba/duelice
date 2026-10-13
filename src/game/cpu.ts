// CPUの思考。
// 公開されている情報だけを使い、二ステップの同時手番を最適戦略で解く。
// 難易度は、最適戦略からどれだけ外れた手を混ぜるかで調整する。
// 無意味なパスはどの強さでも選ばない。弱さは、パス以外の手の選び方で出す。
// どのステップでも、ほかの行動に弱く支配されるパスだけを候補から外す。相手が守りを残していて、自分も焼ける攻撃が防がれうるときのように、意味のあるパスは残す。
// 候補を絞るのは二人とも同じなので、つよいが解く均衡は、この絞った行列ゲームの均衡になる。
// 先読みはターンの終わりまで。次のターンに持ち越すものは、体力に換算した見積もりで足す。
// ダイスを振り足す行動は、振り足すダイスの出方を全て数え、その確率で重みを付けた平均を得点にする。

import { solveMatrixGame } from './matrixGame'
import { extraDiceOf, freeDice, legalActions, resolveStep } from './rules'
import type { Action, GameState, PlayerIndex, Rng } from './types'

/**
 * CPU の考え方の版。考え方を変えたら上げる。強さの評価の記録は、この版ごとに分けて取り直す
 */
export const CPU_VERSION = 3

/** 次のターンに持ち越すものを、体力に換算した見積もり */
export interface Estimates {
  /** 次のターンへ持ち越したダイス1個 */
  carry: number
  /** 相手が次のターンの一ステップ目に置けない目を残したこと */
  freeze: number
}

/** 見積もりの既定値。違う見積もりの CPU どうしを戦わせて、確かめながら決める */
export const ESTIMATES: Estimates = { carry: 1.5, freeze: 0.5 }

/** 振り足すダイスの出方。数ごとに一度だけ数える */
const outcomeCache = new Map<number, { dice: number[]; p: number }[]>()

/** n 個のダイスの出方と、その確率。目の並びは問わないので、組ごとにまとめる */
export function rollOutcomes(n: number): { dice: number[]; p: number }[] {
  const hit = outcomeCache.get(n)
  if (hit) return hit
  const out = countOutcomes(n)
  outcomeCache.set(n, out)
  return out
}

function countOutcomes(n: number): { dice: number[]; p: number }[] {
  if (n === 0) return [{ dice: [], p: 1 }]
  const out: { dice: number[]; p: number }[] = []
  for (const rest of countOutcomes(n - 1))
    for (let v = rest.dice.at(-1) ?? 1; v <= 6; v++) out.push({ dice: [...rest.dice, v], p: 0 })
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1))
  for (const o of out) {
    const counts = [1, 2, 3, 4, 5, 6].map((v) => o.dice.filter((d) => d === v).length)
    o.p = fact(n) / counts.reduce((acc, c) => acc * fact(c), 1) / 6 ** n
  }
  return out
}

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

export class Thinker {
  private step2Cache = new Map<string, number>()
  private estimates: Estimates

  constructor(estimates: Estimates = ESTIMATES) {
    this.estimates = estimates
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

  /** 二ステップ目の価値 */
  private step2Value(s: GameState): number {
    if (s.winner !== null) return 0
    const key = stateKey(s)
    const hit = this.step2Cache.get(key)
    if (hit !== undefined) return hit
    const game = this.buildStep2(s)
    const v = solveMatrixGame(game.payoff).value
    this.step2Cache.set(key, v)
    return v
  }

  private buildStep2(s: GameState): StepGame {
    return this.build(s, (next) => stepScore(next) + this.carried(next))
  }

  private buildStep1(s: GameState): StepGame {
    return this.build(s, (next) => stepScore(next) + this.step2Value(next))
  }

  /** 二人の候補の組ごとに一ステップ解決し、score で得点を付けた行列ゲーム。無意味なパスは外す */
  private build(s: GameState, score: (next: GameState) => number): StepGame {
    const a0 = legalActions(s, 0)
    const a1 = legalActions(s, 1)
    const payoff = a0.map((x) => a1.map((y) => this.expected(s, [x, y], score)))
    return prune({ a0, a1, payoff })
  }

  /** 双方の行動を解決した得点。ダイスを振り足す行動があれば、出方の確率で重みを付けた平均 */
  private expected(s: GameState, acts: [Action, Action], score: (next: GameState) => number): number {
    const [n0, n1] = [extraDiceOf(s, 0, acts[0]), extraDiceOf(s, 1, acts[1])]
    if (n0 === 0 && n1 === 0) return score(resolveStep(s, acts))
    let sum = 0
    for (const e0 of rollOutcomes(n0))
      for (const e1 of rollOutcomes(n1)) sum += e0.p * e1.p * score(resolveStep(s, acts, [e0.dice, e1.dice]))
    return sum
  }

  /** 今のステップの行列ゲームを、指定したプレイヤーの視点で返す */
  game(s: GameState, who: PlayerIndex): { mine: Action[]; theirs: Action[]; payoff: number[][] } {
    const g0 = s.step === 1 ? this.buildStep1(s) : this.buildStep2(s)
    const g = who === 0 ? g0 : flip(g0)
    return { mine: g.a0, theirs: g.a1, payoff: g.payoff }
  }

  /** 今のステップの行列ゲームを、指定したプレイヤーの視点で解く。sol.row が自分の、sol.col が相手の最適戦略 */
  solve(s: GameState, who: PlayerIndex) {
    const g = this.game(s, who)
    return { ...g, sol: solveMatrixGame(g.payoff) }
  }

  /** 各行動を選ぶ確率と、その行動の期待得点 */
  analyze(s: GameState, who: PlayerIndex, level: Level): { action: Action; prob: number; ev: number }[] {
    const { mine, payoff, sol } = this.solve(s, who)
    const ev = payoff.map((row) => row.reduce((acc, v, j) => acc + v * sol.col[j], 0))
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
    const options = this.analyze(s, who, level)
    let r = rng()
    for (const o of options) {
      r -= o.prob
      if (r <= 0) return o.action
    }
    return options[options.length - 1].action
  }
}
