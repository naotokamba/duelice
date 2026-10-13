// ターンの進行に関する例示テスト。カード同士のダメージは cards.test.ts の仕様表で扱う。

import { describe, expect, it } from 'vitest'
import { makeState, seeded } from '../test/helpers'
import { ACTION_DEFS } from './cards'
import {
  bloodOf,
  breaksChant,
  isLegal,
  keptRow,
  legalActions,
  newGame,
  nextTurn,
  resolveStep,
  stepDamage,
  strikes,
  turnOver,
  winnerOf,
} from './rules'
import { fillsRequired } from './slots'
import type { Action } from './types'

const pass: Action = { kind: 'pass' }

describe('ターンの進行', () => {
  it('詠唱は置いた目以上のダメージで崩れる', () => {
    let s = makeState({ roll: [2, 6, 5] }, { roll: [6, 1, 3] })
    s = resolveStep(s, [
      { kind: 'spearChant', dice: [0] },
      { kind: 'fireball', dice: [0, 1] },
    ])
    expect(s.players[0].chant).toBe('broken')
    expect(s.history[0].chants).toEqual(['broken', null])
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
    expect(s.history[0].chants).toEqual(['kept', null])
    expect(s.players[0].hp).toBe(17)
    // 火球は払うダイスを使うだけで、撃った相手は血を払わない
    expect(s.players[1].hp).toBe(20)
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
    s = resolveStep(s, [{ kind: 'overload', dice: [0, null, null] }, pass])
    expect(legalActions(s, 0).some((a) => a.kind === 'overload')).toBe(false)
  })
  it('使ったダイスは二ステップ目に使えない', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    s = resolveStep(s, [{ kind: 'overload', dice: [0, null, null] }, pass])
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 1] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [1, 2] })).toBe(true)
  })
  it('同じダイスを二度選ぶ行動や、範囲外のダイスや、置き場の数に合わない行動は不正', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 3] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 1, null] })).toBe(false)
    // 過負荷は置き場が三つなので、1個でも空いた置き場を書く
    expect(isLegal(s, 0, { kind: 'overload', dice: [0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'overload', dice: [null, null, null] })).toBe(false)
  })
  it('行動はどの置き場に置いたかを記録する', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    const back = resolveStep(s, [{ kind: 'overload', dice: [2, 0, null] }, pass])
    expect(back.history[0].actions[0]).toEqual({ kind: 'overload', dice: [2, 0, null] })
    expect(back.history[0].values[0]).toEqual([4, 6])
    expect(back.history[0].damage).toEqual([2, 4])
    expect(back.players[0].usedDice).toEqual([2, 0])
  })
  it('過負荷は置いた数の倍を当て、置いた数だけ血を払う。点線の枠だけでは使えない', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'overload', dice: [null, 2, null] })).toBe(false)
    const dmg = (dice: (number | null)[]) => resolveStep(s, [{ kind: 'overload', dice }, pass]).history[0].damage
    expect(dmg([2, null, null])).toEqual([1, 2])
    expect(dmg([2, 1, null])).toEqual([2, 4])
    expect(dmg([2, 1, 0])).toEqual([3, 6])
  })
  it('置ける個数が飛び飛びなら、空けられない置き場が埋まっていても、間の個数は合法でない', () => {
    // 1個か3個だけ置ける、仮の過負荷。置き場は三つで、空けられないのは最初の一つ
    const saved = ACTION_DEFS.overload
    ACTION_DEFS.overload = { ...saved, dice: [1, 3] }
    try {
      const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
      expect(isLegal(s, 0, { kind: 'overload', dice: [0, null, null] })).toBe(true)
      expect(isLegal(s, 0, { kind: 'overload', dice: [0, 1, null] })).toBe(false)
      expect(isLegal(s, 0, { kind: 'overload', dice: [0, 1, 2] })).toBe(true)
    } finally {
      ACTION_DEFS.overload = saved
    }
  })
  it('空けられない置き場は、行の前から dice の最小の数。省いてもよい置き場だけに置いても埋まったことにならない', () => {
    expect(fillsRequired(ACTION_DEFS.overload, [0, null, null])).toBe(true)
    expect(fillsRequired(ACTION_DEFS.overload, [null, 0, null])).toBe(false)
    expect(fillsRequired(ACTION_DEFS.overload, [null, null, null])).toBe(false)
    expect(fillsRequired(ACTION_DEFS.fireball, [0, null])).toBe(false)
    expect(fillsRequired(ACTION_DEFS.fireball, [0, 1])).toBe(true)
    // 印の置き場のほかに省いてよい置き場を持つ、仮のカード。印の置き場は空けられない置き場に入る
    const optional = { ...ACTION_DEFS.fireball, dice: [1, 2] }
    expect(fillsRequired(optional, [0, null])).toBe(true)
    expect(fillsRequired(optional, [null, 0])).toBe(false)
  })
  it('X の枠を空けた火球は不正。X の枠に置いた目が威力になり、もう一つの目は払うだけ', () => {
    const s = makeState({ roll: [2, 6, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'fireball', dice: [null, 1] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [1, null] })).toBe(false)
    const low = resolveStep(s, [{ kind: 'fireball', dice: [0, 1] }, pass])
    expect(low.history[0].damage).toEqual([0, 2])
    const high = resolveStep(s, [{ kind: 'fireball', dice: [1, 0] }, pass])
    expect(high.history[0].damage).toEqual([0, 6])
  })
  it('火球はどの目を X の枠に置くかで別の手になり、同じ目の入れ替えは一つにまとめる', () => {
    const fires = (roll: number[]) =>
      legalActions(makeState({ roll }, { roll: [1, 2, 3] }), 0)
        .filter((a) => a.kind === 'fireball')
        .map((a) => (a.kind === 'pass' ? [] : a.dice.map((i) => (i === null ? 0 : roll[i]))))
    expect(fires([6, 4, 1])).toEqual([
      [6, 4],
      [4, 6],
      [6, 1],
      [1, 6],
      [4, 1],
      [1, 4],
    ])
    expect(fires([4, 4, 1])).toEqual([
      [4, 4],
      [4, 1],
      [1, 4],
    ])
    // 印の無い行動は、置き場の違いを別の手にせず、前の置き場から詰めて置く
    const overloads = legalActions(makeState({ roll: [6, 4, 1] }, { roll: [1, 2, 3] }), 0).filter(
      (a) => a.kind === 'overload',
    )
    expect(overloads).toEqual([
      { kind: 'overload', dice: [0, null, null] },
      { kind: 'overload', dice: [1, null, null] },
      { kind: 'overload', dice: [2, null, null] },
      { kind: 'overload', dice: [0, 1, null] },
      { kind: 'overload', dice: [0, 2, null] },
      { kind: 'overload', dice: [1, 2, null] },
      { kind: 'overload', dice: [0, 1, 2] },
    ])
  })
  it('魔弾は同じ目を2個置いたときだけ使え、入れ替えは一つにまとめる', () => {
    const s = makeState({ roll: [4, 4, 1] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'bullet', dice: [0, 1] })).toBe(true)
    expect(isLegal(s, 0, { kind: 'bullet', dice: [0, 2] })).toBe(false)
    expect(legalActions(s, 0).filter((a) => a.kind === 'bullet')).toEqual([{ kind: 'bullet', dice: [0, 1] }])
    expect(legalActions(makeState({ roll: [6, 4, 1] }, { roll: [1, 2, 3] }), 0).some((a) => a.kind === 'bullet')).toBe(
      false,
    )
  })
  it('火球の X の枠の目は、置いた置き場のまま記録に残る', () => {
    const s = makeState({ roll: [2, 6, 1] }, { roll: [1, 2, 3] })
    const next = resolveStep(s, [{ kind: 'fireball', dice: [0, 1] }, pass])
    expect(next.history[0].values[0]).toEqual([2, 6])
    expect(next.history[0].strikes).toEqual([{ from: 0, kind: 'fireball', power: 2, outcome: 'hit', to: 1, dealt: 2 }])
    expect(next.history[0].blood).toEqual([0, 0])
    expect(next.history[0].damage).toEqual([0, 2])
  })
  it('不正な行動を解決しようとすると例外', () => {
    const s = makeState({ roll: [1, 3, 5] }, { roll: [1, 2, 3] })
    expect(() => resolveStep(s, [{ kind: 'spearCast', dice: [0, 1] }, pass])).toThrow()
  })
  it('同時に0以下になったら、体力の残りが多い方の勝ち。同じなら引き分け', () => {
    const fire = (hp0: number, hp1: number) =>
      resolveStep(makeState({ roll: [6, 6, 1], hp: hp0 }, { roll: [6, 6, 1], hp: hp1 }), [
        { kind: 'bullet', dice: [0, 1] },
        { kind: 'bullet', dice: [0, 1] },
      ])
    expect(fire(4, 4).winner).toBe('draw')
    // 0 対 −1 なら、はみ出しの小さい方が勝つ
    const s = fire(4, 3)
    expect(s.players.map((p) => p.hp)).toEqual([0, -1])
    expect(s.winner).toBe(0)
    expect(fire(2, 4).winner).toBe(1)
  })
  it('勝敗は体力だけで決まる', () => {
    const hp = (a: number, b: number) =>
      winnerOf([
        { hp: a, roll: [], usedDice: [], usedCards: [], chant: 'none' },
        { hp: b, roll: [], usedDice: [], usedCards: [], chant: 'none' },
      ])
    expect(hp(1, 1)).toBeNull()
    expect(hp(1, 0)).toBe(0)
    expect(hp(0, 1)).toBe(1)
    expect(hp(0, 0)).toBe('draw')
    expect(hp(-3, -3)).toBe('draw')
    expect(hp(-1, -3)).toBe(0)
    expect(hp(-3, 0)).toBe(1)
  })
  it('片方だけ0以下なら残った方の勝ち。決着後は進めない', () => {
    let s = makeState({ roll: [6, 6, 1] }, { roll: [1, 2, 3], hp: 4 })
    s = resolveStep(s, [{ kind: 'bullet', dice: [0, 1] }, pass])
    expect(s.winner).toBe(0)
    expect(() => resolveStep(s, [pass, pass])).toThrow()
  })
  it('次のターンでダイスと使用記録がリセットされる', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    s = resolveStep(s, [{ kind: 'overload', dice: [0, null, null] }, pass])
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
    // 障壁は置いた目の分だけ減らす
    ['障壁に削られる', [6, 2], fire, [2], { kind: 'barrier', dice: [0] }, { outcome: 'guarded', to: 1, dealt: 4 }],
    [
      '障壁が上回ると0になる',
      [3, 2],
      fire,
      [5],
      { kind: 'barrier', dice: [0] },
      { outcome: 'guarded', to: 1, dealt: 0 },
    ],
    [
      '過負荷も障壁に削られる',
      [1, 1],
      { kind: 'overload', dice: [0, 1, null] },
      [3],
      { kind: 'barrier', dice: [0] },
      { outcome: 'guarded', to: 1, dealt: 1 },
    ],
    [
      '魔弾は障壁をすり抜ける',
      [1, 1],
      { kind: 'bullet', dice: [0, 1] },
      [6],
      { kind: 'barrier', dice: [0] },
      { outcome: 'pierced', to: 1, dealt: 4 },
    ],
    [
      '雷槍の発動は障壁をすり抜ける',
      [6, 5],
      { kind: 'spearCast', dice: [0, 1] },
      [6],
      { kind: 'barrier', dice: [0] },
      { outcome: 'pierced', to: 1, dealt: 11 },
    ],
  ] as const)('%s', (_, mine, a, theirs, b, want) => {
    const [x, ...rest] = strikes([[...mine], [...theirs]], [a as Action, b as Action])
    expect(rest).toEqual([])
    expect(x).toMatchObject({ from: 0, ...want })
  })
  it('撃ち合いは二つの攻撃になり、攻撃しない側からは何も飛ばない', () => {
    expect(
      strikes([[6, 2], [5]], [fire, { kind: 'overload', dice: [0, null, null] }]).map((x) => [x.from, x.to]),
    ).toEqual([
      [0, 1],
      [1, 0],
    ])
    expect(
      strikes(
        [[4], [3]],
        [
          { kind: 'barrier', dice: [0] },
          { kind: 'spearChant', dice: [0] },
        ],
      ),
    ).toEqual([])
  })
  it('詠唱は置いた目と同じか多いダメージで崩れる', () => {
    expect(breaksChant(ACTION_DEFS.spearChant, [5], 4)).toBe(false)
    expect(breaksChant(ACTION_DEFS.spearChant, [5], 5)).toBe(true)
  })
})

