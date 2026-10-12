// 画面の操作から行動を組み立てる処理のテスト

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeState, rollArb, seeded } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, CARD_ORDER, slotsOf } from './cards'
import {
  availableCards,
  CANNOT_USE,
  canPut,
  composeAction,
  effectParts,
  firstStepDice,
  kindsNow,
  missingDice,
  type Placement,
  placeDie,
  placedDice,
  placedKind,
  placementIssue,
  removeDie,
  slotCount,
} from './compose'
import { diceValues, isLegal, legalActions, nextTurn, resolveStep } from './rules'
import type { CardId, GameState } from './types'

describe('行動の組み立て', () => {
  it('画面の操作で全ての行動を作れる', () => {
    // 行動ごとに、それが使える局面を作って組み立てを試す
    const made = new Set<string>()
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      const s = makeState(
        { roll: [4, 4, 4], chant: def.needsCharge ? 'charged' : 'none' },
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
        if (a && a.kind !== 'pass') made.add(a.kind)
      }
    }
    expect([...made].sort()).toEqual([...ACTION_KINDS].sort())
  })
  it('組み立てた行動は常に合法で、そのカードの行動になる', () => {
    fc.assert(
      fc.property(
        rollArb,
        fc.constantFrom<CardId>(...CARD_ORDER),
        fc.subarray([0, 1, 2]),
        fc.boolean(),
        (roll, card, picked, step2) => {
          const s = makeState({ roll, chant: step2 ? 'charged' : 'none' }, { roll: [1, 2, 3] }, step2 ? 2 : 1)
          const pl = placeAll(s, card, picked)
          const a = pl && composeAction(s, 0, card, pl.slots)
          if (!a) return
          expect(isLegal(s, 0, a)).toBe(true)
          expect(a.kind !== 'pass' && ACTION_DEFS[a.kind].card).toBe(card)
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
        expect(availableCards(s, 0)).toEqual(fromLegal)
      }),
    )
  })
})

describe('ステップごとの行動', () => {
  it('雷槍は一ステップ目に詠唱、二ステップ目は詠唱が保たれたときだけ発動', () => {
    const s1 = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] }, 1)
    expect(kindsNow(s1, 0, 'spear')).toEqual(['spearChant'])
    const charged = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(kindsNow(charged, 0, 'spear')).toEqual(['spearCast'])
    const broken = makeState({ roll: [6, 5, 4], chant: 'broken' }, { roll: [1, 2, 3] }, 2)
    expect(kindsNow(broken, 0, 'spear')).toEqual([])
  })
})

