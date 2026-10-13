// 画面の入口。タイトルで強さを選び、CPU との対局を始めたら卓を出す。オンライン対戦を選んだら、その入口へ進む。
// 対局は useLocalMatch が持ち、卓は対局ごとに作り直して、前の対局の見せ方を持ち越さない。
// オンライン対戦の部屋にいたまま再読み込みしたら、タイトルを飛ばしてその部屋に戻る。

import { useEffect, useState } from 'react'
import type { Level } from '../game/cpu'
import type { Rng } from '../game/types'
import { Online } from './Online'
import type { RoomOptions } from './onlineApi'
import { loadSession } from './onlineStore'
import { Table } from './Table'
import { Title } from './Title'
import { type Opponent, useLocalMatch } from './useLocalMatch'
import { useNarrow } from './useNarrow'

export type { Opponent } from './useLocalMatch'

interface Props {
  /** テストでは固定の乱数を渡す */
  rng?: Rng
  /** 相手の手。既定はCPU */
  opponent?: Opponent
  /** 開発のテストだけ。オンライン対戦で作る部屋の持ち時間と体力 */
  room?: RoomOptions
}

export function Game({ rng = Math.random, opponent, room }: Props) {
  const [level, setLevel] = useState<Level>('normal')
  const [online, setOnline] = useState(false)
  /** 何局目か。卓を対局ごとに作り直す */
  const [round, setRound] = useState(0)
  const local = useLocalMatch({ rng, level, opponent })
  const narrow = useNarrow()

  // 覚えている部屋があれば戻る。サーバで描くときはブラウザの記憶を読めないので、画面に出てから読む
  useEffect(() => {
    if (loadSession()) setOnline(true)
  }, [])

  const start = () => {
    local.start()
    setRound((r) => r + 1)
  }

  if (online) return <Online narrow={narrow} options={room} onExit={() => setOnline(false)} />
  if (!local.match) return <Title level={level} setLevel={setLevel} onStart={start} onOnline={() => setOnline(true)} />
  return (
    <Table
      key={round}
      match={local.match}
      narrow={narrow}
      after={{ onAgain: start, leave: { label: '強さを選び直す', onClick: local.quit } }}
      onSurrender={local.quit}
    />
  )
}
