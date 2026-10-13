// @vitest-environment happy-dom
// 戦闘履歴。中央の一つ前の結果は行動とダイスとダメージだけを出し、履歴のモーダルでは起きたことの内訳を印で並べ、同じ中身を公開の文で読み上げる。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStep } from '../game/rules'
import type { Action, StepReport } from '../game/types'
import { makeState } from '../test/helpers'
import { HistoryButton, Recent } from './History'
import { reportLines } from './text'

afterEach(cleanup)

/** 自分と相手の出目と行動から、一つのステップの記録を作る */
function step(mine: number[], theirs: number[], acts: [Action, Action]): StepReport {
  return resolveStep(makeState({ roll: mine }, { roll: theirs }), acts).history[0]
}

/** 自分は6を X の枠、4をもう一つの枠に置いた炎撃で8を撃ち、4を自分も受ける。相手は2の風壁で4を減らし、3を返す */
const guarded = () =>
  step(
    [6, 4, 1],
    [2, 3, 5],
    [
      { kind: 'flameStrike', dice: [0, 1] },
      { kind: 'barrier', dice: [0] },
    ],
  )

/** 自分は6のゾロ目の魔弾で4を撃ち、相手の風壁をすり抜ける */
const pierced = () =>
  step(
    [6, 6, 1],
    [2, 3, 5],
    [
      { kind: 'bullet', dice: [0, 1] },
      { kind: 'barrier', dice: [0] },
    ],
  )

/** 自分は詠唱し、相手の氷礫で崩れる */
const broken = () =>
  step(
    [6, 4, 1],
    [2, 3, 5],
    [
      { kind: 'spearChant', dice: [0] },
      { kind: 'interrupt', dice: [0] },
    ],
  )

/** 自分は詠唱し、相手はパスするので保たれる */
const kept = () => step([6, 4, 1], [2, 3, 5], [{ kind: 'spearChant', dice: [0] }, { kind: 'pass' }])

/** 履歴のモーダルを開き、ステップの行を新しい順に返す */
function open(history: StepReport[]): HTMLElement[] {
  render(<HistoryButton history={history} />)
  fireEvent.click(screen.getByRole('button', { name: '戦闘履歴' }))
  const dialog = screen.getByRole('dialog', { name: '戦闘履歴' })
  return within(dialog).getAllByRole('listitem')
}

/** 行の中の、自分か相手の内訳の印。印の種類と、印に書いた数 */
function marks(entry: HTMLElement, side: 'me' | 'cpu'): string[] {
  const row = entry.querySelector(`.side-${side}`) as HTMLElement
  return [...row.querySelectorAll('.history-fx > svg')].map((svg) => {
    const kind = svg.getAttribute('class')?.trim() ?? ''
    const value = svg.querySelector('.glyph-value')?.textContent ?? ''
    return value ? `${kind} ${value}` : kind
  })
}

describe('戦闘履歴のモーダルの内訳', () => {
  it('守りで減った攻撃は、撃った側に威力の星、守った側に減らした分の盾と返した分の風の渦。自分も受けた分は炎', () => {
    const [entry] = open([guarded()])
    expect(marks(entry, 'me')).toEqual(['glyph-star 8', 'glyph-burn 4'])
    expect(marks(entry, 'cpu')).toEqual(['glyph-line 4', 'glyph-thorns 3'])
  })

  it('守りをすり抜けた攻撃は、突き抜けた星で描き、守った側には何も出さない', () => {
    const [entry] = open([pierced()])
    expect(marks(entry, 'me')).toEqual(['glyph-star glyph-pierce 4'])
    expect(marks(entry, 'cpu')).toEqual([])
  })

  it('詠唱が崩れたか保たれたかを、割れた魔法陣か割れていない魔法陣で描く', () => {
    const [kept1, broken1] = open([broken(), { ...kept(), turn: 2 }])
    expect(marks(broken1, 'me')).toEqual(['glyph-chant is-broken'])
    // 崩した氷礫は、相手の行に威力の星で出る
    expect(marks(broken1, 'cpu')).toEqual(['glyph-star 2'])
    expect(marks(kept1, 'me')).toEqual(['glyph-chant is-kept'])
  })

  it('印は読み上げず、同じ中身を公開の文で読み上げる', () => {
    const report = guarded()
    const [entry] = open([report])
    expect(entry.querySelector('.history-detail')?.getAttribute('aria-hidden')).toBe('true')
    expect(within(entry).getByText(reportLines(report, 0).join('。'))).toBeTruthy()
  })
})

describe('中央の一つ前の結果', () => {
  it('内訳の印も読み上げの文も出さない', () => {
    render(<Recent history={[guarded()]} />)
    const recent = screen.getByRole('region', { name: '一つ前の結果' })
    expect(recent.querySelector('.history-detail')).toBeNull()
    expect(recent.querySelector('.sr-only')).toBeNull()
  })
})
