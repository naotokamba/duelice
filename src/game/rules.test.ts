// ターンの進行に関する例示テスト。カード同士のダメージは cards.test.ts の仕様表で扱う。

import { describe, expect, it } from 'vitest'
import { makeState, seeded } from '../test/helpers'
import { ACTION_DEFS } from './cards'
import {
  backfires,
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
    s = resolveStep(s, [{ kind: 'bullet', dice: [0, null] }, pass])
    expect(legalActions(s, 0).some((a) => a.kind === 'bullet')).toBe(false)
  })
  it('使ったダイスは二ステップ目に使えない', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    s = resolveStep(s, [{ kind: 'bullet', dice: [0, null] }, pass])
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 1] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [1, 2] })).toBe(true)
  })
  it('同じダイスを二度選ぶ行動や、範囲外のダイスや、置き場の数に合わない行動は不正', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 3] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [0, 1, null] })).toBe(false)
    // 魔弾は置き場が二つなので、1個でも空いた置き場を書く
    expect(isLegal(s, 0, { kind: 'bullet', dice: [0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'bullet', dice: [null, null] })).toBe(false)
  })
  it('行動はどの置き場に置いたかを記録する', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    const back = resolveStep(s, [{ kind: 'bullet', dice: [2, 0] }, pass])
    expect(back.history[0].actions[0]).toEqual({ kind: 'bullet', dice: [2, 0] })
    expect(back.history[0].values[0]).toEqual([4, 6])
    expect(back.history[0].damage).toEqual([0, 3])
    expect(back.players[0].usedDice).toEqual([2, 0])
  })
  it('魔弾は左の枠に置けば2、点線の枠にも置けば3。点線の枠だけでは使えない', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'bullet', dice: [null, 2] })).toBe(false)
    expect(resolveStep(s, [{ kind: 'bullet', dice: [2, null] }, pass]).history[0].damage).toEqual([0, 2])
    expect(resolveStep(s, [{ kind: 'bullet', dice: [2, 1] }, pass]).history[0].damage).toEqual([0, 3])
  })
  it('置ける個数が飛び飛びなら、空けられない置き場が埋まっていても、間の個数は合法でない', () => {
    // 1個か3個だけ置ける、仮の魔弾。置き場は三つで、空けられないのは最初の一つ
    const saved = ACTION_DEFS.bullet
    ACTION_DEFS.bullet = { ...saved, dice: [1, 3] }
    try {
      const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
      expect(isLegal(s, 0, { kind: 'bullet', dice: [0, null, null] })).toBe(true)
      expect(isLegal(s, 0, { kind: 'bullet', dice: [0, 1, null] })).toBe(false)
      expect(isLegal(s, 0, { kind: 'bullet', dice: [0, 1, 2] })).toBe(true)
    } finally {
      ACTION_DEFS.bullet = saved
    }
  })
  it('空けられない置き場は、行の前から dice の最小の数。省いてもよい置き場だけに置いても埋まったことにならない', () => {
    expect(fillsRequired(ACTION_DEFS.bullet, [0, null])).toBe(true)
    expect(fillsRequired(ACTION_DEFS.bullet, [null, 0])).toBe(false)
    expect(fillsRequired(ACTION_DEFS.bullet, [null, null])).toBe(false)
    expect(fillsRequired(ACTION_DEFS.fireball, [0, null])).toBe(false)
    expect(fillsRequired(ACTION_DEFS.fireball, [0, 1])).toBe(true)
    // 印の置き場のほかに省いてよい置き場を持つ、仮のカード。印の置き場は空けられない置き場に入る
    const optional = { ...ACTION_DEFS.fireball, dice: [1, 2] }
    expect(fillsRequired(optional, [0, null])).toBe(true)
    expect(fillsRequired(optional, [null, 0])).toBe(false)
  })
  it('X の枠を空けた火球は不正。X の枠に置いた目が威力になる', () => {
    const s = makeState({ roll: [2, 6, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'fireball', dice: [null, 1] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'fireball', dice: [1, null] })).toBe(false)
    const low = resolveStep(s, [{ kind: 'fireball', dice: [0, 1] }, pass])
    expect(low.history[0].damage).toEqual([0, 2])
    const high = resolveStep(s, [{ kind: 'fireball', dice: [1, 0] }, pass])
    expect(high.history[0].damage).toEqual([0, 6])
  })
  it('火球はどの目を X の枠に置くかで別の手になり、同じ目の入れ替えは一つにまとめる', () => {
    const fireballs = (roll: number[]) =>
      legalActions(makeState({ roll }, { roll: [1, 2, 3] }), 0)
        .filter((a) => a.kind === 'fireball')
        .map((a) => (a.kind === 'pass' ? [] : a.dice.map((i) => (i === null ? 0 : roll[i]))))
    expect(fireballs([6, 4, 1])).toEqual([
      [6, 4],
      [4, 6],
      [6, 1],
      [1, 6],
      [4, 1],
      [1, 4],
    ])
    expect(fireballs([4, 4, 1])).toEqual([
      [4, 4],
      [4, 1],
      [1, 4],
    ])
    // 印の無い行動は、置き場の違いを別の手にせず、前の置き場から詰めて置く
    const bullets = legalActions(makeState({ roll: [6, 4, 1] }, { roll: [1, 2, 3] }), 0).filter(
      (a) => a.kind === 'bullet',
    )
    expect(bullets).toEqual([
      { kind: 'bullet', dice: [0, null] },
      { kind: 'bullet', dice: [1, null] },
      { kind: 'bullet', dice: [2, null] },
      { kind: 'bullet', dice: [0, 1] },
      { kind: 'bullet', dice: [0, 2] },
      { kind: 'bullet', dice: [1, 2] },
    ])
  })
  it('火球の X の枠の目は、置いた置き場のまま記録に残る', () => {
    const s = makeState({ roll: [2, 6, 1] }, { roll: [1, 2, 3] })
    const next = resolveStep(s, [{ kind: 'fireball', dice: [0, 1] }, pass])
    expect(next.history[0].values[0]).toEqual([2, 6])
    expect(next.history[0].strikes).toEqual([{ from: 0, kind: 'fireball', power: 2, outcome: 'hit', to: 1, dealt: 2 }])
    expect(next.history[0].damage).toEqual([0, 2])
  })
  it('反撃はどの目1個でも置け、どちらのステップでも使える', () => {
    const counters = (step: 1 | 2) =>
      legalActions(makeState({ roll: [1, 3, 5] }, { roll: [1, 2, 3] }, step), 0).filter((a) => a.kind === 'counter')
    expect(counters(1)).toEqual([
      { kind: 'counter', dice: [0] },
      { kind: 'counter', dice: [1] },
      { kind: 'counter', dice: [2] },
    ])
    expect(counters(2)).toHaveLength(3)
  })
  it('不正な行動を解決しようとすると例外', () => {
    const s = makeState({ roll: [1, 3, 5] }, { roll: [1, 2, 3] })
    expect(() => resolveStep(s, [{ kind: 'spearCast', dice: [0, 1] }, pass])).toThrow()
  })
  it('同時に0以下になったら、体力の残りが多い方の勝ち。同じなら引き分け', () => {
    const fire = (hp0: number, hp1: number) =>
      resolveStep(makeState({ roll: [6, 6, 1], hp: hp0 }, { roll: [6, 6, 1], hp: hp1 }), [
        { kind: 'fireball', dice: [0, 1] },
        { kind: 'fireball', dice: [0, 1] },
      ])
    expect(fire(6, 6).winner).toBe('draw')
    // 0 対 −1 なら、はみ出しの小さい方が勝つ
    const s = fire(6, 5)
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
    let s = makeState({ roll: [6, 6, 1] }, { roll: [1, 2, 3], hp: 6 })
    s = resolveStep(s, [{ kind: 'fireball', dice: [0, 1] }, pass])
    expect(s.winner).toBe(0)
    expect(() => resolveStep(s, [pass, pass])).toThrow()
  })
  it('次のターンでダイスと使用記録がリセットされる', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    s = resolveStep(s, [{ kind: 'bullet', dice: [0, null] }, pass])
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
    // 障壁は置いた目の倍を減らす
    ['障壁に削られる', [6, 2], fire, [2], { kind: 'barrier', dice: [0] }, { outcome: 'guarded', to: 1, dealt: 2 }],
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
      { kind: 'bullet', dice: [0, null] },
      [6],
      { kind: 'barrier', dice: [0] },
      { outcome: 'pierced', to: 1, dealt: 2 },
    ],
    [
      '雷槍の発動は障壁をすり抜ける',
      [6, 5],
      { kind: 'spearCast', dice: [0, 1] },
      [6],
      { kind: 'barrier', dice: [0] },
      { outcome: 'pierced', to: 1, dealt: 11 },
    ],
    [
      '反撃の上限以下なら打ち消され、返す量が攻撃した側に入る',
      [5, 2],
      fire,
      [3],
      { kind: 'counter', dice: [0] },
      { outcome: 'countered', to: 0, dealt: 4 },
    ],
    [
      '反撃の上限を超えると、そのまま通る',
      [6, 2],
      fire,
      [3],
      { kind: 'counter', dice: [0] },
      { outcome: 'overpowered', to: 1, dealt: 6 },
    ],
  ] as const)('%s', (_, mine, a, theirs, b, want) => {
    const [x, ...rest] = strikes([[...mine], [...theirs]], [a as Action, b as Action])
    expect(rest).toEqual([])
    expect(x).toMatchObject({ from: 0, ...want })
  })
  it('撃ち合いは二つの攻撃になり、攻撃しない側からは何も飛ばない', () => {
    expect(strikes([[6, 2], [5]], [fire, { kind: 'bullet', dice: [0, null] }]).map((x) => [x.from, x.to])).toEqual([
      [0, 1],
      [1, 0],
    ])
    expect(
      strikes(
        [[4], [3]],
        [
          { kind: 'barrier', dice: [0] },
          { kind: 'counter', dice: [0] },
        ],
      ),
    ).toEqual([])
  })
  it('詠唱は置いた目と同じか多いダメージで崩れる', () => {
    expect(breaksChant(ACTION_DEFS.spearChant, [5], 4)).toBe(false)
    expect(breaksChant(ACTION_DEFS.spearChant, [5], 5)).toBe(true)
  })
})

