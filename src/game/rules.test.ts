import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  type Action,
  type GameState,
  legalActions,
  nextTurn,
  resolveStep,
  stepDamage,
  turnOver,
} from './rules'

function stateWith(r0: number[], r1: number[], hp = 20): GameState {
  const p = (roll: number[]) => ({ hp, roll, usedDice: [], usedCards: [], chant: 'none' as const })
  return { config: DEFAULT_CONFIG, turn: 1, step: 1, players: [p(r0), p(r1)], history: [], winner: null }
}

const pass: Action = { kind: 'pass' }

describe('ダメージ計算', () => {
  const c = DEFAULT_CONFIG
  it('火球は高い方の目', () => {
    expect(stepDamage(c, [[6, 2], []], [{ kind: 'fireball', dice: [0, 1] }, pass])).toEqual([0, 6])
  })
  it('障壁は置いた目だけ火球を減らす', () => {
    expect(stepDamage(c, [[5, 1], [3]], [{ kind: 'fireball', dice: [0, 1] }, { kind: 'barrier', dice: [0] }])).toEqual([0, 2])
    expect(stepDamage(c, [[5, 1], [6]], [{ kind: 'fireball', dice: [0, 1] }, { kind: 'barrier', dice: [0] }])).toEqual([0, 0])
  })
  it('魔弾は障壁をすり抜ける', () => {
    expect(stepDamage(c, [[1], [6]], [{ kind: 'bullet', dice: [0] }, { kind: 'barrier', dice: [0] }])).toEqual([0, 2])
    expect(stepDamage(c, [[1, 1], [6]], [{ kind: 'bullet', dice: [0, 1] }, { kind: 'barrier', dice: [0] }])).toEqual([0, 3])
  })
  it('反射は攻撃をそのまま返す', () => {
    expect(stepDamage(c, [[6, 4], [2, 2]], [{ kind: 'fireball', dice: [0, 1] }, { kind: 'reflect', dice: [0, 1] }])).toEqual([6, 0])
  })
  it('雷槍は2個の合計', () => {
    expect(stepDamage(c, [[6, 5], [3]], [{ kind: 'spearCast', dice: [0, 1] }, { kind: 'barrier', dice: [0] }])).toEqual([0, 8])
  })
})

describe('ターンの進行', () => {
  it('詠唱は置いた目以上のダメージで崩れる', () => {
    let s = stateWith([2, 6, 5], [6, 1, 3])
    s = resolveStep(s, [{ kind: 'spearChant', dice: [0] }, { kind: 'fireball', dice: [0, 1] }])
    expect(s.players[0].chant).toBe('broken')
    expect(legalActions(s, 0).some((a) => a.kind === 'spearCast')).toBe(false)
  })
  it('詠唱が保たれれば二ステップ目に発動できる', () => {
    let s = stateWith([4, 6, 5], [3, 1, 2])
    s = resolveStep(s, [{ kind: 'spearChant', dice: [0] }, { kind: 'fireball', dice: [0, 1] }])
    expect(s.players[0].chant).toBe('charged')
    s = resolveStep(s, [{ kind: 'spearCast', dice: [1, 2] }, pass])
    expect(s.players[1].hp).toBe(20 - 11)
    expect(turnOver(s)).toBe(true)
  })
  it('同じカードは1ターンに1回まで', () => {
    let s = stateWith([6, 5, 4], [1, 1, 1])
    s = resolveStep(s, [{ kind: 'bullet', dice: [0] }, pass])
    expect(legalActions(s, 0).some((a) => a.kind === 'bullet')).toBe(false)
  })
  it('反射はゾロ目でしか置けない', () => {
    const s = stateWith([2, 2, 5], [1, 3, 5])
    expect(legalActions(s, 0).some((a) => a.kind === 'reflect')).toBe(true)
    expect(legalActions(s, 1).some((a) => a.kind === 'reflect')).toBe(false)
  })
  it('HPが0以下で決着、同時なら引き分け', () => {
    let s = stateWith([6, 6, 1], [6, 6, 1], 6)
    s = resolveStep(s, [{ kind: 'fireball', dice: [0, 1] }, { kind: 'fireball', dice: [0, 1] }])
    expect(s.winner).toBe('draw')
  })
  it('次のターンでダイスと使用記録がリセットされる', () => {
    let s = stateWith([6, 5, 4], [1, 2, 3])
    s = resolveStep(s, [{ kind: 'bullet', dice: [0] }, pass])
    s = resolveStep(s, [{ kind: 'fireball', dice: [1, 2] }, pass])
    s = nextTurn(s, () => 0.5)
    expect(s.turn).toBe(2)
    expect(s.step).toBe(1)
    expect(s.players[0].usedCards).toEqual([])
    expect(s.players[0].roll).toEqual([4, 4, 4])
  })
})
