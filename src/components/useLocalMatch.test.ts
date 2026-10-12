// @vitest-environment happy-dom
// 手元の対戦。自分の行動を出すと、相手には見せてよい盤だけを渡して行動を決めさせ、ステップを解決する。

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GameState } from '../game/types'
import { seeded } from '../test/helpers'
import { useLocalMatch } from './useLocalMatch'

describe('手元の対戦', () => {
  it('自分の行動を出すと、相手に盤を見せて行動を決めさせ、ステップを解決する', () => {
    const opponent = vi.fn((_: GameState) => ({ kind: 'pass' as const }))
    const { result } = renderHook(() => useLocalMatch({ rng: seeded(3), level: 'easy', opponent }))
    act(() => result.current.start())
    const before = result.current.match?.state
    let resolved: ReturnType<typeof result.current.play> | undefined
    act(() => {
      resolved = result.current.play({ kind: 'pass' })
    })
    expect(opponent).toHaveBeenCalledWith(before, 'easy', expect.any(Function))
    expect(resolved?.report.actions).toEqual([{ kind: 'pass' }, { kind: 'pass' }])
    expect(result.current.match?.state.step).toBe(2)
    act(() => result.current.quit())
    expect(result.current.match).toBeNull()
  })

  it('始める前や、合法でない行動は、作りの誤りとして止める', () => {
    const { result } = renderHook(() =>
      useLocalMatch({ rng: seeded(3), level: 'easy', opponent: () => ({ kind: 'reflect', dice: [9, 9] }) }),
    )
    expect(() => result.current.play({ kind: 'pass' })).toThrow('対局が始まっていない')
    act(() => result.current.start())
    expect(() => result.current.play({ kind: 'reflect', dice: [9, 9] })).toThrow('自分の行動を受け付けなかった')
    expect(() => result.current.play({ kind: 'pass' })).toThrow('相手の行動を受け付けなかった')
  })
})
