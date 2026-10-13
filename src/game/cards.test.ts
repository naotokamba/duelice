// カードの仕様表。カードの効果を、ぶつかり方ごとの期待ダメージとして書き並べる。
// カードを足したら、ここに行を足す。行の無い行動があるとメタテストが落ちる。

import { describe, expect, it } from 'vitest'
import { actionOf } from '../test/helpers'
import type { ActionKind, CardId } from './cards'
import { ACTION_DEFS, ACTION_KINDS, CARD_DEFS, CARD_ORDER, effectValue, GUARD_LABEL, kindsOfCard } from './cards'
import { stepDamage } from './rules'

type Side = { kind: ActionKind | 'pass'; vals: number[] }
interface Case {
  name: string
  a: Side
  b: Side
  /** [a が受けるダメージ, b が受けるダメージ] */
  expect: [number, number]
}

const s = (kind: ActionKind | 'pass', ...vals: number[]): Side => ({ kind, vals })

const SPEC: Case[] = [
  // 血弾
  // 目はダイスを置いた置き場の順に並べ、空けた置き場は飛ばす。血弾は X の枠、つまり最初の置き場の目に2を足した威力で、
  // もう一つの置き場の目の分だけ、自分が血を払う
  {
    name: '血弾は X の枠の目に2を足して当て、もう1個の目の血を払う',
    a: s('bloodBullet', 6, 2),
    b: s('pass'),
    expect: [2, 8],
  },
  {
    name: '血弾は X の枠に小さい目を置けば、威力も小さく血は重い',
    a: s('bloodBullet', 2, 6),
    b: s('pass'),
    expect: [6, 4],
  },
  {
    name: '血弾は炎壁の目の倍だけ減り、3を返される',
    a: s('bloodBullet', 5, 1),
    b: s('barrier', 2),
    expect: [4, 3],
  },
  {
    name: '血弾は炎壁に防ぎきられても、3を返される',
    a: s('bloodBullet', 1, 6),
    b: s('barrier', 6),
    expect: [9, 0],
  },
  { name: '血弾どうしは相打ち', a: s('bloodBullet', 6, 1), b: s('bloodBullet', 3, 2), expect: [6, 10] },
  { name: '血弾は詠唱中の相手に当たる', a: s('bloodBullet', 5, 3), b: s('spearChant', 6), expect: [3, 7] },
  // 炎壁
  { name: '炎壁だけでは何も起きない', a: s('barrier', 6), b: s('pass'), expect: [0, 0] },
  { name: '炎壁どうしでは何も起きない', a: s('barrier', 6), b: s('barrier', 1), expect: [0, 0] },
  { name: '炎壁は詠唱には何も返さない', a: s('barrier', 3), b: s('spearChant', 2), expect: [0, 0] },
  // 魔弾
  // 同じ目を2個置き、目に関係なく、障壁で減らない4の威力
  { name: '魔弾はゾロ目で4', a: s('bullet', 6, 6), b: s('pass'), expect: [0, 4] },
  { name: '1のゾロ目の魔弾も4', a: s('bullet', 1, 1), b: s('pass'), expect: [0, 4] },
  { name: '魔弾は炎壁をすり抜け、返されない', a: s('bullet', 2, 2), b: s('barrier', 6), expect: [0, 4] },
  { name: '魔弾と血弾は相打ち', a: s('bullet', 3, 3), b: s('bloodBullet', 6, 1), expect: [8, 5] },
  // 雷槍
  { name: '雷槍の発動は2個の合計', a: s('spearCast', 6, 5), b: s('pass'), expect: [0, 11] },
  { name: '雷槍の発動は炎壁をすり抜け、返されない', a: s('spearCast', 6, 5), b: s('barrier', 3), expect: [0, 11] },
  { name: '雷槍の詠唱そのものはダメージを出さない', a: s('spearChant', 6), b: s('pass'), expect: [0, 0] },
  // 妨害
  { name: '妨害は目に関係なく2', a: s('interrupt', 6), b: s('pass'), expect: [0, 2] },
  { name: '1の妨害も2', a: s('interrupt', 1), b: s('pass'), expect: [0, 2] },
  { name: '妨害は1の炎壁でも防がれ、3を返される', a: s('interrupt', 4), b: s('barrier', 1), expect: [3, 0] },
  { name: '妨害は詠唱中の相手に2点', a: s('interrupt', 3), b: s('spearChant', 5), expect: [0, 2] },
  { name: '妨害と魔弾は相打ち', a: s('interrupt', 2), b: s('bullet', 4, 4), expect: [4, 2] },
]

