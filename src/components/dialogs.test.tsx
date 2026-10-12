// @vitest-environment happy-dom
// モーダル。どの窓も外の暗くした背景を押すと閉じ、中を押しても閉じない。閉じても、確かめていた操作は行わない。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  button,
  clickBackdrop,
  cpuSeat,
  dice,
  narrowScreen,
  pass,
  passOpponent,
  settle,
  start,
  type User,
  useFakeClock,
} from '../test/screen'
import { Game } from './Game'

beforeEach(useFakeClock)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const props = () => ({
  rng: dice([
    [1, 2, 3],
    [1, 2, 3],
  ]),
  opponent: passOpponent,
})

/** 窓を開く手順と、開いた窓の名前 */
const OPENERS: [string, (user: User) => Promise<void>][] = [
  ['メニュー', (user) => user.click(button('メニュー'))],
  [
    'ルール',
    async (user) => {
      await user.click(button('メニュー'))
      await user.click(within(screen.getByRole('dialog', { name: 'メニュー' })).getByRole('button', { name: 'ルール' }))
    },
  ],
  ['パスしますか？', (user) => user.click(button('パス'))],
  [
    '降参しますか？',
    async (user) => {
      await user.click(button('メニュー'))
      await user.click(within(screen.getByRole('dialog', { name: 'メニュー' })).getByRole('button', { name: '降参' }))
    },
  ],
  [
    '戦闘履歴',
    async (user) => {
      await pass(user)
      await settle()
      await user.click(button('戦闘履歴'))
    },
  ],
]

describe('モーダル', () => {
  it.each(OPENERS)('%s の窓は、外を押すと閉じる', async (name, open) => {
    const user = await start(props())
    await open(user)
    const dialog = screen.getByRole('dialog', { name }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    clickBackdrop(dialog)
    expect(dialog.open).toBe(false)
  })

  it('パスを確かめる窓を外で閉じても、パスはしない', async () => {
    const user = await start(props())
    await user.click(button('パス'))
    clickBackdrop(screen.getByRole('dialog', { name: 'パスしますか？' }))
    expect(screen.queryByText('あなたは何もしなかった')).toBeNull()
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
  })

  it('降参を確かめる窓を外で閉じても、対局は続く', async () => {
    const user = await start(props())
    await user.click(button('メニュー'))
    await user.click(within(screen.getByRole('dialog', { name: 'メニュー' })).getByRole('button', { name: '降参' }))
    clickBackdrop(screen.getByRole('dialog', { name: '降参しますか？' }))
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
  })

  it('狭い画面の相手のカードの窓も、外を押すと閉じる', async () => {
    narrowScreen()
    const user = await start(props())
    await user.click(cpuSeat().getByRole('button', { name: '魔弾' }))
    const dialog = screen.getByRole('dialog', { name: '相手のカード' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    clickBackdrop(dialog)
    expect(dialog.open).toBe(false)
  })

  it('タイトルのルールの窓は、中を押しても閉じず、外を押すと閉じる', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Game {...props()} />)
    await user.click(button('ルール'))
    const dialog = screen.getByRole('dialog', { name: 'ルール' }) as HTMLDialogElement
    fireEvent.click(within(dialog).getByText(/毎ターン/))
    expect(dialog.open).toBe(true)
    // 窓の枠の中の余白を押しても閉じない
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 300,
      top: 100,
      bottom: 300,
    } as DOMRect)
    fireEvent.click(dialog, { clientX: 200, clientY: 200 })
    expect(dialog.open).toBe(true)
    clickBackdrop(dialog)
    expect(dialog.open).toBe(false)
  })
})
