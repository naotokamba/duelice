// @vitest-environment happy-dom
// 好きな目のダイスの目を選ぶ窓。選べる目を並べ、凍らされた目は押せず、選ぶか戻すと閉じる。

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WildPicker } from './WildPicker'

afterEach(cleanup)

function draw(props: Partial<Parameters<typeof WildPicker>[0]> = {}) {
  const handlers = { onChoose: vi.fn(), onReturn: vi.fn(), onClose: vi.fn() }
  const view = render(<WildPicker die={3} frozen={null} {...handlers} {...props} />)
  return { ...handlers, ...view }
}

describe('目を選ぶ窓', () => {
  it('ダイスを渡すと開き、1から6を押せる。前に選んだ目は押された形で出す', () => {
    draw({ chosen: 4 })
    const dialog = screen.getByRole('dialog', { name: '目を選ぶ' })
    expect(dialog.hasAttribute('open')).toBe(true)
    for (const v of [1, 2, 3, 4, 5, 6]) expect(screen.getByRole('button', { name: `${v}の目` })).toBeTruthy()
    expect(screen.getByRole('button', { name: '4の目' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '1の目' }).getAttribute('aria-pressed')).toBe('false')
  })
  it('凍らされた目は押せない', () => {
    draw({ frozen: 5 })
    expect(screen.queryByRole('button', { name: '5の目' })).toBeNull()
    expect(screen.getByRole('img', { name: '5の目' }).getAttribute('aria-description')).toBe('凍って置けない')
  })
  it('目を押すと選び、手元に戻すを押すと戻して、どちらも閉じる', () => {
    const { onChoose, onReturn } = draw()
    fireEvent.click(screen.getByRole('button', { name: '6の目' }))
    expect(onChoose).toHaveBeenCalledWith(6)
    expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(false)
    cleanup()
    const second = draw()
    fireEvent.click(screen.getByRole('button', { name: '手元に戻す' }))
    expect(second.onReturn).toHaveBeenCalled()
    expect(onReturn).not.toHaveBeenCalled()
  })
  it('ダイスが無くなれば閉じる', () => {
    const { rerender, onChoose, onReturn, onClose } = draw()
    rerender(<WildPicker die={null} frozen={null} onChoose={onChoose} onReturn={onReturn} onClose={onClose} />)
    expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(false)
  })
})
