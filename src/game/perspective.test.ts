// 見る側の入れ替えのテスト。入れ替えても規則の上で同じ局面になり、二度入れ替えると元に戻ることを、乱数の局面で確かめる。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeState, playRandom, seeded, stateArb } from '../test/helpers'
import { newMatch, submit } from './match'
import { flipReport, flipState, other, resolutionFor, stateFor } from './perspective'
import { isLegal, legalActions, resolveStep } from './rules'
import type { Action, GameState, StepReport } from './types'

/** 局面と、双方の合法な行動 */
const stateWithActsArb = stateArb.chain((s) =>
  fc
    .tuple(fc.constantFrom(...legalActions(s, 0)), fc.constantFrom(...legalActions(s, 1)))
    .map((acts) => ({ s, acts: acts as [Action, Action] })),
)

describe('見る側の入れ替え', () => {
  it('相手の席', () => {
    expect([other(0), other(1)]).toEqual([1, 0])
  })
  it('入れ替えた盤で解決すると、解決してから入れ替えたのと同じになる。攻撃の並びまで同じ', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        const flipped = resolveStep(flipState(s), [acts[1], acts[0]])
        expect(flipped).toEqual(flipState(resolveStep(s, acts)))
      }),
    )
  })
  it('入れ替えた盤では、席を入れ替えて同じ行動が合法になる', () => {
    fc.assert(
      fc.property(stateWithActsArb, ({ s, acts }) => {
        expect(isLegal(flipState(s), 1, acts[0])).toBe(true)
        expect(isLegal(flipState(s), 0, acts[1])).toBe(true)
      }),
    )
  })
  it('二度入れ替えると元に戻る。履歴のある盤でも', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const s of playRandom(seed).states) {
        expect(flipState(flipState(s))).toEqual(s)
        for (const r of s.history) expect(flipReport(flipReport(r))).toEqual(r)
      }
    }
  })
  it('決着は入れ替え、引き分けと決着前はそのまま', () => {
    const s = makeState({ roll: [1, 2, 3] }, { roll: [4, 5, 6] })
    const won = (winner: GameState['winner']) => flipState({ ...s, winner }).winner
    expect([won(0), won(1), won('draw'), won(null)]).toEqual([1, 0, 'draw', null])
  })
  it('守りが返したダメージは、入れ替えた後も攻撃の後ろに、返した先の席の順で並ぶ', () => {
    const strike = (from: 0 | 1, outcome: StepReport['strikes'][number]['outcome']) => ({
      from,
      to: other(from),
      kind: 'barrier' as const,
      power: 3,
      outcome,
      dealt: 3,
    })
    const r = resolveStep(makeState({ roll: [1, 2, 3] }, { roll: [4, 5, 6] }), [{ kind: 'pass' }, { kind: 'pass' }])
      .history[0]
    const report: StepReport = {
      ...r,
      strikes: [strike(0, 'hit'), strike(1, 'hit'), strike(1, 'returned'), strike(0, 'returned')],
    }
    expect(flipReport(report).strikes.map((s) => [s.from, s.outcome])).toEqual([
      [0, 'hit'],
      [1, 'hit'],
      [1, 'returned'],
      [0, 'returned'],
    ])
  })
  it('席0にはそのまま、席1には入れ替えて見せる', () => {
    const m = newMatch(seeded(7))
    const first = submit(m, 0, { kind: 'pass' }, seeded(1))
    if (!first.ok) throw new Error(first.reason)
    const r = submit(first.match, 1, { kind: 'pass' }, seeded(1))
    if (!r.ok || !r.resolved) throw new Error('解決しなかった')
    expect(stateFor(m.state, 0)).toBe(m.state)
    expect(stateFor(m.state, 1)).toEqual(flipState(m.state))
    expect(resolutionFor(r.resolved, 0)).toBe(r.resolved)
    expect(resolutionFor(r.resolved, 1)).toEqual({
      state: flipState(r.resolved.state),
      report: flipReport(r.resolved.report),
    })
  })
})
