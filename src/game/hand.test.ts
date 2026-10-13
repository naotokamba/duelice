// 手元の操作のテスト。決定するまでの、カードに置きかけたダイスと持ち上げたダイスの扱い

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeState, rollArb, stateArb } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, type CardId, POOL, STARTER } from './cards'
import { effectParts } from './face'
import {
  canPut,
  choosable,
  composeAction,
  draftAction,
  draftIssue,
  draftRows,
  EMPTY_HAND,
  type Hand,
  type HandEvent,
  type Issue,
  isWild,
  kindsNow,
  missingDice,
  multiOf,
  type Placement,
  placeDie,
  placementIssue,
  reduceHand,
  removeDie,
  rowNow,
  targets,
  usableCards,
} from './hand'
import { diceValues, freeDice, isLegal, legalActions } from './rules'
import { slotsOf } from './slots'
import { type GameState, WILD } from './types'

/** 1個から3個まで置ける仮の氷礫に替えて確かめる。今の表には、点線の枠を持つ行動が無い */
function withDotted(check: () => void) {
  const saved = ACTION_DEFS.interrupt
  ACTION_DEFS.interrupt = { ...saved, dice: [1, 2, 3], power: (v) => 2 * v.length }
  try {
    check()
  } finally {
    ACTION_DEFS.interrupt = saved
  }
}

describe('行動の組み立て', () => {
  it('画面の操作で、一つのステップにカードを1枚だけ使う全ての行動を作れる', () => {
    // 行動ごとに、それが使える局面を作って組み立てを試す。もう一度出す行動のために、直前の効果を持たせる
    // 一つのステップに複数のカードを使う行動は、「一緒に使うカード」で確かめる
    const single = ACTION_KINDS.filter((k) => !ACTION_DEFS[k].multi)
    const made = new Set<string>()
    for (const kind of single) {
      const def = ACTION_DEFS[kind]
      // 全てのカードを持ち込み、4個まで置ける行動のために4個のダイスを持つ
      const s = makeState(
        {
          roll: [4, 4, 4, 4],
          chant: def.needsCharge ? 'charged' : 'none',
          deck: POOL,
          last: [{ kind: 'interrupt', vals: [2] }],
        },
        { roll: [1, 2, 3] },
        def.step ?? 1,
      )
      for (const n of def.dice) {
        // 前の置き場から n 個を埋め、残りの置き場は空ける
        const a = composeAction(
          s,
          0,
          def.card,
          Array.from({ length: slotsOf(def) }, (_, i) => (i < n ? i : null)),
        )
        if (a) made.add(a.kind)
      }
    }
    expect([...made].sort()).toEqual([...single].sort())
  })
  it('組み立てた行動は常に合法で、そのカードの行動になる', () => {
    fc.assert(
      fc.property(
        rollArb,
        fc.constantFrom<CardId>(...STARTER),
        fc.subarray([0, 1, 2]),
        fc.boolean(),
        (roll, card, picked, step2) => {
          const s = makeState({ roll, chant: step2 ? 'charged' : 'none' }, { roll: [1, 2, 3] }, step2 ? 2 : 1)
          const pl = placeAll(s, card, picked)
          const a = pl && composeAction(s, 0, card, pl.slots)
          if (!a) return
          expect(isLegal(s, 0, a)).toBe(true)
          expect(ACTION_DEFS[a.kind].card).toBe(card)
        },
      ),
    )
  })
  it('合法手は全て画面から組み立てられる', () => {
    fc.assert(
      fc.property(rollArb, fc.boolean(), (roll, step2) => {
        const s = makeState({ roll, chant: step2 ? 'charged' : 'none' }, { roll: [1, 2, 3] }, step2 ? 2 : 1)
        for (const a of legalActions(s, 0)) {
          if (a.kind === 'pass') continue
          const got = composeAction(s, 0, ACTION_DEFS[a.kind].card, a.dice)
          expect(got?.kind).toBe(a.kind)
          expect(diceValues(s.players[0], got ?? a)).toEqual(diceValues(s.players[0], a))
        }
      }),
    )
  })
  it('使えるカードは合法手のカードと一致する', () => {
    fc.assert(
      fc.property(rollArb, (roll) => {
        const s = makeState({ roll }, { roll: [1, 2, 3] })
        const fromLegal = new Set(
          legalActions(s, 0).flatMap((a) => (a.kind === 'pass' ? [] : [ACTION_DEFS[a.kind].card])),
        )
        expect(usableCards(s, 0)).toEqual(fromLegal)
      }),
    )
  })
})

describe('ステップごとの行動', () => {
  it('魔槍は一ステップ目に詠唱、二ステップ目は詠唱が保たれたときだけ発動', () => {
    const s1 = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] }, 1)
    expect(kindsNow(s1, 0, 'spear')).toEqual(['spearChant'])
    const charged = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(kindsNow(charged, 0, 'spear')).toEqual(['spearCast'])
    const broken = makeState({ roll: [6, 5, 4], chant: 'broken' }, { roll: [1, 2, 3] }, 2)
    expect(kindsNow(broken, 0, 'spear')).toEqual([])
  })
})

/** 1枚だけに置く間の placeDie。前に置いたカードを渡し、置いた後のカードを返す */
function placeOne(s: GameState, prev: Placement | null, card: CardId, die: number, slot: number): Placement | null {
  const next = placeDie(s, 0, prev ? [prev] : [], card, die, slot)
  return next && (next.at(-1) ?? null)
}

/** 1枚だけに置く間の removeDie */
const removeOne = (prev: Placement | null, die: number): Placement | null =>
  removeDie(prev ? [prev] : [], die)[0] ?? null

/** 1枚だけに置く間の draftRows */
const draftRow = (s: GameState, who: 0 | 1, hand: Hand) => draftRows(s, who, hand)[0] ?? null

/** 今のステップにそのカードへ並べる置き場の数。置ける行が無ければ 0 */
function slotsNow(s: GameState, card: CardId): number {
  const kind = rowNow(s, 0, card)
  return kind ? slotsOf(ACTION_DEFS[kind]) : 0
}

