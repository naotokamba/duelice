// CPU を別のスレッドで考えさせるときの、やりとりの形と、受けた側の答え方。
// Worker の入口 cpu.worker.ts は、ここの respond を呼ぶだけにして、答え方は単体テストで確かめる。

import { type Level, type Options, Thinker } from '../game/cpu'
import type { GameState } from '../game/types'

/** 考える側へ送る知らせ。reset は新しい対局で、覚えた先読みを捨てる。think は相手の席1として手を考える */
export type ToCpu = { type: 'reset' } | { type: 'think'; id: number; state: GameState; level: Level }

/** 考える側から届く答え。id は think の id */
export interface FromCpu {
  id: number
  options: Options
}

/** 考える側の持ち物。対局ごとに一人の CPU を持ち、先読みの覚えを手番をまたいで使う */
export interface CpuSide {
  thinker: Thinker
}

/** 知らせに答える。答えの要らない知らせは null */
export function respond(side: CpuSide, msg: ToCpu): FromCpu | null {
  if (msg.type === 'reset') {
    side.thinker = new Thinker()
    return null
  }
  return { id: msg.id, options: side.thinker.analyze(msg.state, 1, msg.level) }
}