describe('血を払う', () => {
  const over = (n: number): Action => ({ kind: 'overload', dice: [0, n > 1 ? 1 : null, n > 2 ? 2 : null] })
  it('過負荷は置いた数だけ払い、ほかの行動は払わない', () => {
    expect(bloodOf([[6], []], [over(1), pass])).toEqual([1, 0])
    expect(bloodOf([[1, 1, 1], [4]], [over(3), { kind: 'barrier', dice: [0] }])).toEqual([3, 0])
    expect(
      bloodOf(
        [
          [6, 2],
          [6, 6],
        ],
        [
          { kind: 'fireball', dice: [0, 1] },
          { kind: 'bullet', dice: [0, 1] },
        ],
      ),
    ).toEqual([0, 0])
  })
  it('払った血は記録に別に残り、受けたダメージにも体力にも入る。障壁では減らない', () => {
    const s = resolveStep(makeState({ roll: [6, 2, 1] }, { roll: [3, 4, 5] }), [
      over(2),
      { kind: 'barrier', dice: [0] },
    ])
    expect(s.history[0].blood).toEqual([2, 0])
    expect(s.history[0].damage).toEqual([2, 1])
    expect(s.players.map((p) => p.hp)).toEqual([18, 19])
  })
  it('払った血は、相手の詠唱を崩すダメージに数えない', () => {
    const s = resolveStep(makeState({ roll: [2, 6, 1] }, { roll: [3, 4, 5] }), [
      over(1),
      { kind: 'spearChant', dice: [0] },
    ])
    expect(s.history[0].chants).toEqual([null, 'kept'])
    expect(s.history[0].damage).toEqual([1, 2])
  })
  it('受けるダメージの計算にも、払った血が入る', () => {
    expect(stepDamage([[1, 1, 1], []], [over(3), pass])).toEqual([3, 6])
  })
  it('血を払って自分も0以下になれば、相打ちの決まりで勝敗が決まる', () => {
    // 自分は 2 から 3 の血を払って −1、相手は 6 から 6 を受けて 0
    const s = resolveStep(makeState({ roll: [6, 4, 1], hp: 2 }, { roll: [1, 2, 3], hp: 6 }), [over(3), pass])
    expect(s.players.map((p) => p.hp)).toEqual([-1, 0])
    expect(s.winner).toBe(1)
  })
})

