// @vitest-environment happy-dom
// 画面の文言。平易に書き、括弧で補足しない。説明が要るなら、括弧に入れずに文を分ける。

import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { button, dice, fromMenu, passOpponent, start, useFakeClock } from '../test/screen'

beforeEach(useFakeClock)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** 画面に出ている文言と、読み上げの名前と説明 */
function wording(): string {
  const labels = [...document.querySelectorAll('[aria-label], [title], [aria-description]')].flatMap((el) =>
    ['aria-label', 'title', 'aria-description'].map((a) => el.getAttribute(a) ?? ''),
  )
  return [document.body.textContent ?? '', ...labels].join('\n')
}

describe('画面の文言', () => {
  it('タイトル、対局の画面、ルールのどこにも括弧が無い', async () => {
    const user = await start({
      rng: dice([
        [6, 5, 2],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await fromMenu(user, 'ルール')
    expect(screen.getByRole('dialog', { name: 'ルール' })).toBeTruthy()
    expect(button('メニュー')).toBeTruthy()
    expect(wording()).not.toMatch(/[()（）]/)
  })
})
