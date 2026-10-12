// @vitest-environment happy-dom
// 手元のダイス。カードに置いたダイスと使ったダイスは跡になり、残りだけを押せる。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeState } from '../test/helpers'
import { seatView } from './seatView'
import { Tray, type TrayPlay } from './Tray'

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
        shown={{ card: 'fireball', kind: 'fireball', slots: [1, null], complete: false }}
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
})
