// 評価の働き手。親から受け取った仕事を一つずつこなして返す。仕事は一局の対戦と、互換を探す局面の数え。

import { parentPort } from 'node:worker_threads'
import type { CardId } from '../game/cards'
import type { Estimates } from '../game/cpu'
import { emptyTally, mergeTally, tallyRows } from './dominance'
import { playGame, seeded } from './game'

export type Task =
  | { type: 'game'; decks: [CardId[], CardId[]]; seed: number; estimates?: [Estimates, Estimates] }
  | { type: 'rows'; decks: [CardId[], CardId[]]; seed: number; rate: number }

parentPort?.on('message', ({ id, task }: { id: number; task: Task }) => {
  if (task.type === 'game') {
    parentPort?.postMessage({ id, result: playGame(task.decks, task.seed, task.estimates) })
    return
  }
  // 一局を戦い、ときどき止まって、その局面で互換を数える
  const tally = emptyTally()
  const pickRng = seeded(task.seed ^ 0x9e3779b9)
  playGame(task.decks, task.seed, undefined, (state) => {
    if (pickRng() >= task.rate) return
    for (const who of [0, 1] as const) mergeTally(tally, tallyRows(state, who))
  })
  parentPort?.postMessage({ id, result: tally })
})
