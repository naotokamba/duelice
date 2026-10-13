// カード面に描く効果の値と、カード面の定義の決まり

import { describe, expect, it } from 'vitest'
import { makeState } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, CARD_ORDER } from './cards'
import { effectParts, faceParts } from './face'
import { kindsNow } from './hand'
import { requiredSlots, slotsOf } from './slots'

describe('カード面', () => {
  /** 効果の部品を、読み比べやすい一行にする */
  const flat = (parts: ReturnType<typeof effectParts>) =>
    parts.map((p) => [p.icon, p.value, p.text].filter(Boolean).join(':')).join(' ')
  it.each([
    // 火球は X の枠の目が威力になる。もう一つの枠は払うだけ
    ['fireball', [6, 2], 'damage:6'],
    ['fireball', [2, 6], 'damage:2'],
    ['barrier', [3], 'guard:3'],
    // 魔弾は目に関係なく4
    ['bullet', [3, 3], 'pierce:4'],
    ['bullet', [6, 6], 'pierce:4'],
    ['spearChant', [5], 'chant:5'],
    ['spearCast', [6, 5], 'pierce:11'],
    // 過負荷は置いた数で決まる。威力は数の倍、払う血は数
    ['overload', [3], 'damage:2 blood:1'],
    ['overload', [3, 1], 'damage:4 blood:2'],
    ['overload', [3, 1, 6], 'damage:6 blood:3'],
  ] as const)('%s に %j を置いた効果', (kind, vals, want) => {
    expect(flat(effectParts(kind, [...vals]))).toBe(want)
  })
  it('目が決まるまでは記号のまま。記号の無い行動は、空けられない置き場だけを埋めた値を出す', () => {
    expect(flat(effectParts('fireball'))).toBe('damage:X')
    expect(flat(effectParts('bullet'))).toBe('pierce:4')
    expect(flat(effectParts('spearChant'))).toBe('chant:X')
    expect(flat(effectParts('spearCast'))).toBe('pierce:Y')
    expect(flat(effectParts('barrier'))).toBe('guard:X')
    expect(flat(effectParts('overload'))).toBe('damage:2 blood:1')
  })
  it('点線の枠にも置くと値が増えるなら、増えた値を添える。点線の枠まで埋めたら添えない', () => {
    const before = [
      { icon: 'damage', value: '2', full: '6' },
      { icon: 'blood', value: '1', full: '3' },
    ]
    expect(effectParts('overload')).toEqual(before)
    expect(effectParts('overload', [3])).toEqual(before)
    expect(effectParts('overload', [3, 1, 2])).toEqual([
      { icon: 'damage', value: '6' },
      { icon: 'blood', value: '3' },
    ])
    // 点線の枠の無い行動には添えない
    expect(effectParts('fireball', [6, 1])).toEqual([{ icon: 'damage', value: '6', text: undefined }])
    expect(effectParts('bullet', [6, 6])).toEqual([{ icon: 'pierce', value: '4' }])
  })
  it('記号の無い行動は、値を書かない印にだけ値を入れる。文や、値を書いた印はそのまま', () => {
    // 点線の枠を持ち、文と、値を書いた印も並べた仮のカード
    const def = {
      ...ACTION_DEFS.overload,
      face: { effect: [{ text: '追加' }, { icon: 'pierce' as const }, { icon: 'guard' as const, value: '1' }] },
    }
    expect(faceParts(def, [4])).toEqual([
      { text: '追加' },
      { icon: 'pierce', value: '2', full: '6' },
      { icon: 'guard', value: '1' },
    ])
  })
  it('血を払わない行動の血の印には、効果の値を入れる', () => {
    // 血の性質を持たない、仮の過負荷
    const { blood: _, ...rest } = ACTION_DEFS.overload
    const def = { ...rest, face: { effect: [{ icon: 'blood' as const }] } }
    expect(faceParts(def, [4, 4])).toEqual([{ icon: 'blood', value: '4', full: '6' }])
  })
  it('記号も、威力も、減らす量も無い行動は、カード面をそのまま描く', () => {
    // 記号の置き場を持たず、効果に値を書かない仮のカード
    const def = {
      label: '仮',
      card: 'overload' as const,
      dice: [1],
      face: { effect: [{ icon: 'blood' as const }, { text: '仮' }] },
    }
    expect(faceParts(def, [3])).toEqual([{ icon: 'blood' }, { text: '仮' }])
    expect(faceParts(def)).toEqual([{ icon: 'blood' }, { text: '仮' }])
  })
  it('記号を使う行動でも、文や値の無い印はそのまま残す', () => {
    // X の枠を持ち、記号を含まない値の印、値の無い印、文も並べた仮のカード
    const def = {
      ...ACTION_DEFS.fireball,
      face: {
        mark: 'X',
        effect: [
          { icon: 'damage' as const, value: 'X' },
          { icon: 'guard' as const, value: '1' },
          { icon: 'guard' as const },
          { text: 'X点' },
        ],
      },
    }
    expect(faceParts(def, [5, 1])).toEqual([
      { icon: 'damage', value: '5', text: undefined },
      { icon: 'guard', value: '1', text: undefined },
      { icon: 'guard', value: undefined, text: undefined },
      { value: undefined, text: '5点' },
    ])
  })
  it('点線の枠に書く記号は、そこに置くと増える量と揃う', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      const optional = slotsOf(def) - requiredSlots(def)
      if (def.face.extra === undefined) continue
      // 点線の枠があるときだけ記号を書く
      expect(optional, kind).toBeGreaterThan(0)
      for (let n = requiredSlots(def); n < slotsOf(def); n++) {
        const more = (def.power?.(Array(n + 1).fill(1)) ?? 0) - (def.power?.(Array(n).fill(1)) ?? 0)
        expect(`+${more}`, kind).toBe(def.face.extra)
      }
    }
  })
  it('1枚のカードが1つのステップに使える行動は1つ。カード面の1行が1ステップぶんになる', () => {
    for (const card of CARD_ORDER) {
      for (const step of [1, 2] as const) {
        const s = makeState({ roll: [6, 6, 6], chant: 'charged' }, { roll: [1, 2, 3] }, step)
        expect(kindsNow(s, 0, card).length).toBeLessThanOrEqual(1)
      }
    }
  })
  it('合計を名付ける行動は、置き場を + でつなぐ', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      if (def.face.sum) expect(def.face.join).toBe('+')
    }
  })
  it('同じ目を揃える行動だけが、置き場を = でつなぐ', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      expect(def.face.join === '=', kind).toBe(!!def.sameValues)
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
      expect(icons.has('blood'), kind).toBe(!!def.blood)
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
