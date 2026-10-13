// 席。相手と自分で上下が対になるように、ダイスと体力の段を卓の中央側に置く。
// 相手は上から カード、ダイスと体力。自分は ダイスと体力、カード。

import type { ReactNode } from 'react'
import type { ChantState } from '../game/types'
import { HpBar } from './HpBar'

interface SeatProps {
  side: 'me' | 'cpu'
  name: string
  /** 見せる体力。公開の途中は、まだ当たっていないダメージの分だけ多い */
  hp: number
  maxHp: number
  /** 詠唱の様子。公開の途中で伏せるときは none を渡す */
  chant: ChantState
  /** 名前に添える印。相手が決定した、つながりが切れている、など */
  marks?: ReactNode
  /** 手元のダイス。体力と同じ段に並べる */
  tray: ReactNode
  /** ダイスと体力の段の右端に置くもの。自分の席のパス */
  extra?: ReactNode
  cards: ReactNode
}

export function Seat({ side, name, hp, maxHp, chant, marks, tray, extra, cards }: SeatProps) {
  // 高さを抑えるため、ダイスと体力を一つの段に並べる。段は卓の中央側に置く
  const row = (
    <div className="seat-row">
      {tray}
      <div className="seat-status">
        <h2 className="seat-name" title={name}>
          {name}
        </h2>
        {marks}
        <div className="hp" role="img" aria-label={`体力 ${Math.max(0, hp)} / ${maxHp}`}>
          <HpBar hp={hp} maxHp={maxHp} withMax />
        </div>
        {chant === 'charged' && <span className="badge badge-chant">詠唱中</span>}
        {chant === 'broken' && <span className="badge">詠唱は崩れた</span>}
      </div>
      {extra}
    </div>
  )
  return (
    <section className={`seat seat-${side}`} aria-label={name}>
      {side === 'me' && row}
      {cards}
      {side === 'cpu' && row}
    </section>
  )
}
