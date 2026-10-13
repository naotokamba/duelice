// @vitest-environment happy-dom
// 公開の舞台の描き分け。場面ごとに、矢印、構えの印、受けたダメージの星が出るかを見る。

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStep } from '../game/rules'
import type { Action } from '../game/types'
import { makeState } from '../test/helpers'
import { BURN_MS, Exchange, HOLD_MS, IMPACT_MS, landings, revealMs, STAGE_H, START_MS } from './Exchange'

afterEach(cleanup)

/** 自分が mine を振って a、相手が theirs を振って b をとったステップの記録 */
const reportOf = (mine: number[], a: Action, theirs: number[], b: Action) =>
  resolveStep(makeState({ roll: mine }, { roll: theirs }), [a, b]).history[0]

/** 記録から公開を描く */
function draw(report: ReturnType<typeof reportOf>) {
  const { container } = render(<Exchange report={report} />)
  const all = (sel: string) => [...container.querySelectorAll(sel)]
  return {
    arrows: all('.arrow'),
    bursts: all('.burst').map((e) => e.textContent),
    stances: all('.stance'),
    plates: all('.plate').map((e) => e.textContent),
    one: (sel: string) => container.querySelector(sel),
  }
}

/** 自分が mine を振って a、相手が theirs を振って b をとった公開を描く */
const stage = (mine: number[], a: Action, theirs: number[], b: Action) => draw(reportOf(mine, a, theirs, b))

/** 最初の二つのダイスで撃つ炎撃と魔弾、最初のダイスで撃つ氷礫 */
const fire: Action = { kind: 'flameStrike', dice: [0, 1] }
const bullet: Action = { kind: 'bullet', dice: [0, 1] }
const interrupt: Action = { kind: 'interrupt', dice: [0] }
const pass: Action = { kind: 'pass' }
const barrier: Action = { kind: 'barrier', dice: [0] }