/** dice を card の最初の置き場から順に置いていく。途中で置けなければ null */
function placeAll(s: GameState, card: CardId, dice: number[]): Placement | null {
  let pl: Placement | null = null
  for (const [k, d] of dice.entries()) {
    pl = placeOne(s, pl, card, d, k)
    if (pl === null) return null
  }
  return pl
}

describe('ダイスを置く', () => {
  it('合法手は全て、ダイスをそれぞれの置き場へどの順で置いても、置いた置き場のまま組み立てられる', () => {
    fc.assert(
      fc.property(rollArb, fc.boolean(), fc.boolean(), (roll, step2, reversed) => {
        const s = makeState({ roll, chant: step2 ? 'charged' : 'none' }, { roll: [1, 2, 3] }, step2 ? 2 : 1)
        for (const a of legalActions(s, 0)) {
          if (a.kind === 'pass') continue
          const card = ACTION_DEFS[a.kind].card
          const steps = [...a.dice.entries()].filter((e): e is [number, number] => e[1] !== null)
          let pl: Placement | null = null
          for (const [k, d] of reversed ? steps.reverse() : steps) pl = placeOne(s, pl, card, d, k)
          expect(pl?.slots).toEqual(a.dice)
          expect(composeAction(s, 0, card, pl?.slots ?? [])).toEqual(a)
        }
      }),
    )
  })
  it('使えるカードには、空いたダイスを目を問わずどの置き場にも置ける。置いた結果が行動にならなければ理由が出る', () => {
    fc.assert(
      fc.property(
        rollArb,
        fc.constantFrom<CardId>(...STARTER),
        fc.subarray([0, 1, 2], { minLength: 1 }),
        fc.boolean(),
        (roll, card, order, step2) => {
          const s = makeState({ roll, chant: step2 ? 'charged' : 'none' }, { roll: [1, 2, 3] }, step2 ? 2 : 1)
          const n = slotsNow(s, card)
          const pl = placeAll(s, card, order)
          const fits = usableCards(s, 0).has(card) && order.length <= n
          expect(pl !== null).toBe(fits)
          if (pl === null) return
          // 理由が出ないのは、行動になるときだけ
          const made = composeAction(s, 0, card, pl.slots)
          expect(placementIssue(s, 0, pl) === null).toBe(made !== null)
        },
      ),
    )
  })
  it('使用済みのダイスは置けない', () => {
    const s = makeState({ roll: [6, 6, 2], usedDice: [2] }, { roll: [1, 2, 3] }, 2)
    expect(canPut(s, 0, 'flameStrike', 2)).toBe(false)
    expect(canPut(s, 0, 'flameStrike', 0)).toBe(true)
    expect(placeOne(s, null, 'flameStrike', 2, 0)).toBeNull()
    // 同じダイスを二つの置き場には置けない。置き直すと元の置き場は空く
    expect(placeOne(s, { card: 'flameStrike', slots: [0, null] }, 'flameStrike', 0, 1)).toEqual({
      card: 'flameStrike',
      slots: [null, 0],
    })
  })
  it('凍らされた目のダイスは置けない', () => {
    const s = makeState({ roll: [6, 4, 6], frozen: 6 }, { roll: [1, 2, 3] })
    expect(canPut(s, 0, 'barrier', 0)).toBe(false)
    expect(canPut(s, 0, 'barrier', 2)).toBe(false)
    expect(canPut(s, 0, 'barrier', 1)).toBe(true)
    expect(placeOne(s, null, 'barrier', 0, 0)).toBeNull()
  })
  it('双竜は好きな目の4個で使え、足りなければあと何個置くかを伝える', () => {
    const s = makeState({ roll: [3, 3, 5, 6], deck: POOL }, { roll: [1, 2, 3] })
    expect(placementIssue(s, 0, { card: 'twinDragon', slots: [0, 1, 2, 3] })).toBeNull()
    expect(placementIssue(s, 0, { card: 'twinDragon', slots: [0, 1, 2, null] })).toEqual({
      type: 'more',
      count: 1,
      same: false,
    })
  })
  it('置き場の外には置けない', () => {
    const s = makeState({ roll: [6, 6, 2] }, { roll: [1, 2, 3] })
    expect(slotsNow(s, 'barrier')).toBe(1)
    expect(placeAll(s, 'barrier', [0])).toEqual({ card: 'barrier', slots: [0] })
    expect(placeOne(s, null, 'barrier', 0, 1)).toBeNull()
    expect(placeOne(s, null, 'barrier', 0, -1)).toBeNull()
    expect(placeAll(s, 'flameStrike', [0, 1, 2])).toBeNull()
  })
  it('置き場の無いカードには置けない', () => {
    const s = makeState({ roll: [6, 5, 4], chant: 'broken' }, { roll: [1, 2, 3] }, 2)
    expect(slotsNow(s, 'spear')).toBe(0)
    expect(placeOne(s, null, 'spear', 0, 0)).toBeNull()
  })
  it('行動は置いた置き場をそのまま記録する。炎撃は X の枠に置いた目が威力になる', () => {
    const s = makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] })
    const pl = placeOne(s, placeOne(s, null, 'flameStrike', 0, 1), 'flameStrike', 1, 0)
    expect(pl).toEqual({ card: 'flameStrike', slots: [1, 0] })
    const a = composeAction(s, 0, 'flameStrike', pl?.slots ?? [])
    expect(a).toEqual({ kind: 'flameStrike', dice: [1, 0] })
    expect(diceValues(s.players[0], a ?? { kind: 'pass' })).toEqual([2, 6])
    // X の枠の 2 に2を足して4、もう1個の 6 だけ自分も焼ける
    expect(effectParts('flameStrike', [2, 6])).toEqual([
      { icon: 'damage', value: '4', text: undefined },
      { icon: 'burn', value: '6', text: undefined },
    ])
  })
  it('省いてもよい置き場だけに置いても行動にならない。空けられない置き場を埋めれば行動になり、空けた置き場は空けたまま記録する', () => {
    withDotted(() => {
      const s = makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] })
      const pl = placeOne(s, null, 'interrupt', 2, 1)
      expect(pl).toEqual({ card: 'interrupt', slots: [null, 2, null] })
      expect(composeAction(s, 0, 'interrupt', pl?.slots ?? [])).toBeNull()
      const both = placeOne(s, pl, 'interrupt', 0, 0)
      expect(composeAction(s, 0, 'interrupt', both?.slots ?? [])).toEqual({ kind: 'interrupt', dice: [0, 2, null] })
      expect(composeAction(s, 0, 'interrupt', [2, null, null])).toEqual({ kind: 'interrupt', dice: [2, null, null] })
    })
  })
  it('X の枠を空けた炎撃は行動にならない', () => {
    const s = makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] })
    expect(composeAction(s, 0, 'flameStrike', [null, 0])).toBeNull()
    expect(composeAction(s, 0, 'flameStrike', [0, null])).toBeNull()
  })
  it('魔弾は同じ目を2個置けば行動になり、目が違えば置けても行動にならない', () => {
    const s = makeState({ roll: [3, 5, 3] }, { roll: [1, 2, 3] })
    expect(placeAll(s, 'bullet', [0, 2])).toEqual({ card: 'bullet', slots: [0, 2] })
    expect(composeAction(s, 0, 'bullet', [0, 2])).toEqual({ kind: 'bullet', dice: [0, 2] })
    expect(placeAll(s, 'bullet', [0, 1])).toEqual({ card: 'bullet', slots: [0, 1] })
    expect(composeAction(s, 0, 'bullet', [0, 1])).toBeNull()
  })
  it('使えないカードには置けない', () => {
    const s = makeState({ roll: [6, 6, 2], usedCards: ['flameStrike'] }, { roll: [1, 2, 3] }, 2)
    expect(canPut(s, 0, 'flameStrike', 0)).toBe(false)
    expect(canPut(s, 0, 'spear', 0)).toBe(false)
    expect(canPut(s, 0, 'interrupt', 0)).toBe(true)
    // 使用済みのカードには置けない
    const used = makeState({ roll: [1, 2, 3], usedCards: ['barrier'] }, { roll: [1, 2, 3] }, 2)
    expect(canPut(used, 0, 'barrier', 0)).toBe(false)
    expect(placeOne(used, null, 'barrier', 0, 0)).toBeNull()
  })
  it('別のカードに置くと、前のカードのダイスは手元に戻る', () => {
    const s = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
    const fire: Placement = { card: 'flameStrike', slots: [0, 1] }
    expect(placeOne(s, fire, 'barrier', 1, 0)).toEqual({ card: 'barrier', slots: [1] })
  })
  it('埋まった置き場に手元のダイスを置くと、あったダイスは手元に戻る', () => {
    const s = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
    const fire: Placement = { card: 'flameStrike', slots: [0, 1] }
    expect(placeOne(s, fire, 'flameStrike', 2, 0)).toEqual({ card: 'flameStrike', slots: [2, 1] })
  })
  it('同じカードの別の置き場へ移すと、移した先のダイスと入れ替わる。空いた置き場へは、そのまま移る', () => {
    const s = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
    expect(placeOne(s, { card: 'flameStrike', slots: [0, 1] }, 'flameStrike', 0, 1)).toEqual({
      card: 'flameStrike',
      slots: [1, 0],
    })
    expect(placeOne(s, { card: 'flameStrike', slots: [null, 1] }, 'flameStrike', 1, 0)).toEqual({
      card: 'flameStrike',
      slots: [1, null],
    })
    // 同じ置き場に置き直しても変わらない
    expect(placeOne(s, { card: 'flameStrike', slots: [0, 1] }, 'flameStrike', 0, 0)).toEqual({
      card: 'flameStrike',
      slots: [0, 1],
    })
  })
  it('ダイスを手元に戻すと、その置き場だけが空く', () => {
    const fire: Placement = { card: 'flameStrike', slots: [0, 1] }
    expect(removeOne(fire, 0)).toEqual({ card: 'flameStrike', slots: [null, 1] })
    expect(removeOne(fire, 2)).toEqual(fire)
    expect(removeOne({ card: 'barrier', slots: [2] }, 2)).toBeNull()
    expect(removeOne(null, 0)).toBeNull()
  })
  it('魔槍は一ステップ目は詠唱、二ステップ目は発動の行に置く', () => {
    const s1 = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] }, 1)
    expect(rowNow(s1, 0, 'spear')).toBe('spearChant')
    expect(slotsNow(s1, 'spear')).toBe(1)
    const s2 = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(rowNow(s2, 0, 'spear')).toBe('spearCast')
    expect(slotsNow(s2, 'spear')).toBe(2)
  })
})

