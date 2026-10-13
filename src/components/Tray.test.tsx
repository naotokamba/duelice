// @vitest-environment happy-dom
// 手元のダイス。カードに置いたダイスと使ったダイスは跡になり、残りだけを押せる。凍ったダイスは押せない。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveStep } from '../game/rules'
import { makeState } from '../test/helpers'
import { seatView } from './seatView'
import { Tray, type TrayPlay, trayCount } from './Tray'

afterEach(cleanup)

const noDrag = () => ({
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  onPointerCancel: vi.fn(),
})

/** 1個目のダイスを1ステップ目に使い、2個目をカードに置いている二ステップ目の席 */
function seat() {
  return seatView(makeState({ roll: [6, 2, 1], usedDice: [0], usedCards: ['barrier'] }, { roll: [1, 2, 3] }, 2), 0)
}

describe('手元のダイス', () => {
  it('置いたダイスと使ったダイスは跡になり、残りのダイスだけを押せる', () => {
    const onTap = vi.fn()
    const play: TrayPlay = { held: 2, onTap, drag: noDrag, lifted: null }
    render(
      <Tray
        seat={seat()}
        shown={{ card: 'flameStrike', kind: 'flameStrike', slots: [1, null], complete: false }}
        rolling={false}
        play={play}
      />,
    )
    const tray = within(screen.getByRole('group', { name: 'ダイス' }))
    expect(tray.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['1の目'])
    expect(tray.getByRole('button', { name: '1の目' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(tray.getByRole('button', { name: '1の目' }))
    expect(onTap).toHaveBeenCalledWith(2)
  })

  it('選んでいない間や相手の手元は、押せない絵として描く', () => {
    render(<Tray seat={seat()} shown={null} rolling={false} />)
    const tray = within(screen.getByRole('group', { name: 'ダイス' }))
    expect(tray.queryAllByRole('button')).toEqual([])
    expect(tray.getAllByRole('img').map((d) => d.getAttribute('aria-label'))).toEqual(['2の目', '1の目'])
  })

  it('好きな目のダイスは、点を打たずに好きな目と読み上げる', () => {
    const deck = ['transmute', 'freeze', 'meditate', 'barrier', 'allOut'] as const
    const s = makeState({ roll: [6, 2, 1], deck }, { roll: [1, 2, 3] })
    const next = resolveStep(s, [{ kind: 'transmute', dice: [0] }, { kind: 'pass' }])
    render(<Tray seat={seatView(next, 0)} shown={null} rolling={false} />)
    const tray = within(screen.getByRole('group', { name: 'ダイス' }))
    const wild = tray.getAllByRole('img').filter((d) => d.getAttribute('aria-label') === '好きな目')
    expect(wild).toHaveLength(3)
    for (const d of wild) expect(d.querySelectorAll('.pip:not(.pip-empty)')).toHaveLength(0)
  })

  it('持ち越したダイスと振り足したダイスは、押せるまま角の印と説明を付ける', () => {
    const deck = ['overload', 'freeze', 'meditate', 'barrier', 'allOut'] as const
    const s = makeState({ roll: [6, 2, 1, 4], deck }, { roll: [1, 2, 3] })
    const next = resolveStep(s, [{ kind: 'overload', dice: [0] }, { kind: 'pass' }], [[5, 3], []])
    render(
      <Tray
        seat={seatView(next, 0)}
        shown={null}
        rolling={false}
        play={{ held: null, onTap: vi.fn(), drag: noDrag, lifted: null }}
      />,
    )
    const tray = within(screen.getByRole('group', { name: 'ダイス' }))
    const dice = tray.getAllByRole('button')
    expect(dice.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-description')])).toEqual([
      ['2の目', null],
      ['1の目', null],
      ['4の目', '前のターンから持ち越した'],
      ['5の目', '振り足した'],
      ['3の目', '振り足した'],
    ])
    expect(dice[2].querySelector('.die-badge')).not.toBeNull()
    expect(dice[0].querySelector('.die-badge')).toBeNull()
    // 4個より多いときは、使ったダイスの跡を残さない
    expect(document.querySelectorAll('.socket')).toHaveLength(0)
  })

  it('凍って置けないダイスは、選んでいる間も押せない絵として描く', () => {
    const s = makeState({ roll: [2, 5, 2], frozen: 2 }, { roll: [1, 2, 3] })
    const onTap = vi.fn()
    render(
      <Tray
        seat={seatView(s, 0)}
        shown={null}
        rolling={false}
        play={{ held: null, onTap, drag: noDrag, lifted: null }}
      />,
    )
    const tray = within(screen.getByRole('group', { name: 'ダイス' }))
    expect(tray.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['5の目'])
    const frozen = tray.getAllByRole('img')
    expect(frozen.map((d) => [d.getAttribute('aria-label'), d.getAttribute('aria-description')])).toEqual([
      ['2の目', '凍って置けない'],
      ['2の目', '凍って置けない'],
    ])
    fireEvent.click(frozen[0])
    expect(onTap).not.toHaveBeenCalled()
  })

  it('並べる数は、4個までなら跡も数え、それより多ければ残っているダイスだけを数える', () => {
    expect(trayCount(seat(), null)).toBe(3)
    const deck = ['overload', 'freeze', 'meditate', 'barrier', 'allOut'] as const
    const s = makeState({ roll: [6, 2, 1, 4], deck }, { roll: [1, 2, 3] })
    const next = seatView(resolveStep(s, [{ kind: 'overload', dice: [0] }, { kind: 'pass' }], [[5, 3], []]), 0)
    expect(trayCount(next, null)).toBe(5)
    expect(trayCount(next, { card: 'allOut', kind: 'allOut', slots: [4, null, null, null], complete: true })).toBe(4)
  })
})
