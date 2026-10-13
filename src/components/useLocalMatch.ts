// 手元の対戦。対局 match.ts を持ち、自分の行動を出したら相手の行動を決めて出し、解決の結果を卓に渡す。
// 二人が持ち込む5枚は、始めるときに受け取る。受け取らなければ二人ともスターター。
// 相手には viewFor で見せてよい様子だけを渡す。卓にはオンライン対戦と同じ形で、自分を席0とした様子を渡す。
// CPU はブラウザでは Worker で考える。考えている間は、自分の出した行動を卓に見せ、長くかかれば考え中の印を出す。

import { useEffect, useRef, useState } from 'react'
import { type Level, pick } from '../game/cpu'
import { type Match, newMatch, submit, viewFor } from '../game/match'
import type { Decks } from '../game/rules'
import { type Action, DEFAULT_CONFIG, type GameState, type Rng } from '../game/types'
import { Brain, type MakeWorker } from './cpuBrain'
import type { TableMatch } from './Table'
import type { Resolved } from './useRevealClock'

/** 相手の手を決める関数。既定はCPU。テストで差し替える */
export type Opponent = (state: GameState, level: Level, rng: Rng) => Action

/** 考え中の印を出すまでの時間。すぐ答えが出るときは印を出さない */
export const THINKING_DELAY_MS = 300

interface Options {
  rng: Rng
  level: Level
  opponent?: Opponent
  /** CPU を考えさせる Worker を作る。テストで差し替える。null ならいつもその場で考える */
  worker?: MakeWorker | null
}

export function useLocalMatch({ rng, level, opponent, worker }: Options) {
  const [match, setMatch] = useState<Match | null>(null)
  const [resolved, setResolved] = useState<Resolved | null>(null)
  /** CPU が考えていて、考え中の印を出している */
  const [thinking, setThinking] = useState(false)
  const brain = useRef<Brain | null>(null)
  /** 何局目か。対局をやめたり始め直したりした後に、前の対局の CPU の答えが届いても使わない */
  const generation = useRef(0)

  const brainOf = () => {
    brain.current ??= new Brain(worker)
    return brain.current
  }

  useEffect(() => () => brain.current?.dispose(), [])

  /** 対局を始める。decks は [自分の5枚, 相手の5枚] で、省くと二人ともスターター */
  const start = (decks?: Decks) => {
    generation.current++
    brain.current?.reset()
    setThinking(false)
    setMatch(newMatch(rng, DEFAULT_CONFIG, decks))
    setResolved(null)
  }

  /** 対局をやめる。降参や、強さの選び直し */
  const quit = () => {
    generation.current++
    setThinking(false)
    setMatch(null)
  }

  /**
   * 自分の行動を出し、相手の行動を受け取ってステップを解決する。
   * 画面は合法な行動しか出さないので、受け付けられなければ作りの誤りとして止める
   */
  const play = (mine: Action) => {
    if (!match) throw new Error('対局が始まっていない')
    const first = submit(match, 0, mine, rng)
    if (!first.ok) throw new Error(`自分の行動を受け付けなかった: ${first.reason}`)
    // 相手には、こちらの出した行動を見せない
    const seen = viewFor(first.match, 1).state
    const finish = (theirs: Action) => {
      const done = submit(first.match, 1, theirs, rng)
      if (!done.ok || !done.resolved) throw new Error('相手の行動を受け付けなかった')
      const resolution = done.resolved
      setMatch(done.match)
      setResolved((r) => ({ n: (r?.n ?? 0) + 1, resolution }))
    }
    if (opponent) return finish(opponent(seen, level, rng))
    const cpu = brainOf()
    if (cpu.inline) return finish(pick(cpu.thinkNow(seen, level), rng))
    // 考えている間は、自分の出した行動を見せておく。相手の手は、答えが届いてから乱数で選ぶので、乱数を引く順はその場で考えるときと同じ
    setMatch(first.match)
    const gen = generation.current
    const timer = setTimeout(() => setThinking(true), THINKING_DELAY_MS)
    cpu.think(seen, level).then((options) => {
      clearTimeout(timer)
      if (gen !== generation.current) return
      setThinking(false)
      finish(pick(options, rng))
    })
  }

  const table: TableMatch | null = match && { view: viewFor(match, 0), resolved, submit: play }
  return { match: table, thinking, start, quit, play }
}
