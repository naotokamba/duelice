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
    // 背水は目に関係なく、満タンなら2。失った体力で増えることは数を持たない印で示す
    ['lastStand', [5, 1], 'damage:2 wound'],
    // 凍結は相手の手元の同じ目1個につき2を当て、印の置き場の目を凍らせる。瞑想は印の置き場の目をそのまま書く
    ['freeze', [4], 'shards:2 frost:4'],
    ['meditate', [2], 'carry:2'],
    ['darkWall', [3], 'guard:6 refund'],
    // 風陣は、返す攻撃が来なかったら置いた目の合計を自分が受ける
    ['galeWard', [2, 5], 'reflect miss:7'],
    ['thunder', [5, 1], 'damage:5 fast'],
    // 延焼は倍率を書く
    ['wildfire', [3], 'ignite:2'],
    // 過負荷は、足すダイス1個ずつに置いた目を書く
    ['overload', [3], 'extra:3 extra:3 endBurn:2'],
    ['twinDragon', [1, 1, 2, 2], 'damage:20'],
    // 錬成と二重詠唱は決まった数を書き、残響は数を持たない
    ['transmute', [4], 'forge:3'],
    ['doubleCast', [4], 'multi:2 back'],
    ['echo', [4], 'repeat'],
    // 反撃は打ち消せる上限と返す量を書き、打ち消す攻撃が来なかったときに受ける量は置いた目
    ['counter', [3], 'cancel:6 riposte:4 whiff:3'],
  ] as const)('%s に %j を置いた効果', (kind, vals, want) => {
    expect(flat(effectParts(kind, [...vals]))).toBe(want)
  })
  it('背水は、置く前は増える基の2+を書き、置いたら使う側の失った体力の半分を2に足して書く', () => {
    expect(flat(effectParts('lastStand'))).toBe('damage:2+ wound')
    expect(flat(effectParts('lastStand', undefined, { hp: 7, maxHp: 20 }))).toBe('damage:2+ wound')
    expect(flat(effectParts('lastStand', [5, 1], { hp: 7, maxHp: 20 }))).toBe('damage:8 wound')
    expect(flat(effectParts('lastStand', [5, 1], UNHURT))).toBe('damage:2 wound')
  })
  it('同じ記号を書いた印でも、印ごとに値を決める。外したときの印は外したときに受ける量、持ち越す印は印の置き場の目、ほかは効果の値', () => {
    // 合計の記号を威力にも外したときに受ける量にも書き、持ち越しもする仮のカード
    const def = {
      ...ACTION_DEFS.galeWard,
      power: (v: number[]) => v[0] + v[1],
      missBurn: () => 1,
      carries: true,
      face: {
        ...ACTION_DEFS.galeWard.face,
        effect: [
          { icon: 'damage' as const, value: 'Y' },
          { icon: 'miss' as const, value: 'Y' },
          { icon: 'carry' as const, value: 'Y' },
        ],
      },
    }
    expect(faceParts(def, [5, 2])).toEqual([
      { icon: 'damage', value: '7', text: undefined },
      { icon: 'miss', value: '1', text: undefined },
      { icon: 'carry', value: '5', text: undefined },
    ])
    // 外したときに受ける量を持たない行動の外したときの印には、効果の値を入れる
    const { missBurn: _, ...bare } = def
    expect(faceParts(bare, [5, 2])[1]).toEqual({ icon: 'miss', value: '7', text: undefined })
  })
  it('目が決まるまでは記号のまま書き、置いたら印ごとの値にする', () => {
    expect(flat(effectParts('freeze'))).toBe('shards:2 frost:X')
    expect(flat(effectParts('galeWard'))).toBe('reflect miss:Y')
    expect(flat(effectParts('meditate', [5]))).toBe('carry:5')
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
  it('どの行動のカード面にも、印が一つはある。公開の舞台は最初の印で行動を描く', () => {
    for (const kind of ACTION_KINDS)
      expect(
        ACTION_DEFS[kind].face.effect.some((p) => p.icon),
        kind,
      ).toBe(true)
  })
  it('効果の印は行動の性質と食い違わない', () => {
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      const icons = new Set(def.face.effect.map((p) => p.icon).filter(Boolean))
      // 攻撃は、貫通するかどうかで星の印を使い分ける。相手の手元の目で威力が決まる攻撃は、ダイスを添えた星にする
      const vals0 = Array<number>(slotsOf(def)).fill(3)
      const matched =
        !!def.power &&
        def.power(vals0, { hp: 20, maxHp: 20, foe: [] }) !== def.power(vals0, { hp: 20, maxHp: 20, foe: [3, 3] })
      expect(icons.has('shards'), kind).toBe(matched)
      expect(icons.has('damage'), kind).toBe(!!def.power && !def.piercing && !matched)
      expect(icons.has('pierce'), kind).toBe(!!def.power && !!def.piercing)
      expect(icons.has('guard'), kind).toBe(!!def.guard)
      expect(icons.has('thorns'), kind).toBe(!!def.thorns)
      // 使った時に焼けるか、ターンの終わりに焼けるかで、炎の印を使い分ける
      expect(icons.has('burn'), kind).toBe(!!def.burn)
      expect(icons.has('endBurn'), kind).toBe(!!def.endBurn)
      expect(icons.has('chant'), kind).toBe(!!def.chant)
      expect(icons.has('disrupt'), kind).toBe(!!def.disrupts)
      // 失った体力で威力が変わる行動だけが、そのことを示す印を持つ
      const vals = Array<number>(slotsOf(def)).fill(3)
      const wounded = !!def.power && def.power(vals, UNHURT) !== def.power(vals, { hp: 1, maxHp: 20 })
      expect(icons.has('wound'), kind).toBe(wounded)
      expect(icons.has('frost'), kind).toBe(!!def.freezes)
      expect(icons.has('refund'), kind).toBe(!!def.refund)
      expect(icons.has('reflect'), kind).toBe(!!def.reflects)
      expect(icons.has('miss') || icons.has('whiff'), kind).toBe(!!def.missBurn)
      expect(icons.has('whiff'), kind).toBe(def.cancels !== undefined)
      expect(icons.has('cancel'), kind).toBe(def.cancels !== undefined)
      expect(icons.has('riposte'), kind).toBe(!!def.riposte)
      expect(icons.has('back'), kind).toBe(!!def.returnsDice)
      expect(icons.has('fast'), kind).toBe(!!def.fast)
      expect(icons.has('ignite'), kind).toBe(!!def.ignite)
      expect(icons.has('extra'), kind).toBe(!!def.copies)
      expect(icons.has('carry'), kind).toBe(!!def.carries)
    }
  })
  it('決まった数を書く印は、その数と揃う', () => {
    const written = (kind: (typeof ACTION_KINDS)[number], icon: EffectIcon) =>
      ACTION_DEFS[kind].face.effect.find((p) => p.icon === icon)?.value
    for (const kind of ACTION_KINDS) {
      const def = ACTION_DEFS[kind]
      // ダイスを足す行動は、足すダイスの数だけ足す印を並べ、どれにも印の置き場の記号を書く
      if (def.copies) {
        const extras = def.face.effect.filter((p) => p.icon === 'extra')
        expect(
          extras.map((p) => p.value),
          kind,
        ).toEqual(Array(def.copies).fill(def.face.mark))
      }
      // 打ち消す構えは、打ち消せる上限と、打ち消したら返す量を書く
      if (def.cancels !== undefined) expect(written(kind, 'cancel'), kind).toBe(String(def.cancels))
      if (def.riposte) expect(written(kind, 'riposte'), kind).toBe(String(def.riposte))
      // ターンの終わりに焼ける行動の炎は、焼ける量を書く
      if (def.endBurn) expect(written(kind, 'endBurn'), kind).toBe(String(def.endBurn))
      // 焼けた分を与える行動は、倍率を書く
      if (def.ignite) expect(written(kind, 'ignite'), kind).toBe(String(def.ignite))
    }
  })
  it('数を持たない印は、記号の無い攻撃のカード面に並べても、置いた個数から値を入れない', () => {
    expect(BARE_ICONS).toEqual(['chant', 'disrupt', 'wound', 'refund', 'reflect', 'fast', 'repeat', 'back'])
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
  it('置き場の記号は、どの行動でも効果に現れる', () => {
    for (const kind of ACTION_KINDS) {
      const { face } = ACTION_DEFS[kind]
      const written = face.effect.map((p) => `${p.value ?? ''}${p.text ?? ''}`).join(' ')
      for (const sym of [face.mark, face.sum, face.cost]) if (sym) expect(written).toContain(sym)
    }
  })
})
