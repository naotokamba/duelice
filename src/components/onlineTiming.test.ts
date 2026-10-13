// オンライン対戦の持ち時間は、解決してから公開の演出と次のステップの帯が終わるまで数え始めない。
// サーバの猶予 REVEAL_GRACE_MS と START_GRACE_MS が、画面の演出の長さより短くならないことを確かめる。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { legalActions, resolveStep } from '../game/rules'
import { REVEAL_GRACE_MS, START_GRACE_MS } from '../online/protocol'
import { stateArb } from '../test/helpers'
import { revealMs } from './Exchange'
import { BANNER_MS } from './useRevealClock'

describe('持ち時間の猶予', () => {
  it('どの解決でも、公開の演出と次の帯は、解決の後の猶予の間に終わる', () => {
    const arb = stateArb.chain((s) =>
      fc.record({
        s: fc.constant(s),
        a0: fc.constantFrom(...legalActions(s, 0)),
        a1: fc.constantFrom(...legalActions(s, 1)),
      }),
    )
    fc.assert(
      fc.property(arb, ({ s, a0, a1 }) => {
        const report = resolveStep(s, [a0, a1]).history.at(-1)
        if (!report) throw new Error('記録が無い')
        expect(revealMs(report) + BANNER_MS).toBeLessThanOrEqual(REVEAL_GRACE_MS)
      }),
      { numRuns: 2000 },
    )
  })

  it('最初のターンの帯は、対局が始まった後の猶予の間に終わる', () => {
    expect(BANNER_MS).toBeLessThanOrEqual(START_GRACE_MS)
  })
})
