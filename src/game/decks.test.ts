import { describe, expect, it } from 'vitest'
import { isDeck, POOL, STARTER } from './cards'
import { CPU_DECKS, inPoolOrder, pickCpuDeck } from './decks'

describe('カードの表の順', () => {
  it('選んだ順によらず、カードの表の順に並べ替える。元の並びは変えない', () => {
    const picked = ['meditate', 'barrier', 'meteor', 'flameStrike', 'darkWall'] as const
    expect(inPoolOrder(picked)).toEqual(['flameStrike', 'barrier', 'meteor', 'darkWall', 'meditate'])
    expect(picked[0]).toBe('meditate')
    expect(inPoolOrder([...POOL].reverse())).toEqual(POOL)
  })
})

describe('CPU のデッキ', () => {
  it('どれも持ち込める5枚で、カードの表の順に並び、互いに違う', () => {
    for (const deck of CPU_DECKS) {
      expect(isDeck(deck)).toBe(true)
      expect(deck).toEqual(inPoolOrder(deck))
    }
    expect(new Set(CPU_DECKS.map((d) => d.join())).size).toBe(CPU_DECKS.length)
  })

  it('スターターも含み、拡張のカードを使うデッキもある', () => {
    expect(CPU_DECKS).toContainEqual(STARTER)
    expect(CPU_DECKS.some((d) => d.some((c) => !STARTER.includes(c)))).toBe(true)
  })

  it('乱数の値に応じて、表のどのデッキも選ばれる', () => {
    const n = CPU_DECKS.length
    expect(pickCpuDeck(() => 0)).toBe(CPU_DECKS[0])
    expect(pickCpuDeck(() => 0.999999)).toBe(CPU_DECKS[n - 1])
    const seen = new Set(Array.from({ length: n }, (_, i) => pickCpuDeck(() => (i + 0.5) / n)))
    expect(seen.size).toBe(n)
  })
})
