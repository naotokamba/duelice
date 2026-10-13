// 画面に出す文のテスト。記録と理由を、見ている側から文にする

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { legalActions, resolveStep } from '../game/rules'
import type { Action, PlayerIndex, StepReport } from '../game/types'
import { makeState, stateArb } from '../test/helpers'
import { actionLabel, CANNOT_USE, issueText, reportLines, resultText } from './text'

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
    expect(lines([5, 1, 1], [1, 2, 1], fireball, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの火球 5点、障壁 1 に削られて 3点',
      '相手は 1 で障壁を張った',
    ])
  })
  it('障壁をすり抜けた攻撃', () => {
    expect(lines([1, 2, 3], [6, 2, 1], { kind: 'bullet', dice: [0, null] }, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの魔弾 2点、障壁をすり抜けた',
      '相手は 6 で障壁を張った',
    ])
  })
  it('反撃に打ち消されて返された攻撃', () => {
    expect(lines([5, 4, 1], [2, 2, 1], fireball, { kind: 'counter', dice: [0] })).toEqual([
      'あなたの火球 5点は反撃で打ち消され、4点返された',
      '相手は 2 で反撃を構えた',
    ])
  })
  it('反撃の上限を超えて通した攻撃と、外れた反撃', () => {
    expect(lines([6, 4, 1], [2, 2, 1], fireball, { kind: 'counter', dice: [0] })).toEqual([
      'あなたの火球 6点、反撃では返せなかった',
      '相手は 2 で反撃を構えた',
      '相手の反撃は外れて 4点を受けた',
    ])
  })
  it('攻撃が来なくて外れた反撃は、自分で受けた点を添える', () => {
    expect(lines([3, 4, 1], [2, 2, 1], { kind: 'counter', dice: [0] }, pass)).toEqual([
      'あなたは 3 で反撃を構えた',
      '相手は何もしなかった',
      'あなたの反撃は外れて 6点を受けた',
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
          // 詠唱した側には詠唱の結果を、反撃が外れた側には自分で受けた点を、一行ずつ添える
          expect(out).toHaveLength(
            2 + r.chants.filter((c) => c !== null).length + r.backfire.filter((n) => n > 0).length,
          )
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
    [{ type: 'more', count: 1 }, 'あと1個置く'],
    [{ type: 'left' }, '左の枠に置く'],
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
