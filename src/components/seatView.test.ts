// 盤から席ごとに画面へ出すものを求める関数と、狭い画面で大きく出すカードの決め方。

import { describe, expect, it } from 'vitest'
import { STARTER } from '../game/cards'
import { submit } from '../game/match'
import { resolveStep } from '../game/rules'
import { makeState, seeded } from '../test/helpers'
import { currentCard, diceMarks, revealed, seatView, shownOn, usedUp } from './seatView'

describe('席の様子', () => {
  it('カードは席の5枚を、持ち込んだ順に並べる。様子には席の体力を持つ', () => {
    const deck = ['meteor', 'freeze', 'barrier', 'thunder', 'meditate'] as const
    const view = seatView(makeState({ roll: [6, 2, 1], deck, hp: 9 }, { roll: [1, 2, 3] }), 0)
    expect([...view.active.keys()]).toEqual(deck)
    expect([...view.rows.keys()]).toEqual(deck)
    // 様子には、相手の手元のまだ使っていないダイスの目も持つ
    expect(view.ctx).toEqual({ hp: 9, maxHp: 20, foe: [1, 2, 3] })
    expect([...seatView(makeState({ roll: [6, 2, 1], deck }, { roll: [1, 2, 3] }), 1).active.keys()]).toEqual(STARTER)
  })
  it('使えるカードと、カードごとに今使える行を求める', () => {
    const view = seatView(makeState({ roll: [6, 2, 1], usedCards: ['barrier'] }, { roll: [1, 2, 3] }), 0)
    // 使い終わった風壁は使えない
    expect(view.usable.has('barrier')).toBe(false)
    expect(view.active.get('barrier')).toEqual([])
    // 1ステップ目の魔槍は詠唱の行だけ
    expect(view.active.get('spear')).toEqual(['spearChant'])
    expect(view.kept).toEqual([])
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
    expect(view.kept).toEqual([{ card: 'flameStrike', kind: 'flameStrike', slots: [1, 0] }])
    expect(usedUp(view, 'flameStrike')).toBe(true)
    expect(usedUp(view, 'interrupt')).toBe(false)
  })

  it('公開した行動は、組み上がったダイスとしてカードに置く。パスは置かない', () => {
    expect(revealed({ kind: 'flameStrike', dice: [1, 0] })).toEqual([
      { card: 'flameStrike', kind: 'flameStrike', slots: [1, 0], complete: true },
    ])
    expect(revealed({ kind: 'pass' })).toEqual([])
  })
})

describe('狭い画面で大きく出すカード', () => {
  const usable = new Set(['barrier', 'interrupt'] as const)
  const deck = STARTER
  const shown = [{ card: 'interrupt' as const, kind: 'interrupt' as const, slots: [0], complete: true }]

  it('公開の間は使ったカード', () => {
    expect(currentCard({ revealing: true, shown, focus: 'barrier', usable, deck })).toBe('interrupt')
  })
  it('選んでいる間は名前を押したカード、次にダイスを置いたカード、次に使える最初のカード', () => {
    expect(currentCard({ revealing: false, shown, focus: 'barrier', usable, deck })).toBe('barrier')
    expect(currentCard({ revealing: false, shown, focus: null, usable, deck })).toBe('interrupt')
    expect(currentCard({ revealing: false, shown: [], focus: null, usable, deck })).toBe('barrier')
    // 使えるカードのうち、席の5枚の並びで最初のもの
    const reversed = [...STARTER].reverse()
    expect(currentCard({ revealing: false, shown: [], focus: null, usable, deck: reversed })).toBe('interrupt')
  })
  it('使えるカードが無ければ左端のカード', () => {
    expect(currentCard({ revealing: false, shown: [], focus: null, usable: new Set(), deck })).toBe('flameStrike')
    expect(
      currentCard({ revealing: false, shown: [], focus: null, usable: new Set(), deck: ['meteor', 'freeze'] }),
    ).toBe('meteor')
  })
})

