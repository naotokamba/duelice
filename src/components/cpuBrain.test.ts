// CPU を Worker で考えさせる部品。本物の Worker の代わりに、同じ答え方で後から答える偽物を使う

import { describe, expect, it, vi } from 'vitest'
import { Thinker } from '../game/cpu'
import { makeState } from '../test/helpers'
import { Brain, type MakeWorker } from './cpuBrain'
import { type CpuSide, respond, type ToCpu } from './cpuMessages'

const state = makeState({ roll: [6, 5, 2] }, { roll: [3, 3, 6] })

/** 知らせを受けると、次の機会に cpuMessages の答え方で答える偽の Worker */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  side: CpuSide = { thinker: new Thinker() }
  sent: ToCpu[] = []
  terminated = false
  postMessage(msg: ToCpu) {
    this.sent.push(msg)
    queueMicrotask(() => {
      const answer = respond(this.side, msg)
      if (answer && !this.terminated) this.onmessage?.({ data: answer } as MessageEvent)
    })
  }
  terminate() {
    this.terminated = true
  }
}

function fake() {
  const made: FakeWorker[] = []
  const make = (() => {
    const w = new FakeWorker()
    made.push(w)
    return w as unknown as Worker
  }) satisfies MakeWorker
  return { made, make }
}

describe('考えるやりとり', () => {
  it('考える知らせには、相手の席1から見た行動ごとの確率と期待得点で答える', () => {
    const side: CpuSide = { thinker: new Thinker() }
    expect(respond(side, { type: 'think', id: 7, state, level: 'hard' })).toEqual({
      id: 7,
      options: new Thinker().analyze(state, 1, 'hard'),
    })
  })
  it('新しい対局の知らせでは、覚えた先読みを捨てて、答えない', () => {
    const before = new Thinker()
    const side: CpuSide = { thinker: before }
    expect(respond(side, { type: 'reset' })).toBeNull()
    expect(side.thinker).not.toBe(before)
  })
})

describe('Worker で考える CPU', () => {
  it('Worker が考えた答えを、その場で考えた答えと同じ形で受け取る', async () => {
    const { made, make } = fake()
    const brain = new Brain(make)
    expect(brain.inline).toBe(false)
    const got = await brain.think(state, 'normal')
    expect(got).toEqual(new Thinker().analyze(state, 1, 'normal'))
    // Worker は一つを使い続ける
    await brain.think(state, 'hard')
    expect(made).toHaveLength(1)
    expect(made[0].sent.map((m) => m.type)).toEqual(['think', 'think'])
  })

  it('新しい対局では、待っている答えが無ければ Worker に先読みを捨てさせ、考えている途中なら Worker ごと作り直す', async () => {
    const { made, make } = fake()
    const brain = new Brain(make)
    await brain.think(state, 'hard')
    brain.reset()
    expect(made[0].sent.at(-1)).toEqual({ type: 'reset' })
    const late = vi.fn()
    brain.think(state, 'hard').then(late)
    brain.reset()
    expect(made[0].terminated).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(late).not.toHaveBeenCalled()
    await brain.think(state, 'hard')
    expect(made).toHaveLength(2)
    brain.dispose()
    expect(made[1].terminated).toBe(true)
  })

  it('Worker が動かなければ、待っている手をその場で考えて答え、以後もその場で考える', async () => {
    const { made, make } = fake()
    const brain = new Brain(make)
    const waiting = brain.think(state, 'hard')
    made[0].terminated = true
    made[0].onerror?.(new Event('error'))
    expect(await waiting).toEqual(new Thinker().analyze(state, 1, 'hard'))
    expect(brain.inline).toBe(true)
    expect(await brain.think(state, 'easy')).toEqual(new Thinker().analyze(state, 1, 'easy'))
    expect(made).toHaveLength(1)
  })

  it('Worker を作れなければ、その場で考える', async () => {
    const brain = new Brain(() => {
      throw new Error('作れない')
    })
    expect(await brain.think(state, 'hard')).toEqual(new Thinker().analyze(state, 1, 'hard'))
    expect(brain.inline).toBe(true)
  })

  it('Worker の無い所では、待たずにその場で考える', () => {
    const brain = new Brain()
    expect(brain.inline).toBe(true)
    expect(brain.thinkNow(state, 'hard')).toEqual(new Thinker().analyze(state, 1, 'hard'))
    expect(new Brain(null).inline).toBe(true)
  })
})