describe('公開の舞台', () => {
  it('当たった攻撃は、矢印と受けたダメージの星になる', () => {
    const s = stage([6, 6, 1], bullet, [1, 2, 3], pass)
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-bullet'])
    expect(s.bursts).toEqual(['−4'])
    // パスした側にはパスの印
    expect(s.one('.stance-pass')).not.toBeNull()
    // 名乗りの札に、技の名前と値が出る。矢印の札にも技の名前が付く
    expect(s.plates).toEqual(['パス', '魔弾4'])
    expect(s.one('.arrow-name')?.textContent).toBe('魔弾')
  })
  it('風壁に当たった矢印は風壁の値を見せ、削られた分だけ星になる。風壁は風の渦の矢印で3を吹き返す', () => {
    // 炎撃は 6 に2を足して8、風壁の 1 の倍の2に削られて6が通る。4 だけ自分も焼け、風壁から3を返される
    const s = stage([6, 4, 1], fire, [1, 1, 1], barrier)
    expect(s.one('.stance.card-barrier')?.textContent).toBe('2風壁')
    // 止めた風壁は揺れ、止められた矢印は薄くなる。何を止めたかを読めるように、矢印の札は消さない
    expect(s.one('.stance.is-blocking')).not.toBeNull()
    expect(s.arrows.map((e) => e.className)).toEqual([
      'arrow is-up card-flameStrike is-spent',
      'arrow is-down card-barrier',
    ])
    // 返した矢印には、技の名前と風の渦の印を付ける
    expect(s.one('.arrow.card-barrier .arrow-name')?.textContent).toBe('風壁')
    expect(s.one('.arrow.card-barrier .glyph-thorns')?.textContent).toBe('3')
    expect(s.bursts).toEqual(['−6', '−3', '−4'])
  })
  it('相手の攻撃が自分の風壁に止められると、下向きの矢印が止まって薄くなり、上向きの風の渦が返る', () => {
    const s = stage([6, 1, 1], barrier, [4, 3, 1], fire)
    expect(s.arrows.map((e) => e.className)).toEqual([
      'arrow is-down card-flameStrike is-spent',
      'arrow is-up card-barrier',
    ])
    expect(s.one('.stance.card-barrier.is-blocking')).not.toBeNull()
    // 自分は何も受けない。相手は返した3と、自分で焼けた3を受ける
    expect(s.bursts).toEqual(['−3', '−3'])
  })
  it('風壁が攻撃を上回れば、受けたダメージの星は出ず、返した星と焼けた分だけが出る', () => {
    const s = stage([2, 1, 1], fire, [6, 1, 1], barrier)
    expect(s.bursts).toEqual(['−3', '−1'])
    expect(s.one('.burst-burn')).not.toBeNull()
  })
  it('すり抜けられた風壁は薄くなり、何も返さない', () => {
    const charged = makeState({ roll: [2, 1, 1], chant: 'charged' }, { roll: [6, 1, 1] }, 2)
    const s = draw(resolveStep(charged, [{ kind: 'spearCast', dice: [0, 1] }, barrier]).history[0])
    // 貫通する攻撃の矢印には、カードと同じ串刺しの星が付く
    expect(s.one('.stance.is-pierced')).not.toBeNull()
    expect(s.one('.arrow .glyph-pierce')).not.toBeNull()
    expect(s.one('.arrow.is-spent')).toBeNull()
    expect(s.one('.arrow.card-barrier')).toBeNull()
    expect(s.bursts).toEqual(['−3'])
  })
  it('魔弾も風壁をすり抜け、目に関係なく4の星になる', () => {
    const s = stage([1, 1, 2], bullet, [6, 1, 1], barrier)
    expect(s.one('.stance.is-pierced')).not.toBeNull()
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-bullet'])
    expect(s.bursts).toEqual(['−4'])
  })
  it('自分も焼ける攻撃は、相手に当たった星と、自分を焼いた炎を出す', () => {
    const s = stage([6, 4, 1], fire, [1, 2, 3], pass)
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-flameStrike'])
    expect(s.bursts).toEqual(['−8', '−4'])
    expect(s.one('.burst-burn .glyph-burn')).not.toBeNull()
    expect(s.one('.burst-burn')?.textContent).toBe('−4')
  })
  it('ダメージの星と自分を焼く炎は、膨らんでも舞台の外の枠や体力の帯にかからない', () => {
    // 星は幅60で、出る時に1.25倍まで膨らむ
    const radius = (60 * 1.25) / 2
    const cases: [number[], Action, number[], Action][] = [
      [[6, 4, 1], fire, [5, 5, 1], bullet],
      [[6, 4, 1], fire, [1, 2, 3], pass],
      [[1, 1, 1], fire, [3, 1, 1], barrier],
      [[6, 4, 1], interrupt, [1, 1, 1], barrier],
    ]
    for (const [mine, a, theirs, b] of cases) {
      const { container } = render(
        <Exchange report={resolveStep(makeState({ roll: mine }, { roll: theirs }), [a, b]).history[0]} />,
      )
      const tops = [...container.querySelectorAll<HTMLElement>('.burst')].map((e) => Number.parseFloat(e.style.top))
      expect(tops.length).toBeGreaterThan(0)
      for (const top of tops) {
        expect(top).toBeGreaterThanOrEqual(radius)
        expect(top).toBeLessThanOrEqual(STAGE_H - radius)
      }
      cleanup()
    }
  })
  it('撃ち合いでは二本の矢印が左右にずれてすれ違う', () => {
    const s = stage([6, 4, 1], fire, [5, 5, 1], bullet)
    const lefts = s.arrows.map((e) => (e as HTMLElement).style.left)
    expect(new Set(lefts).size).toBe(2)
    expect(s.bursts).toEqual(['−8', '−4', '−4'])
  })
  it('詠唱は攻撃では崩れず、氷礫で崩れたときだけ印が変わる', () => {
    const held = stage([5, 1, 1], { kind: 'spearChant', dice: [0] }, [6, 2, 1], fire)
    expect(held.one('.stance.card-spear.is-broken')).toBeNull()
    cleanup()
    const broken = stage([2, 1, 1], { kind: 'spearChant', dice: [0] }, [6, 5, 1], interrupt)
    expect(broken.one('.stance.card-spear.is-broken .chant-off')).not.toBeNull()
  })
  it('攻撃が当たって見せ終わるまで次へ進まない。自分は攻撃を放つ時に焼ける', () => {
    expect(revealMs(reportOf([6, 6, 1], bullet, [1, 2, 3], pass))).toBe(IMPACT_MS + HOLD_MS)
    const paid = reportOf([6, 4, 1], fire, [1, 2, 3], pass)
    expect(landings(paid)).toEqual([IMPACT_MS, BURN_MS])
    expect(BURN_MS).toBe(START_MS)
    expect(revealMs(paid)).toBe(IMPACT_MS + HOLD_MS)
    // 攻撃が無ければ、構えを見せてから短く進む
    const calm = revealMs(reportOf([3, 1, 1], barrier, [1, 2, 3], pass))
    expect(calm).toBeGreaterThan(START_MS)
    expect(calm).toBeLessThan(IMPACT_MS + HOLD_MS)
  })
})