/** dice を card の最初の置き場から順に置いていく。途中で置けなければ null */
function placeAll(s: GameState, card: CardId, dice: number[]): Placement | null {
  let pl: Placement | null = null
  for (const [k, d] of dice.entries()) {
    pl = placeDie(s, 0, pl, card, d, k)
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
          for (const [k, d] of reversed ? steps.reverse() : steps) pl = placeDie(s, 0, pl, card, d, k)
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
        fc.constantFrom<CardId>(...CARD_ORDER),
        fc.subarray([0, 1, 2], { minLength: 1 }),
        fc.boolean(),
        (roll, card, order, step2) => {
          const s = makeState({ roll, chant: step2 ? 'charged' : 'none' }, { roll: [1, 2, 3] }, step2 ? 2 : 1)
          const n = slotCount(s, 0, card)
          const pl = placeAll(s, card, order)
          const fits = availableCards(s, 0).has(card) && order.length <= n
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
    expect(canPut(s, 0, 'bullet', 2)).toBe(false)
    expect(canPut(s, 0, 'bullet', 0)).toBe(true)
    expect(placeDie(s, 0, null, 'bullet', 2, 0)).toBeNull()
    // 同じダイスを二つの置き場には置けない。置き直すと元の置き場は空く
    expect(placeDie(s, 0, { card: 'bullet', slots: [0, null] }, 'bullet', 0, 1)).toEqual({
      card: 'bullet',
      slots: [null, 0],
    })
  })
  it('置き場の外には置けない', () => {
    const s = makeState({ roll: [6, 6, 2] }, { roll: [1, 2, 3] })
    expect(slotCount(s, 0, 'barrier')).toBe(1)
    expect(placeAll(s, 'barrier', [0])).toEqual({ card: 'barrier', slots: [0] })
    expect(placeDie(s, 0, null, 'barrier', 0, 1)).toBeNull()
    expect(placeDie(s, 0, null, 'barrier', 0, -1)).toBeNull()
    expect(placeAll(s, 'bullet', [0, 1, 2])).toBeNull()
  })
  it('置き場の無いカードには置けない', () => {
    const s = makeState({ roll: [6, 5, 4], chant: 'broken' }, { roll: [1, 2, 3] }, 2)
    expect(slotCount(s, 0, 'spear')).toBe(0)
    expect(placeDie(s, 0, null, 'spear', 0, 0)).toBeNull()
  })
  it('行動は置いた置き場をそのまま記録する。火球は X の枠に置いた目が威力になる', () => {
    const s = makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] })
    const pl = placeDie(s, 0, placeDie(s, 0, null, 'fireball', 0, 1), 'fireball', 1, 0)
    expect(pl).toEqual({ card: 'fireball', slots: [1, 0] })
    const a = composeAction(s, 0, 'fireball', pl?.slots ?? [])
    expect(a).toEqual({ kind: 'fireball', dice: [1, 0] })
    expect(diceValues(s.players[0], a ?? { kind: 'pass' })).toEqual([2, 6])
    expect(effectParts('fireball', [2, 6])).toEqual([{ icon: 'damage', value: '2' }])
  })
  it('省いてもよい置き場だけに置いても、置いた個数の行動になり、空けた置き場は空けたまま記録する', () => {
    const s = makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] })
    const pl = placeDie(s, 0, null, 'bullet', 2, 1)
    expect(pl).toEqual({ card: 'bullet', slots: [null, 2] })
    expect(composeAction(s, 0, 'bullet', pl?.slots ?? [])).toEqual({ kind: 'bullet', dice: [null, 2] })
  })
  it('X の枠を空けた火球は行動にならない', () => {
    const s = makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] })
    expect(composeAction(s, 0, 'fireball', [null, 0])).toBeNull()
    expect(composeAction(s, 0, 'fireball', [0, null])).toBeNull()
  })
  it('反射には違う目も置けるが、同じ目が揃うまで行動にならない', () => {
    const s = makeState({ roll: [3, 5, 3] }, { roll: [1, 2, 3] })
    const mixed = placeAll(s, 'reflect', [0, 1])
    expect(mixed).toEqual({ card: 'reflect', slots: [0, 1] })
    expect(composeAction(s, 0, 'reflect', [0, 1])).toBeNull()
    // 違う目の置き場に同じ目を置き直せば、行動になる
    const fixed = placeDie(s, 0, mixed, 'reflect', 2, 1)
    expect(fixed).toEqual({ card: 'reflect', slots: [0, 2] })
    expect(composeAction(s, 0, 'reflect', fixed?.slots ?? [])).toEqual({ kind: 'reflect', dice: [0, 2] })
  })
  it('使えないカードには置けない', () => {
    const s = makeState({ roll: [6, 6, 2], usedCards: ['fireball'] }, { roll: [1, 2, 3] }, 2)
    expect(canPut(s, 0, 'fireball', 0)).toBe(false)
    expect(canPut(s, 0, 'spear', 0)).toBe(false)
    expect(canPut(s, 0, 'bullet', 0)).toBe(true)
    // ゾロ目が無ければ、反射は使えないカードなので置けない
    const odd = makeState({ roll: [1, 2, 3] }, { roll: [1, 2, 3] })
    expect(canPut(odd, 0, 'reflect', 0)).toBe(false)
    expect(placeDie(odd, 0, null, 'reflect', 0, 0)).toBeNull()
  })
  it('別のカードに置くと、前のカードのダイスは手元に戻る', () => {
    const s = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
    const fire: Placement = { card: 'fireball', slots: [0, 1] }
    expect(placeDie(s, 0, fire, 'barrier', 1, 0)).toEqual({ card: 'barrier', slots: [1] })
  })
  it('埋まった置き場に手元のダイスを置くと、あったダイスは手元に戻る', () => {
    const s = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
    const fire: Placement = { card: 'fireball', slots: [0, 1] }
    expect(placeDie(s, 0, fire, 'fireball', 2, 0)).toEqual({ card: 'fireball', slots: [2, 1] })
  })
  it('同じカードの別の置き場へ移すと、移した先のダイスと入れ替わる。空いた置き場へは、そのまま移る', () => {
    const s = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
    expect(placeDie(s, 0, { card: 'fireball', slots: [0, 1] }, 'fireball', 0, 1)).toEqual({
      card: 'fireball',
      slots: [1, 0],
    })
    expect(placeDie(s, 0, { card: 'fireball', slots: [null, 1] }, 'fireball', 1, 0)).toEqual({
      card: 'fireball',
      slots: [1, null],
    })
    // 同じ置き場に置き直しても変わらない
    expect(placeDie(s, 0, { card: 'fireball', slots: [0, 1] }, 'fireball', 0, 0)).toEqual({
      card: 'fireball',
      slots: [0, 1],
    })
  })
  it('ダイスを手元に戻すと、その置き場だけが空く', () => {
    const fire: Placement = { card: 'fireball', slots: [0, 1] }
    expect(removeDie(fire, 0)).toEqual({ card: 'fireball', slots: [null, 1] })
    expect(removeDie(fire, 2)).toEqual(fire)
    expect(removeDie({ card: 'barrier', slots: [2] }, 2)).toBeNull()
    expect(removeDie(null, 0)).toBeNull()
    expect(placedDice(null)).toEqual([])
  })
  it('雷槍は一ステップ目は詠唱、二ステップ目は発動の行に置く', () => {
    const s1 = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] }, 1)
    expect(placedKind(s1, 0, { card: 'spear', slots: [0] })).toBe('spearChant')
    expect(slotCount(s1, 0, 'spear')).toBe(1)
    const s2 = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(placedKind(s2, 0, { card: 'spear', slots: [0, null] })).toBe('spearCast')
    expect(slotCount(s2, 0, 'spear')).toBe(2)
  })
})