describe('反撃が外れる', () => {
  const counter: Action = { kind: 'counter', dice: [0] }
  const fire: Action = { kind: 'fireball', dice: [0, 1] }
  const miss = (mine: number[], a: Action, theirs: number[], b: Action) => {
    const vals: [number[], number[]] = [mine, theirs]
    return backfires(vals, [a, b], strikes(vals, [a, b]))
  }
  it('攻撃を打ち消せたら外れない', () => {
    expect(miss([3], counter, [5, 1], fire)).toEqual([0, 0])
  })
  it('攻撃が来なければ外れて、X の枠の目の倍を受ける', () => {
    expect(miss([3], counter, [], pass)).toEqual([6, 0])
    expect(miss([2], counter, [4], { kind: 'barrier', dice: [0] })).toEqual([4, 0])
  })
  it('上限を超えて通されても外れる', () => {
    expect(miss([1], counter, [6, 1], fire)).toEqual([2, 0])
  })
  it('反撃どうしは双方が外れる', () => {
    expect(miss([1], counter, [3], counter)).toEqual([2, 6])
  })
  it('外れて受けたダメージは記録に別に残り、受けたダメージにも体力にも入る', () => {
    const s = resolveStep(makeState({ roll: [6, 2, 1] }, { roll: [3, 4, 5] }), [fire, counter])
    expect(s.history[0].backfire).toEqual([0, 6])
    expect(s.history[0].damage).toEqual([0, 12])
    expect(s.players.map((p) => p.hp)).toEqual([20, 8])
  })
  it('打ち消せば、攻撃した側が返す量を受け、反撃した側は何も受けない', () => {
    const s = resolveStep(makeState({ roll: [5, 2, 1] }, { roll: [3, 4, 5] }), [fire, counter])
    expect(s.history[0].backfire).toEqual([0, 0])
    expect(s.history[0].damage).toEqual([4, 0])
  })
  it('外れた反撃の自傷は、詠唱した相手の詠唱を崩さない', () => {
    const s = resolveStep(makeState({ roll: [1, 2, 3] }, { roll: [6, 4, 5] }), [
      { kind: 'spearChant', dice: [0] },
      counter,
    ])
    expect(s.history[0].chants).toEqual(['kept', null])
    expect(s.history[0].damage).toEqual([0, 12])
  })
  it('受けるダメージの計算にも、外れた反撃の自傷が入る', () => {
    expect(stepDamage([[3], []], [counter, pass])).toEqual([6, 0])
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
      { kind: 'counter', dice: [2] },
    ])
    expect(keptRow(s, 0)).toEqual({ card: 'fireball', kind: 'fireball', slots: [1, 0] })
    expect(keptRow(s, 1)).toEqual({ card: 'counter', kind: 'counter', slots: [2] })
    // 2ステップ目を解決しても、ターンが変わるまでは残る
    const after = resolveStep(s, [pass, pass])
    expect(keptRow(after, 0)).toEqual({ card: 'fireball', kind: 'fireball', slots: [1, 0] })
    // ターンが変わると片付く
    expect(keptRow(nextTurn(after, seeded(1)), 0)).toBeNull()
  })
  it('省いた置き場は空いたまま残り、パスなら何も残らない', () => {
    // 点線の枠を省いた魔弾は、点線の枠が空いたまま残る
    const s = resolveStep(start, [{ kind: 'bullet', dice: [2, null] }, pass])
    expect(keptRow(s, 0)).toEqual({ card: 'bullet', kind: 'bullet', slots: [2, null] })
    expect(keptRow(s, 1)).toBeNull()
  })
  it('詠唱のダイスは、詠唱の行に残る', () => {
    const s = resolveStep(start, [{ kind: 'spearChant', dice: [0] }, pass])
    expect(keptRow(s, 0)).toEqual({ card: 'spear', kind: 'spearChant', slots: [0] })
  })
})
