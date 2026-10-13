// 手元の対戦の CPU。ブラウザでは Worker で考えさせ、考えている間も画面を止めない。
// Worker の無い所（テストの偽の DOM）や、Worker が動かなかったときは、その場で考える。

import { type Level, type Options, Thinker } from '../game/cpu'
import type { GameState } from '../game/types'
import { type CpuSide, type FromCpu, respond, type ToCpu } from './cpuMessages'

/** Worker を作る。テストでは差し替える */
export type MakeWorker = () => Worker

const makeWorker: MakeWorker = () => new Worker(new URL('./cpu.worker.ts', import.meta.url), { type: 'module' })

interface Waiting {
  state: GameState
  level: Level
  resolve: (options: Options) => void
}

export class Brain {
  /** その場で考えるときの CPU */
  private here: CpuSide = { thinker: new Thinker() }
  private worker: Worker | null = null
  /** Worker が動かなかった。以後はその場で考える */
  private broken = false
  private next = 0
  private waiting = new Map<number, Waiting>()
  private make: MakeWorker | null

  /** make を省くと、Worker のある所では Worker で考える。null なら、いつもその場で考える */
  constructor(make?: MakeWorker | null) {
    this.make = make === undefined ? (typeof Worker === 'undefined' ? null : makeWorker) : make
  }

  /** 待たずに考えられるか。Worker を使わないなら、その場で考えて答えを返せる */
  get inline(): boolean {
    return this.make === null || this.broken
  }

  /** その場で考える */
  thinkNow(state: GameState, level: Level): Options {
    return respond(this.here, { type: 'think', id: 0, state, level })?.options as Options
  }

  /** 考える。Worker で考えるなら、答えは後で届く */
  think(state: GameState, level: Level): Promise<Options> {
    const worker = this.ensure()
    if (!worker) return Promise.resolve(this.thinkNow(state, level))
    const id = ++this.next
    return new Promise((resolve) => {
      this.waiting.set(id, { state, level, resolve })
      worker.postMessage({ type: 'think', id, state, level } satisfies ToCpu)
    })
  }

  /** 新しい対局。覚えた先読みを捨てる。考えている途中なら、その答えは届かなくなる */
  reset() {
    this.here = { thinker: new Thinker() }
    if (this.waiting.size > 0) {
      // 古い対局の手を考え終えるのを待たないよう、Worker ごと作り直す
      this.worker?.terminate()
      this.worker = null
      this.waiting.clear()
      return
    }
    this.worker?.postMessage({ type: 'reset' } satisfies ToCpu)
  }

  /** Worker を止める */
  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.waiting.clear()
  }

  private ensure(): Worker | null {
    if (this.inline) return null
    if (this.worker) return this.worker
    try {
      this.worker = (this.make as MakeWorker)()
    } catch {
      return this.fail()
    }
    this.worker.onmessage = (e: MessageEvent<FromCpu>) => {
      const w = this.waiting.get(e.data.id)
      this.waiting.delete(e.data.id)
      w?.resolve(e.data.options)
    }
    this.worker.onerror = () => {
      this.fail()
    }
    return this.worker
  }

  /** Worker が動かなかった。待っている手はその場で考えて答え、以後もその場で考える */
  private fail(): null {
    this.broken = true
    this.worker?.terminate()
    this.worker = null
    const left = [...this.waiting.values()]
    this.waiting.clear()
    for (const w of left) w.resolve(this.thinkNow(w.state, w.level))
    return null
  }
}
