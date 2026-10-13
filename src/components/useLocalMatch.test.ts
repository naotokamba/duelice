// @vitest-environment happy-dom
// 手元の対戦。自分の行動を出すと、相手には見せてよい盤だけを渡して行動を決めさせ、ステップを解決して卓に渡す。

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Thinker } from '../game/cpu'
import type { GameState } from '../game/types'
import { seeded } from '../test/helpers'
import type { MakeWorker } from './cpuBrain'
import { type CpuSide, respond, type ToCpu } from './cpuMessages'
import { THINKING_DELAY_MS, useLocalMatch } from './useLocalMatch'

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

/** 答えを手で返す偽の Worker。release で、届いた知らせに cpuMessages の答え方で答える */
class HeldWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  side: CpuSide = { thinker: new Thinker() }
  held: ToCpu[] = []
  postMessage(msg: ToCpu) {
    this.held.push(msg)
  }
  release() {
    for (const msg of this.held.splice(0)) {
      const answer = respond(this.side, msg)
      if (answer) this.onmessage?.({ data: answer } as MessageEvent)
    }
  }
  terminate() {
    this.held = []
  }
}

describe('Worker で考える CPU との手元の対戦', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const workers: HeldWorker[] = []
    const worker: MakeWorker = () => {
      const w = new HeldWorker()
      workers.push(w)
      return w as unknown as Worker
    }
    const hook = renderHook(() => useLocalMatch({ rng: seeded(3), level: 'hard', worker }))
    /** 届いた知らせに答えて、答えが卓に届くまで進める */
    const release = async () => {
      await act(async () => {
        workers.at(-1)?.release()
        await Promise.resolve()
      })
    }
    return { ...hook, workers, release }
  }

  it('考えている間は自分の行動を見せ、答えが届いたら、その場で考えたときと同じ手で解決する', async () => {
    vi.useFakeTimers()
    const { result, release } = setup()
    act(() => result.current.start())
    act(() => result.current.match?.submit({ kind: 'pass' }))
    expect(result.current.match?.view.mine).toEqual({ kind: 'pass' })
    expect(result.current.match?.resolved).toBeNull()
    // すぐには考え中の印を出さず、長くかかれば出す
    expect(result.current.thinking).toBe(false)
    act(() => vi.advanceTimersByTime(THINKING_DELAY_MS))
    expect(result.current.thinking).toBe(true)
    await release()
    expect(result.current.thinking).toBe(false)
    expect(result.current.match?.resolved?.n).toBe(1)
    // 同じ乱数でその場で考えたときと同じ手になる
    const inline = renderHook(() => useLocalMatch({ rng: seeded(3), level: 'hard', worker: null }))
    act(() => inline.result.current.start())
    act(() => inline.result.current.match?.submit({ kind: 'pass' }))
    expect(result.current.match?.resolved?.resolution.report).toEqual(
      inline.result.current.match?.resolved?.resolution.report,
    )
  })

  it('考えている途中に対局をやめたり始め直したりしたら、届いた答えは使わない', async () => {
    const { result, release, workers } = setup()
    act(() => result.current.start())
    act(() => result.current.match?.submit({ kind: 'pass' }))
    act(() => result.current.quit())
    await release()
    expect(result.current.match).toBeNull()
    act(() => result.current.start())
    act(() => result.current.match?.submit({ kind: 'pass' }))
    const stale = workers[0]
    act(() => result.current.start())
    // 考えている途中の Worker は作り直す。古い Worker が答えても使わない
    await act(async () => {
      stale.release()
      await Promise.resolve()
    })
    expect(result.current.match?.resolved).toBeNull()
    expect(result.current.match?.view.state.step).toBe(1)
  })
})
