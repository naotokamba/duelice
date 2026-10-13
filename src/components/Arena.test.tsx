// @vitest-environment happy-dom
// 二人の間の段。ターンとステップの箱、一つ前の結果、勝敗、履歴の印とメニュー、切り替わりの幕を、渡した状態どおりに描くか。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveStep } from '../game/rules'
import type { StepReport } from '../game/types'
import { makeState } from '../test/helpers'
import { Arena, TurnLabel } from './Arena'
import { place } from './MatchMenu'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** 1ステップ目に自分が魔弾4、2ステップ目は両者パスの記録 */
function history(): StepReport[] {
  const s1 = resolveStep(makeState({ roll: [6, 6, 1] }, { roll: [1, 2, 3] }), [
    { kind: 'bullet', dice: [0, 1] },
    { kind: 'pass' },
  ])
  return resolveStep(s1, [{ kind: 'pass' }, { kind: 'pass' }]).history
}

function draw(over: Partial<Parameters<typeof Arena>[0]> = {}) {
  render(
    <Arena
      turn={1}
      step={2}
      history={history()}
      revealing={false}
      lines={null}
      over={null}
      banner={null}
      onSurrender={vi.fn()}
      {...over}
    />,
  )
}

describe('ターンとステップの箱', () => {
  it('今のターンとステップを読み上げる', () => {
    render(<TurnLabel turn={2} step={1} />)
    expect(screen.getByText('Turn 2 - Step 1')).toBeTruthy()
  })
})

describe('二人の間の段', () => {
  it('選んでいる間は一つ前の結果だけと、履歴の印とメニューを出す', () => {
    draw()
    const latest = within(screen.getByRole('region', { name: '一つ前の結果' }))
    expect(latest.getAllByRole('listitem')).toHaveLength(1)
    expect(latest.getAllByRole('img', { name: 'パス' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: '戦闘履歴' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'メニュー' })).toBeTruthy()
  })

  it('公開の最中は、結果も履歴の印も切り替わりの幕も出さず、公開の内容を読み上げる', () => {
    draw({ revealing: true, lines: ['あなたは何もしなかった'], banner: { text: 'Step 2', turn: false } })
    expect(screen.queryByRole('region', { name: '一つ前の結果' })).toBeNull()
    expect(screen.queryByRole('button', { name: '戦闘履歴' })).toBeNull()
    expect(screen.queryByText('Step 2')).toBeNull()
    expect(screen.getByText('あなたは何もしなかった')).toBeTruthy()
  })

  it('切り替わりを幕で知らせる', () => {
    draw({ banner: { text: 'Turn 2', turn: true } })
    expect(screen.getByText('Turn 2')).toBeTruthy()
  })

  it('決着したら勝敗と次の対局の始め方を出し、メニューには降参を出さない', () => {
    const onAgain = vi.fn()
    const onRelevel = vi.fn()
    draw({ revealing: true, over: { winner: 0, hp: [5, -2], onAgain, onRelevel }, onSurrender: undefined })
    expect(screen.getByText('あなたの勝ち')).toBeTruthy()
    expect(screen.getByRole('region', { name: '一つ前の結果' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'もう一戦' }))
    fireEvent.click(screen.getByRole('button', { name: '強さを選び直す' }))
    expect(onAgain).toHaveBeenCalled()
    expect(onRelevel).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
    const menu = screen.getByRole('dialog', { name: 'メニュー' })
    expect(within(menu).queryByRole('button', { name: '降参' })).toBeNull()
  })

  it.each([
    ['draw', [-2, -2], '相打ち。引き分けです'],
    [1, [-2, 4], '相手の勝ち'],
    [0, [0, -3], '相打ち。0 対 −3 で、あなたの勝ち'],
    [1, [-3, -1], '相打ち。−3 対 −1 で、相手の勝ち'],
  ] as const)('勝敗 %s を出す', (winner, hp, text) => {
    draw({ revealing: true, over: { winner, hp: [hp[0], hp[1]], onAgain: vi.fn(), onRelevel: vi.fn() } })
    expect(screen.getByText(text)).toBeTruthy()
  })
})

describe('メニューの置き場所', () => {
  /** 画面の高さ 800、幅 1000 で、ボタンと高さ 120 のメニューを rect の位置に置く */
  function placeAt(button: Partial<DOMRect>) {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
    const from = document.createElement('button')
    const menu = document.createElement('dialog')
    vi.spyOn(from, 'getBoundingClientRect').mockReturnValue(button as DOMRect)
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ height: 120 } as DOMRect)
    place(menu, from)
    return menu.style
  }

  it('ボタンの右端に揃えて、すぐ下に出す', () => {
    const style = placeAt({ top: 52, bottom: 100, right: 960 })
    expect(style.top).toBe('108px')
    expect(style.right).toBe('40px')
  })

  it('下に収まらなければ、ボタンの上に出す', () => {
    const style = placeAt({ top: 700, bottom: 748, right: 1000 })
    expect(style.top).toBe('572px')
    // 画面の端からは離す
    expect(style.right).toBe('8px')
  })
})
