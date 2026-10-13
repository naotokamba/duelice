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
    ['fireball', [6, 2], 'damage:6'],
    ['fireball', [2, 6], 'damage:2'],
    // 記号を含む式は、式ごと値になる。障壁の 2X は、X が 3 なら 6
    ['barrier', [3], 'guard:6'],
    ['spearChant', [5], 'chant:5'],
    ['spearCast', [6, 5], 'pierce:11'],
    // 反撃は、打ち消せる上限と返す量はそのまま、外れたときに受ける 2X だけが値になる
    ['counter', [3], 'bounce:5 damage:4 backfire:6'],
    ['bullet', [3], 'pierce:2'],
    ['bullet', [3, 1], 'pierce:3'],
  ] as const)('%s に %j を置いた効果', (kind, vals, want) => {
    expect(flat(effectParts(kind, [...vals]))).toBe(want)
  })
  it('目が決まるまでは記号のまま。記号の無い行動は、空けられない置き場だけを埋めた値を出す', () => {
    expect(flat(effectParts('fireball'))).toBe('damage:X')
    expect(flat(effectParts('spearChant'))).toBe('chant:X')
    expect(flat(effectParts('spearCast'))).toBe('pierce:Y')
    expect(flat(effectParts('barrier'))).toBe('guard:2X')
    expect(flat(effectParts('bullet'))).toBe('pierce:2')
    expect(flat(effectParts('counter'))).toBe('bounce:5 damage:4 backfire:2X')
  })
  it('点線の枠にも置くと値が増えるなら、増えた値を添える。点線の枠まで埋めたら添えない', () => {
    expect(effectParts('bullet')).toEqual([{ icon: 'pierce', value: '2', full: '3' }])
    expect(effectParts('bullet', [3])).toEqual([{ icon: 'pierce', value: '2', full: '3' }])
    expect(effectParts('bullet', [3, 1])).toEqual([{ icon: 'pierce', value: '3' }])
    // 点線の枠の無い行動には添えない
    expect(effectParts('fireball', [6, 2])).toEqual([{ icon: 'damage', value: '6' }])
  })
  it('記号の無い行動は、値を書かない印にだけ値を入れる。文や、値を書いた印はそのまま', () => {
    // 点線の枠を持ち、文と、値を書いた印も並べた仮のカード
    const def = {
      ...ACTION_DEFS.bullet,
      face: { effect: [{ text: '追加' }, { icon: 'pierce' as const }, { icon: 'guard' as const, value: '1' }] },
    }
    expect(faceParts(def, [4])).toEqual([
      { text: '追加' },
      { icon: 'pierce', value: '2', full: '3' },
      { icon: 'guard', value: '1' },
    ])
  })
  it('記号も、威力も、減らす量も無い行動は、カード面をそのまま描く', () => {
    // 記号の置き場を持たず、効果に値を書かない仮のカード
    const def = { ...ACTION_DEFS.counter, face: { effect: [{ icon: 'bounce' as const }, { text: '仮' }] } }
    expect(faceParts(def, [3])).toEqual([{ icon: 'bounce' }, { text: '仮' }])
    expect(faceParts(def)).toEqual([{ icon: 'bounce' }, { text: '仮' }])
  })
  it('記号を使う行動でも、文や値の無い印はそのまま残す', () => {
    // X の枠を持ち、値の無い印と文も並べた仮のカード
    const def = {
      ...ACTION_DEFS.fireball,
      face: {
        mark: 'X',
        effect: [{ icon: 'damage' as const, value: 'X' }, { icon: 'bounce' as const }, { text: 'X点' }],
      },
    }
    expect(faceParts(def, [5, 1])).toEqual([
      { icon: 'damage', value: '5', text: undefined },
      { icon: 'bounce', value: undefined, text: undefined },
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
  it('効果の印は行動の性質と食い違わない', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      const icons = new Set(def.face.effect.map((p) => p.icon).filter(Boolean))
      // 攻撃は、貫通するかどうかで星の印を使い分ける。反撃は返す量を、ダメージの星で描く
      expect(icons.has('damage'), kind).toBe((!!def.power && !def.piercing) || !!def.counter)
      expect(icons.has('pierce'), kind).toBe(!!def.power && !!def.piercing)
      expect(icons.has('guard'), kind).toBe(!!def.guard)
      expect(icons.has('bounce'), kind).toBe(!!def.counter)
      expect(icons.has('backfire'), kind).toBe(!!def.counter)
      expect(icons.has('chant'), kind).toBe(!!def.chant)
    }
  })
  it('反撃のカード面は、打ち消せる上限、返す量、外れたときに受ける量を、定義と同じ値で描く', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      if (!def.counter) continue
      const value = (icon: string) => def.face.effect.find((p) => p.icon === icon)?.value
      expect(value('bounce'), kind).toBe(String(def.counter.upTo))
      expect(value('damage'), kind).toBe(String(def.counter.back))
      // 外れたときに受ける量は X の枠の目で決まる。どの目でも、カード面の値が定義と揃う
      for (const x of [1, 2, 3, 4, 5, 6]) {
        const parts = effectParts(kind, [x])
        expect(parts.find((p) => p.icon === 'backfire')?.value, `${kind} ${x}`).toBe(String(def.counter.miss([x])))
      }
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
