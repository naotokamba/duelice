// ターンの進行に関する例示テスト。カード同士のダメージは cards.test.ts の仕様表で扱う。

import { describe, expect, it } from 'vitest'
import { makeState, seeded } from '../test/helpers'
import { ACTION_DEFS } from './cards'
import {
  breaksChant,
  burnOf,
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
const interrupt: Action = { kind: 'interrupt', dice: [0] }

describe('ターンの進行', () => {
  it('詠唱は攻撃のダメージでは崩れず、二ステップ目に発動できる', () => {
    let s = makeState({ roll: [4, 6, 5] }, { roll: [6, 1, 2] })
    s = resolveStep(s, [
      { kind: 'spearChant', dice: [0] },
      { kind: 'flameStrike', dice: [0, 1] },
    ])
    expect(s.players[0].chant).toBe('charged')
    expect(s.history[0].chants).toEqual(['kept', null])
    // 炎撃は X の枠の 6 に2を足して8、もう1個の 1 だけ自分も焼ける
    expect(s.players.map((p) => p.hp)).toEqual([12, 19])
    s = resolveStep(s, [{ kind: 'spearCast', dice: [1, 2] }, pass])
    expect(s.players[1].hp).toBe(19 - 11)
    expect(s.players[0].chant).toBe('none')
    expect(turnOver(s)).toBe(true)
  })
  it('詠唱は、同じステップに相手が氷礫を使うと崩れ、発動できない', () => {
    let s = makeState({ roll: [6, 6, 5] }, { roll: [1, 1, 3] })
    s = resolveStep(s, [{ kind: 'spearChant', dice: [0] }, interrupt])
    expect(s.players[0].chant).toBe('broken')
    expect(s.history[0].chants).toEqual(['broken', null])
    expect(legalActions(s, 0).some((a) => a.kind === 'spearCast')).toBe(false)
  })
  it('魔槍の発動は一ステップ目には使えず、詠唱は二ステップ目には使えない', () => {
    const s1 = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] })
    expect(isLegal(s1, 0, { kind: 'spearCast', dice: [0, 1] })).toBe(false)
    const s2 = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] }, 2)
    expect(isLegal(s2, 0, { kind: 'spearChant', dice: [0] })).toBe(false)
  })
  it('同じカードは1ターンに1回まで', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 1, 1] })
    s = resolveStep(s, [interrupt, pass])
    expect(legalActions(s, 0).some((a) => a.kind === 'interrupt')).toBe(false)
  })
  it('使ったダイスは二ステップ目に使えない', () => {
    let s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    s = resolveStep(s, [interrupt, pass])
    expect(isLegal(s, 0, { kind: 'flameStrike', dice: [0, 1] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'flameStrike', dice: [1, 2] })).toBe(true)
  })
  it('同じダイスを二度選ぶ行動や、範囲外のダイスや、置き場の数に合わない行動は不正', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'flameStrike', dice: [0, 0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'flameStrike', dice: [0, 3] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'flameStrike', dice: [0] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'flameStrike', dice: [0, 1, null] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'interrupt', dice: [] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'interrupt', dice: [null] })).toBe(false)
  })
  it('行動はどの置き場に置いたかを記録する', () => {
    const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
    const back = resolveStep(s, [{ kind: 'flameStrike', dice: [2, 0] }, pass])
    expect(back.history[0].actions[0]).toEqual({ kind: 'flameStrike', dice: [2, 0] })
    expect(back.history[0].values[0]).toEqual([4, 6])
    // X の枠の 4 に2を足して6、もう1個の 6 だけ自分も焼ける
    expect(back.history[0].damage).toEqual([6, 6])
    expect(back.players[0].usedDice).toEqual([2, 0])
  })
  it('置ける個数が飛び飛びなら、空けられない置き場が埋まっていても、間の個数は合法でない', () => {
    // 1個か3個だけ置ける、仮の氷礫。置き場は三つで、空けられないのは最初の一つ
    const saved = ACTION_DEFS.interrupt
    ACTION_DEFS.interrupt = { ...saved, dice: [1, 3] }
    try {
      const s = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] })
      expect(isLegal(s, 0, { kind: 'interrupt', dice: [0, null, null] })).toBe(true)
      expect(isLegal(s, 0, { kind: 'interrupt', dice: [0, 1, null] })).toBe(false)
      expect(isLegal(s, 0, { kind: 'interrupt', dice: [0, 1, 2] })).toBe(true)
      // 点線の枠だけに置いても使えない
      expect(isLegal(s, 0, { kind: 'interrupt', dice: [null, 1, null] })).toBe(false)
    } finally {
      ACTION_DEFS.interrupt = saved
    }
  })
  it('省いてよい置き場のある行動は、置く個数ごとに列挙し、同じ目の組は一つにまとめる', () => {
    // 1個から3個まで置ける、仮の氷礫。目の 4 は二つある
    const saved = ACTION_DEFS.interrupt
    ACTION_DEFS.interrupt = { ...saved, dice: [1, 2, 3] }
    try {
      const listed = legalActions(makeState({ roll: [4, 6, 4] }, { roll: [1, 2, 3] }), 0).filter(
        (a) => a.kind === 'interrupt',
      )
      expect(listed).toEqual([
        { kind: 'interrupt', dice: [0, null, null] },
        { kind: 'interrupt', dice: [1, null, null] },
        { kind: 'interrupt', dice: [0, 1, null] },
        { kind: 'interrupt', dice: [0, 2, null] },
        { kind: 'interrupt', dice: [0, 1, 2] },
      ])
    } finally {
      ACTION_DEFS.interrupt = saved
    }
  })
  it('空けられない置き場は、行の前から dice の最小の数。省いてもよい置き場だけに置いても埋まったことにならない', () => {
    // 1個から3個まで置ける、仮の氷礫
    const dotted = { ...ACTION_DEFS.interrupt, dice: [1, 2, 3] }
    expect(fillsRequired(dotted, [0, null, null])).toBe(true)
    expect(fillsRequired(dotted, [null, 0, null])).toBe(false)
    expect(fillsRequired(dotted, [null, null, null])).toBe(false)
    expect(fillsRequired(ACTION_DEFS.flameStrike, [0, null])).toBe(false)
    expect(fillsRequired(ACTION_DEFS.flameStrike, [0, 1])).toBe(true)
    // 印の置き場のほかに省いてよい置き場を持つ、仮のカード。印の置き場は空けられない置き場に入る
    const optional = { ...ACTION_DEFS.flameStrike, dice: [1, 2] }
    expect(fillsRequired(optional, [0, null])).toBe(true)
    expect(fillsRequired(optional, [null, 0])).toBe(false)
  })
  it('X の枠を空けた炎撃は不正。X の枠に置いた目に2を足した威力で、もう一つの目の分だけ自分も焼ける', () => {
    const s = makeState({ roll: [2, 6, 4] }, { roll: [1, 2, 3] })
    expect(isLegal(s, 0, { kind: 'flameStrike', dice: [null, 1] })).toBe(false)
    expect(isLegal(s, 0, { kind: 'flameStrike', dice: [1, null] })).toBe(false)
    const low = resolveStep(s, [{ kind: 'flameStrike', dice: [0, 1] }, pass])
    expect(low.history[0].damage).toEqual([6, 4])
    const high = resolveStep(s, [{ kind: 'flameStrike', dice: [1, 0] }, pass])
    expect(high.history[0].damage).toEqual([2, 8])
  })
  it('炎撃はどの目を X の枠に置くかで別の手になり、同じ目の入れ替えは一つにまとめる', () => {
    const burns = (roll: number[]) =>
      legalActions(makeState({ roll }, { roll: [1, 2, 3] }), 0)
        .filter((a) => a.kind === 'flameStrike')
        .map((a) => (a.kind === 'pass' ? [] : a.dice.map((i) => (i === null ? 0 : roll[i]))))
    expect(burns([6, 4, 1])).toEqual([
      [6, 4],
      [4, 6],
      [6, 1],
      [1, 6],
      [4, 1],
      [1, 4],
    ])
    expect(burns([4, 4, 1])).toEqual([
      [4, 4],
      [4, 1],
      [1, 4],
    ])
    // 印の無い行動は、置き場の違いを別の手にせず、前の置き場から詰めて置く。氷礫は目ごとに別の手になる
    const interrupts = legalActions(makeState({ roll: [6, 4, 4] }, { roll: [1, 2, 3] }), 0).filter(
      (a) => a.kind === 'interrupt',
    )
    expect(interrupts).toEqual([
      { kind: 'interrupt', dice: [0] },
      { kind: 'interrupt', dice: [1] },
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
  it('炎撃の X の枠の目は、置いた置き場のまま記録に残る', () => {
    const s = makeState({ roll: [2, 6, 1] }, { roll: [1, 2, 3] })
    const next = resolveStep(s, [{ kind: 'flameStrike', dice: [0, 1] }, pass])
    expect(next.history[0].values[0]).toEqual([2, 6])
    expect(next.history[0].strikes).toEqual([
      { from: 0, kind: 'flameStrike', power: 4, outcome: 'hit', to: 1, dealt: 4 },
    ])
    expect(next.history[0].burn).toEqual([6, 0])
    expect(next.history[0].damage).toEqual([6, 4])
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
    s = resolveStep(s, [interrupt, pass])
    s = resolveStep(s, [{ kind: 'flameStrike', dice: [1, 2] }, pass])
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
  const fire: Action = { kind: 'flameStrike', dice: [0, 1] }
  const wall: Action = { kind: 'barrier', dice: [0] }
  /** 風壁が攻撃を受けて、攻撃した 0 へ返す3 */
  const back = { from: 1, kind: 'barrier', power: 3, outcome: 'returned', to: 0, dealt: 3 }
  it.each([
    ['何もしない相手には当たる', [6, 2], fire, [], pass, [{ outcome: 'hit', to: 1, dealt: 8 }]],
    // 風壁は置いた目の倍だけ減らし、減らした攻撃を放った相手に3を返す
    ['風壁に削られ、3を返される', [6, 2], fire, [2], wall, [{ outcome: 'guarded', to: 1, dealt: 4 }, back]],
    [
      '風壁が上回って0になっても、3を返される',
      [3, 2],
      fire,
      [5],
      wall,
      [{ outcome: 'guarded', to: 1, dealt: 0 }, back],
    ],
    ['氷礫も風壁に削られ、3を返される', [6], interrupt, [1], wall, [{ outcome: 'guarded', to: 1, dealt: 0 }, back]],
    [
      '魔弾は風壁をすり抜け、返されない',
      [1, 1],
      { kind: 'bullet', dice: [0, 1] },
      [6],
      wall,
      [{ outcome: 'pierced', to: 1, dealt: 4 }],
    ],
    [
      '魔槍の発動は風壁をすり抜け、返されない',
      [6, 5],
      { kind: 'spearCast', dice: [0, 1] },
      [6],
      wall,
      [{ outcome: 'pierced', to: 1, dealt: 11 }],
    ],
  ] as const)('%s', (_, mine, a, theirs, b, want) => {
    const list = strikes([[...mine], [...theirs]], [a as Action, b as Action])
    expect(list).toHaveLength(want.length)
    list.forEach((x, i) => {
      expect(x).toMatchObject(i === 0 ? { from: 0, ...want[0] } : want[i])
    })
  })
  it('撃ち合いは二つの攻撃になり、攻撃しない側からは何も飛ばない', () => {
    expect(strikes([[6, 2], [5]], [fire, interrupt]).map((x) => [x.from, x.to])).toEqual([
      [0, 1],
      [1, 0],
    ])
    expect(strikes([[4], [3]], [wall, { kind: 'spearChant', dice: [0] }])).toEqual([])
  })
  it('詠唱を崩すのは、詠唱を崩す性質を持つ行動だけ', () => {
    expect(breaksChant(interrupt)).toBe(true)
    expect(breaksChant(fire)).toBe(false)
    expect(breaksChant(wall)).toBe(false)
    expect(breaksChant(pass)).toBe(false)
  })
})

describe('返す', () => {
  it('返したダメージは記録に攻撃として残り、攻撃した側の体力から引かれる', () => {
    const s = resolveStep(makeState({ roll: [6, 2, 1] }, { roll: [1, 4, 5] }), [
      interrupt,
      { kind: 'barrier', dice: [0] },
    ])
    expect(s.history[0].strikes.map((x) => x.outcome)).toEqual(['guarded', 'returned'])
    expect(s.history[0].damage).toEqual([3, 0])
    expect(s.players.map((p) => p.hp)).toEqual([17, 20])
  })
  it('返す性質の無い守りは、攻撃を減らしても何も返さない', () => {
    const saved = ACTION_DEFS.barrier
    ACTION_DEFS.barrier = { ...saved, thorns: undefined }
    try {
      const list = strikes(
        [[6], [2]],
        [
          { kind: 'interrupt', dice: [0] },
          { kind: 'barrier', dice: [0] },
        ],
      )
      expect(list.map((x) => x.outcome)).toEqual(['guarded'])
    } finally {
      ACTION_DEFS.barrier = saved
    }
  })
  it('風壁どうしや、攻撃の来ない風壁は何も返さない', () => {
    const s = resolveStep(makeState({ roll: [6, 2, 1] }, { roll: [1, 4, 5] }), [
      { kind: 'barrier', dice: [0] },
      { kind: 'barrier', dice: [0] },
    ])
    expect(s.history[0].strikes).toEqual([])
    expect(s.history[0].damage).toEqual([0, 0])
  })
})

describe('自分も焼ける', () => {
  const burn: Action = { kind: 'flameStrike', dice: [0, 1] }
  it('炎撃はもう一つの置き場の目だけ払い、ほかの行動は払わない', () => {
    expect(burnOf([[6, 2], []], [burn, pass])).toEqual([2, 0])
    expect(burnOf([[1, 5], [4]], [burn, { kind: 'barrier', dice: [0] }])).toEqual([5, 0])
    expect(burnOf([[6], [6, 6]], [interrupt, { kind: 'bullet', dice: [0, 1] }])).toEqual([0, 0])
  })
  it('焼けた分は記録に別に残り、受けたダメージにも体力にも入る。風壁では減らない', () => {
    // 炎撃は 6 に2を足して8、風壁の 3 の倍の6に削られて2が通る。自分も2焼け、風壁から3を返される
    const s = resolveStep(makeState({ roll: [6, 2, 1] }, { roll: [3, 4, 5] }), [burn, { kind: 'barrier', dice: [0] }])
    expect(s.history[0].burn).toEqual([2, 0])
    expect(s.history[0].damage).toEqual([5, 2])
    expect(s.players.map((p) => p.hp)).toEqual([15, 18])
  })
  it('受けるダメージの計算にも、焼けた分が入る', () => {
    expect(stepDamage([[1, 1], []], [burn, pass])).toEqual([1, 3])
  })
  it('自分も焼けて0以下になれば、相打ちの決まりで勝敗が決まる', () => {
    // 自分は 2 から 6 の自分も焼けて −4、相手は 6 から 6 を受けて 0
    const s = resolveStep(makeState({ roll: [6, 4, 1], hp: 2 }, { roll: [1, 2, 3], hp: 6 }), [
      { kind: 'flameStrike', dice: [1, 0] },
      pass,
    ])
    expect(s.players.map((p) => p.hp)).toEqual([-4, 0])
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
      { kind: 'flameStrike', dice: [1, 0] },
      { kind: 'barrier', dice: [2] },
    ])
    expect(keptRow(s, 0)).toEqual({ card: 'flameStrike', kind: 'flameStrike', slots: [1, 0] })
    expect(keptRow(s, 1)).toEqual({ card: 'barrier', kind: 'barrier', slots: [2] })
    // 2ステップ目を解決しても、ターンが変わるまでは残る
    const after = resolveStep(s, [pass, pass])
    expect(keptRow(after, 0)).toEqual({ card: 'flameStrike', kind: 'flameStrike', slots: [1, 0] })
    // ターンが変わると片付く
    expect(keptRow(nextTurn(after, seeded(1)), 0)).toBeNull()
  })
  it('パスなら何も残らない', () => {
    const s = resolveStep(start, [interrupt, pass])
    expect(keptRow(s, 0)).toEqual({ card: 'interrupt', kind: 'interrupt', slots: [0] })
    expect(keptRow(s, 1)).toBeNull()
  })
  it('詠唱のダイスは、詠唱の行に残る', () => {
    const s = resolveStep(start, [{ kind: 'spearChant', dice: [0] }, pass])
    expect(keptRow(s, 0)).toEqual({ card: 'spear', kind: 'spearChant', slots: [0] })
  })
})
