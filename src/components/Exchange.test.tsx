// @vitest-environment happy-dom
// 公開の舞台の描き分け。場面ごとに、矢印、構えの印、受けたダメージの星が出るかを見る。

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStep, strikes } from '../game/rules'
import type { Action } from '../game/types'
import { makeState } from '../test/helpers'
import { Exchange, HOLD_MS, IMPACT_MS, RETURN_MS, revealMs, STAGE_H, START_MS } from './Exchange'

afterEach(cleanup)

/** 自分が mine を振って a、相手が theirs を振って b をとった公開を描く */
function stage(mine: number[], a: Action, theirs: number[], b: Action) {
  const report = resolveStep(makeState({ roll: mine }, { roll: theirs }), [a, b]).history[0]
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

const fire: Action = { kind: 'fireball', dice: [0, 1] }
const pass: Action = { kind: 'pass' }

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
    const s = stage([6, 4, 1], fire, [3, 1, 1], { kind: 'barrier', dice: [0] })
    expect(s.one('.stance.card-barrier')?.textContent).toBe('3障壁')
    // 止めた障壁は揺れ、止められた矢印は薄くなる。何を止めたかを読めるように、矢印の札は消さない
    expect(s.one('.stance.is-blocking')).not.toBeNull()
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-fireball is-spent'])
    expect(s.bursts).toEqual(['−3'])
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
  it('反射された矢印は向きを変えて、攻撃した側に星が出る。返された矢印の札は、返る矢印と入れ替わりに消す', () => {
    const s = stage([6, 4, 1], fire, [3, 3, 1], { kind: 'reflect', dice: [0, 1] })
    expect(s.arrows.map((e) => e.className)).toEqual([
      'arrow is-up card-fireball is-spent is-returned',
      'arrow is-down card-fireball',
    ])
    expect(s.one('.stance.card-reflect')).not.toBeNull()
    expect(s.bursts).toEqual(['−6'])
  })
  it('相手の攻撃を自分が反射すると、相手の側に星が出る', () => {
    const s = stage([3, 3, 1], { kind: 'reflect', dice: [0, 1] }, [6, 4, 1], fire)
    expect(s.arrows.map((e) => e.className)).toEqual([
      'arrow is-down card-fireball is-spent is-returned',
      'arrow is-up card-fireball',
    ])
    expect(s.bursts).toEqual(['−6'])
  })
  it('ダメージの星は、膨らんでも舞台の外の枠や体力の帯にかからない', () => {
    // 星は幅60で、出る時に1.25倍まで膨らむ
    const radius = (60 * 1.25) / 2
    const cases: [number[], Action, number[], Action][] = [
      [[6, 4, 1], fire, [5, 1, 1], { kind: 'bullet', dice: [0, null] }],
      [[6, 4, 1], fire, [3, 3, 1], { kind: 'reflect', dice: [0, 1] }],
      [[6, 4, 1], fire, [3, 1, 1], { kind: 'barrier', dice: [0] }],
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
  it('反射があると、返った矢印が当たるまで次へ進まない', () => {
    const direct = strikes([[6, 4], []], [fire, pass])
    expect(revealMs(direct)).toBe(IMPACT_MS + HOLD_MS)
    const reflected = strikes(
      [
        [6, 4],
        [3, 3],
      ],
      [fire, { kind: 'reflect', dice: [0, 1] }],
    )
    expect(revealMs(reflected)).toBe(RETURN_MS + HOLD_MS)
    // 攻撃が無ければ、構えを見せてから短く進む
    expect(revealMs([])).toBeGreaterThan(START_MS)
    expect(revealMs([])).toBeLessThan(IMPACT_MS + HOLD_MS)
  })
})
