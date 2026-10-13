// 公開の途中で、まだ当たっていないダメージ。その分だけ体力を多く見せる。

import { describe, expect, it } from 'vitest'
import { resolveStep } from '../game/rules'
import { makeState } from '../test/helpers'
import { BURN_MS, IMPACT_MS } from './Exchange'
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

  it('守りが返すダメージも、矢印が当たる時刻まで数える', () => {
    // 氷礫の2は1の風壁に防がれ、風壁が3を返す
    const report = resolveStep(makeState({ roll: [6, 4, 1] }, { roll: [1, 2, 3] }), [
      { kind: 'interrupt', dice: [0] },
      { kind: 'barrier', dice: [0] },
    ]).history[0]
    expect(unlanded(report, 0, 0)).toBe(3)
    expect(unlanded(report, 0, IMPACT_MS)).toBe(0)
    expect(unlanded(report, 1, 0)).toBe(0)
  })

  it('自分が焼けるダメージは、攻撃を放つ時刻まで数える', () => {
    // X の枠に4を置いた炎撃は6を当て、もう1個の6だけ自分も焼ける
    const report = resolveStep(makeState({ roll: [6, 4, 1] }, { roll: [1, 2, 3] }), [
      { kind: 'flameStrike', dice: [1, 0] },
      { kind: 'pass' },
    ]).history[0]
    expect(unlanded(report, 0, 0)).toBe(6)
    expect(unlanded(report, 0, BURN_MS)).toBe(0)
    // 相手に当たる分は、払った後もまだ当たっていない
    expect(unlanded(report, 1, BURN_MS)).toBe(6)
    expect(unlanded(report, 1, IMPACT_MS)).toBe(0)
  })
})
