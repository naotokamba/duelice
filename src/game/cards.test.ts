// カードの仕様表。カードの効果を、ぶつかり方ごとの期待ダメージとして書き並べる。
// カードを足したら、ここに行を足す。行の無い行動があるとメタテストが落ちる。

import { describe, expect, it } from 'vitest'
import { actionOf, movesFor } from '../test/helpers'
import type { ActionKind, CardId, PowerCtx } from './cards'
import {
  ACTION_DEFS,
  ACTION_KINDS,
  CARD_DEFS,
  DECK_SIZE,
  effectValue,
  GUARD_LABEL,
  isDeck,
  kindsOfCard,
  POOL,
  STARTER,
} from './cards'
import { stepDamage } from './rules'

/**
 * 席の行動と置いた目。hp を書くと、ステップの前の体力がそれになる。最大は20。
 * foe を書くと、相手がステップの初めにまだ使っていないダイスの目がそれになる
 */
type Side = { kind: ActionKind | 'pass'; vals: number[]; hp?: number; foe?: number[] }
interface Case {
  name: string
  a: Side
  b: Side
  /** [a が受けるダメージ, b が受けるダメージ]。ターンの終わりに起きることは含まない */
  expect: [number, number]
}

const s = (kind: ActionKind | 'pass', ...vals: number[]): Side => ({ kind, vals })
/** 体力が hp まで減った席 */
const hurt = (hp: number, side: Side): Side => ({ ...side, hp })
/** 相手の手元に foe の目のダイスが残っている席 */
const facing = (foe: number[], side: Side): Side => ({ ...side, foe })

