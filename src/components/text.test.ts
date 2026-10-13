// 画面に出す文のテスト。記録と理由を、見ている側から文にする

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { legalActions, resolveStep } from '../game/rules'
import type { Action, PlayerIndex, StepReport } from '../game/types'
import { makeState, stateArb } from '../test/helpers'
import { actionLabel, CANNOT_USE, endingText, issueText, playLabel, reportLines, resultText } from './text'

const pass: Action = { kind: 'pass' }
const bullet: Action = { kind: 'bullet', dice: [0, 1] }
const fire: Action = { kind: 'flameStrike', dice: [0, 1] }
const interrupt: Action = { kind: 'interrupt', dice: [0] }

/** 双方が r0 と r1 を振って a0 と a1 を出したステップの記録 */
const report = (r0: number[], r1: number[], a0: Action, a1: Action): StepReport =>
  resolveStep(makeState({ roll: r0 }, { roll: r1 }), [a0, a1]).history[0]

describe('拡張のカードの公開の文', () => {
  const POOL_DECK = ['galeWard', 'thunder', 'wildfire', 'overload', 'darkWall'] as const
  /** 双方が拡張のカードを持ち込んだ盤 */
  const pool = (r0: number[], r1: number[], step: 1 | 2 = 1, hp1 = 20) =>
    makeState({ roll: r0, deck: POOL_DECK }, { roll: r1, hp: hp1 }, step)

  it('攻撃を返す構えに返された攻撃は、返されて自分が受けた点を書く', () => {
    const r = resolveStep(pool([2, 2, 1], [6, 1, 3]), [{ kind: 'galeWard', dice: [0, 1] }, fire]).history[0]
    expect(reportLines(r, 1)).toEqual([
      'あなたの炎撃 8点、風陣に返されて自分が 8点受けた',
      '相手は 2と2 で風陣を張った',
      'あなたは炎撃で自分も 1点受けた',
    ])
  })
  it('先に当たる攻撃で倒れた側は、行動が起きなかったと書く', () => {
    const r = resolveStep(pool([6, 1, 3], [6, 1, 3], 1, 4), [{ kind: 'thunder', dice: [0, 1] }, fire]).history[0]
    expect(reportLines(r, 0)).toEqual(['あなたの迅雷 6点', '相手は先に倒れて、炎撃は起きなかった'])
  })
  it('防ぎきってダイスが戻ったこと、振り足した目、ターンの終わりに焼けた分と延焼の点を書く', () => {
    let s = pool([3, 1, 2], [3, 1, 2])
    s = resolveStep(s, [{ kind: 'darkWall', dice: [0] }, fire])
    expect(reportLines(s.history[0], 0)).toEqual([
      'あなたは 3 で闇壁を張った',
      '相手の炎撃 5点、闇壁 3 に削られて 0点',
      'あなたは防ぎきって、ダイスが戻った',
      '相手は炎撃で自分も 1点受けた',
    ])
    s = { ...s, players: [{ ...s.players[0], usedCards: [] }, s.players[1]] }
    s = resolveStep({ ...s, step: 1 }, [{ kind: 'overload', dice: [0] }, pass], [[5, 6], []])
    expect(reportLines(s.history[1], 0)).toContain('あなたはダイスを振り足して 5と6')
    s = resolveStep(s, [{ kind: 'wildfire', dice: [1] }, pass])
    expect(reportLines(s.history[2], 0)).toEqual([
      'あなたは 1 で延焼を放った',
      '相手は何もしなかった',
      'ターンの終わりに、あなたは自分も 2点受けた',
      'ターンの終わりに、あなたの延焼 4点',
    ])
    expect(reportLines(s.history[2], 1)).toContain('ターンの終わりに、相手の延焼 4点')
  })
  it('返す構えに返す攻撃が来なかったら、返す攻撃が来ずに自分が受けた点を書く', () => {
    const r = resolveStep(pool([1, 2, 6], [3, 3, 1]), [{ kind: 'galeWard', dice: [0, 1] }, pass]).history[0]
    expect(reportLines(r, 0)).toEqual([
      'あなたは 1と2 で風陣を張った',
      '相手は何もしなかった',
      'あなたの風陣に返す攻撃が来ず、自分が 3点受けた',
    ])
  })
  it('凍らせる攻撃は、当たった点と、凍らされた側が次のステップに置けない目を書く', () => {
    const deck = ['freeze', 'flameStrike', 'barrier', 'bullet', 'interrupt'] as const
    const s = makeState({ roll: [4, 1, 1], deck }, { roll: [6, 4, 2], deck })
    const r = resolveStep(s, [
      { kind: 'freeze', dice: [0] },
      { kind: 'barrier', dice: [1] },
    ]).history[0]
    expect(reportLines(r, 0)).toEqual([
      'あなたの凍結 2点、風壁 4 に削られて 0点',
      '相手は 4 で風壁を張った。3点を返した',
      '相手は次のステップに 4 の目を置けない',
    ])
    expect(reportLines(r, 1)).toContain('あなたは次のステップに 4 の目を置けない')
  })
})

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
      'あなたは炎撃で自分も 6点受けた',
    ])
  })
  it('風壁に削られた攻撃は、削った目と通った点を示し、風壁は返した点を示す', () => {
    expect(lines([5, 1, 1], [1, 2, 1], fire, { kind: 'barrier', dice: [0] })).toEqual([
      'あなたの炎撃 7点、風壁 1 に削られて 5点',
      '相手は 1 で風壁を張った。3点を返した',
      'あなたは炎撃で自分も 1点受けた',
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
      '相手は炎撃で自分も 3点受けた',
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

describe('中央の勝敗の文', () => {
  it('見ている側から、勝ち、負け、引き分けのどれかだけを書く', () => {
    expect(resultText(0, 0)).toBe('勝ち')
    expect(resultText(0, 1)).toBe('負け')
    expect(resultText(1, 0)).toBe('負け')
    expect(resultText('draw', 0)).toBe('引き分け')
  })
})

describe('戦闘履歴の決着の文', () => {
  it('片方だけ倒れたら、勝ち負けだけを書く', () => {
    expect(endingText(0, [3, -2], 0)).toBe('あなたの勝ち')
    expect(endingText(0, [3, -2], 1)).toBe('あなたの負け')
    expect(endingText(1, [0, 7], 0)).toBe('あなたの負け')
  })
  it('同時に0以下で決着したら、相打ちと書き、はみ出した体力を見ている側から並べる', () => {
    expect(endingText(0, [-1, -3], 0)).toBe('相打ち。−1 対 −3 で、あなたの勝ち')
    expect(endingText(0, [-1, -3], 1)).toBe('相打ち。−3 対 −1 で、あなたの負け')
    expect(endingText(1, [-4, 0], 0)).toBe('相打ち。−4 対 0 で、あなたの負け')
    expect(endingText('draw', [-2, -2], 0)).toBe('相打ち。−2 対 −2 で、引き分け')
  })
})

describe('一緒に使ったカードと、もう一度出した効果の文', () => {
  const DECK = ['doubleCast', 'echo', 'flameStrike', 'interrupt', 'freeze'] as const
  const board = (r0: number[], r1: number[], step: 1 | 2 = 1) =>
    makeState(
      { roll: r0, deck: DECK },
      { roll: r1, deck: ['barrier', 'spear', 'bullet', 'interrupt', 'flameStrike'] },
      step,
    )

  it('一緒に使ったカードを先に書き、効果ごとに一文で書く。炎で焼けた分は焼けたカードの名前で書く', () => {
    const a: Action = {
      kind: 'doubleCast',
      dice: [0],
      with: [
        { kind: 'interrupt', dice: [1] },
        { kind: 'flameStrike', dice: [2, 3] },
      ],
    }
    const r = resolveStep(board([1, 3, 6, 2], [4, 5, 6]), [a, { kind: 'spearChant', dice: [0] }]).history[0]
    expect(reportLines(r, 0)).toEqual([
      'あなたは二重詠唱で、氷礫と炎撃を一緒に使った',
      'あなたの氷礫 2点',
      'あなたの炎撃 8点',
      '相手は 4 で魔槍を詠唱',
      '相手の詠唱は氷礫で崩れた',
      'あなたは炎撃で自分も 2点受けた',
    ])
    expect(playLabel(r, 0)).toBe('二重詠唱・氷礫・炎撃')
    expect(playLabel(r, 1)).toBe('魔槍の詠唱')
  })
  it('守りが減らした攻撃と、守りが返したダメージを、それぞれの効果の文に書く', () => {
    const a: Action = { kind: 'doubleCast', dice: [0], with: [{ kind: 'interrupt', dice: [1] }] }
    const r = resolveStep(board([1, 3, 6], [2, 5, 6]), [a, { kind: 'barrier', dice: [0] }]).history[0]
    expect(reportLines(r, 0)).toEqual([
      'あなたは二重詠唱で、氷礫を一緒に使った',
      'あなたの氷礫 2点、風壁 2 に削られて 0点',
      '相手は 2 で風壁を張った。3点を返した',
    ])
  })
  it('もう一度出した効果は、何を出したかを書き、出した効果の名前で書く', () => {
    const s = makeState(
      { roll: [1, 3, 6], deck: DECK, last: [{ kind: 'flameStrike', vals: [6, 1] }] },
      { roll: [4, 5, 6] },
      2,
    )
    const r = resolveStep(s, [{ kind: 'echo', dice: [0] }, pass]).history[0]
    expect(reportLines(r, 0)).toEqual([
      'あなたは残響で、炎撃をもう一度出した',
      'あなたの炎撃 8点',
      '相手は何もしなかった',
      'あなたは炎撃で自分も 1点受けた',
    ])
    expect(playLabel(r, 0)).toBe('残響→炎撃')
  })
  it('好きな目を選ぶことと、ほかのカードにも置くことを伝える', () => {
    expect(issueText({ type: 'pick' })).toBe('好きな目を選ぶ')
    expect(issueText({ type: 'with' })).toBe('ほかのカードにも置く')
  })
})
