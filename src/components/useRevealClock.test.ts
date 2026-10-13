// 公開の途中で、まだ当たっていないダメージ。その分だけ体力を多く見せる。

import { describe, expect, it } from 'vitest'
import { resolveStep } from '../game/rules'
import { makeState } from '../test/helpers'
import { BACKFIRE_MS, IMPACT_MS, RETURN_MS } from './Exchange'
import { unlanded } from './useRevealClock'

describe('まだ当たっていないダメージ', () => {
  it('矢印が当たる時刻までは数え、当たったら数えない', () => {
    const report = resolveStep(makeState({ roll: [6, 4, 1] }, { roll: [1, 2, 3] }), [
      { kind: 'fireball', dice: [0, 1] },
      { kind: 'pass' },
    ]).history[0]
    expect(unlanded(report, 1, 0)).toBe(6)
    expect(unlanded(report, 1, IMPACT_MS)).toBe(0)
    expect(unlanded(report, 0, 0)).toBe(0)
  })

  it('反撃で返したダメージは、返した矢印が当たる時刻まで数える', () => {
    const report = resolveStep(makeState({ roll: [5, 4, 1] }, { roll: [3, 3, 1] }), [
      { kind: 'fireball', dice: [0, 1] },
      { kind: 'counter', dice: [0] },
    ]).history[0]
    expect(unlanded(report, 0, IMPACT_MS)).toBe(4)
    expect(unlanded(report, 0, RETURN_MS)).toBe(0)
  })

  it('反撃が外れて自分で受けるダメージは、外れる時刻まで数える', () => {
    const report = resolveStep(makeState({ roll: [3, 4, 1] }, { roll: [1, 2, 3] }), [
      { kind: 'counter', dice: [0] },
      { kind: 'pass' },
    ]).history[0]
    expect(unlanded(report, 0, 0)).toBe(6)
    expect(unlanded(report, 0, BACKFIRE_MS)).toBe(0)
    expect(unlanded(report, 1, 0)).toBe(0)
  })
})
