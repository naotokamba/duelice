// @vitest-environment happy-dom
// 公開の舞台の描き分け。場面ごとに、矢印、構えの印、受けたダメージの星が出るかを見る。

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStep } from '../game/rules'
import type { Action } from '../game/types'
import { makeState } from '../test/helpers'
import { BACKFIRE_MS, Exchange, HOLD_MS, IMPACT_MS, RETURN_MS, revealMs, STAGE_H, START_MS } from './Exchange'

afterEach(cleanup)

/** 自分が mine を振って a、相手が theirs を振って b をとったステップの記録 */
const reportOf = (mine: number[], a: Action, theirs: number[], b: Action) =>
  resolveStep(makeState({ roll: mine }, { roll: theirs }), [a, b]).history[0]

/** 自分が mine を振って a、相手が theirs を振って b をとった公開を描く */
function stage(mine: number[], a: Action, theirs: number[], b: Action) {
  const { container } = render(<Exchange report={reportOf(mine, a, theirs, b)} />)
  const all = (sel: string) => [...container.querySelectorAll(sel)]
  return {
    arrows: all('.arrow'),
    bursts: all('.burst').map((e) => e.textContent),
    stances: all('.stance'),
    plates: all('.plate').map((e) => e.textContent),
    one: (sel: string) => container.querySelector(sel),
  }
}

const fire: Action = { kind: 'fireball', dice: [0, 1] }
const pass: Action = { kind: 'pass' }
const counter: Action = { kind: 'counter', dice: [0] }

