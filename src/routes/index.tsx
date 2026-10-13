import { createFileRoute } from '@tanstack/react-router'
import { Game, type Opponent } from '../components/Game'
import type { RoomOptions } from '../components/onlineApi'
import type { Rng } from '../game/types'

/**
 * 本物のブラウザで画面を通して確かめるテスト e2e/ は、読み込む前に window.__duelice へ出目と相手の手を入れて固定する。
 * オンライン対戦では、作る部屋の持ち時間と体力を短くする。これは開発のサーバだけが受け付ける。
 * ふだんは何も入っておらず、乱数の既定値とCPUで遊ぶ
 */
declare global {
  interface Window {
    __duelice?: { rng?: Rng; opponent?: Opponent; room?: RoomOptions }
  }
}

function Home() {
  const fixed = typeof window === 'undefined' ? undefined : window.__duelice
  return <Game rng={fixed?.rng} opponent={fixed?.opponent} room={fixed?.room} />
}

export const Route = createFileRoute('/')({ component: Home })
