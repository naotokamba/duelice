// 盤から席ごとに画面へ出すものを求める関数と、狭い画面で大きく出すカードの決め方。

import { describe, expect, it } from 'vitest'
import { submit } from '../game/match'
import { makeState, seeded } from '../test/helpers'
import { currentCard, revealed, seatView, usedUp } from './seatView'

describe('席の様子', () => {
  it('使えるカードと、カードごとに今使える行を求める', () => {
    const view = seatView(makeState({ roll: [6, 2, 1], usedCards: ['barrier'] }, { roll: [1, 2, 3] }), 0)
    // 使い終わった風壁は使えない
    expect(view.usable.has('barrier')).toBe(false)
    expect(view.active.get('barrier')).toEqual([])
    // 1ステップ目の魔槍は詠唱の行だけ
    expect(view.active.get('spear')).toEqual(['spearChant'])
    expect(view.kept).toBeNull()
  })

  it('色で描く行には、出目のせいで使えないカードの行も入れる。ステップの都合で使えない行と、使い終わったカードは入れない', () => {
    const view = seatView(makeState({ roll: [6, 2, 1], usedCards: ['barrier'] }, { roll: [1, 2, 3] }), 0)
    // ゾロ目が無いので魔弾は使えないが、色はそのまま
    expect(view.usable.has('bullet')).toBe(false)
    expect(view.rows.get('bullet')).toEqual(['bullet'])
    // 1ステップ目の魔槍は詠唱の段だけ。使い終わった風壁は無し
    expect(view.rows.get('spear')).toEqual(['spearChant'])
    expect(view.rows.get('barrier')).toEqual([])
    // 2ステップ目に詠唱していなければ、魔槍はどの段も置けない
    const second = seatView(makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] }, 2), 0)
    expect(second.rows.get('spear')).toEqual([])
  })

  it('二ステップ目には、一ステップ目に置いたダイスが置き場どおりに残る', () => {
    const state = makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] })
    const match = { state, pending: [null, null] as [null, null] }
    // X の枠に2、もう一つの枠に6を置く
    const first = submit(match, 0, { kind: 'flameStrike', dice: [1, 0] }, seeded(1))
    if (!first.ok) throw new Error('受け付けなかった')
    const done = submit(first.match, 1, { kind: 'pass' }, seeded(1))
    if (!done.ok) throw new Error('受け付けなかった')
    const view = seatView(done.match.state, 0)
    expect(view.kept).toEqual({ card: 'flameStrike', kind: 'flameStrike', slots: [1, 0] })
    expect(usedUp(view, 'flameStrike')).toBe(true)
    expect(usedUp(view, 'interrupt')).toBe(false)
  })

  it('公開した行動は、組み上がったダイスとしてカードに置く。パスは置かない', () => {
    expect(revealed({ kind: 'flameStrike', dice: [1, 0] })).toEqual({
      card: 'flameStrike',
      kind: 'flameStrike',
      slots: [1, 0],
      complete: true,
    })
    expect(revealed({ kind: 'pass' })).toBeNull()
  })
})

describe('狭い画面で大きく出すカード', () => {
  const usable = new Set(['barrier', 'interrupt'] as const)
  const shown = { card: 'interrupt' as const, kind: 'interrupt' as const, slots: [0], complete: true }

  it('公開の間は使ったカード', () => {
    expect(currentCard({ revealing: true, shown, focus: 'barrier', usable })).toBe('interrupt')
  })
  it('選んでいる間は名前を押したカード、次にダイスを置いたカード、次に使える最初のカード', () => {
    expect(currentCard({ revealing: false, shown, focus: 'barrier', usable })).toBe('barrier')
    expect(currentCard({ revealing: false, shown, focus: null, usable })).toBe('interrupt')
    expect(currentCard({ revealing: false, shown: null, focus: null, usable })).toBe('barrier')
  })
  it('使えるカードが無ければ左端のカード', () => {
    expect(currentCard({ revealing: false, shown: null, focus: null, usable: new Set() })).toBe('flameStrike')
  })
})
