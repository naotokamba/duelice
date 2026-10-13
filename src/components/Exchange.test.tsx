// @vitest-environment happy-dom
// 公開の舞台の描き分け。場面ごとに、矢印、構えの印、受けたダメージの星が出るかを見る。

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStep } from '../game/rules'
import type { Action } from '../game/types'
import { makeState } from '../test/helpers'
import { BLOOD_MS, Exchange, HOLD_MS, IMPACT_MS, landings, revealMs, STAGE_H, START_MS } from './Exchange'

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

/** 最初の二つのダイスで撃つ血弾と魔弾、最初のダイスで撃つ妨害 */
const fire: Action = { kind: 'bloodBullet', dice: [0, 1] }
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
  it('炎壁に当たった矢印は炎壁の値を見せ、削られた分だけ星になる。炎壁は炎の矢印で3を返す', () => {
    // 血弾は 6 に2を足して8、炎壁の 1 の倍の2に削られて6が通る。4 の血を払い、炎壁から3を返される
    const s = stage([6, 4, 1], fire, [1, 1, 1], barrier)
    expect(s.one('.stance.card-barrier')?.textContent).toBe('2炎壁')
    // 止めた炎壁は揺れ、止められた矢印は薄くなる。何を止めたかを読めるように、矢印の札は消さない
    expect(s.one('.stance.is-blocking')).not.toBeNull()
    expect(s.arrows.map((e) => e.className)).toEqual([
      'arrow is-up card-bloodBullet is-spent',
      'arrow is-down card-barrier',
    ])
    // 返した矢印には、技の名前と炎の印を付ける
    expect(s.one('.arrow.card-barrier .arrow-name')?.textContent).toBe('炎壁')
    expect(s.one('.arrow.card-barrier .glyph-thorns')?.textContent).toBe('3')
    expect(s.bursts).toEqual(['−6', '−3', '−4'])
  })
  it('相手の攻撃が自分の炎壁に止められると、下向きの矢印が止まって薄くなり、上向きの炎が返る', () => {
    const s = stage([6, 1, 1], barrier, [4, 3, 1], fire)
    expect(s.arrows.map((e) => e.className)).toEqual([
      'arrow is-down card-bloodBullet is-spent',
      'arrow is-up card-barrier',
    ])
    expect(s.one('.stance.card-barrier.is-blocking')).not.toBeNull()
    // 自分は何も受けない。相手は返した3と、自分で払った3の血を受ける
    expect(s.bursts).toEqual(['−3', '−3'])
  })
  it('炎壁が攻撃を上回れば、受けたダメージの星は出ず、返した星と払った血だけが出る', () => {
    const s = stage([2, 1, 1], fire, [6, 1, 1], barrier)
    expect(s.bursts).toEqual(['−3', '−1'])
    expect(s.one('.burst-blood')).not.toBeNull()
  })
  it('すり抜けられた炎壁は薄くなり、何も返さない', () => {
    const charged = makeState({ roll: [2, 1, 1], chant: 'charged' }, { roll: [6, 1, 1] }, 2)
    const s = draw(resolveStep(charged, [{ kind: 'spearCast', dice: [0, 1] }, barrier]).history[0])
    // 貫通する攻撃の矢印には、カードと同じ串刺しの星が付く
    expect(s.one('.stance.is-pierced')).not.toBeNull()
    expect(s.one('.arrow .glyph-pierce')).not.toBeNull()
    expect(s.one('.arrow.is-spent')).toBeNull()
    expect(s.one('.arrow.card-barrier')).toBeNull()
    expect(s.bursts).toEqual(['−3'])
  })
  it('魔弾も炎壁をすり抜け、目に関係なく4の星になる', () => {
    const s = stage([1, 1, 2], bullet, [6, 1, 1], barrier)
    expect(s.one('.stance.is-pierced')).not.toBeNull()
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-bullet'])
    expect(s.bursts).toEqual(['−4'])
  })
  it('血を払う攻撃は、相手に当たった星と、自分が払った血のしずくを出す', () => {
    const s = stage([6, 4, 1], fire, [1, 2, 3], pass)
    expect(s.arrows.map((e) => e.className)).toEqual(['arrow is-up card-bloodBullet'])
    expect(s.bursts).toEqual(['−8', '−4'])
    expect(s.one('.burst-blood .glyph-blood')).not.toBeNull()
    expect(s.one('.burst-blood')?.textContent).toBe('−4')
  })
  it('ダメージの星と血のしずくは、膨らんでも舞台の外の枠や体力の帯にかからない', () => {
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
  it('詠唱は攻撃では崩れず、妨害で崩れたときだけ印が変わる', () => {
    const held = stage([5, 1, 1], { kind: 'spearChant', dice: [0] }, [6, 2, 1], fire)
    expect(held.one('.stance.card-spear.is-broken')).toBeNull()
    cleanup()
    const broken = stage([2, 1, 1], { kind: 'spearChant', dice: [0] }, [6, 5, 1], interrupt)
    expect(broken.one('.stance.card-spear.is-broken .chant-off')).not.toBeNull()
  })
  it('攻撃が当たって見せ終わるまで次へ進まない。血は攻撃を放つ時に払う', () => {
    expect(revealMs(reportOf([6, 6, 1], bullet, [1, 2, 3], pass))).toBe(IMPACT_MS + HOLD_MS)
    const paid = reportOf([6, 4, 1], fire, [1, 2, 3], pass)
    expect(landings(paid)).toEqual([IMPACT_MS, BLOOD_MS])
    expect(BLOOD_MS).toBe(START_MS)
    expect(revealMs(paid)).toBe(IMPACT_MS + HOLD_MS)
    // 攻撃が無ければ、構えを見せてから短く進む
    const calm = revealMs(reportOf([3, 1, 1], barrier, [1, 2, 3], pass))
    expect(calm).toBeGreaterThan(START_MS)
    expect(calm).toBeLessThan(IMPACT_MS + HOLD_MS)
  })
})
