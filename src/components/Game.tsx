// 画面の入口。タイトルで強さを選び、CPU との対局を始めたら卓を出す。オンライン対戦を選んだら、その入口へ進む。
// カードを選んで戦う対戦は、カードを選ぶ画面で5枚を選んでから始め、CPU は評価で強かったデッキから一つを持ち込む。
// 再戦は同じ5枚どうしで戦い、対局を抜けるとカードを選ぶ画面へ戻る。
// 対局は useLocalMatch が持ち、卓は対局ごとに作り直して、前の対局の見せ方を持ち越さない。
// オンライン対戦の部屋にいたまま再読み込みしたら、タイトルを飛ばしてその部屋に戻る。

import { useEffect, useState } from 'react'
import type { CardId } from '../game/cards'
import type { Level } from '../game/cpu'
import { pickCpuDeck } from '../game/decks'
import type { Decks } from '../game/rules'
import type { Rng } from '../game/types'
import { DeckPick } from './DeckPick'
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
  /** カードを選ぶ対戦で、CPU の持ち込む5枚を決める。既定は評価で強かったデッキから無作為に選ぶ */
  cpuDeck?: () => readonly CardId[]
  /** 開発のテストだけ。オンライン対戦で作る部屋の持ち時間と体力 */
  room?: RoomOptions
}

const randomCpuDeck = () => pickCpuDeck(Math.random)

export function Game({ rng = Math.random, opponent, cpuDeck = randomCpuDeck, room }: Props) {
  const [level, setLevel] = useState<Level>('normal')
  const [online, setOnline] = useState(false)
  /** カードを選ぶ画面を出している */
  const [picking, setPicking] = useState(false)
  /** カードを選んで戦う対局の、二人の5枚。スターターどうしの対局なら null */
  const [decks, setDecks] = useState<Decks | null>(null)
  /** 何局目か。卓を対局ごとに作り直す */
  const [round, setRound] = useState(0)
  const local = useLocalMatch({ rng, level, opponent })
  const narrow = useNarrow()

  // 覚えている部屋があれば戻る。サーバで描くときはブラウザの記憶を読めないので、画面に出てから読む
  useEffect(() => {
    if (loadSession()) setOnline(true)
  }, [])

  const start = (d: Decks | null) => {
    setDecks(d)
    local.start(d ?? undefined)
    setRound((r) => r + 1)
  }

  /** 対局を抜ける。カードを選んで戦っていたなら、カードを選ぶ画面へ戻る */
  const quit = () => {
    setPicking(decks !== null)
    local.quit()
  }

  if (online) return <Online narrow={narrow} options={room} onExit={() => setOnline(false)} />
  if (!local.match && picking) {
    return (
      <DeckPick
        level={level}
        setLevel={setLevel}
        onBack={() => setPicking(false)}
        onStart={(mine) => start([mine, cpuDeck()])}
      />
    )
  }
  if (!local.match) {
    return (
      <Title
        level={level}
        setLevel={setLevel}
        onStart={() => start(null)}
        onOnline={() => setOnline(true)}
        onPick={() => setPicking(true)}
      />
    )
  }
  return (
    <Table
      key={round}
      match={local.match}
      narrow={narrow}
      after={{
        onAgain: () => start(decks),
        leave: { label: decks ? 'カードを選び直す' : '強さを選び直す', onClick: quit },
      }}
      onSurrender={quit}
    />
  )
}
