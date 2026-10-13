// @vitest-environment happy-dom
// 持ち時間の残り。公開の猶予の間は満了のまま止め、猶予が過ぎてから秒で減らし、残りが少なくなったら色を変える。

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Countdown, HURRY_S } from './Countdown'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const timer = () => screen.getByRole('timer')

describe('持ち時間の残り', () => {
  it('猶予の間は満了を出し、過ぎたら秒で減らし、少なくなったら色を変え、期限を過ぎたら0で止める', () => {
    render(<Countdown deadline={Date.now() + 67_000} stepMs={60_000} />)
    expect(timer().getAttribute('aria-label')).toBe('残り 60 秒')
    act(() => vi.advanceTimersByTime(7_000))
    expect(timer().getAttribute('aria-label')).toBe('残り 60 秒')
    act(() => vi.advanceTimersByTime(1_000))
    expect(timer().getAttribute('aria-label')).toBe('残り 59 秒')
    expect(timer().classList.contains('is-hurry')).toBe(false)
    act(() => vi.advanceTimersByTime((59 - HURRY_S) * 1000))
    expect(timer().getAttribute('aria-label')).toBe(`残り ${HURRY_S} 秒`)
    expect(timer().classList.contains('is-hurry')).toBe(true)
    act(() => vi.advanceTimersByTime(30_000))
    expect(timer().textContent).toBe('0')
  })
})
