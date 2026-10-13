// 画面に出す文のテスト。記録と理由を、見ている側から文にする

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { legalActions, resolveStep } from '../game/rules'
import type { Action, PlayerIndex, StepReport } from '../game/types'
import { makeState, stateArb } from '../test/helpers'
import { actionLabel, CANNOT_USE, issueText, reportLines, resultText } from './text'

const pass: Action = { kind: 'pass' }
const bullet: Action = { kind: 'bullet', dice: [0, 1] }
const fire: Action = { kind: 'flameStrike', dice: [0, 1] }
const interrupt: Action = { kind: 'interrupt', dice: [0] }

/** 双方が r0 と r1 を振って a0 と a1 を出したステップの記録 */
const report = (r0: number[], r1: number[], a0: Action, a1: Action): StepReport =>
  resolveStep(makeState({ roll: r0 }, { roll: r1 }), [a0, a1]).history[0]

describe('公開の文', () => {
  const lines = (r0: number[], r1: number[], a0: Action, a1: Action, viewer: PlayerIndex = 0) =>
    reportLines(report(r0, r1, a0, a1), viewer)

  it('攻撃と何もしない', () => {
    expect(lines([6, 6, 1], [1, 2, 3], bullet, pass)).toEqual(['あなたの魔弾 4点', '相手は何もしなかった'])
  })
  it('炎撃は X の枠に置いた目に2を足して書き、焼けた分を添える', () => {
    expect(lines([2, 6, 1], [1, 2, 3], fire, pass)).toEqual([
      'あなたの炎撃 4点',
      '相手は何もしなかった',
      'あなたは炎撃で自分も 6点焼けた',
    ])
  })
  it('風壁に削られた攻撃は、削った目と通った点を示し、風壁は返した点を示す', () => {
    expect(lines([5, 1, 1], [1, 2, 1], fire, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの炎撃 7点、風壁 1 に削られて 5点',
      '相手は 1 で風壁を張った。3点を返した',
      'あなたは炎撃で自分も 1点焼けた',
    ])
  })
  it('魔弾は風壁をすり抜け、風壁は返さない', () => {
    expect(lines([3, 3, 1], [6, 2, 1], bullet, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの魔弾 4点、風壁をすり抜けた',
      '相手は 6 で風壁を張った',
    ])
  })
  it('風壁をすり抜けた攻撃', () => {
    const charged = makeState({ roll: [1, 2, 3], chant: 'charged' }, { roll: [6, 2, 1] }, 2)
    const r = resolveStep(charged, [
      { kind: 'spearCast', dice: [0, 1] },
      { kind: 'barrier', dice: [0] },
    ]).history[0]
    expect(reportLines(r, 0)).toEqual(['あなたの魔槍の発動 3点、風壁をすり抜けた', '相手は 6 で風壁を張った'])
  })
  it('相手が焼けた分も、相手の行として添える', () => {
    expect(lines([1, 2, 3], [6, 3, 1], pass, fire)).toEqual([
      'あなたは何もしなかった',
      '相手の炎撃 8点',
      '相手は炎撃で自分も 3点焼けた',
    ])
  })
  it('詠唱は攻撃では崩れず、氷礫で崩れる', () => {
    expect(lines([2, 1, 1], [6, 1, 1], { kind: 'spearChant', dice: [0] }, interrupt)).toEqual([
      'あなたは 2 で魔槍を詠唱',
      '相手の氷礫 2点',
      'あなたの詠唱は氷礫で崩れた',
    ])
    expect(lines([2, 1, 1], [6, 1, 1], { kind: 'spearChant', dice: [0] }, fire)).toContain('あなたの詠唱は保たれた')
    expect(lines([2, 1, 1], [1, 1, 1], { kind: 'spearChant', dice: [0] }, pass)).toContain('あなたの詠唱は保たれた')
  })
  it('相手の席から見ると、相手の行動をあなたとして先に書く', () => {
    expect(lines([2, 1, 1], [6, 1, 1], { kind: 'spearChant', dice: [0] }, interrupt, 1)).toEqual([
      'あなたの氷礫 2点',
      '相手は 2 で魔槍を詠唱',
      '相手の詠唱は氷礫で崩れた',
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
          // 詠唱した側には詠唱の結果を、自分も焼けた側には焼けた点を、一行ずつ添える
          expect(out).toHaveLength(2 + r.chants.filter((c) => c !== null).length + r.burn.filter((n) => n > 0).length)
          for (const l of out) expect(l).toMatch(/\S/)
        },
      ),
    )
  })
  it('公開時の行動名', () => {
    expect(actionLabel(pass)).toBe('何もしない')
    expect(actionLabel({ kind: 'spearChant', dice: [0] })).toBe('魔槍の詠唱')
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