const SPEC: Case[] = [
  // 炎撃
  // 目はダイスを置いた置き場の順に並べ、空けた置き場は飛ばす。炎撃は X の枠、つまり最初の置き場の目に2を足した威力で、
  // もう一つの置き場の目の分だけ、自分も焼ける
  {
    name: '炎撃は X の枠の目に2を足して当て、もう1個の目だけ自分も焼ける',
    a: s('flameStrike', 6, 2),
    b: s('pass'),
    expect: [2, 8],
  },
  {
    name: '炎撃は X の枠に小さい目を置けば、威力も小さく自分は大きく焼ける',
    a: s('flameStrike', 2, 6),
    b: s('pass'),
    expect: [6, 4],
  },
  {
    name: '炎撃は風壁の目の倍だけ減り、3を返される',
    a: s('flameStrike', 5, 1),
    b: s('barrier', 2),
    expect: [4, 3],
  },
  {
    name: '炎撃は風壁に防ぎきられても、3を返される',
    a: s('flameStrike', 1, 6),
    b: s('barrier', 6),
    expect: [9, 0],
  },
  { name: '炎撃どうしは相打ち', a: s('flameStrike', 6, 1), b: s('flameStrike', 3, 2), expect: [6, 10] },
  { name: '炎撃は詠唱中の相手に当たる', a: s('flameStrike', 5, 3), b: s('spearChant', 6), expect: [3, 7] },
  // 風壁
  { name: '風壁だけでは何も起きない', a: s('barrier', 6), b: s('pass'), expect: [0, 0] },
  { name: '風壁どうしでは何も起きない', a: s('barrier', 6), b: s('barrier', 1), expect: [0, 0] },
  { name: '風壁は詠唱には何も返さない', a: s('barrier', 3), b: s('spearChant', 2), expect: [0, 0] },
  // 魔弾
  // 同じ目を2個置き、目に関係なく、障壁で減らない4の威力
  { name: '魔弾はゾロ目で4', a: s('bullet', 6, 6), b: s('pass'), expect: [0, 4] },
  { name: '1のゾロ目の魔弾も4', a: s('bullet', 1, 1), b: s('pass'), expect: [0, 4] },
  { name: '魔弾は風壁をすり抜け、返されない', a: s('bullet', 2, 2), b: s('barrier', 6), expect: [0, 4] },
  { name: '魔弾と炎撃は相打ち', a: s('bullet', 3, 3), b: s('flameStrike', 6, 1), expect: [8, 5] },
  // 魔槍
  { name: '魔槍の発動は2個の合計', a: s('spearCast', 6, 5), b: s('pass'), expect: [0, 11] },
  { name: '魔槍の発動は風壁をすり抜け、返されない', a: s('spearCast', 6, 5), b: s('barrier', 3), expect: [0, 11] },
  { name: '魔槍の詠唱そのものはダメージを出さない', a: s('spearChant', 6), b: s('pass'), expect: [0, 0] },
  // 氷礫
  { name: '氷礫は目に関係なく2', a: s('interrupt', 6), b: s('pass'), expect: [0, 2] },
  { name: '1の氷礫も2', a: s('interrupt', 1), b: s('pass'), expect: [0, 2] },
  { name: '氷礫は1の風壁でも防がれ、3を返される', a: s('interrupt', 4), b: s('barrier', 1), expect: [3, 0] },
  { name: '氷礫は詠唱中の相手に2点', a: s('interrupt', 3), b: s('spearChant', 5), expect: [0, 2] },
  { name: '氷礫と魔弾は相打ち', a: s('interrupt', 2), b: s('bullet', 4, 4), expect: [4, 2] },
  // 隕石
  { name: '隕石は3個の合計', a: s('meteor', 6, 5, 4), b: s('pass'), expect: [0, 15] },
  { name: '隕石は風壁の目の倍だけ減り、3を返される', a: s('meteor', 6, 5, 4), b: s('barrier', 3), expect: [3, 9] },
  { name: '隕石も風陣に返される', a: s('meteor', 1, 1, 2), b: s('galeWard', 5, 5), expect: [4, 0] },
  // 全開
  { name: '全開は1個なら1', a: s('allOut', 6), b: s('pass'), expect: [0, 1] },
  { name: '全開は目に関係なく、4個なら16', a: s('allOut', 1, 1, 2, 3), b: s('pass'), expect: [0, 16] },
  {
    name: '全開の3個の9は、風壁の目の倍だけ減り、3を返される',
    a: s('allOut', 1, 2, 3),
    b: s('barrier', 2),
    expect: [3, 5],
  },
  // 背水
  { name: '背水は体力が満タンなら、目に関係なく2', a: s('lastStand', 6, 6), b: s('pass'), expect: [0, 2] },
  {
    name: '背水は失った体力の半分を2に足す。12失えば8',
    a: hurt(8, s('lastStand', 1, 1)),
    b: s('pass'),
    expect: [0, 8],
  },
  {
    name: '背水の失った体力の半分は切り捨てる。3失えば3',
    a: hurt(17, s('lastStand', 2, 6)),
    b: s('pass'),
    expect: [0, 3],
  },
  {
    name: '背水は風壁の目の倍だけ減り、3を返される。19失えば11',
    a: hurt(1, s('lastStand', 6, 6)),
    b: s('barrier', 3),
    expect: [3, 5],
  },
  // 凍結
  // 相手がステップの初めにまだ使っていないダイスのうち、凍らせる目と同じ目のもの1個につき2の威力
  {
    name: '凍結は、相手の手元の同じ目のダイス1個につき2',
    a: facing([4, 4, 1], s('freeze', 4)),
    b: s('pass'),
    expect: [0, 4],
  },
  {
    name: '凍結は、相手の手元に同じ目が無ければ攻撃しない',
    a: facing([1, 2, 3], s('freeze', 4)),
    b: s('pass'),
    expect: [0, 0],
  },
  {
    name: '凍結は風壁の目の倍だけ減り、3を返される',
    a: facing([6, 6, 1], s('freeze', 6)),
    b: s('barrier', 1),
    expect: [3, 2],
  },
  {
    name: '凍結しても、同じステップの攻撃は受ける',
    a: facing([4], s('freeze', 4)),
    b: s('flameStrike', 5, 1),
    expect: [7, 3],
  },
  // 闇壁
  { name: '闇壁は置いた目の倍を減らし、返さない', a: s('darkWall', 2), b: s('flameStrike', 6, 1), expect: [4, 1] },
  { name: '闇壁で防ぎきれば何も受けない', a: s('darkWall', 3), b: s('flameStrike', 4, 2), expect: [0, 2] },
  { name: '魔弾は闇壁をすり抜ける', a: s('darkWall', 6), b: s('bullet', 1, 1), expect: [4, 0] },
  // 風陣
  {
    name: '風陣は同じ目でなくてよく、受けた攻撃をそのまま返す。炎撃なら自分も焼けたうえで返される',
    a: s('galeWard', 3, 5),
    b: s('flameStrike', 6, 1),
    expect: [0, 9],
  },
  { name: '風陣は氷礫も返す', a: s('galeWard', 1, 1), b: s('interrupt', 5), expect: [0, 2] },
  {
    name: '風陣は魔弾を返せず、返す攻撃が来なかったので置いた目の合計も受ける',
    a: s('galeWard', 2, 3),
    b: s('bullet', 6, 6),
    expect: [9, 0],
  },
  {
    name: '風陣は魔槍の発動を返せず、置いた目の合計も受ける',
    a: s('galeWard', 2, 2),
    b: s('spearCast', 6, 5),
    expect: [15, 0],
  },
  {
    name: '風陣に攻撃が来なければ、置いた目の合計を自分が受ける',
    a: s('galeWard', 4, 6),
    b: s('barrier', 6),
    expect: [10, 0],
  },
  { name: '低い目の風陣は、外しても受ける分が少ない', a: s('galeWard', 1, 1), b: s('pass'), expect: [2, 0] },
  // 迅雷
  { name: '迅雷は X の枠の目の威力', a: s('thunder', 6, 1), b: s('pass'), expect: [0, 6] },
  { name: '迅雷は風壁の目の倍だけ減り、3を返される', a: s('thunder', 6, 1), b: s('barrier', 2), expect: [3, 2] },
  { name: '迅雷も風陣に返される', a: s('thunder', 5, 2), b: s('galeWard', 1, 1), expect: [5, 0] },
  { name: '迅雷で倒れなければ、相手の攻撃も当たる', a: s('thunder', 6, 1), b: s('flameStrike', 6, 2), expect: [8, 8] },
  {
    name: '迅雷で倒れた相手の攻撃は起きず、自分も焼けない',
    a: s('thunder', 6, 1),
    b: hurt(5, s('flameStrike', 6, 2)),
    expect: [0, 6],
  },
  {
    name: '迅雷どうしは同時に当たる',
    a: hurt(5, s('thunder', 6, 1)),
    b: hurt(5, s('thunder', 5, 1)),
    expect: [5, 6],
  },
  // 延焼、過負荷、瞑想は、ターンの終わりや次のステップに効く。ステップのダメージは無い
  { name: '延焼はそのステップにはダメージを出さない', a: s('wildfire', 3), b: s('pass'), expect: [0, 0] },
  { name: '過負荷はそのステップにはダメージを出さない', a: s('overload', 3), b: s('interrupt', 2), expect: [2, 0] },
  { name: '瞑想はダメージを出さない', a: s('meditate', 6), b: s('pass'), expect: [0, 0] },
  // 双竜
  { name: '双竜は好きな目の4個で20', a: s('twinDragon', 1, 2, 3, 6), b: s('pass'), expect: [0, 20] },
  {
    name: '双竜は風壁の目の倍だけ減り、3を返される',
    a: s('twinDragon', 2, 2, 2, 2),
    b: s('barrier', 6),
    expect: [3, 8],
  },
  { name: '双竜は闇壁の目の倍だけ減る', a: s('twinDragon', 1, 1, 6, 6), b: s('darkWall', 5), expect: [0, 10] },
  { name: '双竜も風陣に返される', a: s('twinDragon', 1, 1, 6, 6), b: s('galeWard', 5, 5), expect: [20, 0] },
  // 反撃
  // 威力6以下の攻撃を、障壁で減らない攻撃も先に当たる攻撃も打ち消して、4返す。一つも打ち消さなければ、置いた目を自分が受ける
  {
    name: '反撃は威力6以下の攻撃を打ち消して4返す。炎撃なら自分も焼ける',
    a: s('counter', 3),
    b: s('flameStrike', 4, 1),
    expect: [0, 5],
  },
  { name: '反撃は魔弾も打ち消す', a: s('counter', 2), b: s('bullet', 1, 1), expect: [0, 4] },
  { name: '反撃は迅雷も打ち消す', a: s('counter', 1), b: s('thunder', 6, 1), expect: [0, 4] },
  {
    name: '反撃は6より大きい攻撃を打ち消さず、置いた目も受ける',
    a: s('counter', 2),
    b: s('flameStrike', 5, 1),
    expect: [9, 1],
  },
  { name: '反撃に攻撃が来なければ、置いた目を自分が受ける', a: s('counter', 5), b: s('pass'), expect: [5, 0] },
  { name: '反撃どうしは、どちらも置いた目を受ける', a: s('counter', 2), b: s('counter', 6), expect: [2, 6] },
  // 錬成、二重詠唱、残響。それ自身はダメージを出さない。効果はターンをまたぐ決まりなので expansion.test.ts で確かめる
  { name: '錬成はダメージを出さない', a: s('transmute', 6), b: s('pass'), expect: [0, 0] },
  { name: '錬成しても、同じステップの攻撃は受ける', a: s('transmute', 6), b: s('interrupt', 3), expect: [2, 0] },
  { name: '二重詠唱そのものはダメージを出さない', a: s('doubleCast', 6), b: s('pass'), expect: [0, 0] },
  { name: '残響そのものはダメージを出さない', a: s('echo', 6), b: s('flameStrike', 5, 1), expect: [7, 1] },
]

