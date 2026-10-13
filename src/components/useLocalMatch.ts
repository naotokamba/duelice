// 手元の対戦。対局 match.ts を持ち、自分の行動を出したら相手の行動を決めて出し、解決の結果を卓に渡す。
// 二人が持ち込む5枚は、始めるときに受け取る。受け取らなければ二人ともスターター。
// 相手には viewFor で見せてよい様子だけを渡す。卓にはオンライン対戦と同じ形で、自分を席0とした様子を渡す。

import { useRef, useState } from 'react'
import { type Level, Thinker } from '../game/cpu'
import { type Match, newMatch, submit, viewFor } from '../game/match'
import type { Decks } from '../game/rules'
import { type Action, DEFAULT_CONFIG, type GameState, type Rng } from '../game/types'
import type { TableMatch } from './Table'
import type { Resolved } from './useRevealClock'

/** 相手の手を決める関数。既定はCPU。テストで差し替える */
export type Opponent = (state: GameState, level: Level, rng: Rng) => Action

interface Options {
  rng: Rng
  level: Level
  opponent?: Opponent
}

export function useLocalMatch({ rng, level, opponent }: Options) {
  const [match, setMatch] = useState<Match | null>(null)
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const thinker = useRef(new Thinker())

  /** 対局を始める。decks は [自分の5枚, 相手の5枚] で、省くと二人ともスターター */
  const start = (decks?: Decks) => {
    thinker.current = new Thinker()
    setMatch(newMatch(rng, DEFAULT_CONFIG, decks))
    setResolved(null)
  }

  /** 対局をやめる。降参や、強さの選び直し */
  const quit = () => setMatch(null)

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
    const theirs = opponent ? opponent(seen, level, rng) : thinker.current.decide(seen, 1, level, rng)
    const done = submit(first.match, 1, theirs, rng)
    if (!done.ok || !done.resolved) throw new Error('相手の行動を受け付けなかった')
    const resolution = done.resolved
    setMatch(done.match)
    setResolved((r) => ({ n: (r?.n ?? 0) + 1, resolution }))
  }

  const table: TableMatch | null = match && { view: viewFor(match, 0), resolved, submit: play }
  return { match: table, start, quit, play }
}