describe('決定を押せない理由', () => {
  const s = makeState({ roll: [3, 5, 3] }, { roll: [1, 2, 3] })
  const more = (count: number, same = false): Issue => ({ type: 'more', count, same })
  const UNUSABLE: Issue = { type: 'unusable' }
  it('行動になる置き方なら理由は無い', () => {
    expect(placementIssue(s, 0, { card: 'flameStrike', slots: [1, 0] })).toBeNull()
    expect(placementIssue(s, 0, { card: 'barrier', slots: [2] })).toBeNull()
    expect(placementIssue(s, 0, { card: 'bullet', slots: [0, 2] })).toBeNull()
    expect(placementIssue(s, 0, { card: 'interrupt', slots: [1] })).toBeNull()
    // 点線の枠を持つ行動は、1個でも2個でも3個でも行動になる
    withDotted(() => {
      expect(placementIssue(s, 0, { card: 'interrupt', slots: [1, null, null] })).toBeNull()
      expect(placementIssue(s, 0, { card: 'interrupt', slots: [1, 0, null] })).toBeNull()
      expect(placementIssue(s, 0, { card: 'interrupt', slots: [1, 0, 2] })).toBeNull()
    })
  })
  it('点線の枠だけに置いて空けられない置き場が空いていれば、左の枠に置くよう伝える', () => {
    withDotted(() => {
      expect(placementIssue(s, 0, { card: 'interrupt', slots: [null, 1, null] })).toEqual({ type: 'left' })
      expect(placementIssue(s, 0, { card: 'interrupt', slots: [null, 1, 0] })).toEqual({ type: 'left' })
    })
  })
  it('同じ目を揃える行動は、個数が足りなければ同じ目をあと何個、目が違えば同じ目を何個置くかを伝える', () => {
    expect(placementIssue(s, 0, { card: 'bullet', slots: [0, null] })).toEqual(more(1, true))
    // どの置き場にも同じ目が入るので、印の置き場が空いていても印のことは言わない
    expect(placementIssue(s, 0, { card: 'bullet', slots: [null, 0] })).toEqual(more(1, true))
    // 目が揃っていても、使用済みのダイスを含むなら、目のことは言わず使えないとだけ伝える
    const used = makeState({ roll: [3, 3, 5], usedDice: [1] }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(used, 0, { card: 'bullet', slots: [0, 1] })).toEqual({ type: 'unusable' })
    expect(placementIssue(s, 0, { card: 'bullet', slots: [0, 1] })).toEqual({ type: 'same', count: 2 })
  })
  it('個数が足りなければ、あと何個置くかを出す', () => {
    expect(placementIssue(s, 0, { card: 'flameStrike', slots: [1, null] })).toEqual(more(1))
    const charged = makeState({ roll: [3, 5, 3], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(charged, 0, { card: 'spear', slots: [null, 1] })).toEqual(more(1))
  })
  it('印の置き場が空いていれば、ほかの置き場が足りていても、まず印の置き場に置くよう伝える', () => {
    expect(placementIssue(s, 0, { card: 'flameStrike', slots: [null, 0] })).toEqual({ type: 'mark', mark: 'X' })
    // 印の無い行動は、どの置き場が空いていても印のことは言わない
    const charged = makeState({ roll: [3, 5, 3], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(charged, 0, { card: 'spear', slots: [null, 0] })).toEqual(more(1))
  })
  it('置ける個数になるまでの残りを数える。個数を選べるなら、一番近い個数を目指す', () => {
    expect(missingDice([2], 1)).toBe(1)
    expect(missingDice([2], 0)).toBe(2)
    expect(missingDice([1, 2], 0)).toBe(1)
    expect(missingDice([1, 2], 1)).toBeNull()
    expect(missingDice([1, 2], 2)).toBeNull()
    expect(missingDice([2, 3], 1)).toBe(1)
    expect(missingDice([1, 3], 2)).toBe(1)
    // 多すぎる個数には、足しても届かない
    expect(missingDice([2], 3)).toBeNull()
  })
  it('個数と置き場が揃っていても、使用済みのダイスを含むなら、使えないとだけ伝える', () => {
    const mixed = makeState({ roll: [3, 5, 6], usedDice: [2] }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(mixed, 0, { card: 'flameStrike', slots: [0, 2] })).toEqual(UNUSABLE)
  })
  it('決まった理由に当たらなければ、使えないとだけ伝える', () => {
    // 使用済みのダイスが置き場に残っている
    const used = makeState({ roll: [3, 5, 3], usedDice: [2] }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(used, 0, { card: 'barrier', slots: [2] })).toEqual(UNUSABLE)
    // 今のステップで使える行の無いカード
    const broken = makeState({ roll: [3, 5, 3], chant: 'broken' }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(broken, 0, { card: 'spear', slots: [0] })).toEqual(UNUSABLE)
  })
})

describe('手元への操作', () => {
  const s = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
  /** 二ステップ目で、魔槍は詠唱していないので使えない */
  const late = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] }, 2)
  /** 操作を順に受けた後の手元 */
  const run = (state: GameState, ...events: HandEvent[]): Hand =>
    events.reduce((h, e) => reduceHand(state, 0, h, e), EMPTY_HAND)

  it('手元のダイスを押すと持ち上げ、もう一度押すと下ろす。別のダイスを押せば持ち替える', () => {
    expect(run(s, { type: 'tapTray', die: 0 }).held).toBe(0)
    expect(run(s, { type: 'tapTray', die: 0 }, { type: 'tapTray', die: 0 }).held).toBeNull()
    expect(run(s, { type: 'tapTray', die: 0 }, { type: 'tapTray', die: 1 }).held).toBe(1)
  })
  it('引きずり始めたダイスを持つ。置いてあるダイスを引きずっても、置いたままで持つ', () => {
    expect(run(s, { type: 'grab', die: 2 })).toEqual({ drafts: [], held: 2 })
    const placed = run(s, { type: 'put', card: 'barrier', slot: 0, die: 0 }, { type: 'grab', die: 0 })
    expect(placed).toEqual({ drafts: [{ card: 'barrier', slots: [0] }], held: 0 })
  })
  it('使用済みのダイスは持ち上げられない', () => {
    const used = makeState({ roll: [6, 4, 2], usedDice: [0] }, { roll: [1, 2, 3] }, 2)
    expect(run(used, { type: 'tapTray', die: 0 }).held).toBeNull()
    expect(run(used, { type: 'grab', die: 0 }).held).toBeNull()
  })
  it('凍らされた目のダイスは持ち上げられない', () => {
    const frozen = makeState({ roll: [6, 4, 2], frozen: 4 }, { roll: [1, 2, 3] })
    expect(run(frozen, { type: 'tapTray', die: 1 }).held).toBeNull()
    expect(run(frozen, { type: 'grab', die: 1 }).held).toBeNull()
    expect(run(frozen, { type: 'tapTray', die: 0 }).held).toBe(0)
  })
  it('持っているダイスを置き場に置く。何も持っていなければ置き場を押しても何も起きない', () => {
    const h = run(s, { type: 'tapTray', die: 1 }, { type: 'put', card: 'flameStrike', slot: 1 })
    expect(h).toEqual({ drafts: [{ card: 'flameStrike', slots: [null, 1] }], held: null })
    expect(run(s, { type: 'put', card: 'flameStrike', slot: 0 })).toEqual(EMPTY_HAND)
  })
  it('引きずって落とした置き場には、引きずったダイスが入る', () => {
    const h = run(s, { type: 'grab', die: 2 }, { type: 'put', card: 'barrier', slot: 0, die: 2 })
    expect(h).toEqual({ drafts: [{ card: 'barrier', slots: [2] }], held: null })
  })
  it('置けない置き場に置こうとしても配置は変わらず、持っていたダイスは下ろす', () => {
    const before = run(late, { type: 'put', card: 'flameStrike', slot: 0, die: 0 })
    // 詠唱していないので魔槍の発動は使えない
    const after = reduceHand(late, 0, { ...before, held: 1 }, { type: 'put', card: 'spear', slot: 0 })
    expect(after).toEqual({ drafts: before.drafts, held: null })
  })
  it('置き場のダイスを押すと、ダイスを持っていれば入れ替え、持っていなければ手元に戻す', () => {
    const placed = run(
      s,
      { type: 'put', card: 'flameStrike', slot: 0, die: 0 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 1 },
    )
    expect(placed.drafts).toEqual([{ card: 'flameStrike', slots: [0, 1] }])
    const swapped = run(
      s,
      { type: 'put', card: 'flameStrike', slot: 0, die: 0 },
      { type: 'tapTray', die: 2 },
      {
        type: 'tapPlaced',
        card: 'flameStrike',
        slot: 0,
        die: 0,
      },
    )
    // 埋まった置き場に手元のダイスを置くと、あったダイスは手元に戻る
    expect(swapped).toEqual({ drafts: [{ card: 'flameStrike', slots: [2, null] }], held: null })
    const back = reduceHand(s, 0, placed, { type: 'tapPlaced', card: 'flameStrike', slot: 0, die: 0 })
    expect(back).toEqual({ drafts: [{ card: 'flameStrike', slots: [null, 1] }], held: null })
  })
  it('置いたダイスを同じカードの別の置き場へ引きずると、移した先のダイスと入れ替わる', () => {
    const placed: Hand = { drafts: [{ card: 'flameStrike', slots: [0, 1] }], held: null }
    const moved = run(
      s,
      { type: 'put', card: 'flameStrike', slot: 0, die: 0 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 1 },
      { type: 'grab', die: 0 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 0 },
    )
    expect(moved).toEqual({ drafts: [{ card: 'flameStrike', slots: [1, 0] }], held: null })
    expect(reduceHand(s, 0, placed, { type: 'takeBack', die: 1 })).toEqual({
      drafts: [{ card: 'flameStrike', slots: [0, null] }],
      held: null,
    })
  })
  it('別のカードに置くと、前のカードのダイスは手元に戻る', () => {
    const h = run(
      s,
      { type: 'put', card: 'flameStrike', slot: 0, die: 0 },
      { type: 'put', card: 'barrier', slot: 0, die: 1 },
    )
    expect(h.drafts).toEqual([{ card: 'barrier', slots: [1] }])
  })
  it('カードの名前を押すと、持っていたダイスは置かずに下ろす。別のカードなら置いたダイスも戻し、同じカードならそのまま', () => {
    const placed = run(s, { type: 'put', card: 'barrier', slot: 0, die: 0 }, { type: 'tapTray', die: 1 })
    expect(reduceHand(s, 0, placed, { type: 'consider', card: 'barrier' })).toEqual({
      drafts: [{ card: 'barrier', slots: [0] }],
      held: null,
    })
    expect(reduceHand(s, 0, placed, { type: 'consider', card: 'flameStrike' })).toEqual(EMPTY_HAND)
  })
  it('どこにも落とさなければダイスを下ろすだけで、決定すると手元は空になる', () => {
    const placed = run(s, { type: 'put', card: 'barrier', slot: 0, die: 0 }, { type: 'grab', die: 1 })
    expect(reduceHand(s, 0, placed, { type: 'release' })).toEqual({ drafts: placed.drafts, held: null })
    expect(reduceHand(s, 0, placed, { type: 'clear' })).toEqual(EMPTY_HAND)
  })
  it('持っているダイスを置ける置き場は、使えるカードの今の行の全ての置き場。持っていなければ無い', () => {
    const held: Hand = { drafts: [], held: 0 }
    expect(targets(s, 0, held, 'flameStrike')).toEqual([0, 1])
    expect(targets(s, 0, held, 'barrier')).toEqual([0])
    expect(targets(s, 0, held, 'barrier')).toEqual([0])
    expect(targets(late, 0, held, 'spear')).toEqual([])
    expect(targets(s, 0, EMPTY_HAND, 'flameStrike')).toEqual([])
  })
  it('置いたダイスから、カードの行と、行動か決定できない理由を読む', () => {
    const half: Hand = { drafts: [{ card: 'flameStrike', slots: [null, 1] }], held: null }
    expect(draftRow(s, 0, half)).toEqual({ card: 'flameStrike', kind: 'flameStrike', slots: [null, 1] })
    expect(draftAction(s, 0, half)).toBeNull()
    expect(draftIssue(s, 0, half)).toEqual({ type: 'mark', mark: 'X' })
    const full: Hand = { drafts: [{ card: 'flameStrike', slots: [0, 1] }], held: null }
    expect(draftAction(s, 0, full)).toEqual({ kind: 'flameStrike', dice: [0, 1] })
    expect(draftIssue(s, 0, full)).toBeNull()
    expect(draftRow(s, 0, EMPTY_HAND)).toBeNull()
    // 今のステップに置ける行の無いカードは、行として読まない
    const broken = makeState({ roll: [6, 4, 2], chant: 'broken' }, { roll: [1, 2, 3] }, 2)
    expect(draftRow(broken, 0, { drafts: [{ card: 'spear', slots: [0, 1] }], held: null })).toBeNull()
    expect(draftAction(s, 0, EMPTY_HAND)).toBeNull()
    expect(draftIssue(s, 0, EMPTY_HAND)).toBeNull()
  })
})

