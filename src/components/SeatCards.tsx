// 席のカード。広い画面ではその席の5枚を並べ、狭い画面ではカードの名前を並べて一枚だけ大きく出す。
// 相手の席は、狭い画面では名前だけを並べる。公開した技は中央の名乗りの札で分かり、カードは名前を押せば窓で見られる。

import type { CardId } from '../game/cards'
import { ACTION_DEFS, kindsOfCard } from '../game/cards'
import { Card, type CardPlay } from './Card'
import { CardTabs } from './CardTabs'
import { type SeatView, type Shown, shownOn, usedUp } from './seatView'

interface CardProps {
  seat: SeatView
  card: CardId
  /** カードに置いているか、公開しているダイス。一緒に使ったカードも並ぶ */
  shown: readonly Shown[]
  /** 公開の最中。使ったカードを光らせる */
  revealing: boolean
  play?: CardPlay
}

/** 席のカードを一枚描く */
export function SeatCard({ seat, card, shown, revealing, play }: CardProps) {
  const here = shownOn(shown, card)
  // 直前の効果をもう一度出すカードには、今使えば何を出すかを書く。公開の間は、出した効果が記録に残るので書かない
  const echoes = kindsOfCard(card).some((k) => ACTION_DEFS[k].echo)
  return (
    <Card
      card={card}
      roll={seat.player.roll}
      active={seat.active.get(card) ?? []}
      lit={seat.rows.get(card) ?? []}
      used={usedUp(seat, card)}
      shown={here}
      casting={revealing && here !== null}
      kept={seat.kept.find((r) => r.card === card) ?? null}
      play={play}
      ctx={seat.ctx}
      last={echoes && !revealing ? seat.player.last : undefined}
    />
  )
}

interface Props {
  seat: SeatView
  shown: readonly Shown[]
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
  const deck = seat.player.deck
  if (!narrow) return <ul className="cards">{deck.map(view)}</ul>

  const tabs = (
    <CardTabs
      tabs={deck.map((c) => {
        const here = shownOn(shown, c) !== null
        return {
          card: c,
          // 灰色にするのは、このステップに置ける行が無いときだけ。出目のせいで使えないだけなら色は変えない
          off: (seat.rows.get(c) ?? []).length === 0 && !here,
          current: c === (current ?? shown[0]?.card),
          hint: !!hint && seat.usable.has(c),
          placed: here || seat.kept.some((r) => r.card === c),
          used: usedUp(seat, c) && !here,
        }
      })}
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
