// @vitest-environment happy-dom
// 印に添える一行の説明。マウスを重ねる、押す、キーボードで選ぶ、のどれでも出て、外を押すか Esc で閉じる。

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tip } from './Tip'

afterEach(cleanup)

function two() {
  render(
    <div>
      <Tip text="6ダメージを与える">★</Tip>
      <Tip text="受けるダメージを3減らす">盾</Tip>
      <p>外</p>
    </div>,
  )
  return {
    star: screen.getByRole('button', { name: '6ダメージを与える' }),
    shield: screen.getByRole('button', { name: '受けるダメージを3減らす' }),
    tip: () => screen.queryByRole('tooltip')?.textContent ?? null,
  }
}

describe('印の説明', () => {
  it('押すと出て、外を押すと閉じる', () => {
    const t = two()
    expect(t.tip()).toBeNull()
    fireEvent.click(t.star)
    expect(t.tip()).toBe('6ダメージを与える')
    expect(t.star.getAttribute('aria-describedby')).toBeTruthy()
    fireEvent.pointerDown(t.star)
    expect(t.tip()).toBe('6ダメージを与える')
    fireEvent.pointerDown(screen.getByText('外'))
    expect(t.tip()).toBeNull()
  })
  it('開いているのは一つだけ', () => {
    const t = two()
    fireEvent.click(t.star)
    fireEvent.click(t.shield)
    expect(screen.getAllByRole('tooltip').map((e) => e.textContent)).toEqual(['受けるダメージを3減らす'])
  })
  it('マウスは重ねると出て、離すと閉じる。指で触れても重ねただけでは出ない', () => {
    const t = two()
    fireEvent.pointerEnter(t.star, { pointerType: 'touch' })
    expect(t.tip()).toBeNull()
    fireEvent.pointerEnter(t.star, { pointerType: 'mouse' })
    expect(t.tip()).toBe('6ダメージを与える')
    fireEvent.pointerLeave(t.star, { pointerType: 'mouse' })
    expect(t.tip()).toBeNull()
    fireEvent.pointerLeave(t.star, { pointerType: 'touch' })
  })
  it('キーボードで選ぶと出て、Esc か選び直しで閉じる', () => {
    const t = two()
    act(() => t.star.focus())
    expect(t.tip()).toBe('6ダメージを与える')
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(t.tip()).toBe('6ダメージを与える')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(t.tip()).toBeNull()
    act(() => t.star.focus())
    act(() => t.star.blur())
    expect(t.tip()).toBeNull()
  })
})