describe('拡張のカードの公開', () => {
  const deck = ['freeze', 'overload', 'galeWard', 'wildfire', 'lastStand'] as const
  it('振り足すといった攻撃しない行動は、名乗りの札と構えにカード面の最初の印を出た値で出す。凍らせる攻撃は、名乗りの札に威力を、構えに凍らせた目を出す', () => {
    const s = makeState({ roll: [5, 1, 1], deck }, { roll: [2, 3, 1], deck })
    const report = resolveStep(
      s,
      [
        { kind: 'freeze', dice: [0] },
        { kind: 'overload', dice: [0] },
      ],
      [[], [4, 4]],
    ).history[0]
    const d = draw(report)
    expect(d.plates).toEqual(['過負荷2', '凍結2'])
    expect(d.one('.stance.card-freeze .glyph-frost')?.textContent).toBe('5')
    expect(d.one('.stance.card-overload .glyph-extra')?.textContent).toBe('2')
    expect(d.stances.map((e) => e.textContent)).toEqual(['5凍結', '2過負荷'])
  })

  it('受けた攻撃を返す構えは、守りと同じく矢印の通り道に印を出し、返された矢印は構えで止まる', () => {
    const s = makeState({ roll: [6, 4, 1], deck: ['flameStrike', ...deck.slice(1)] }, { roll: [3, 3, 1], deck })
    const d = draw(resolveStep(s, [fire, { kind: 'galeWard', dice: [0, 1] }]).history[0])
    expect(d.one('.stance.card-galeWard.is-blocking .glyph-reflect')).not.toBeNull()
    expect(d.arrows.map((e) => e.className)).toEqual(['arrow is-up card-flameStrike is-spent'])
  })

  it('ターンの終わりの攻撃は、放った行動の名前と威力で描き、ターンの終わりに焼けた分も炎に足す', () => {
    // 1ステップ目に過負荷と延焼を使い、2ステップ目は何もしない。ターンの終わりに過負荷の2が焼け、延焼でその倍の4を与える
    const s = makeState(
      { roll: [6, 4, 1, 3, 3], usedDice: [0, 1], usedCards: ['overload', 'wildfire'], deck },
      { roll: [1, 2, 3], deck },
      2,
    )
    const d = draw(resolveStep(s, [{ kind: 'pass' }, { kind: 'pass' }]).history[0])
    expect(d.one('.arrow.card-wildfire .arrow-name')?.textContent).toBe('延焼')
    expect(d.one('.arrow.card-wildfire .glyph-star')?.textContent).toBe('4')
    expect(d.bursts).toEqual(['−4', '−2'])
    expect(d.one('.burst-burn')?.textContent).toBe('−2')
  })

  it('失った体力で増える攻撃は、放った時の威力を名乗りの札と矢印に書く', () => {
    const s = makeState({ roll: [5, 1, 1], deck, hp: 8 }, { roll: [1, 2, 3], deck })
    const d = draw(resolveStep(s, [{ kind: 'lastStand', dice: [0, 1] }, pass]).history[0])
    // 失った体力12で3増え、5に足して8
    expect(d.plates).toEqual(['パス', '背水8'])
    expect(d.one('.arrow.card-lastStand .glyph-star')?.textContent).toBe('8')
  })
})