describe('ダイスの印', () => {
  const deck = ['overload', 'freeze', 'meditate', 'barrier', 'allOut'] as const

  it('ターンの初めに振ったダイスの後ろは、前のターンから持ち越したダイス', () => {
    const s = makeState({ roll: [6, 2, 1, 4], deck }, { roll: [1, 2, 3] })
    expect(diceMarks(s, 0)).toEqual([null, null, null, 'carried'])
    expect(diceMarks(s, 1)).toEqual([null, null, null])
  })

  it('このターンに効果で足したダイスは、持ち越したダイスのさらに後ろに並ぶ', () => {
    const s = makeState({ roll: [6, 2, 1, 4], deck }, { roll: [1, 2, 3], deck })
    const next = resolveStep(s, [{ kind: 'overload', dice: [0] }, { kind: 'pass' }])
    expect(next.players[0].roll).toEqual([6, 2, 1, 4, 6, 6])
    expect(diceMarks(next, 0)).toEqual([null, null, null, 'carried', 'extra', 'extra'])
    expect(seatView(next, 0).marks).toEqual(diceMarks(next, 0))
    // 前のターンに足したダイスは数えない
    expect(diceMarks({ ...next, turn: 2 }, 0)).toEqual([null, null, null, 'carried', 'carried', 'carried'])
  })

  it('好きな目のダイスには印を付けない。持ち越したダイスは、その前に並ぶ', () => {
    const forge = ['transmute', 'freeze', 'meditate', 'barrier', 'allOut'] as const
    const s = makeState({ roll: [6, 2, 1, 4], deck: forge }, { roll: [1, 2, 3], deck })
    const next = resolveStep(s, [{ kind: 'transmute', dice: [0] }, { kind: 'pass' }])
    expect(diceMarks(next, 0)).toEqual([null, null, null, 'carried', null, null, null])
  })

  it('相手に凍らされた目のダイスは、まだ使っていなければ凍って置けない', () => {
    const s = makeState({ roll: [2, 5, 2], deck }, { roll: [2, 3, 1], deck })
    // 自分は 5 で相手の 5 を、相手は 2 で自分の 2 を凍らせる
    const next = resolveStep(s, [
      { kind: 'freeze', dice: [1] },
      { kind: 'freeze', dice: [0] },
    ])
    expect(diceMarks(next, 0)).toEqual(['frozen', null, 'frozen'])
    // 相手に 5 の目は無い
    expect(diceMarks(next, 1)).toEqual([null, null, null])
    // 使ったダイスは凍らない
    const used = makeState({ roll: [2, 5, 2], usedDice: [0], frozen: 2, deck }, { roll: [2, 3, 1] }, 2)
    expect(diceMarks(used, 0)).toEqual([null, null, 'frozen'])
  })
})

describe('一緒に使ったカード', () => {
  const deck = ['doubleCast', 'barrier', 'interrupt', 'darkWall', 'flameStrike'] as const
  const both = {
    kind: 'doubleCast' as const,
    dice: [0],
    with: [
      { kind: 'interrupt' as const, dice: [1] },
      { kind: 'darkWall' as const, dice: [2] },
    ],
  }

  it('公開した行動は、一緒に使ったカードもそれぞれのカードに置く', () => {
    expect(revealed(both).map((s) => [s.card, s.slots])).toEqual([
      ['doubleCast', [0]],
      ['interrupt', [1]],
      ['darkWall', [2]],
    ])
  })
  it('二ステップ目には、一緒に使ったカードにもダイスが残る。防ぎきって戻ったダイスと、いつも戻るダイスは残さない', () => {
    const state = makeState({ roll: [6, 2, 1], deck }, { roll: [1, 2, 3] })
    // 相手の氷礫を闇壁が防ぎきって、闇壁のダイスも戻る。二重詠唱のダイスはいつも戻る
    const done = resolveStep(state, [both, { kind: 'interrupt', dice: [0] }])
    expect(seatView(done, 0).kept.map((r) => r.card)).toEqual(['interrupt'])
    // 何も防がなければ、二重詠唱のほかは残る
    const calm = resolveStep(state, [both, { kind: 'pass' }])
    expect(seatView(calm, 0).kept.map((r) => r.card)).toEqual(['interrupt', 'darkWall'])
  })
  it('狭い画面では、公開の間は最後に置いたカードを、選んでいる間は最初に置いたカードを出す', () => {
    const shown = revealed(both)
    const usable = new Set(deck)
    expect(currentCard({ revealing: true, shown, focus: null, usable, deck })).toBe('darkWall')
    expect(currentCard({ revealing: false, shown, focus: null, usable, deck })).toBe('doubleCast')
    expect(shownOn(shown, 'interrupt')?.slots).toEqual([1])
    expect(shownOn(shown, 'barrier')).toBeNull()
  })
})
