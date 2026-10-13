// 画面の入口。タイトルで強さを選び、対局を始めたら卓を出す。
// 対局は useLocalMatch が持ち、卓は対局ごとに作り直して、前の対局の見せ方を持ち越さない。

import { useState } from 'react'
import type { Level } from '../game/cpu'
import type { Rng } from '../game/types'
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
}

export function Game({ rng = Math.random, opponent }: Props) {
  const [level, setLevel] = useState<Level>('normal')
  /** 何局目か。卓を対局ごとに作り直す */
  const [round, setRound] = useState(0)
  const local = useLocalMatch({ rng, level, opponent })
  const narrow = useNarrow()

  const start = () => {
    local.start()
    setRound((r) => r + 1)
  }

  if (!local.match) return <Title level={level} setLevel={setLevel} onStart={start} />
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
