// 評価の数え方のテスト。勝率の区間、Bradley–Terry の当てはめ、賭け金、記録の名前、互換の数えを確かめる。

import { describe, expect, it } from 'vitest'
import { STARTER } from '../game/cards'
import { makeState } from '../test/helpers'
import { emptyTally, mergeTally, tallyRows } from './dominance'
import { playGame, stakesOf } from './game'
import { bradleyTerry, close, expected, mean, wilson } from './stats'
import { canonical, cardFingerprint, deckKey, deckOf, seatsOf, seedOf } from './store'

describe('勝率の区間', () => {
  it('Wilson の区間は勝率を挟み、0から1に収まる', () => {
    const r = wilson(30, 40)
    expect(r.rate).toBe(0.75)
    expect(r.lo).toBeGreaterThan(0.59)
    expect(r.lo).toBeLessThan(0.75)
    expect(r.hi).toBeGreaterThan(0.75)
    expect(r.hi).toBeLessThan(0.87)
    expect(wilson(0, 10).lo).toBe(0)
    expect(wilson(10, 10).hi).toBe(1)
    expect(wilson(0, 0)).toEqual({ score: 0, n: 0, rate: 0.5, lo: 0, hi: 1 })
  })
  it('区間が 0.5 をまたげば接戦', () => {
    expect(close(wilson(5, 10))).toBe(true)
    expect(close(wilson(40, 40))).toBe(false)
    expect(close(wilson(0, 40))).toBe(false)
  })
})

describe('Bradley–Terry', () => {
  it('勝ち越した側が強く、平均は0', () => {
    const elo = bradleyTerry([
      { a: 'x', b: 'y', score: 75, n: 100 },
      { a: 'y', b: 'z', score: 75, n: 100 },
      { a: 'x', b: 'z', score: 90, n: 100 },
    ])
    const [x, y, z] = ['x', 'y', 'z'].map((k) => elo.get(k) as number)
    expect(x).toBeGreaterThan(y)
    expect(y).toBeGreaterThan(z)
    expect(x + y + z).toBeCloseTo(0, 6)
    // 75% は Elo の差でおよそ 190
    expect(expected(x - y)).toBeGreaterThan(0.65)
    expect(expected(x - y)).toBeLessThan(0.8)
  })
  it('全勝でも強さは有限', () => {
    const elo = bradleyTerry([{ a: 'x', b: 'y', score: 10, n: 10 }])
    expect(Number.isFinite(elo.get('x'))).toBe(true)
    expect(elo.get('x')).toBeGreaterThan(elo.get('y') as number)
  })
  it('五分なら同じ強さ', () => {
    const elo = bradleyTerry([{ a: 'x', b: 'y', score: 5, n: 10 }])
    expect(elo.get('x')).toBeCloseTo(0, 6)
    expect(elo.get('y')).toBeCloseTo(0, 6)
  })
  it('平均', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(mean([])).toBeNaN()
  })
})

describe('一局', () => {
  it('賭け金は、最適戦略で得点が価値からずれる量の平均', () => {
    // 当てれば勝ち、外せば負けの読み合いは、どの手でも1ずれる
    expect(
      stakesOf(
        [
          [1, -1],
          [-1, 1],
        ],
        [0.5, 0.5],
        [0.5, 0.5],
        0,
      ),
    ).toBe(1)
    // 一択の局面は、ずれない
    expect(stakesOf([[3]], [1], [1], 3)).toBe(0)
  })
  it('スターターどうしを最後まで戦わせ、席ごとのステップと使ったカードを数える', () => {
    const g = playGame([STARTER, STARTER], 3)
    expect(g.winner === 'draw' || g.hp[g.winner] > 0).toBe(true)
    for (const s of g.seats) {
      const used = Object.values(s.cards).reduce((a, b) => a + (b ?? 0), 0)
      expect(used + s.passes).toBe(s.steps[0] + s.steps[1])
      expect(s.forced[0]).toBeLessThanOrEqual(s.steps[0])
    }
    expect(g.turns).toBeGreaterThan(0)
    // 同じ種なら同じ一局
    expect(playGame([STARTER, STARTER], 3)).toEqual(g)
  })
})

describe('記録の名前', () => {
  it('デッキは選べるカードの順にそろえて名付け、名前から戻せる', () => {
    const deck = ['meditate', 'barrier', 'meteor', 'flameStrike', 'freeze'] as const
    expect(canonical(deck)).toEqual(['flameStrike', 'barrier', 'meteor', 'freeze', 'meditate'])
    expect(deckOf(deckKey(deck))).toEqual(canonical(deck))
  })
  it('席を入れ替えた二局は同じ種で、席は交互', () => {
    const entry = { first: 'a', second: 'b' }
    expect(seatsOf(entry, 0)).toEqual(['a', 'b'])
    expect(seatsOf(entry, 1)).toEqual(['b', 'a'])
    expect(seedOf(entry, 0)).toBe(seedOf(entry, 1))
    expect(seedOf(entry, 2)).not.toBe(seedOf(entry, 0))
  })
  it('カードの指紋は、カードごとに違う', () => {
    expect(cardFingerprint('meteor')).not.toBe(cardFingerprint('allOut'))
    expect(cardFingerprint('meteor')).toBe(cardFingerprint('meteor'))
  })
})

describe('局面で見る互換', () => {
  it('一ステップ目に3個を全て置く攻撃は、同じ3個で同じ合計を出せる攻撃に支配されることがある', () => {
    // 二ステップ目に全てのダイスを使い切る局面。目の合計が同じなら、どの攻撃も残りのダイスを持たない
    const s = makeState({ roll: [6, 6, 6] }, { roll: [] }, 2)
    const t = tallyRows(s, 0)
    expect(t.applicable.allOut).toBe(1)
    // 二ステップ目には使えない行動は数えない
    expect(t.applicable.meteor).toBeUndefined()
    // 全開の3個の9は、どれにも支配されない
    expect(Object.values(t.dominated.allOut ?? {})).toEqual([])
    // 魔弾の4は、全開の9に支配される
    expect(t.dominated.bullet?.allOut).toBe(1)
  })
  it('数えを足し合わせる', () => {
    const a = { applicable: { meteor: 1 }, dominated: { meteor: { allOut: 1 } } }
    const total = mergeTally(mergeTally(emptyTally(), a), a)
    expect(total).toEqual({ applicable: { meteor: 2 }, dominated: { meteor: { allOut: 2 } } })
  })
})
