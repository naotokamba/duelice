// ターンの進行に関する例示テスト。カード同士のダメージは cards.test.ts の仕様表で扱う。

import { describe, expect, it } from 'vitest'
import { makeState } from '../test/helpers'
import {
  type Action,
  actionLabel,
  breaksChant,
  isLegal,
  legalActions,
  newGame,
  nextTurn,
  resolveStep,
  strikes,
  turnOver,
} from './rules'

const pass: Action = { kind: 'pass' }

describe('ターンの進行', () => {
  it('詠唱は置いた目以上のダメージで崩れる', () => {
    let s = makeState({ roll: [2, 6, 5] }, { roll: [6, 1, 3] })
    s = resolveStep(s, [
      { kind: 'spearChant', dice: [0] },
      { kind: 'fireball', dice: [0, 1] },
    ])
    expect(s.players[0].chant).toBe('broken')
    expect(s.history[0].lines.some((l) => l.includes('崩れた'))).toBe(true)
    expect(legalActions(s, 0).some((a) => a.kind === 'spearCast')).toBe(false)
  })
  it('詠唱と同じ値のダメージでも崩れる', () => {
    let s = makeState({ roll: [6, 1, 1] }, { roll: [6, 1, 3] })
    s = resolveStep(s, [
      { kind: 'spearChant', dice: [0] },
      { kind: 'fireball', dice: [0, 1] },
    ])
    expect(s.players[0].chant).toBe('broken')
  })
  it('詠唱の目より小さいダメージなら保たれ、二ステップ目に発動できる', () => {
    let s = makeState({ roll: [4, 6, 5] }, { roll: [3, 1, 2] })
    s = resolveStep(s, [
      { kind: 'spearChant', dice: [0] },
      { kind: 'fireball', dice: [0, 1] },
    ])
    expect(s.players[0].chant).toBe('charged')
    expect(s.players[0].hp).toBe(17)
    s = resolveStep(s, [{ kind: 'spearCast', dice: [1, 2] }, pass])
    expect(s.players[1].hp).toBe(20 - 11)
    expect(s.players[0].chant).toBe('none')
    expect(turnOver(s)).toBe(true)
  })
  it('雷槍の発動は一ステップ目には使えず、詠唱は二ステップ目には使えない', () => {
    const s1 = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] })
    expect(isLegal(s1, 0, { kind: 'spearCast', dice: [0, 1] })).toBe(false)
    const s2 = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] }, 2)
    expect(isLegal(s2, 0, { kind: 'spearChant', dice: [0] })).toBe(false)
  })
  it('同じカードは1ターンに1回まで', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 1, 1] })
    s = resolveStep(s, [{ kind: 'bullet', dice: [0] }, pass])
    expect(legalActions(s, 0).some((a) => a.kind === 'bullet')).toBe(false)
  })
  it('使ったダイスは二ステップ目に使えない', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    s = resolveStep(s, [{ kind: 'bullet', dice: [0] }, pass])
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 1] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [1, 2] })).toBe(true)
  })
  it('同じダイスを二度選ぶ行動や、範囲外のダイスは不正', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 3] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0] })).toBe(false)
  })
  it('反射はゾロ目でしか置けない', () => {
    const s = makeState({ roll: [2, 2, 5] }, { roll: [1, 3, 5] })
    expect(legalActions(s, 0).some((a) => a.kind === 'reflect')).toBe(true)
    expect(legalActions(s, 1).some((a) => a.kind === 'reflect')).toBe(false)
  })
  it('不正な行動を解決しようとすると例外', () => {
    const s = makeState({ roll: [1, 3, 5] }, { roll: [1, 2, 3] })
    expect(() => resolveStep(s, [{ kind: 'reflect', dice: [0, 1] }, pass])).toThrow()
  })
  it('HPが0以下で決着、同時なら引き分け', () => {
    let s = makeState({ roll: [6, 6, 1], hp: 6 }, { roll: [6, 6, 1], hp: 6 })
    s = resolveStep(s, [
      { kind: 'fireball', dice: [0, 1] },
      { kind: 'fireball', dice: [0, 1] },
    ])
    expect(s.winner).toBe('draw')
  })
  it('片方だけ0以下なら残った方の勝ち。決着後は進めない', () => {
    let s = makeState({ roll: [6, 6, 1] }, { roll: [1, 2, 3], hp: 6 })
    s = resolveStep(s, [{ kind: 'fireball', dice: [0, 1] }, pass])
    expect(s.winner).toBe(0)
    expect(() => resolveStep(s, [pass, pass])).toThrow()
  })
  it('次のターンでダイスと使用記録がリセットされる', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    s = resolveStep(s, [{ kind: 'bullet', dice: [0] }, pass])
    s = resolveStep(s, [{ kind: 'fireball', dice: [1, 2] }, pass])
    s = nextTurn(s, () => 0.5)
    expect(s.turn).toBe(2)
    expect(s.step).toBe(1)
    expect(s.players[0].usedCards).toEqual([])
    expect(s.players[0].usedDice).toEqual([])
    expect(s.players[0].roll).toEqual([4, 4, 4])
    expect(turnOver(s)).toBe(false)
  })
  it('詠唱の状態も次のターンで戻る', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    s = resolveStep(s, [{ kind: 'spearChant', dice: [0] }, pass])
    s = resolveStep(s, [pass, pass])
    expect(s.players[0].chant).toBe('charged')
    expect(nextTurn(s, () => 0.5).players[0].chant).toBe('none')
  })
  it('新しいゲームは体力満タン、未使用、詠唱なしで始まる', () => {
    const s = newGame(() => 0.99, { maxHp: 7, diceCount: 4 })
    expect(s.turn).toBe(1)
    expect(s.step).toBe(1)
    expect(s.history).toEqual([])
    expect(s.winner).toBeNull()
    for (const p of s.players) {
      expect(p).toEqual({ hp: 7, roll: [6, 6, 6, 6], usedDice: [], usedCards: [], chant: 'none' })
    }
  })
})

