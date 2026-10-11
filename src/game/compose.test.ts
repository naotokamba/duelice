// 画面の操作から行動を組み立てる処理のテスト

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeState, rollArb } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, CARD_ORDER } from './cards'
import {
  availableCards,
  canPlace,
  composeAction,
  effectParts,
  kindsNow,
  type Placement,
  placeDie,
  placedKind,
  removeDie,
  slotOrder,
} from './compose'
import { diceValues, isLegal, legalActions } from './rules'
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
        const a = composeAction(
          s,
          0,
          def.card,
          Array.from({ length: n }, (_, i) => i),
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
          const a = composeAction(s, 0, card, picked)
          if (a === null) return
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

/** dice を順に card へ置いていく。途中で置けなければ null */
function placeAll(s: GameState, card: CardId, dice: number[]): Placement | null {
  let pl: Placement | null = null
  for (const d of dice) {
    pl = placeDie(s, 0, pl, card, d)
    if (pl === null) return null
  }
  return pl
}

/** picked を含む、空きダイスの組み合わせ全て */
function supersets(free: number[], picked: number[]): number[][] {
  const rest = free.filter((i) => !picked.includes(i))
  return rest.reduce<number[][]>((acc, i) => acc.flatMap((xs) => [xs, [...xs, i]]), [picked])
}

describe('ダイスを置く', () => {
  it('合法手は全て、ダイスを一つずつどの順で置いても組み立てられる', () => {
    fc.assert(
      fc.property(rollArb, fc.boolean(), fc.boolean(), (roll, step2, reversed) => {
        const s = makeState({ roll, chant: step2 ? 'charged' : 'none' }, { roll: [1, 2, 3] }, step2 ? 2 : 1)
        for (const a of legalActions(s, 0)) {
          if (a.kind === 'pass') continue
          const card = ACTION_DEFS[a.kind].card
          const order = reversed ? [...a.dice].reverse() : a.dice
          const pl = placeAll(s, card, order)
          expect(pl?.dice).toEqual(order)
          expect(composeAction(s, 0, card, pl?.dice ?? [])?.kind).toBe(a.kind)
        }
      }),
    )
  })
  it('置けたダイスは、足りないダイスを足せば必ず合法な行動になる', () => {
    fc.assert(
      fc.property(
        rollArb,
        fc.constantFrom<CardId>(...CARD_ORDER),
        fc.subarray([0, 1, 2]),
        fc.boolean(),
        (roll, card, order, step2) => {
          const s = makeState({ roll, chant: step2 ? 'charged' : 'none' }, { roll: [1, 2, 3] }, step2 ? 2 : 1)
          const pl = placeAll(s, card, order)
          if (pl === null) return
          const made = supersets([0, 1, 2], pl.dice).some((dice) => composeAction(s, 0, card, dice) !== null)
          expect(made).toBe(true)
        },
      ),
    )
  })
  it('使用済みのダイスや、置いてあるダイスは置けない', () => {
    const s = makeState({ roll: [6, 6, 2], usedDice: [2] }, { roll: [1, 2, 3] }, 2)
    expect(canPlace(s, 0, 'bullet', [], 2)).toBe(false)
    expect(canPlace(s, 0, 'bullet', [0], 0)).toBe(false)
    expect(canPlace(s, 0, 'bullet', [0], 1)).toBe(true)
  })
  it('置き場より多くは置けない', () => {
    const s = makeState({ roll: [6, 6, 2] }, { roll: [1, 2, 3] })
    expect(placeAll(s, 'barrier', [0])).toEqual({ card: 'barrier', dice: [0] })
    expect(placeAll(s, 'barrier', [0, 1])).toBeNull()
    expect(placeAll(s, 'bullet', [0, 1, 2])).toBeNull()
  })
  it('反射には同じ目しか並べられない', () => {
    const s = makeState({ roll: [3, 5, 3] }, { roll: [1, 2, 3] })
    expect(placeAll(s, 'reflect', [0, 2])).toEqual({ card: 'reflect', dice: [0, 2] })
    expect(canPlace(s, 0, 'reflect', [0], 1)).toBe(false)
    // ゾロ目の無い目は、最初の一個から置けない
    expect(canPlace(s, 0, 'reflect', [], 1)).toBe(false)
    expect(composeAction(s, 0, 'reflect', [0, 1])).toBeNull()
    expect(composeAction(s, 0, 'reflect', [0, 2])).toEqual({ kind: 'reflect', dice: [0, 2] })
  })
  it('使えないカードには置けない', () => {
    const s = makeState({ roll: [6, 6, 2], usedCards: ['fireball'] }, { roll: [1, 2, 3] }, 2)
    expect(canPlace(s, 0, 'fireball', [], 0)).toBe(false)
    expect(canPlace(s, 0, 'spear', [], 0)).toBe(false)
  })
  it('別のカードに置くと、前のカードのダイスは手元に戻る', () => {
    const s = makeState({ roll: [6, 4, 2] }, { roll: [1, 2, 3] })
    const fire: Placement = { card: 'fireball', dice: [0, 1] }
    expect(placeDie(s, 0, fire, 'barrier', 1)).toEqual({ card: 'barrier', dice: [1] })
    // 同じカードに置き直しても、ダイスは増えない
    expect(placeDie(s, 0, fire, 'fireball', 0)).toEqual({ card: 'fireball', dice: [1, 0] })
    expect(placeDie(s, 0, fire, 'fireball', 2)).toBeNull()
  })
  it('ダイスを手元に戻す', () => {
    const fire: Placement = { card: 'fireball', dice: [0, 1] }
    expect(removeDie(fire, 0)).toEqual({ card: 'fireball', dice: [1] })
    expect(removeDie(fire, 2)).toEqual(fire)
    expect(removeDie({ card: 'barrier', dice: [2] }, 2)).toBeNull()
    expect(removeDie(null, 0)).toBeNull()
  })
  it('雷槍は一ステップ目は詠唱、二ステップ目は発動の行に置く', () => {
    const s1 = makeState({ roll: [6, 5, 4] }, { roll: [1, 2, 3] }, 1)
    expect(placedKind(s1, 0, { card: 'spear', dice: [0] })).toBe('spearChant')
    const s2 = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(placedKind(s2, 0, { card: 'spear', dice: [0] })).toBe('spearCast')
    expect(placedKind(s2, 0, { card: 'spear', dice: [0, 1] })).toBe('spearCast')
  })
})

describe('カード面', () => {
  it('置き場には高い目から並べ、同じ目は置いた位置の順にする', () => {
    expect(slotOrder([2, 6, 4], [0, 1, 2])).toEqual([1, 2, 0])
    expect(slotOrder([6, 2, 6], [2, 0])).toEqual([0, 2])
  })
  /** 効果の部品を、読み比べやすい一行にする */
  const flat = (parts: ReturnType<typeof effectParts>) =>
    parts.map((p) => [p.icon, p.value, p.text].filter(Boolean).join(':')).join(' ')
  it.each([
    ['fireball', [6, 2], 'damage:6'],
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
