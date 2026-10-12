// 席のカード。広い画面では全てのカードを並べ、狭い画面ではカードの名前を並べて一枚だけ大きく出す。
// 相手の席は、狭い画面では名前だけを並べる。公開した技は中央の名乗りの札で分かり、カードは名前を押せば窓で見られる。

import { CARD_ORDER, type CardId } from '../game/cards'
import { Card, type CardPlay } from './Card'
import { CardTabs } from './CardTabs'
import { type SeatView, type Shown, usedUp } from './seatView'

interface CardProps {
  seat: SeatView
  card: CardId
  /** カードに置いているか、公開しているダイス */
  shown: Shown | null
  /** 公開の最中。使ったカードを光らせる */
  revealing: boolean
  play?: CardPlay
}

/** 席のカードを一枚描く */
export function SeatCard({ seat, card, shown, revealing, play }: CardProps) {
  const here = shown?.card === card
  return (
    <Card
      card={card}
      roll={seat.player.roll}
      active={seat.active.get(card) ?? []}
      used={usedUp(seat, card)}
      shown={here ? shown : null}
      casting={revealing && here}
      kept={seat.kept?.card === card ? seat.kept : null}
      play={play}
    />
  )
}

interface Props {
  seat: SeatView
  shown: Shown | null
  revealing: boolean
  narrow: boolean
  /** 狭い画面で大きく出すカード。相手の席では出さない */
  current?: CardId
  /** 名前を押した */
  onPick?: (c: CardId) => void
  /** 何も持っていない間。使えるカードの名前を光らせる */
  hint?: boolean
  /** 自分の席で選んでいる間の、カードごとの操作 */
  playFor?: (c: CardId) => CardPlay | undefined
}

export function SeatCards({ seat, shown, revealing, narrow, current, onPick, hint, playFor }: Props) {
  const view = (c: CardId) => (
    <SeatCard key={c} seat={seat} card={c} shown={shown} revealing={revealing} play={playFor?.(c)} />
  )
  if (!narrow) return <ul className="cards">{CARD_ORDER.map(view)}</ul>

  const tabs = (
    <CardTabs
      tabs={CARD_ORDER.map((c) => ({
        card: c,
        off: !seat.usable.has(c) && shown?.card !== c,
        current: c === (current ?? shown?.card),
        hint: !!hint && seat.usable.has(c),
        placed: shown?.card === c || seat.kept?.card === c,
      }))}
      onPick={onPick}
    />
  )
  if (current === undefined) return tabs
  return (
    <>
      {tabs}
      <ul className="cards cards-one">{view(current)}</ul>
    </>
  )
}
