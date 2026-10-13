// 画面に出す文のテスト。記録と理由を、見ている側から文にする

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { legalActions, resolveStep } from '../game/rules'
import type { Action, PlayerIndex, StepReport } from '../game/types'
import { makeState, stateArb } from '../test/helpers'
import { actionLabel, CANNOT_USE, issueText, reportLines, resultText } from './text'

const pass: Action = { kind: 'pass' }
const twin: Action = { kind: 'twin', dice: [0, 1] }
const blood: Action = { kind: 'bloodBullet', dice: [0, 1] }

/** 双方が r0 と r1 を振って a0 と a1 を出したステップの記録 */
const report = (r0: number[], r1: number[], a0: Action, a1: Action): StepReport =>
  resolveStep(makeState({ roll: r0 }, { roll: r1 }), [a0, a1]).history[0]

describe('公開の文', () => {
  const lines = (r0: number[], r1: number[], a0: Action, a1: Action, viewer: PlayerIndex = 0) =>
    reportLines(report(r0, r1, a0, a1), viewer)

  it('攻撃と何もしない', () => {
    expect(lines([6, 6, 1], [1, 2, 3], twin, pass)).toEqual(['あなたの双炎 8点', '相手は何もしなかった'])
  })
  it('血弾は X の枠に置いた目で書き、払った血を添える', () => {
    expect(lines([2, 6, 1], [1, 2, 3], blood, pass)).toEqual([
      'あなたの血弾 2点',
      '相手は何もしなかった',
      'あなたは血弾で 6点の血を払った',
    ])
  })
  it('障壁に削られた攻撃は、削った目と通った点を示す', () => {
    expect(lines([3, 3, 1], [1, 2, 1], twin, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの双炎 5点、障壁 1 に削られて 4点',
      '相手は 1 で障壁を張った',
    ])
  })
  it('障壁をすり抜けた攻撃', () => {
    const charged = makeState({ roll: [1, 2, 3], chant: 'charged' }, { roll: [6, 2, 1] }, 2)
    const r = resolveStep(charged, [
      { kind: 'spearCast', dice: [0, 1] },
      { kind: 'barrier', dice: [0] },
    ]).history[0]
    expect(reportLines(r, 0)).toEqual(['あなたの雷槍の発動 3点、障壁をすり抜けた', '相手は 6 で障壁を張った'])
  })
  it('相手が払った血も、相手の行として添える', () => {
    expect(lines([1, 2, 3], [1, 1, 1], pass, { kind: 'overload', dice: [0, 1, 2] })).toEqual([
      'あなたは何もしなかった',
      '相手の過負荷 6点',
      '相手は過負荷で 3点の血を払った',
    ])
  })
  it('詠唱が崩れたときと保たれたとき', () => {
    expect(lines([2, 1, 1], [6, 1, 1], { kind: 'spearChant', dice: [0] }, blood)).toEqual([
      'あなたは 2 で雷槍を詠唱',
      '相手の血弾 6点',
      'あなたの詠唱は 6点を受けて崩れた',
      '相手は血弾で 1点の血を払った',
    ])
    expect(lines([2, 1, 1], [1, 1, 1], { kind: 'spearChant', dice: [0] }, pass)).toContain('あなたの詠唱は保たれた')
  })
  it('相手の席から見ると、相手の行動をあなたとして先に書く', () => {
    expect(lines([2, 1, 1], [6, 1, 1], { kind: 'spearChant', dice: [0] }, blood, 1)).toEqual([
      'あなたの血弾 6点',
      '相手は 2 で雷槍を詠唱',
      '相手の詠唱は 6点を受けて崩れた',
      'あなたは血弾で 1点の血を払った',
    ])
  })
  it('どの局面でも、双方について一行ずつ、あなたと相手の順に並ぶ', () => {
    fc.assert(
      fc.property(
        stateArb.chain((s) =>
          fc.tuple(fc.constant(s), fc.constantFrom(...legalActions(s, 0)), fc.constantFrom(...legalActions(s, 1))),
        ),
        fc.constantFrom<PlayerIndex>(0, 1),
        ([s, a0, a1], viewer) => {
          const r = resolveStep(s, [a0, a1]).history[0]
          const out = reportLines(r, viewer)
          expect(out[0]).toMatch(/^あなた/)
          expect(out[1]).toMatch(/^相手/)
          // 詠唱した側には詠唱の結果を、血を払った側には払った点を、一行ずつ添える
          expect(out).toHaveLength(2 + r.chants.filter((c) => c !== null).length + r.blood.filter((n) => n > 0).length)
          for (const l of out) expect(l).toMatch(/\S/)
        },
      ),
    )
  })
  it('公開時の行動名', () => {
    expect(actionLabel(pass)).toBe('何もしない')
    expect(actionLabel({ kind: 'spearChant', dice: [0] })).toBe('雷槍の詠唱')
  })
})

describe('決定できない理由の文', () => {
  it.each([
    [{ type: 'mark', mark: 'X' }, 'X の枠に置く'],
    [{ type: 'more', count: 1, same: false }, 'あと1個置く'],
    [{ type: 'more', count: 1, same: true }, '同じ目をあと1個置く'],
    [{ type: 'left' }, '左の枠に置く'],
    [{ type: 'same', count: 2 }, '同じ目を2個置く'],
    [{ type: 'unusable' }, CANNOT_USE],
  ] as const)('%j', (issue, want) => {
    expect(issueText(issue)).toBe(want)
  })
})

describe('勝敗の文', () => {
  it('片方だけ倒れたら、勝ち負けだけを書く', () => {
    expect(resultText(0, [3, -2], 0)).toBe('あなたの勝ち')
    expect(resultText(0, [3, -2], 1)).toBe('相手の勝ち')
    expect(resultText(1, [0, 7], 0)).toBe('相手の勝ち')
  })
  it('同時に0以下で決着したら、はみ出した体力を見ている側から並べる', () => {
    expect(resultText(0, [-1, -3], 0)).toBe('相打ち。−1 対 −3 で、あなたの勝ち')
    expect(resultText(0, [-1, -3], 1)).toBe('相打ち。−3 対 −1 で、相手の勝ち')
    expect(resultText(1, [-4, 0], 0)).toBe('相打ち。−4 対 0 で、相手の勝ち')
  })
  it('引き分け', () => {
    expect(resultText('draw', [-2, -2], 0)).toBe('相打ち。引き分けです')
  })
})