describe('攻撃の行方', () => {
  const fire: Action = { kind: 'fireball', dice: [0, 1] }
  it.each([
    ['何もしない相手には当たる', [6, 2], fire, [], pass, { outcome: 'hit', to: 1, dealt: 6 }],
    ['障壁に削られる', [6, 2], fire, [4], { kind: 'barrier', dice: [0] }, { outcome: 'guarded', to: 1, dealt: 2 }],
    [
      '障壁が上回ると0になる',
      [3, 2],
      fire,
      [5],
      { kind: 'barrier', dice: [0] },
      { outcome: 'guarded', to: 1, dealt: 0 },
    ],
    [
      '魔弾は障壁をすり抜ける',
      [1],
      { kind: 'bullet', dice: [0] },
      [6],
      { kind: 'barrier', dice: [0] },
      { outcome: 'pierced', to: 1, dealt: 2 },
    ],
    [
      '反射で攻撃した側に返る',
      [6, 2],
      fire,
      [3, 3],
      { kind: 'reflect', dice: [0, 1] },
      { outcome: 'reflected', to: 0, dealt: 6 },
    ],
  ] as const)('%s', (_, mine, a, theirs, b, want) => {
    const [x, ...rest] = strikes([[...mine], [...theirs]], [a as Action, b as Action])
    expect(rest).toEqual([])
    expect(x).toMatchObject({ from: 0, ...want })
  })
  it('撃ち合いは二つの攻撃になり、攻撃しない側からは何も飛ばない', () => {
    expect(strikes([[6, 2], [5]], [fire, { kind: 'bullet', dice: [0] }]).map((x) => [x.from, x.to])).toEqual([
      [0, 1],
      [1, 0],
    ])
    expect(
      strikes(
        [[4], [3, 3]],
        [
          { kind: 'barrier', dice: [0] },
          { kind: 'reflect', dice: [0, 1] },
        ],
      ),
    ).toEqual([])
  })
  it('詠唱は置いた目と同じか多いダメージで崩れる', () => {
    expect(breaksChant([5], 4)).toBe(false)
    expect(breaksChant([5], 5)).toBe(true)
  })
})

describe('公開の文', () => {
  const lines = (r0: number[], r1: number[], a0: Action, a1: Action) =>
    resolveStep(makeState({ roll: r0 }, { roll: r1 }), [a0, a1]).history[0].lines
  const fireball: Action = { kind: 'fireball', dice: [0, 1] }

  it('攻撃と何もしない', () => {
    expect(lines([6, 2, 1], [1, 2, 3], fireball, pass)).toEqual(['あなたの火球 6点', '相手は何もしなかった'])
  })
  it('障壁に削られた攻撃は、削った目と通った点を示す', () => {
    expect(lines([5, 1, 1], [3, 2, 1], fireball, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの火球 5点、障壁 3 に削られて 2点',
      '相手は 3 で障壁を張った',
    ])
  })
  it('障壁をすり抜けた攻撃', () => {
    expect(lines([1, 2, 3], [6, 2, 1], { kind: 'bullet', dice: [0] }, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの魔弾 2点、障壁をすり抜けた',
      '相手は 6 で障壁を張った',
    ])
  })
  it('反射で返された攻撃', () => {
    expect(lines([6, 4, 1], [2, 2, 1], fireball, { kind: 'reflect', dice: [0, 1] })).toEqual([
      'あなたの火球 6点は反射で返された',
      '相手は 2と2 で反射を構えた',
    ])
  })
  it('詠唱が崩れたときと保たれたとき', () => {
    expect(lines([2, 1, 1], [6, 1, 1], { kind: 'spearChant', dice: [0] }, fireball)).toEqual([
      'あなたは 2 で雷槍を詠唱',
      '相手の火球 6点',
      'あなたの詠唱は 6点を受けて崩れた',
    ])
    expect(lines([2, 1, 1], [1, 1, 1], { kind: 'spearChant', dice: [0] }, pass)).toContain('あなたの詠唱は保たれた')
  })
  it('公開時の行動名', () => {
    expect(actionLabel(pass)).toBe('何もしない')
    expect(actionLabel({ kind: 'spearChant', dice: [0] })).toBe('雷槍の詠唱')
  })
  it('何もしない手のダイスの値は空', () => {
    const s = resolveStep(makeState({ roll: [1, 2, 3] }, { roll: [1, 2, 3] }), [pass, pass])
    expect(s.history[0].values).toEqual([[], []])
  })
  it('例外の文で原因が分かる', () => {
    const s = makeState({ roll: [1, 3, 5] }, { roll: [1, 2, 3] })
    expect(() => resolveStep(s, [{ kind: 'reflect', dice: [0, 1] }, pass])).toThrow(/不正な行動/)
    const over = { ...s, winner: 0 as const }
    expect(() => resolveStep(over, [pass, pass])).toThrow(/終了/)
  })
})
