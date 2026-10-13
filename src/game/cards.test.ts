// カードの仕様表。カードの効果を、ぶつかり方ごとの期待ダメージとして書き並べる。
// カードを足したら、ここに行を足す。行の無い行動があるとメタテストが落ちる。

import { describe, expect, it } from 'vitest'
import { actionOf } from '../test/helpers'
import type { ActionKind, CardId } from './cards'
import { ACTION_DEFS, ACTION_KINDS, CARD_DEFS, CARD_ORDER, GUARD_LABEL, kindsOfCard } from './cards'
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
  // 火球
  // 目はダイスを置いた置き場の順に並べ、空けた置き場は飛ばす。火球は X の枠、つまり最初の置き場の目が威力
  { name: '火球は X の枠の目を当てる', a: s('fireball', 6, 2), b: s('pass'), expect: [0, 6] },
  { name: '火球は X の枠に小さい目を置けば、その目', a: s('fireball', 2, 6), b: s('pass'), expect: [0, 2] },
  { name: '火球は障壁の目だけ減る', a: s('fireball', 5, 1), b: s('barrier', 3), expect: [0, 2] },
  { name: '火球は障壁でゼロ未満にならない', a: s('fireball', 1, 6), b: s('barrier', 6), expect: [0, 0] },
  { name: '火球どうしは相打ち', a: s('fireball', 6, 1), b: s('fireball', 3, 2), expect: [3, 6] },
  { name: '火球は詠唱中の相手に当たる', a: s('fireball', 5, 3), b: s('spearChant', 6), expect: [0, 5] },
  // 障壁
  { name: '障壁だけでは何も起きない', a: s('barrier', 6), b: s('pass'), expect: [0, 0] },
  { name: '障壁どうし', a: s('barrier', 6), b: s('barrier', 1), expect: [0, 0] },
  // 魔弾
  // 同じ目を2個置き、目に関係なく、障壁で減らない4の威力
  { name: '魔弾はゾロ目で4', a: s('bullet', 6, 6), b: s('pass'), expect: [0, 4] },
  { name: '1のゾロ目の魔弾も4', a: s('bullet', 1, 1), b: s('pass'), expect: [0, 4] },
  { name: '魔弾は障壁をすり抜ける', a: s('bullet', 2, 2), b: s('barrier', 6), expect: [0, 4] },
  { name: '魔弾と火球は相打ち', a: s('bullet', 3, 3), b: s('fireball', 6, 1), expect: [6, 4] },
  // 雷槍
  { name: '雷槍の発動は2個の合計', a: s('spearCast', 6, 5), b: s('pass'), expect: [0, 11] },
  { name: '雷槍の発動は障壁をすり抜ける', a: s('spearCast', 6, 5), b: s('barrier', 3), expect: [0, 11] },
  { name: '雷槍の詠唱そのものはダメージを出さない', a: s('spearChant', 6), b: s('pass'), expect: [0, 0] },
  // 過負荷
  { name: '過負荷1個は2点で、1の血を払う', a: s('overload', 6), b: s('pass'), expect: [1, 2] },
  { name: '過負荷2個は4点で、2の血を払う', a: s('overload', 1, 1), b: s('pass'), expect: [2, 4] },
  { name: '過負荷3個は6点で、3の血を払う', a: s('overload', 1, 2, 3), b: s('pass'), expect: [3, 6] },
  { name: '過負荷は障壁の目だけ減り、血は減らない', a: s('overload', 1, 1, 1), b: s('barrier', 4), expect: [3, 2] },
  { name: '過負荷と雷槍の発動は相打ち', a: s('overload', 1, 1), b: s('spearCast', 3, 3), expect: [8, 4] },
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
    expect(CARD_ORDER.map((c) => CARD_DEFS[c].name)).toEqual(['火球', '障壁', '魔弾', '雷槍', '過負荷'])
  })
  it('障壁で減らない攻撃の説明には、受けるダメージを減らす行動の名前を使う', () => {
    expect(GUARD_LABEL).toBe('障壁')
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
      // 詠唱の発動は、同じカードに詠唱が無いと使えない
      if (d.needsCharge)
        expect(
          kindsOfCard(d.card).some((x) => ACTION_DEFS[x].chant),
          k,
        ).toBe(true)
    }
  })
})
