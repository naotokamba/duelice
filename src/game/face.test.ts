// カード面に描く効果の値と、カード面の定義の決まり

import { describe, expect, it } from 'vitest'
import { makeState } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, BARE_ICONS, type EffectIcon, POOL, UNHURT } from './cards'
import { effectParts, faceParts } from './face'
import { kindsNow } from './hand'
import { requiredSlots, slotsOf } from './slots'

describe('カード面', () => {
  /** 効果の部品を、読み比べやすい一行にする */
  const flat = (parts: ReturnType<typeof effectParts>) =>
    parts.map((p) => [p.icon, p.value, p.text].filter(Boolean).join(':')).join(' ')
  it.each([
    // 炎撃は X の枠の目に2を足した威力で、もう一つの枠の目の分だけ自分も焼ける
    ['flameStrike', [6, 2], 'damage:8 burn:2'],
    ['flameStrike', [2, 6], 'damage:4 burn:6'],
    // 風壁は目の倍を減らし、決まった3を返す
    ['barrier', [3], 'guard:6 thorns:3'],
    // 魔弾は目に関係なく4
    ['bullet', [3, 3], 'pierce:4'],
    ['bullet', [6, 6], 'pierce:4'],
    // 詠唱は数を持たない
    ['spearChant', [5], 'chant'],
    ['spearCast', [6, 5], 'pierce:11'],
    // 氷礫は目に関係なく2で、詠唱を崩す印は数を持たない
    ['interrupt', [3], 'damage:2 disrupt'],
    // 隕石は3個の合計
    ['meteor', [6, 5, 4], 'damage:15'],
    // 全開は置いた個数の二乗
    ['allOut', [6, 6], 'damage:4'],
    ['allOut', [1, 2, 3, 4], 'damage:16'],
    // 背水は満タンなら X のまま。失った体力で増えることは数を持たない印で示す
    ['lastStand', [5, 1], 'damage:5 wound'],
    // 凍結と瞑想は、印の置き場の目をそのまま書く
    ['freeze', [4], 'frost:4'],
    ['meditate', [2], 'carry:2'],
    ['darkWall', [3], 'guard:6 refund'],
    ['galeWard', [2, 2], 'reflect'],
    ['thunder', [5, 1], 'damage:5 fast'],
    ['wildfire', [3], 'ignite'],
    ['overload', [3], 'extra:2 burn:2'],
    ['twinDragon', [1, 1, 2, 2], 'damage:20'],
  ] as const)('%s に %j を置いた効果', (kind, vals, want) => {
    expect(flat(effectParts(kind, [...vals]))).toBe(want)
  })
  it('背水は、使う側の体力が減っていれば、置いた目に失った体力4ごとに1を足して書く', () => {
    expect(flat(effectParts('lastStand', [5, 1], { hp: 7, maxHp: 20 }))).toBe('damage:8 wound')
    expect(flat(effectParts('lastStand', [5, 1], UNHURT))).toBe('damage:5 wound')
  })
  it('全開は置く前は1個の値を書き、4個まで置いた値を添える', () => {
    expect(effectParts('allOut')).toEqual([{ icon: 'damage', value: '1', full: '16' }])
  })
  it('目が決まるまでは記号のまま。記号の無い行動は、空けられない置き場だけを埋めた値を出す', () => {
    expect(flat(effectParts('flameStrike'))).toBe('damage:X+2 burn:Y')
    expect(flat(effectParts('bullet'))).toBe('pierce:4')
    expect(flat(effectParts('spearChant'))).toBe('chant')
    expect(flat(effectParts('spearCast'))).toBe('pierce:Y')
    expect(flat(effectParts('barrier'))).toBe('guard:2X thorns:3')
    expect(flat(effectParts('interrupt'))).toBe('damage:2 disrupt')
  })
  /** 点線の枠を持ち、置いた数の倍の威力で、置いた数だけ自分も焼ける仮のカード。今の表には点線の枠を持つ行動が無い */
  const dotted = {
    card: 'interrupt' as const,
    label: '仮',
    dice: [1, 2, 3],
    power: (v: number[]) => 2 * v.length,
    burn: (v: number[]) => v.length,
    face: { extra: '+2', effect: [{ icon: 'damage' as const }, { icon: 'burn' as const }] },
  }
  it('点線の枠にも置くと値が増えるなら、増えた値を添える。点線の枠まで埋めたら添えない', () => {
    const before = [
      { icon: 'damage', value: '2', full: '6' },
      { icon: 'burn', value: '1', full: '3' },
    ]
    expect(faceParts(dotted)).toEqual(before)
    expect(faceParts(dotted, [3])).toEqual(before)
    expect(faceParts(dotted, [3, 1, 2])).toEqual([
      { icon: 'damage', value: '6' },
      { icon: 'burn', value: '3' },
    ])
    // 点線の枠の無い行動には添えない
    expect(effectParts('flameStrike', [6, 1])).toEqual([
      { icon: 'damage', value: '8', text: undefined },
      { icon: 'burn', value: '1', text: undefined },
    ])
    expect(effectParts('bullet', [6, 6])).toEqual([{ icon: 'pierce', value: '4' }])
  })
  it('記号の無い行動は、値を書かない印にだけ値を入れる。文や、値を書いた印や、数を持たない印はそのまま', () => {
    // 点線の枠を持ち、文と、値を書いた印と、数を持たない印も並べた仮のカード
    const def = {
      ...dotted,
      face: {
        effect: [
          { text: '追加' },
          { icon: 'pierce' as const },
          { icon: 'guard' as const, value: '1' },
          { icon: 'chant' as const },
        ],
      },
    }
    expect(faceParts(def, [4])).toEqual([
      { text: '追加' },
      { icon: 'pierce', value: '2', full: '6' },
      { icon: 'guard', value: '1' },
      { icon: 'chant' },
    ])
  })
  it('自分は焼けない行動の焼ける印には、効果の値を入れる', () => {
    const { burn: _, ...rest } = dotted
    const def = { ...rest, face: { effect: [{ icon: 'burn' as const }] } }
    expect(faceParts(def, [4, 4])).toEqual([{ icon: 'burn', value: '4', full: '6' }])
  })
  it('記号も、威力も、減らす量も無い行動は、カード面をそのまま描く', () => {
    // 記号の置き場を持たず、効果に値を書かない仮のカード
    const def = {
      label: '仮',
      card: 'interrupt' as const,
      dice: [1],
      face: { effect: [{ icon: 'burn' as const }, { text: '仮' }] },
    }
    expect(faceParts(def, [3])).toEqual([{ icon: 'burn' }, { text: '仮' }])
    expect(faceParts(def)).toEqual([{ icon: 'burn' }, { text: '仮' }])
  })
  it('記号を使う行動でも、文や値の無い印はそのまま残す', () => {
    // X の枠と自分も焼ける Y の枠を持ち、記号を含まない値の印、値の無い印、文も並べた仮のカード
    const def = {
      ...ACTION_DEFS.flameStrike,
      power: (v: number[]) => v[0],
      face: {
        mark: 'X',
        cost: 'Y',
        effect: [
          { icon: 'damage' as const, value: 'X' },
          { icon: 'burn' as const, value: 'Y' },
          { icon: 'guard' as const, value: '1' },
          { icon: 'guard' as const },
          { text: 'X点' },
        ],
      },
    }
    expect(faceParts(def, [5, 1])).toEqual([
      { icon: 'damage', value: '5', text: undefined },
      { icon: 'burn', value: '1', text: undefined },
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
        const more = (def.power?.(Array(n + 1).fill(1), UNHURT) ?? 0) - (def.power?.(Array(n).fill(1), UNHURT) ?? 0)
        expect(`+${more}`, kind).toBe(def.face.extra)
      }
    }
  })
  it('1枚のカードが1つのステップに使える行動は1つ。カード面の1行が1ステップぶんになる', () => {
    for (const card of POOL) {
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
      expect(icons.has('thorns'), kind).toBe(!!def.thorns)
      expect(icons.has('burn'), kind).toBe(!!def.burn || !!def.endBurn)
      expect(icons.has('chant'), kind).toBe(!!def.chant)
      expect(icons.has('disrupt'), kind).toBe(!!def.disrupts)
      // 失った体力で威力が変わる行動だけが、そのことを示す印を持つ
      const vals = Array<number>(slotsOf(def)).fill(3)
      const wounded = !!def.power && def.power(vals, UNHURT) !== def.power(vals, { hp: 1, maxHp: 20 })
      expect(icons.has('wound'), kind).toBe(wounded)
      expect(icons.has('frost'), kind).toBe(!!def.freezes)
      expect(icons.has('refund'), kind).toBe(!!def.refund)
      expect(icons.has('reflect'), kind).toBe(!!def.reflects)
      expect(icons.has('fast'), kind).toBe(!!def.fast)
      expect(icons.has('ignite'), kind).toBe(!!def.ignite)
      expect(icons.has('extra'), kind).toBe(!!def.extraDice)
      expect(icons.has('carry'), kind).toBe(!!def.carries)
    }
  })
  it('決まった数を書く印は、その数と揃う', () => {
    const written = (kind: (typeof ACTION_KINDS)[number], icon: EffectIcon) =>
      ACTION_DEFS[kind].face.effect.find((p) => p.icon === icon)?.value
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      if (def.extraDice) expect(written(kind, 'extra'), kind).toBe(String(def.extraDice))
      // ターンの終わりに焼ける行動の炎は、焼ける量を書く
      if (def.endBurn) expect(written(kind, 'burn'), kind).toBe(String(def.endBurn))
    }
  })
  it('数を持たない印は、記号の無い攻撃のカード面に並べても、置いた個数から値を入れない', () => {
    expect(BARE_ICONS).toEqual(['chant', 'disrupt', 'wound', 'refund', 'reflect', 'fast', 'ignite'])
    // 記号を持たず、置いた個数で威力が決まる仮のカード
    const def = { ...ACTION_DEFS.allOut, face: { effect: BARE_ICONS.map((icon) => ({ icon })) } }
    expect(faceParts(def, [1, 1])).toEqual(BARE_ICONS.map((icon) => ({ icon })))
  })
  it('数を持たない印には数を書かない', () => {
    for (const kind of ACTION_KINDS) {
      for (const p of ACTION_DEFS[kind].face.effect) {
        if (p.icon && BARE_ICONS.includes(p.icon)) expect(p.value, kind).toBeUndefined()
      }
    }
  })
  it('置き場ごとの記号は二組のゾロ目を置く行動だけが書き、二つの記号を二つずつ並べる', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      expect(def.face.labels !== undefined, kind).toBe(!!def.twoPairs)
      const { labels } = def.face
      if (!labels) continue
      expect(labels).toHaveLength(slotsOf(def))
      const counts = [...new Set(labels)].map((l) => labels.filter((x) => x === l).length)
      expect(counts).toEqual([2, 2])
    }
  })
  it('置き場の記号は、どの行動でも効果に現れる', () => {
    for (const kind of ACTION_KINDS) {
      const { face } = ACTION_DEFS[kind]
      const written = face.effect.map((p) => `${p.value ?? ''}${p.text ?? ''}`).join(' ')
      for (const sym of [face.mark, face.sum, face.cost]) if (sym) expect(written).toContain(sym)
    }
  })
})
