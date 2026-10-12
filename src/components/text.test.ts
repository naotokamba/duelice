// 画面に出す文のテスト。記録と理由を、見ている側から文にする

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { legalActions, resolveStep } from '../game/rules'
import type { Action, PlayerIndex, StepReport } from '../game/types'
import { makeState, stateArb } from '../test/helpers'
import { actionLabel, CANNOT_USE, issueText, reportLines } from './text'

const pass: Action = { kind: 'pass' }
const fireball: Action = { kind: 'fireball', dice: [0, 1] }

/** 双方が r0 と r1 を振って a0 と a1 を出したステップの記録 */
const report = (r0: number[], r1: number[], a0: Action, a1: Action): StepReport =>
  resolveStep(makeState({ roll: r0 }, { roll: r1 }), [a0, a1]).history[0]

describe('公開の文', () => {
  const lines = (r0: number[], r1: number[], a0: Action, a1: Action, viewer: PlayerIndex = 0) =>
    reportLines(report(r0, r1, a0, a1), viewer)

  it('攻撃と何もしない', () => {
    expect(lines([6, 2, 1], [1, 2, 3], fireball, pass)).toEqual(['あなたの火球 6点', '相手は何もしなかった'])
  })
  it('火球は X の枠に置いた目で書く', () => {
    expect(lines([2, 6, 1], [1, 2, 3], fireball, pass)).toEqual(['あなたの火球 2点', '相手は何もしなかった'])
  })
  it('障壁に削られた攻撃は、削った目と通った点を示す', () => {
    expect(lines([5, 1, 1], [3, 2, 1], fireball, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの火球 5点、障壁 3 に削られて 2点',
      '相手は 3 で障壁を張った',
    ])
  })
  it('障壁をすり抜けた攻撃', () => {
    expect(lines([1, 2, 3], [6, 2, 1], { kind: 'bullet', dice: [0, null] }, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの魔弾 2点、障壁をすり抜けた',
      '相手は 6 で障壁を張った',
    ])
  })
  it('反射で返された攻撃', () => {
    expect(lines([6, 4, 1], [2, 2, 1], fireball, { kind: 'reflect', dice: [0, 1] })).toEqual([
      'あなたの火球 6点は反射で返された',
      '相手は 2と2 で反射を構えた',
    ])
  })
  it('詠唱が崩れたときと保たれたとき', () => {
    expect(lines([2, 1, 1], [6, 1, 1], { kind: 'spearChant', dice: [0] }, fireball)).toEqual([
      'あなたは 2 で雷槍を詠唱',
      '相手の火球 6点',
      'あなたの詠唱は 6点を受けて崩れた',
    ])
    expect(lines([2, 1, 1], [1, 1, 1], { kind: 'spearChant', dice: [0] }, pass)).toContain('あなたの詠唱は保たれた')
  })
  it('相手の席から見ると、相手の行動をあなたとして先に書く', () => {
    expect(lines([2, 1, 1], [6, 1, 1], { kind: 'spearChant', dice: [0] }, fireball, 1)).toEqual([
      'あなたの火球 6点',
      '相手は 2 で雷槍を詠唱',
      '相手の詠唱は 6点を受けて崩れた',
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
          expect(out).toHaveLength(2 + r.chants.filter((c) => c !== null).length)
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
