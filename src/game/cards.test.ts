// カードの仕様表。カードの効果を、ぶつかり方ごとの期待ダメージとして書き並べる。
// カードを足したら、ここに行を足す。行の無い行動があるとメタテストが落ちる。

import { describe, expect, it } from 'vitest'
import { actionOf } from '../test/helpers'
import type { ActionKind, CardId } from './cards'
import { ACTION_DEFS, ACTION_KINDS, CARD_DEFS, CARD_ORDER, COUNTER_LABEL, GUARD_LABEL, kindsOfCard } from './cards'
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
  // 目はダイスを置いた置き場の順に並べ、空けた置き場は飛ばす。火球は X の枠、つまり最初の置き場に置いた目が威力で、もう一つは支払うだけ
  { name: '火球は X の枠に置いた目', a: s('fireball', 6, 2), b: s('pass'), expect: [0, 6] },
  { name: '火球は X の枠に小さい目を置けば、その目', a: s('fireball', 2, 6), b: s('pass'), expect: [0, 2] },
  { name: '火球は X の枠の目が障壁で減る', a: s('fireball', 3, 6), b: s('barrier', 1), expect: [0, 1] },
  { name: '火球は障壁の目の倍だけ減る', a: s('fireball', 5, 1), b: s('barrier', 2), expect: [0, 1] },
  { name: '火球は障壁でゼロ未満にならない', a: s('fireball', 5, 1), b: s('barrier', 3), expect: [0, 0] },
  { name: '火球どうしは相打ち', a: s('fireball', 4, 4), b: s('fireball', 6, 1), expect: [6, 4] },
  { name: '5以下の火球は反撃で打ち消され、4返される', a: s('fireball', 5, 1), b: s('counter', 3), expect: [4, 0] },
  { name: '火球は X の枠の目で反撃の上限と比べる', a: s('fireball', 2, 6), b: s('counter', 1), expect: [4, 0] },
  {
    name: '6の火球は反撃で返せずそのまま当たり、外れた反撃は目の倍を受ける',
    a: s('fireball', 6, 1),
    b: s('counter', 2),
    expect: [0, 10],
  },
  { name: '火球は詠唱中の相手に当たる', a: s('fireball', 6, 1), b: s('spearChant', 3), expect: [0, 6] },
  // 障壁
  { name: '障壁だけでは何も起きない', a: s('barrier', 6), b: s('pass'), expect: [0, 0] },
  { name: '障壁どうし', a: s('barrier', 6), b: s('barrier', 1), expect: [0, 0] },
  // 魔弾
  { name: '魔弾1個は2点', a: s('bullet', 1), b: s('pass'), expect: [0, 2] },
  { name: '魔弾2個は3点', a: s('bullet', 1, 1), b: s('pass'), expect: [0, 3] },
  { name: '魔弾は障壁をすり抜ける', a: s('bullet', 1), b: s('barrier', 6), expect: [0, 2] },
  { name: '魔弾2個も障壁をすり抜ける', a: s('bullet', 1, 2), b: s('barrier', 6), expect: [0, 3] },
  { name: '魔弾は反撃で打ち消され、4返される', a: s('bullet', 1), b: s('counter', 3), expect: [4, 0] },
  { name: '魔弾2個も反撃で打ち消される', a: s('bullet', 1, 1), b: s('counter', 6), expect: [4, 0] },
  // 雷槍
  { name: '雷槍の発動は2個の合計', a: s('spearCast', 6, 5), b: s('pass'), expect: [0, 11] },
  { name: '雷槍の発動は障壁をすり抜ける', a: s('spearCast', 6, 5), b: s('barrier', 3), expect: [0, 11] },
  {
    name: '6以上の雷槍の発動は反撃で返せず、外れた反撃は目の倍を受ける',
    a: s('spearCast', 6, 5),
    b: s('counter', 1),
    expect: [0, 13],
  },
  { name: '5以下の雷槍の発動は反撃で打ち消される', a: s('spearCast', 2, 3), b: s('counter', 1), expect: [4, 0] },
  { name: '雷槍の詠唱そのものはダメージを出さない', a: s('spearChant', 6), b: s('pass'), expect: [0, 0] },
  { name: '詠唱に反撃は外れる', a: s('spearChant', 4), b: s('counter', 3), expect: [0, 6] },
  // 反撃
  { name: '反撃どうしは双方が外れる', a: s('counter', 1), b: s('counter', 3), expect: [2, 6] },
  { name: '攻撃が来なければ反撃は外れる', a: s('counter', 2), b: s('barrier', 4), expect: [4, 0] },
  { name: '何もしない相手にも反撃は外れる', a: s('counter', 3), b: s('pass'), expect: [6, 0] },
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
    expect(CARD_ORDER.map((c) => CARD_DEFS[c].name)).toEqual(['火球', '障壁', '魔弾', '雷槍', '反撃'])
  })
  it('障壁で減らない攻撃の説明には、受けるダメージを減らす行動の名前を使う', () => {
    expect(GUARD_LABEL).toBe('障壁')
  })
  it('反撃が外れたときの説明には、反撃する行動の名前を使う', () => {
    expect(COUNTER_LABEL).toBe('反撃')
  })
  it('攻撃する行動は、何もしない相手、受けるダメージを減らす相手、反撃する相手とぶつかる行が仕様表にある', () => {
    const missing: string[] = []
    for (const k of ACTION_KINDS.filter((k) => ACTION_DEFS[k].power)) {
      const against = SPEC.flatMap((c) => (c.a.kind === k ? [c.b.kind] : c.b.kind === k ? [c.a.kind] : []))
      const has = (ok: (o: ActionKind) => boolean) => against.some((o) => o !== 'pass' && ok(o))
      if (!against.includes('pass')) missing.push(`${k} と何もしない相手`)
      if (!has((o) => !!ACTION_DEFS[o].guard)) missing.push(`${k} と受けるダメージを減らす相手`)
      if (!has((o) => !!ACTION_DEFS[o].counter)) missing.push(`${k} と反撃する相手`)
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
      // 詠唱の発動は、同じカードに詠唱が無いと使えない
      if (d.needsCharge)
        expect(
          kindsOfCard(d.card).some((x) => ACTION_DEFS[x].chant),
          k,
        ).toBe(true)
    }
  })
})
