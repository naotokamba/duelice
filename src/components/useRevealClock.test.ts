// 公開の途中で、まだ当たっていないダメージ。その分だけ体力を多く見せる。

import { describe, expect, it } from 'vitest'
import { resolveStep } from '../game/rules'
import { makeState } from '../test/helpers'
import { BLOOD_MS, IMPACT_MS } from './Exchange'
import { unlanded } from './useRevealClock'

describe('まだ当たっていないダメージ', () => {
  it('矢印が当たる時刻までは数え、当たったら数えない', () => {
    const report = resolveStep(makeState({ roll: [6, 6, 1] }, { roll: [1, 2, 3] }), [
      { kind: 'bullet', dice: [0, 1] },
      { kind: 'pass' },
    ]).history[0]
    expect(unlanded(report, 1, 0)).toBe(4)
    expect(unlanded(report, 1, IMPACT_MS)).toBe(0)
    expect(unlanded(report, 0, 0)).toBe(0)
  })

  it('血として払うダメージは、攻撃を放つ時刻まで数える', () => {
    // 3個置いた過負荷は6を当て、3の血を払う
    const report = resolveStep(makeState({ roll: [6, 4, 1] }, { roll: [1, 2, 3] }), [
      { kind: 'overload', dice: [0, 1, 2] },
      { kind: 'pass' },
    ]).history[0]
    expect(unlanded(report, 0, 0)).toBe(3)
    expect(unlanded(report, 0, BLOOD_MS)).toBe(0)
    // 相手に当たる分は、払った後もまだ当たっていない
    expect(unlanded(report, 1, BLOOD_MS)).toBe(6)
    expect(unlanded(report, 1, IMPACT_MS)).toBe(0)
  })
})
