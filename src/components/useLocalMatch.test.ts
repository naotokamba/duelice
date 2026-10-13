// @vitest-environment happy-dom
// 手元の対戦。自分の行動を出すと、相手には見せてよい盤だけを渡して行動を決めさせ、ステップを解決して卓に渡す。

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GameState } from '../game/types'
import { seeded } from '../test/helpers'
import { useLocalMatch } from './useLocalMatch'

describe('手元の対戦', () => {
  it('自分の行動を出すと、相手に盤を見せて行動を決めさせ、解決した結果を番号を付けて渡す', () => {
    const opponent = vi.fn((_: GameState) => ({ kind: 'pass' as const }))
    const { result } = renderHook(() => useLocalMatch({ rng: seeded(3), level: 'easy', opponent }))
    act(() => result.current.start())
    const before = result.current.match?.view.state
    expect(result.current.match?.view).toMatchObject({ mine: null, opponentReady: false })
    expect(result.current.match?.resolved).toBeNull()
    act(() => result.current.match?.submit({ kind: 'pass' }))
    expect(opponent).toHaveBeenCalledWith(before, 'easy', expect.any(Function))
    expect(result.current.match?.resolved?.n).toBe(1)
    expect(result.current.match?.resolved?.resolution.report.actions).toEqual([{ kind: 'pass' }, { kind: 'pass' }])
    expect(result.current.match?.view.state.step).toBe(2)
    act(() => result.current.match?.submit({ kind: 'pass' }))
    expect(result.current.match?.resolved?.n).toBe(2)
    // 新しい対局では、解決の番号を数え直す
    act(() => result.current.start())
    expect(result.current.match?.resolved).toBeNull()
    act(() => result.current.quit())
    expect(result.current.match).toBeNull()
  })

  it('始める前や、合法でない行動は、作りの誤りとして止める', () => {
    const { result } = renderHook(() =>
      useLocalMatch({ rng: seeded(3), level: 'easy', opponent: () => ({ kind: 'spearCast', dice: [9, 9] }) }),
    )
    expect(() => result.current.play({ kind: 'pass' })).toThrow('対局が始まっていない')
    act(() => result.current.start())
    expect(() => result.current.play({ kind: 'spearCast', dice: [9, 9] })).toThrow('自分の行動を受け付けなかった')
    expect(() => result.current.play({ kind: 'pass' })).toThrow('相手の行動を受け付けなかった')
  })
})
