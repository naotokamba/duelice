// CPU を考えさせる Worker の入口。画面のスレッドを止めずに先読みする。答え方は cpuMessages.ts にある

import { Thinker } from '../game/cpu'
import { type CpuSide, respond, type ToCpu } from './cpuMessages'

/** Worker の中の大域。画面の型の self と違い、postMessage は宛先を取らない */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToCpu>) => void) | null
  postMessage: (msg: unknown) => void
}

const side: CpuSide = { thinker: new Thinker() }

scope.onmessage = (e) => {
  const answer = respond(side, e.data)
  if (answer) scope.postMessage(answer)
}