describe('手元への操作の性質', () => {
  const eventArb: fc.Arbitrary<HandEvent> = fc.oneof(
    fc.record({ type: fc.constant('tapTray' as const), die: fc.integer({ min: 0, max: 2 }) }),
    fc.record({ type: fc.constant('grab' as const), die: fc.integer({ min: 0, max: 2 }) }),
    fc.record(
      {
        type: fc.constant('put' as const),
        card: fc.constantFrom(...STARTER),
        slot: fc.integer({ min: -1, max: 2 }),
        die: fc.integer({ min: 0, max: 2 }),
      },
      { requiredKeys: ['type', 'card', 'slot'] },
    ),
    fc.record({
      type: fc.constant('tapPlaced' as const),
      card: fc.constantFrom(...STARTER),
      slot: fc.integer({ min: 0, max: 1 }),
      die: fc.integer({ min: 0, max: 2 }),
    }),
    fc.record({ type: fc.constant('takeBack' as const), die: fc.integer({ min: 0, max: 2 }) }),
    fc.record({ type: fc.constant('consider' as const), card: fc.constantFrom(...STARTER) }),
    fc.constant({ type: 'release' as const }),
    fc.constant({ type: 'clear' as const }),
  )

  /** 手元がいつも守る決まり */
  function expectSound(state: GameState, hand: Hand) {
    const free = freeDice(state.players[0])
    if (hand.held !== null) expect(free).toContain(hand.held)
    // スターターには行動の回数を増やすカードが無いので、置けるのは1枚まで
    expect(hand.drafts.length).toBeLessThanOrEqual(1)
    const [draft] = hand.drafts
    if (!draft) return
    // 置いたダイスは、このステップに使える空いたダイスだけで、重ならず、少なくとも一つある
    const dice = draft.slots.filter((d): d is number => d !== null)
    expect(dice.length).toBeGreaterThan(0)
    expect(new Set(dice).size).toBe(dice.length)
    for (const d of dice) expect(free).toContain(d)
    // 使えるカードの、今の行の置き場の数だけ並ぶ
    expect(usableCards(state, 0).has(draft.card)).toBe(true)
    const kind = rowNow(state, 0, draft.card)
    expect(kind).toBeDefined()
    expect(draft.slots).toHaveLength(slotsOf(ACTION_DEFS[kind ?? 'flameStrike']))
    // 理由が出ないのは行動になるときだけで、行動は置いた置き場をそのまま持つ合法手
    const a = draftAction(state, 0, hand)
    expect(draftIssue(state, 0, hand) === null).toBe(a !== null)
    if (a && a.kind !== 'pass') {
      expect(isLegal(state, 0, a)).toBe(true)
      expect(a.dice).toEqual(draft.slots)
    }
  }

  it('どんな操作を続けても、手元は決まりを守る', () => {
    fc.assert(
      fc.property(stateArb, fc.array(eventArb, { maxLength: 12 }), (state, events) => {
        let hand = EMPTY_HAND
        for (const e of events) {
          const next = reduceHand(state, 0, hand, e)
          expectSound(state, next)
          // 決定すれば空になり、名前を押せば持っていたダイスを下ろし、別のカードなら置いたダイスも戻す
          if (e.type === 'clear') expect(next).toEqual(EMPTY_HAND)
          if (e.type === 'consider') {
            expect(next.held).toBeNull()
            const same = hand.drafts.length === 1 && hand.drafts[0].card === e.card
            expect(next.drafts).toEqual(same ? hand.drafts : [])
          }
          // 手元に戻したダイスは置き場から消える
          if (e.type === 'takeBack') expect(next.drafts.flatMap((p) => p.slots)).not.toContain(e.die)
          // 置けたなら、そのダイスはその置き場にあり、ほかの置き場には無い
          if (e.type === 'put' && next.drafts !== hand.drafts && next.drafts.length > 0) {
            const die = e.die ?? hand.held
            const [placed] = next.drafts
            expect(placed.card).toBe(e.card)
            expect(placed.slots[e.slot]).toBe(die)
            expect(placed.slots.filter((d) => d === die)).toHaveLength(1)
          }
          hand = next
        }
      }),
    )
  })
  it('持っているダイスは、置ける置き場のどこに置いても、その置き場に入る', () => {
    fc.assert(
      fc.property(stateArb, fc.integer({ min: 0, max: 2 }), fc.constantFrom(...STARTER), (state, die, card) => {
        const hand = reduceHand(state, 0, EMPTY_HAND, { type: 'tapTray', die })
        for (const k of targets(state, 0, hand, card)) {
          const next = reduceHand(state, 0, hand, { type: 'put', card, slot: k })
          expect(next.drafts[0]?.slots[k]).toBe(die)
          expect(canPut(state, 0, card, die)).toBe(true)
        }
      }),
    )
  })
})