describe('記録', () => {
  it('何もしない手のダイスの値は空', () => {
    const s = resolveStep(makeState({ roll: [1, 2, 3] }, { roll: [1, 2, 3] }), [pass, pass])
    expect(s.history[0].values).toEqual([[], []])
  })
  it('例外の文で原因が分かる', () => {
    const s = makeState({ roll: [1, 3, 5] }, { roll: [1, 2, 3] })
    expect(() => resolveStep(s, [{ kind: 'spearCast', dice: [0, 1] }, pass])).toThrow(/不正な行動/)
    const over = { ...s, winner: 0 as const }
    expect(() => resolveStep(over, [pass, pass])).toThrow(/終了/)
  })
})

describe('1ステップ目のダイス', () => {
  const start = makeState({ roll: [6, 2, 5] }, { roll: [3, 3, 1] })
  it('1ステップ目を解決するまでは、カードに残るダイスは無い', () => {
    expect(keptRow(start, 0)).toBeNull()
    expect(keptRow(start, 1)).toBeNull()
  })
  it('2ステップ目には、双方が1ステップ目に使ったダイスが、置いた置き場のままカードに残る', () => {
    const s = resolveStep(start, [
      { kind: 'fireball', dice: [1, 0] },
      { kind: 'barrier', dice: [2] },
    ])
    expect(keptRow(s, 0)).toEqual({ card: 'fireball', kind: 'fireball', slots: [1, 0] })
    expect(keptRow(s, 1)).toEqual({ card: 'barrier', kind: 'barrier', slots: [2] })
    // 2ステップ目を解決しても、ターンが変わるまでは残る
    const after = resolveStep(s, [pass, pass])
    expect(keptRow(after, 0)).toEqual({ card: 'fireball', kind: 'fireball', slots: [1, 0] })
    // ターンが変わると片付く
    expect(keptRow(nextTurn(after, seeded(1)), 0)).toBeNull()
  })
  it('省いた置き場は空いたまま残り、パスなら何も残らない', () => {
    // 点線の枠を省いた過負荷は、点線の枠が空いたまま残る
    const s = resolveStep(start, [{ kind: 'overload', dice: [2, null, null] }, pass])
    expect(keptRow(s, 0)).toEqual({ card: 'overload', kind: 'overload', slots: [2, null, null] })
    expect(keptRow(s, 1)).toBeNull()
  })
  it('詠唱のダイスは、詠唱の行に残る', () => {
    const s = resolveStep(start, [{ kind: 'spearChant', dice: [0] }, pass])
    expect(keptRow(s, 0)).toEqual({ card: 'spear', kind: 'spearChant', slots: [0] })
  })
})
