// @vitest-environment happy-dom
// 明滅して光らせるのは、今押せるものだけ。状態の強調は色や枠で示して動かさない。
// styles.css で繰り返し動かしている要素を読み取り、対局のいろいろな場面で、その要素が今押せるボタンかを確かめる。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  button,
  dice,
  myCard,
  narrowScreen,
  passOpponent,
  place,
  start,
  trayDie,
  type User,
  useFakeClock,
} from '../test/screen'

beforeEach(useFakeClock)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * styles.css のうち、繰り返し動かす規則のセレクタ。動きを止める設定の中と、動きそのものの定義は除く。
 * ::after などの飾りは、飾りを持つ要素で数える
 */
function blinking(): string[] {
  const css = readFileSync(join(import.meta.dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const found: string[] = []
  const stack: string[] = []
  let buf = ''
  for (const ch of css) {
    if (ch === '{') {
      stack.push(buf.trim())
      buf = ''
    } else if (ch === '}') {
      const prelude = stack.pop() ?? ''
      const inside = stack.some((p) => p.startsWith('@keyframes') || p.includes('prefers-reduced-motion'))
      if (!prelude.startsWith('@') && !inside && /\binfinite\b/.test(buf)) {
        found.push(...prelude.split(',').map((s) => s.trim().replace(/::?(after|before)$/, '')))
      }
      buf = ''
    } else {
      buf += ch
    }
  }
  return found
}

/** 今押せる。押せるボタンか、押せるボタンを一つだけ包む枠 */
function pressable(el: Element): boolean {
  if (el.matches('button:not(:disabled)')) return true
  const inner = el.querySelectorAll('button')
  return inner.length === 1 && !inner[0].disabled
}

/** 今の画面で、光っているのに押せない要素 */
function blinkingButNotPressable(): string[] {
  return blinking().flatMap((sel) =>
    [...document.querySelectorAll(sel)]
      .filter((el) => !pressable(el))
      .map((el) => `${sel}: ${el.outerHTML.slice(0, 80)}`),
  )
}

/** 今の画面で光っている要素の数 */
const blinkCount = () => blinking().reduce((n, sel) => n + document.querySelectorAll(sel).length, 0)

const props = () => ({
  rng: dice([
    [6, 3, 3],
    [1, 2, 3],
  ]),
  opponent: passOpponent,
})

describe('光らせるのは今押せるものだけ', () => {
  it('styles.css には繰り返し動かすものがある', () => {
    expect(blinking().length).toBeGreaterThan(0)
  })

  it('何も持っていない間は手元のダイスだけが光り、置き場は光らない', async () => {
    await start(props())
    expect(blinkingButNotPressable()).toEqual([])
    expect(blinkCount()).toBe(3)
  })

  it('ダイスを持っている間は、置ける置き場が光る。ダイスのある置き場も入れ替えられるので光る', async () => {
    const user: User = await start(props())
    await place(user, 3, '障壁')
    await user.click(trayDie(6))
    expect(blinkingButNotPressable()).toEqual([])
    expect(myCard('障壁').getByRole('button', { name: '3の目と入れ替える' })).toBeTruthy()
    expect(blinkCount()).toBeGreaterThan(0)
  })

  it('公開の最中は何も光らない', async () => {
    const user = await start(props())
    await place(user, 6, '障壁')
    await user.click(button('決定'))
    expect(screen.getByText('あなたは 6 で障壁を張った')).toBeTruthy()
    expect(blinkCount()).toBe(0)
  })

  it('狭い画面でも、光るのは押せるものだけ', async () => {
    narrowScreen()
    const user = await start(props())
    expect(blinkingButNotPressable()).toEqual([])
    await user.click(trayDie(6))
    expect(blinkingButNotPressable()).toEqual([])
  })
})
