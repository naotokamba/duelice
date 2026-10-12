// CPUの思考。
// 公開されている情報だけを使い、二ステップの同時手番を最適戦略で解く。
// 難易度は、最適戦略からどれだけ外れた手を混ぜるかで調整する。

import { solveMatrixGame } from './matrixGame'
import { freeDice, legalActions, resolveStep } from './rules'
import type { Action, GameState, PlayerIndex, Rng } from './types'

export type Level = 'easy' | 'normal' | 'hard'

export const LEVEL_NAMES: Record<Level, string> = {
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'つよい',
}

/** 倒した、倒されたことをダメージ差より重く見る */
const KILL_BONUS = 30

interface StepGame {
  a0: Action[]
  a1: Action[]
  payoff: number[][] // プレイヤー0から見た得点
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
    const a0 = legalActions(s, 0)
    const a1 = legalActions(s, 1)
    const payoff = a0.map((x) => a1.map((y) => stepScore(resolveStep(s, [x, y]))))
    return { a0, a1, payoff }
  }

  private buildStep1(s: GameState): StepGame {
    const a0 = legalActions(s, 0)
    const a1 = legalActions(s, 1)
    const payoff = a0.map((x) =>
      a1.map((y) => {
        const next = resolveStep(s, [x, y])
        return stepScore(next) + this.step2Value(next)
      }),
    )
    return { a0, a1, payoff }
  }

  /** 今のステップの行列ゲームを、指定したプレイヤーの視点で返す */
  game(s: GameState, who: PlayerIndex): { mine: Action[]; theirs: Action[]; payoff: number[][] } {
    const g = s.step === 1 ? this.buildStep1(s) : this.buildStep2(s)
    if (who === 0) return { mine: g.a0, theirs: g.a1, payoff: g.payoff }
    const payoff = g.a1.map((_, j) => g.a0.map((_, i) => -g.payoff[i][j]))
    return { mine: g.a1, theirs: g.a0, payoff }
  }

  /** 各行動を選ぶ確率と、その行動の期待得点 */
  analyze(s: GameState, who: PlayerIndex, level: Level): { action: Action; prob: number; ev: number }[] {
    const { mine, payoff } = this.game(s, who)
    const sol = solveMatrixGame(payoff)
    const ev = payoff.map((row) => row.reduce((acc, v, j) => acc + v * sol.col[j], 0))
    let probs: number[]
    if (level === 'hard') probs = sol.row
    else {
      const tau = level === 'normal' ? 1.5 : 4
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
