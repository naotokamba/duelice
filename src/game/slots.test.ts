// 置き場の読み方。行動をカードの行に置いたダイスとして読むことと、置き場ごとの目

import { describe, expect, it } from 'vitest'
import { playRow, rowOf, rowsOf, rowValues } from './slots'
import { WILD } from './types'

describe('カードの行に置いたダイス', () => {
  it('パスは行を持たず、カードの行動は一つの行、一緒に使ったカードはそれぞれの行になる', () => {
    expect(rowOf({ kind: 'pass' })).toBeNull()
    expect(rowsOf({ kind: 'pass' })).toEqual([])
    expect(rowsOf({ kind: 'flameStrike', dice: [1, 0] })).toEqual([
      { card: 'flameStrike', kind: 'flameStrike', slots: [1, 0] },
    ])
    expect(
      rowsOf({
        kind: 'doubleCast',
        dice: [0],
        with: [
          { kind: 'spearChant', dice: [1] },
          { kind: 'interrupt', dice: [2] },
        ],
      }),
    ).toEqual([
      { card: 'doubleCast', kind: 'doubleCast', slots: [0] },
      { card: 'spear', kind: 'spearChant', slots: [1] },
      { card: 'interrupt', kind: 'interrupt', slots: [2] },
    ])
  })
  it('好きな目のダイスに選んだ目も、行に写す', () => {
    const set = [6, 1]
    const row = playRow({ kind: 'flameStrike', dice: [3, 4], set })
    expect(row).toEqual({ card: 'flameStrike', kind: 'flameStrike', slots: [3, 4], set: [6, 1] })
    // 写した目は、元の行動と分ける
    expect(row.set).not.toBe(set)
  })
})

describe('置き場ごとの目', () => {
  const roll = [6, 2, 1, WILD, WILD]
  it('空けた置き場を飛ばし、置き場の順に並べる', () => {
    expect(rowValues(roll, { slots: [2, null, 0] })).toEqual([1, 6])
  })
  it('好きな目のダイスは選んだ目にし、まだ選んでいなければ WILD のまま', () => {
    expect(rowValues(roll, { slots: [3, 4], set: [5, null] })).toEqual([5, WILD])
    expect(rowValues(roll, { slots: [3] })).toEqual([WILD])
  })
})