describe('カード面', () => {
  /** 効果の部品を、読み比べやすい一行にする */
  const flat = (parts: ReturnType<typeof effectParts>) =>
    parts.map((p) => [p.icon, p.value, p.text].filter(Boolean).join(':')).join(' ')
  it.each([
    ['fireball', [6, 2], 'damage:6'],
    ['fireball', [2, 6], 'damage:2'],
    ['barrier', [4], 'guard:4'],
    ['spearChant', [5], 'chant:5'],
    ['spearCast', [6, 5], 'damage:11'],
    ['reflect', [2, 2], 'reflect'],
    ['bullet', [3], '1個 pierce:2 2個 pierce:3'],
  ] as const)('%s に %j を置いた効果', (kind, vals, want) => {
    expect(flat(effectParts(kind, [...vals]))).toBe(want)
  })
  it('目が決まるまでは記号のまま', () => {
    expect(flat(effectParts('fireball'))).toBe('damage:X')
    expect(flat(effectParts('spearChant'))).toBe('chant:X')
    expect(flat(effectParts('spearCast'))).toBe('damage:Y')
  })
  it('1枚のカードが1つのステップに使える行動は1つ。カード面の1行が1ステップぶんになる', () => {
    for (const card of CARD_ORDER) {
      for (const step of [1, 2] as const) {
        const s = makeState({ roll: [6, 6, 6], chant: 'charged' }, { roll: [1, 2, 3] }, step)
        expect(kindsNow(s, 0, card).length).toBeLessThanOrEqual(1)
      }
    }
  })
  it('同じ目を求める行動は置き場を = でつなぎ、合計を名付ける行動は + でつなぐ', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      if (def.sameValues) expect(def.face.join).toBe('=')
      if (def.face.sum) expect(def.face.join).toBe('+')
    }
  })
  it('効果の印は行動の性質と食い違わない', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      const icons = new Set(def.face.effect.map((p) => p.icon).filter(Boolean))
      // 攻撃は、貫通するかどうかで星の印を使い分ける
      expect(icons.has('damage'), kind).toBe(!!def.power && !def.piercing)
      expect(icons.has('pierce'), kind).toBe(!!def.power && !!def.piercing)
      expect(icons.has('guard'), kind).toBe(!!def.guard)
      expect(icons.has('reflect'), kind).toBe(!!def.reflects)
      expect(icons.has('chant'), kind).toBe(!!def.chant)
    }
  })
  it('置き場の記号は、どの行動でも効果に現れる', () => {
    for (const kind of ACTION_KINDS) {
      const { face } = ACTION_DEFS[kind]
      const written = face.effect.map((p) => `${p.value ?? ''}${p.text ?? ''}`).join(' ')
      for (const sym of [face.mark, face.sum]) if (sym) expect(written).toContain(sym)
    }
  })
})

