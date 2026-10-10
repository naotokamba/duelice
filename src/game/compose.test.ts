// 画面の操作から行動を組み立てる処理のテスト

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeState, rollArb } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, CARD_ORDER } from './cards'
import { availableCards, composeAction, kindsNow, maxDice, previewText } from './compose'
import { diceValues, isLegal, legalActions } from './rules'
import type { CardId } from './types'

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
    expect(maxDice(s1, 0, 'spear')).toBe(1)
    const charged = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(kindsNow(charged, 0, 'spear')).toEqual(['spearCast'])
    expect(maxDice(charged, 0, 'spear')).toBe(2)
    const broken = makeState({ roll: [6, 5, 4], chant: 'broken' }, { roll: [1, 2, 3] }, 2)
    expect(kindsNow(broken, 0, 'spear')).toEqual([])
    expect(maxDice(broken, 0, 'spear')).toBe(0)
  })
})

describe('説明文', () => {
  const s = makeState({ roll: [6, 2, 2] }, { roll: [1, 2, 3] })
  it.each([
    ['fireball', [0, 1], '火球：6と2、6点'],
    ['bullet', [1], '魔弾：2、2点、防御をすり抜ける'],
    ['barrier', [0], '障壁：6、受ける攻撃を6減らす'],
    ['spear', [0], '雷槍の詠唱：6。6以上のダメージを受けると崩れる'],
    ['reflect', [1, 2], '反射：2と2、受ける攻撃を返す'],
    ['bullet', [], '魔弾：ダイスを1個か2個選んでください'],
    ['fireball', [0], '火球：ダイスを2個選んでください'],
    ['reflect', [0, 1], '反射：同じ目を2個選んでください'],
    ['reflect', [], '反射：ダイスを2個選んでください'],
  ] as const)('%s に %j を置く', (card, picked, text) => {
    expect(previewText(s, 0, card, [...picked])).toBe(text)
  })
  it('雷槍の発動は合計を示す', () => {
    const c = makeState({ roll: [6, 5, 4], chant: 'charged' }, { roll: [1, 2, 3] }, 2)
    expect(previewText(c, 0, 'spear', [0, 1])).toBe('雷槍の発動：6と5、11点')
  })
  it('どのカードとダイスの組でも説明文が空にならない', () => {
    fc.assert(
      fc.property(rollArb, fc.constantFrom<CardId>(...CARD_ORDER), fc.subarray([0, 1, 2]), (roll, card, picked) => {
        const st = makeState({ roll }, { roll: [1, 2, 3] })
        if (kindsNow(st, 0, card).length === 0) return
        expect(previewText(st, 0, card, picked).length).toBeGreaterThan(0)
      }),
    )
  })
})