/** ステップの前の様子。体力を書かなければ満タンで、相手の手元のダイスを書かなければ無い */
const ctxOf = (side: Side): PowerCtx => ({ hp: side.hp ?? 20, maxHp: 20, foe: side.foe ?? [] })

function run(c: Case): [number, number] {
  return stepDamage(
    movesFor([c.a.vals, c.b.vals], [actionOf(c.a.kind, c.a.vals.length), actionOf(c.b.kind, c.b.vals.length)]),
    [ctxOf(c.a), ctxOf(c.b)],
  )
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
  it('スターターはこの5枚で、カードを選ばない対局ではこの順に並ぶ', () => {
    expect(STARTER.map((c) => CARD_DEFS[c].name)).toEqual(['炎撃', '風壁', '魔弾', '魔槍', '氷礫'])
    expect(isDeck(STARTER)).toBe(true)
  })
  it('選べるカードは、スターターの後に拡張のカードがこの順で並ぶ', () => {
    expect(POOL.map((c) => CARD_DEFS[c].name)).toEqual([
      '炎撃',
      '風壁',
      '魔弾',
      '魔槍',
      '氷礫',
      '隕石',
      '全開',
      '背水',
      '凍結',
      '闇壁',
      '風陣',
      '迅雷',
      '延焼',
      '過負荷',
      '双竜',
      '瞑想',
      '錬成',
      '二重詠唱',
      '残響',
      '反撃',
    ])
  })
  it('持ち込めるのは、表にある互いに違うカードを5枚', () => {
    expect(DECK_SIZE).toBe(5)
    expect(isDeck(['meteor', 'allOut', 'lastStand', 'freeze', 'darkWall'])).toBe(true)
    expect(isDeck(['meteor', 'allOut', 'lastStand', 'freeze'])).toBe(false)
    expect(isDeck(['meteor', 'allOut', 'lastStand', 'freeze', 'darkWall', 'galeWard'])).toBe(false)
    // 重なりを含めて6枚でも持ち込めない
    expect(isDeck(['meteor', 'meteor', 'allOut', 'lastStand', 'freeze', 'darkWall'])).toBe(false)
    expect(isDeck(['meteor', 'meteor', 'lastStand', 'freeze', 'darkWall'])).toBe(false)
    expect(isDeck(['meteor', 'allOut', 'lastStand', 'freeze', 'nothing'])).toBe(false)
    expect(isDeck(['meteor', 'allOut', 'lastStand', 'freeze', 'toString'])).toBe(false)
  })
  it('障壁で減らない攻撃の説明には、受けるダメージを減らす行動の名前を使う', () => {
    expect(GUARD_LABEL).toBe('風壁')
  })
  it('効果の値は、攻撃なら威力、守りなら減らす量、攻撃しない行動の置けなくする目や持ち越す目や足す目ならその目で、どれでもない詠唱は 0', () => {
    expect(effectValue(ACTION_DEFS.flameStrike, [4, 1])).toBe(6)
    expect(effectValue(ACTION_DEFS.barrier, [3])).toBe(6)
    expect(effectValue(ACTION_DEFS.spearChant, [5])).toBe(0)
    // 凍結は攻撃もするので、効果の値は威力。相手の手元の同じ目のダイスで決まり、様子を渡さなければ無いとみなす
    expect(effectValue(ACTION_DEFS.freeze, [5])).toBe(0)
    expect(effectValue(ACTION_DEFS.freeze, [5], { hp: 20, maxHp: 20, foe: [5, 2, 5] })).toBe(4)
    // 足す目は印の置き場の目
    expect(effectValue(ACTION_DEFS.overload, [3])).toBe(3)
    expect(effectValue(ACTION_DEFS.meditate, [2])).toBe(2)
    expect(effectValue(ACTION_DEFS.wildfire, [2])).toBe(0)
    // 様子を渡さなければ、体力は減っていないとみなす
    expect(effectValue(ACTION_DEFS.lastStand, [4, 1])).toBe(2)
    expect(effectValue(ACTION_DEFS.lastStand, [4, 1], { hp: 3, maxHp: 20 })).toBe(10)
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
  it('攻撃しない行動と、威力が0になりうる攻撃は、公開の文を持つ', () => {
    for (const k of ACTION_KINDS) {
      const d = ACTION_DEFS[k]
      const vals = Array<number>(Math.max(...d.dice)).fill(3)
      const silent = !d.power || d.power(vals, { hp: 20, maxHp: 20, foe: [] }) === 0
      if (silent && !d.chant && !d.multi) expect(d.done, k).toMatch(/\S/)
    }
    expect(ACTION_DEFS.freeze.done).toBe('凍らせた')
  })
  it('全ての行動が仕様表に一度は登場する', () => {
    const covered = new Set(SPEC.flatMap((c) => [c.a.kind, c.b.kind]))
    const missing = ACTION_KINDS.filter((k) => !covered.has(k))
    expect(missing, `仕様表に行が無い行動: ${missing.join(', ')}`).toEqual([])
  })
  it('全てのカードが選べるカードに一度だけ含まれ、スターターは選べるカードの最初の5枚', () => {
    const ids = Object.keys(CARD_DEFS) as CardId[]
    expect([...POOL].sort()).toEqual([...ids].sort())
    expect(POOL.slice(0, DECK_SIZE)).toEqual(STARTER)
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
      // 自分も焼ける行動は攻撃で、自分が焼ける量は効果の値と別に決まる
      if (d.burn) expect(d.power, k).toBeDefined()
      // 攻撃を返すのは守る行動で、カード面の風の渦の数は返すダメージと揃える
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
      // ダイスが戻るのは守りで防ぎきったとき
      if (d.refund) expect(d.guard, k).toBeDefined()
      // 攻撃を返す構えと、先に当たる性質は、攻撃と組み合わさって意味を持つ
      if (d.reflects) expect(d.power, k).toBeUndefined()
      if (d.fast) expect(d.power, k).toBeDefined()
      // 足したダイスは次のステップで使うので、二ステップ目には使えない
      if (d.copies) expect(d.step, k).toBe(1)
      // 攻撃が来なかったときに受ける分は、返す構えか打ち消す構えだけが持つ
      if (d.missBurn) expect(!!d.reflects || d.cancels !== undefined, k).toBe(true)
      // 打ち消したら返す分は、打ち消す構えだけが持つ。打ち消す構えは攻撃しない
      if (d.riposte) expect(d.cancels, k).toBeDefined()
      if (d.cancels !== undefined) expect(d.power, k).toBeUndefined()
      // 置けなくする目と持ち越す目と足す目は、印の置き場の目
      if (d.freezes || d.carries || d.copies) expect(d.face.mark, k).toBeDefined()
    }
  })
})