describe('決定を押せない理由', () => {
  const s = makeState({ roll: [3, 5, 3] }, { roll: [1, 2, 3] })
  it('行動になる置き方なら理由は無い', () => {
    expect(placementIssue(s, 0, { card: 'fireball', slots: [1, 0] })).toBeNull()
    expect(placementIssue(s, 0, { card: 'reflect', slots: [0, 2] })).toBeNull()
    // 魔弾は1個でも2個でも行動になる。省いてよい置き場だけでもよい
    expect(placementIssue(s, 0, { card: 'bullet', slots: [null, 1] })).toBeNull()
  })
  it('個数が足りなければ、あと何個置くかを出す', () => {
    expect(placementIssue(s, 0, { card: 'fireball', slots: [1, null] })).toBe('あと1個置く')
    const charged = makeState({ roll: [3, 5, 3], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(charged, 0, { card: 'spear', slots: [null, 1] })).toBe('あと1個置く')
  })
  it('印の置き場が空いていれば、ほかの置き場が足りていても、まず印の置き場に置くよう伝える', () => {
    expect(placementIssue(s, 0, { card: 'fireball', slots: [null, 0] })).toBe('X の枠に置く')
    // 印の無い行動は、どの置き場が空いていても印のことは言わない
    expect(placementIssue(s, 0, { card: 'reflect', slots: [null, 0] })).toBe('同じ目をあと1個置く')
  })
  it('同じ目を揃える行動は、揃える目の数で伝える', () => {
    expect(placementIssue(s, 0, { card: 'reflect', slots: [1, null] })).toBe('同じ目をあと1個置く')
    expect(placementIssue(s, 0, { card: 'reflect', slots: [0, 1] })).toBe('同じ目を2個置く')
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
  it('同じ目が揃っていても、ほかの理由で使えなければ同じ目のことは言わない', () => {
    // 使用済みのダイスで、同じ目が揃っている
    const used = makeState({ roll: [3, 3, 3], usedDice: [2] }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(used, 0, { card: 'reflect', slots: [0, 2] })).toBe(CANNOT_USE)
    // 同じ目を求めない行動は、違う目でも同じ目のことは言わない
    const mixed = makeState({ roll: [3, 5, 6], usedDice: [2] }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(mixed, 0, { card: 'fireball', slots: [0, 2] })).toBe(CANNOT_USE)
  })
  it('決まった理由に当たらなければ、使えないとだけ伝える', () => {
    expect(CANNOT_USE).toBe('この置き方では使えない')
    // 使用済みのダイスが置き場に残っている
    const used = makeState({ roll: [3, 5, 3], usedDice: [2] }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(used, 0, { card: 'barrier', slots: [2] })).toBe(CANNOT_USE)
    // 今のステップで使える行の無いカード
    const broken = makeState({ roll: [3, 5, 3], chant: 'broken' }, { roll: [1, 2, 3] }, 2)
    expect(placementIssue(broken, 0, { card: 'spear', slots: [0] })).toBe(CANNOT_USE)
  })
})

describe('1ステップ目のダイス', () => {
  const start = makeState({ roll: [6, 2, 5] }, { roll: [3, 3, 1] })
  it('1ステップ目を解決するまでは、カードに残るダイスは無い', () => {
    expect(firstStepDice(start, 0)).toBeNull()
    expect(firstStepDice(start, 1)).toBeNull()
  })
  it('2ステップ目には、双方が1ステップ目に使ったダイスが、置いた置き場のままカードに残る', () => {
    const s = resolveStep(start, [
      { kind: 'fireball', dice: [1, 0] },
      { kind: 'reflect', dice: [0, 1] },
    ])
    expect(firstStepDice(s, 0)).toEqual({ card: 'fireball', kind: 'fireball', slots: [1, 0] })
    expect(firstStepDice(s, 1)).toEqual({ card: 'reflect', kind: 'reflect', slots: [0, 1] })
    // 2ステップ目を解決しても、ターンが変わるまでは残る
    const after = resolveStep(s, [{ kind: 'pass' }, { kind: 'pass' }])
    expect(firstStepDice(after, 0)).toEqual({ card: 'fireball', kind: 'fireball', slots: [1, 0] })
    // ターンが変わると片付く
    expect(firstStepDice(nextTurn(after, seeded(1)), 0)).toBeNull()
  })
  it('省いた置き場は空いたまま残り、パスなら何も残らない', () => {
    // 省いてもよい置き場だけに置いた魔弾は、その置き場に残る
    const s = resolveStep(start, [{ kind: 'bullet', dice: [null, 2] }, { kind: 'pass' }])
    expect(firstStepDice(s, 0)).toEqual({ card: 'bullet', kind: 'bullet', slots: [null, 2] })
    const front = resolveStep(start, [{ kind: 'bullet', dice: [2, null] }, { kind: 'pass' }])
    expect(firstStepDice(front, 0)).toEqual({ card: 'bullet', kind: 'bullet', slots: [2, null] })
    expect(firstStepDice(s, 1)).toBeNull()
  })
  it('詠唱のダイスは、詠唱の行に残る', () => {
    const s = resolveStep(start, [{ kind: 'spearChant', dice: [0] }, { kind: 'pass' }])
    expect(firstStepDice(s, 0)).toEqual({ card: 'spear', kind: 'spearChant', slots: [0] })
  })
})