function run(c: Case): [number, number] {
  return stepDamage([c.a.vals, c.b.vals], [actionOf(c.a.kind, c.a.vals.length), actionOf(c.b.kind, c.b.vals.length)])
}

describe('カードの仕様表', () => {
  for (const c of SPEC) {
    it(c.name, () => {
      expect(run(c)).toEqual(c.expect)
    })
    it(`${c.name}。席を入れ替えても同じ`, () => {
      const swapped = run({ ...c, a: c.b, b: c.a, expect: [c.expect[1], c.expect[0]] })
      expect(swapped).toEqual([c.expect[1], c.expect[0]])
    })
  }
})

describe('定義表の整合性', () => {
  it('カードは画面にこの順で並ぶ', () => {
    expect(CARD_ORDER.map((c) => CARD_DEFS[c].name)).toEqual(['血弾', '炎壁', '魔弾', '雷槍', '妨害'])
  })
  it('障壁で減らない攻撃の説明には、受けるダメージを減らす行動の名前を使う', () => {
    expect(GUARD_LABEL).toBe('炎壁')
  })
  it('効果の値は、攻撃なら威力、守りなら減らす量で、どちらでもない詠唱は 0', () => {
    expect(effectValue(ACTION_DEFS.bloodBullet, [4, 1])).toBe(6)
    expect(effectValue(ACTION_DEFS.barrier, [3])).toBe(6)
    expect(effectValue(ACTION_DEFS.spearChant, [5])).toBe(0)
  })
  it('攻撃する行動は、何もしない相手と、受けるダメージを減らす相手とぶつかる行が仕様表にある', () => {
    const missing: string[] = []
    for (const k of ACTION_KINDS.filter((k) => ACTION_DEFS[k].power)) {
      const against = SPEC.flatMap((c) => (c.a.kind === k ? [c.b.kind] : c.b.kind === k ? [c.a.kind] : []))
      const has = (ok: (o: ActionKind) => boolean) => against.some((o) => o !== 'pass' && ok(o))
      if (!against.includes('pass')) missing.push(`${k} と何もしない相手`)
      if (!has((o) => !!ACTION_DEFS[o].guard)) missing.push(`${k} と受けるダメージを減らす相手`)
    }
    expect(missing).toEqual([])
  })
  it('全ての行動が仕様表に一度は登場する', () => {
    const covered = new Set(SPEC.flatMap((c) => [c.a.kind, c.b.kind]))
    const missing = ACTION_KINDS.filter((k) => !covered.has(k))
    expect(missing, `仕様表に行が無い行動: ${missing.join(', ')}`).toEqual([])
  })
  it('全てのカードが画面の並び順に一度だけ含まれる', () => {
    const ids = Object.keys(CARD_DEFS) as CardId[]
    expect([...CARD_ORDER].sort()).toEqual([...ids].sort())
  })
  it('全てのカードに行動があり、名前とカード面の効果がある', () => {
    for (const id of Object.keys(CARD_DEFS) as CardId[]) {
      expect(kindsOfCard(id).length, id).toBeGreaterThan(0)
      expect(CARD_DEFS[id].name, id).toMatch(/\S/)
      for (const k of kindsOfCard(id)) {
        expect(ACTION_DEFS[k].label, k).toMatch(/\S/)
        expect(ACTION_DEFS[k].face.effect.length, k).toBeGreaterThan(0)
      }
    }
  })
  it('行動の定義は矛盾しない', () => {
    for (const k of ACTION_KINDS) {
      const d = ACTION_DEFS[k]
      expect(d.dice.length, k).toBeGreaterThan(0)
      expect(
        d.dice.every((n) => Number.isInteger(n) && n > 0),
        k,
      ).toBe(true)
      // 攻撃でない行動は、公開時の文が必要
      if (!d.power) expect(d.done ?? d.label, k).toBeTruthy()
      // 血を払う行動は攻撃で、払う血は効果の値と別に決まる
      if (d.blood) expect(d.power, k).toBeDefined()
      // 攻撃を返すのは守る行動で、カード面の炎の数は返すダメージと揃える
      if (d.thorns) {
        expect(d.guard, k).toBeDefined()
        expect(d.face.effect.find((p) => p.icon === 'thorns')?.value, k).toBe(String(d.thorns))
      }
      // 詠唱はステップ1だけなので、詠唱を崩す行動はステップ1にも使える
      if (d.disrupts) expect(d.step, k).not.toBe(2)
      // 詠唱の発動は、同じカードに詠唱が無いと使えない
      if (d.needsCharge)
        expect(
          kindsOfCard(d.card).some((x) => ACTION_DEFS[x].chant),
          k,
        ).toBe(true)
    }
  })
})