describe('公開の舞台', () => {
  it('当たった攻撃は、矢印と受けたダメージの星になる', () => {
    const s = stage([6, 4, 1], fire, [1, 2, 3], pass)
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-fireball'])
    expect(s.bursts).toEqual(['−6'])
    // パスした側にはパスの印
    expect(s.one('.stance-pass')).not.toBeNull()
    // 名乗りの札に、技の名前と値が出る。矢印の札にも技の名前が付く
    expect(s.plates).toEqual(['パス', '火球6'])
    expect(s.one('.arrow-name')?.textContent).toBe('火球')
  })
  it('障壁に当たった矢印は障壁の値を見せ、削られた分だけ星になる', () => {
    // 1の目の障壁は2を減らす
    const s = stage([6, 4, 1], fire, [1, 1, 1], { kind: 'barrier', dice: [0] })
    expect(s.one('.stance.card-barrier')?.textContent).toBe('2障壁')
    // 止めた障壁は揺れ、止められた矢印は薄くなる。何を止めたかを読めるように、矢印の札は消さない
    expect(s.one('.stance.is-blocking')).not.toBeNull()
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-fireball is-spent'])
    expect(s.bursts).toEqual(['−4'])
  })
  it('相手の攻撃が自分の障壁に止められると、下向きの矢印が止まって薄くなる', () => {
    const s = stage([6, 1, 1], { kind: 'barrier', dice: [0] }, [4, 1, 1], fire)
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-down card-fireball is-spent'])
    expect(s.one('.stance.card-barrier.is-blocking')).not.toBeNull()
    expect(s.bursts).toEqual([])
  })
  it('障壁が攻撃を上回れば星は出ない', () => {
    const s = stage([2, 1, 1], fire, [6, 1, 1], { kind: 'barrier', dice: [0] })
    expect(s.bursts).toEqual([])
  })
  it('すり抜けられた障壁は薄くなる', () => {
    const s = stage([2, 1, 1], { kind: 'bullet', dice: [0, null] }, [6, 1, 1], { kind: 'barrier', dice: [0] })
    // 貫通する攻撃の矢印には、カードと同じ串刺しの星が付く
    expect(s.one('.stance.is-pierced')).not.toBeNull()
    expect(s.one('.arrow .glyph-pierce')).not.toBeNull()
    expect(s.one('.arrow.is-spent')).toBeNull()
    expect(s.bursts).toEqual(['−2'])
  })
  it('反撃に打ち消された矢印は止まり、反撃の札を付けた矢印が返って、攻撃した側に返した量の星が出る', () => {
    const s = stage([5, 4, 1], fire, [3, 1, 1], counter)
    // 打ち消された矢印の札は、返す矢印と入れ替わりに消す
    expect(s.arrows.map((e) => e.className)).toEqual([
      'arrow is-up card-fireball is-spent is-returned',
      'arrow is-down card-counter',
    ])
    expect(s.one('.stance.card-counter.is-blocking')).not.toBeNull()
    expect([...document.querySelectorAll('.arrow-name')].map((e) => e.textContent)).toEqual(['火球', '反撃'])
    expect(s.bursts).toEqual(['−4'])
    expect(s.one('.burst-backfire')).toBeNull()
  })
  it('相手の攻撃を自分の反撃が打ち消すと、相手の側に星が出る', () => {
    const s = stage([3, 1, 1], counter, [5, 4, 1], fire)
    expect(s.arrows.map((e) => e.className)).toEqual([
      'arrow is-down card-fireball is-spent is-returned',
      'arrow is-up card-counter',
    ])
    expect(s.bursts).toEqual(['−4'])
  })
  it('上限を超えた攻撃は反撃を通り抜け、外れた反撃は中を抜いた星で自分の受けた分を出す', () => {
    const s = stage([6, 4, 1], fire, [2, 1, 1], counter)
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-fireball'])
    expect(s.one('.stance.card-counter.is-missed')).not.toBeNull()
    expect(s.bursts).toEqual(['−6', '−4'])
    expect(s.one('.burst-backfire .glyph-backfire')).not.toBeNull()
    expect(s.one('.burst-backfire')?.textContent).toBe('−4')
  })
  it('攻撃が来なくて外れた反撃も、自分の受けた分を出す', () => {
    const s = stage([3, 1, 1], counter, [1, 2, 3], pass)
    expect(s.arrows).toEqual([])
    expect(s.one('.stance.card-counter.is-missed')).not.toBeNull()
    expect(s.bursts).toEqual(['−6'])
    expect(s.one('.burst-backfire')).not.toBeNull()
  })
  it('ダメージの星は、膨らんでも舞台の外の枠や体力の帯にかからない', () => {
    // 星は幅60で、出る時に1.25倍まで膨らむ
    const radius = (60 * 1.25) / 2
    const cases: [number[], Action, number[], Action][] = [
      [[6, 4, 1], fire, [5, 1, 1], { kind: 'bullet', dice: [0, null] }],
      [[5, 4, 1], fire, [3, 1, 1], counter],
      [[6, 4, 1], fire, [3, 1, 1], counter],
      [[3, 1, 1], counter, [1, 2, 3], pass],
      [[6, 4, 1], fire, [1, 1, 1], { kind: 'barrier', dice: [0] }],
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
    const s = stage([6, 4, 1], fire, [5, 1, 1], { kind: 'bullet', dice: [0, null] })
    const lefts = s.arrows.map((e) => (e as HTMLElement).style.left)
    expect(new Set(lefts).size).toBe(2)
    expect(s.bursts).toEqual(['−6', '−2'])
  })
  it('詠唱は崩れたかどうかで印が変わる', () => {
    const held = stage([5, 1, 1], { kind: 'spearChant', dice: [0] }, [1, 2, 1], fire)
    expect(held.one('.stance.card-spear.is-broken')).toBeNull()
    cleanup()
    const broken = stage([2, 1, 1], { kind: 'spearChant', dice: [0] }, [6, 5, 1], fire)
    expect(broken.one('.stance.card-spear.is-broken .chant-off')).not.toBeNull()
  })
  it('反撃で返したら、返した矢印が当たるまで次へ進まない。外れた反撃の自傷も、入って見せ終わるまで進まない', () => {
    expect(revealMs(reportOf([6, 4, 1], fire, [1, 2, 3], pass))).toBe(IMPACT_MS + HOLD_MS)
    expect(revealMs(reportOf([5, 4, 1], fire, [3, 1, 1], counter))).toBe(RETURN_MS + HOLD_MS)
    expect(revealMs(reportOf([3, 1, 1], counter, [1, 2, 3], pass))).toBe(BACKFIRE_MS + HOLD_MS)
    // 攻撃も外れも無ければ、構えを見せてから短く進む
    const calm = revealMs(reportOf([3, 1, 1], { kind: 'barrier', dice: [0] }, [1, 2, 3], pass))
    expect(calm).toBeGreaterThan(START_MS)
    expect(calm).toBeLessThan(IMPACT_MS + HOLD_MS)
  })
})