describe('一緒に使うカード', () => {
  /** 二重詠唱と、1個で使えるカードを持つ */
  const deck = ['doubleCast', 'barrier', 'interrupt', 'freeze', 'flameStrike'] as const
  const s = makeState({ roll: [6, 4, 2], deck }, { roll: [1, 2, 3] })
  const run = (state: GameState, ...events: HandEvent[]): Hand =>
    events.reduce((h, e) => reduceHand(state, 0, h, e), EMPTY_HAND)

  it('行動の回数を増やすカードに置けば、ほかのカードにも決まった枚数まで置け、まとめて一つの行動になる', () => {
    const h = run(
      s,
      { type: 'put', card: 'doubleCast', slot: 0, die: 0 },
      { type: 'put', card: 'barrier', slot: 0, die: 1 },
      { type: 'put', card: 'interrupt', slot: 0, die: 2 },
    )
    expect(h.drafts.map((p) => p.card)).toEqual(['doubleCast', 'barrier', 'interrupt'])
    expect(draftAction(s, 0, h)).toEqual({
      kind: 'doubleCast',
      dice: [0],
      with: [
        { kind: 'barrier', dice: [1] },
        { kind: 'interrupt', dice: [2] },
      ],
    })
    expect(draftIssue(s, 0, h)).toBeNull()
    expect(draftRows(s, 0, h).map((r) => r.kind)).toEqual(['doubleCast', 'barrier', 'interrupt'])
  })
  it('先にほかのカードに置いてから行動の回数を増やすカードに置いても、置いたカードはそのまま一緒に使う', () => {
    const h = run(
      s,
      { type: 'put', card: 'flameStrike', slot: 0, die: 0 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 1 },
      { type: 'put', card: 'doubleCast', slot: 0, die: 2 },
    )
    expect(draftAction(s, 0, h)).toEqual({
      kind: 'doubleCast',
      dice: [2],
      with: [{ kind: 'flameStrike', dice: [0, 1] }],
    })
  })
  it('行動の回数を増やすカードだけでは行動にならず、ほかのカードにも置くよう伝える', () => {
    const h = run(s, { type: 'put', card: 'doubleCast', slot: 0, die: 0 })
    expect(draftAction(s, 0, h)).toBeNull()
    expect(draftIssue(s, 0, h)).toEqual({ type: 'with' })
  })
  it('決まった枚数を超えて置くと、最後に置いたカードの代わりに入る', () => {
    const four = makeState({ roll: [6, 4, 2, 3], deck }, { roll: [1, 2, 3] })
    const h = run(
      four,
      { type: 'put', card: 'doubleCast', slot: 0, die: 0 },
      { type: 'put', card: 'barrier', slot: 0, die: 1 },
      { type: 'put', card: 'interrupt', slot: 0, die: 2 },
      { type: 'put', card: 'freeze', slot: 0, die: 3 },
    )
    expect(h.drafts.map((p) => p.card)).toEqual(['doubleCast', 'barrier', 'freeze'])
  })
  it('行動の回数を増やすカードのダイスを戻すと、最初に一緒に置いたカードだけが残る', () => {
    const h = run(
      s,
      { type: 'put', card: 'doubleCast', slot: 0, die: 0 },
      { type: 'put', card: 'barrier', slot: 0, die: 1 },
      { type: 'put', card: 'interrupt', slot: 0, die: 2 },
      { type: 'takeBack', die: 0 },
    )
    expect(h.drafts).toEqual([{ card: 'barrier', slots: [1] }])
  })
  it('一緒に置いたカードのダイスを別のカードへ移すと、前のカードから外れる', () => {
    const h = run(
      s,
      { type: 'put', card: 'doubleCast', slot: 0, die: 0 },
      { type: 'put', card: 'barrier', slot: 0, die: 1 },
      { type: 'put', card: 'interrupt', slot: 0, die: 1 },
    )
    expect(h.drafts).toEqual([
      { card: 'doubleCast', slots: [0] },
      { card: 'interrupt', slots: [1] },
    ])
  })
  it('行動の回数を増やすカードに置いていれば、名前を押しても置いたダイスは戻さない', () => {
    const h = run(
      s,
      { type: 'put', card: 'doubleCast', slot: 0, die: 0 },
      { type: 'put', card: 'barrier', slot: 0, die: 1 },
      { type: 'consider', card: 'interrupt' },
    )
    expect(h.drafts).toEqual([
      { card: 'doubleCast', slots: [0] },
      { card: 'barrier', slots: [1] },
    ])
  })
  it('一緒に置いたカードに置き直しても、ほかに一緒に置いたカードはそのまま残る', () => {
    const four = makeState({ roll: [6, 4, 2, 3], deck }, { roll: [1, 2, 3] })
    const h = run(
      four,
      { type: 'put', card: 'doubleCast', slot: 0, die: 0 },
      { type: 'put', card: 'barrier', slot: 0, die: 1 },
      { type: 'put', card: 'interrupt', slot: 0, die: 2 },
      { type: 'put', card: 'barrier', slot: 0, die: 3 },
    )
    expect(h.drafts).toEqual([
      { card: 'doubleCast', slots: [0] },
      { card: 'barrier', slots: [3] },
      { card: 'interrupt', slots: [2] },
    ])
  })
  it('一緒に置いたカードの一枚が行動にならなければ、まとめても行動にならず、そのカードの理由を伝える', () => {
    const h = run(
      s,
      { type: 'put', card: 'doubleCast', slot: 0, die: 0 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 1 },
    )
    expect(draftAction(s, 0, h)).toBeNull()
    expect(draftIssue(s, 0, h)).toEqual({ type: 'mark', mark: 'X' })
  })
  it('置き場の番号が負なら置かない', () => {
    expect(placeDie(s, 0, [], 'barrier', 0, -1)).toBeNull()
    expect(placeDie(s, 0, [], 'barrier', 0, 1)).toBeNull()
  })
  it('合法手は全て、カードごとにダイスを置いて組み立てられる', () => {
    fc.assert(
      fc.property(rollArb, (roll) => {
        const state = makeState({ roll, deck }, { roll: [1, 2, 3] })
        for (const a of legalActions(state, 0)) {
          if (a.kind === 'pass') continue
          let hand = EMPTY_HAND
          for (const x of [a, ...(a.with ?? [])]) {
            const card = ACTION_DEFS[x.kind].card
            x.dice.forEach((d, k) => {
              if (d !== null) hand = reduceHand(state, 0, hand, { type: 'put', card, slot: k, die: d })
            })
          }
          expect(draftAction(state, 0, hand)).toEqual(a)
        }
      }),
    )
  })
  it('一緒にだけ使えるカードも、使えるカードに数える', () => {
    const used = makeState({ roll: [6, 4, 2], deck, usedCards: ['barrier'] }, { roll: [1, 2, 3] })
    expect(usableCards(used, 0)).toEqual(new Set(['doubleCast', 'interrupt', 'freeze', 'flameStrike']))
  })
})

