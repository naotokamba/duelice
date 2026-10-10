import { describe, expect, it } from 'vitest'
import { Thinker } from './cpu'
import { DEFAULT_CONFIG, type GameState, isLegal, nextTurn, newGame, resolveStep, turnOver } from './rules'

function seeded(seed: number) {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

function stateWith(r0: number[], r1: number[], hp = 20): GameState {
  const p = (roll: number[]) => ({ hp, roll, usedDice: [], usedCards: [], chant: 'none' as const })
  return { config: DEFAULT_CONFIG, turn: 1, step: 1, players: [p(r0), p(r1)], history: [], winner: null }
}

describe('CPU', () => {
  it('常に合法手を選ぶ', () => {
    const rng = seeded(7)
    const t = new Thinker()
    let s = newGame(rng)
    for (let k = 0; k < 40 && s.winner === null; k++) {
      const a0 = t.decide(s, 0, 'hard', rng)
      const a1 = t.decide(s, 1, 'easy', rng)
      expect(isLegal(s, 0, a0)).toBe(true)
      expect(isLegal(s, 1, a1)).toBe(true)
      s = resolveStep(s, [a0, a1])
      if (s.winner === null && turnOver(s)) s = nextTurn(s, rng)
    }
  })
  it('確率の合計は1', () => {
    const t = new Thinker()
    const s = stateWith([6, 5, 2], [3, 3, 6])
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const sum = t.analyze(s, 1, level).reduce((a, o) => a + o.prob, 0)
      expect(sum).toBeCloseTo(1, 6)
    }
  })
  it('倒し切れるときは倒しに行く', () => {
    const t = new Thinker()
    // 相手は残り3でゾロ目なし。魔弾2個なら障壁も関係なく3点で倒せる
    let s = stateWith([1, 2, 3], [6, 6, 1], 20)
    s = { ...s, players: [{ ...s.players[0], hp: 3 }, s.players[1]] }
    const best = t.analyze(s, 1, 'hard').sort((a, b) => b.prob - a.prob)[0]
    expect(best.action.kind === 'fireball' || best.action.kind === 'bullet').toBe(true)
  })
})