describe('好きな目のダイス', () => {
  /** 錬成の後の二ステップ目。手元は好きな目のダイス3個で、1と2は使い終わっている */
  const deck = ['transmute', 'flameStrike', 'bullet', 'barrier', 'interrupt'] as const
  const forged = (frozen: number | null = null) =>
    makeState(
      { roll: [6, 4, 2, WILD, WILD, WILD], usedDice: [0, 1, 2], usedCards: ['transmute'], deck, frozen },
      { roll: [1, 2, 3] },
      2,
    )
  const run = (state: GameState, ...events: HandEvent[]): Hand =>
    events.reduce((h, e) => reduceHand(state, 0, h, e), EMPTY_HAND)

  it('一つ目の置き場だけに置いても、まだ目を選んでいないと読む', () => {
    const s = forged()
    const h = run(s, { type: 'put', card: 'flameStrike', slot: 0, die: 3 })
    expect(draftRows(s, 0, h)).toEqual([
      { card: 'flameStrike', kind: 'flameStrike', slots: [3, null], set: [null, null] },
    ])
    expect(draftIssue(s, 0, h)).toEqual({ type: 'more', count: 1, same: false })
  })
  it('ふつうのダイスと一緒に置いても、好きな目のダイスの置き場にだけ選んだ目を添える', () => {
    // 今のカードでは手元に混ざらないが、ルールは混ざった手元も扱うので、同じように組み立てる
    const mixed = makeState({ roll: [6, WILD, 2], deck, usedCards: ['transmute'] }, { roll: [1, 2, 3] }, 2)
    const h = run(
      mixed,
      { type: 'put', card: 'flameStrike', slot: 0, die: 0 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 1 },
      { type: 'choose', die: 1, value: 1 },
    )
    expect(draftAction(mixed, 0, h)).toEqual({ kind: 'flameStrike', dice: [0, 1], set: [null, 1] })
  })
  it('目を選んだダイスと選んでいないダイスがあれば、目を選ぶよう伝える', () => {
    const s = forged()
    const h = run(
      s,
      { type: 'put', card: 'flameStrike', slot: 0, die: 3 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 4 },
      { type: 'choose', die: 3, value: 6 },
    )
    expect(draftIssue(s, 0, h)).toEqual({ type: 'pick' })
  })
  it('置いてから目を選ぶまで行動にならず、目を選ぶよう伝える', () => {
    const s = forged()
    const h = run(
      s,
      { type: 'put', card: 'flameStrike', slot: 0, die: 3 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 4 },
    )
    expect(draftAction(s, 0, h)).toBeNull()
    expect(draftIssue(s, 0, h)).toEqual({ type: 'pick' })
    expect(draftRows(s, 0, h)).toEqual([{ card: 'flameStrike', kind: 'flameStrike', slots: [3, 4], set: [null, null] }])
  })
  it('選んだ目で行動になる。選んだ目はダイスごとに覚え、置き場を移しても変わらない', () => {
    const s = forged()
    const h = run(
      s,
      { type: 'put', card: 'flameStrike', slot: 0, die: 3 },
      { type: 'put', card: 'flameStrike', slot: 1, die: 4 },
      { type: 'choose', die: 3, value: 6 },
      { type: 'choose', die: 4, value: 1 },
    )
    expect(draftAction(s, 0, h)).toEqual({ kind: 'flameStrike', dice: [3, 4], set: [6, 1] })
    const swapped = reduceHand(s, 0, h, { type: 'put', card: 'flameStrike', slot: 1, die: 3 })
    expect(draftAction(s, 0, swapped)).toEqual({ kind: 'flameStrike', dice: [4, 3], set: [1, 6] })
  })
  it('同じ目を揃える行動は、選んだ目が揃っていなければ揃えるよう伝える', () => {
    const s = forged()
    const h = run(
      s,
      { type: 'put', card: 'bullet', slot: 0, die: 3 },
      { type: 'put', card: 'bullet', slot: 1, die: 4 },
      { type: 'choose', die: 3, value: 2 },
      { type: 'choose', die: 4, value: 5 },
    )
    expect(draftIssue(s, 0, h)).toEqual({ type: 'same', count: 2 })
    expect(draftAction(s, 0, reduceHand(s, 0, h, { type: 'choose', die: 4, value: 2 }))).toEqual({
      kind: 'bullet',
      dice: [3, 4],
      set: [2, 2],
    })
  })
  it('凍らされた目と、1から6でない目は選べない。好きな目のダイスでないダイスの目も選べない', () => {
    const s = forged(5)
    const h = run(s, { type: 'put', card: 'barrier', slot: 0, die: 3 })
    expect(reduceHand(s, 0, h, { type: 'choose', die: 3, value: 5 })).toBe(h)
    expect(reduceHand(s, 0, h, { type: 'choose', die: 3, value: 7 })).toBe(h)
    expect(reduceHand(s, 0, h, { type: 'choose', die: 3, value: 0 })).toBe(h)
    expect(reduceHand(s, 0, h, { type: 'choose', die: 3, value: 2.5 })).toBe(h)
    const plain = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
    expect(reduceHand(plain, 0, EMPTY_HAND, { type: 'choose', die: 0, value: 3 })).toBe(EMPTY_HAND)
    expect(choosable(s, 0, 4)).toBe(true)
    expect(isWild(s, 0, 3)).toBe(true)
    expect(isWild(s, 0, 0)).toBe(false)
  })
  it('好きな目のダイスで作れる合法手は、置いて目を選べば組み立てられる', () => {
    const s = forged()
    for (const a of legalActions(s, 0)) {
      if (a.kind === 'pass') continue
      const card = ACTION_DEFS[a.kind].card
      let hand = EMPTY_HAND
      a.dice.forEach((d, k) => {
        if (d === null) return
        hand = reduceHand(s, 0, hand, { type: 'put', card, slot: k, die: d })
        hand = reduceHand(s, 0, hand, { type: 'choose', die: d, value: a.set?.[k] ?? 0 })
      })
      expect(draftAction(s, 0, hand)).toEqual(a)
    }
  })
})

describe('行動の回数を増やすカードの枚数', () => {
  it('行動の回数を増やすカードだけが、一緒に使える枚数を持つ', () => {
    expect(multiOf('doubleCast')).toBe(2)
    expect(multiOf('flameStrike')).toBe(0)
    expect(multiOf('spear')).toBe(0)
  })
})
