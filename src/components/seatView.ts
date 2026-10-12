// 盤から、席ごとに画面へ出すものを求める。合法手を数えるのは重いので、盤が変わったときに一度だけ求める。
// 対局の中身は変えず、見せ方だけを決める純粋な関数を置く。

import { type ActionKind, CARD_ORDER, type CardId } from '../game/cards'
import { kindsNow, usableCards } from '../game/hand'
import { keptRow } from '../game/rules'
import { type PlacedRow, rowOf } from '../game/slots'
import type { Action, GameState, PlayerIndex, PlayerState } from '../game/types'

/** カードに置いて見せるダイス。complete は行動として組み上がっていること。効果の記号を値に置き換える */
export type Shown = PlacedRow & { complete: boolean }

export interface SeatView {
  who: PlayerIndex
  player: PlayerState
  /** 今のステップで使えるカード */
  usable: Set<CardId>
  /** カードごとの、今使える行。使えないカードは空 */
  active: Map<CardId, ActionKind[]>
  /** 1ステップ目に使い、ターンが変わるまでカードの置き場に残るダイス */
  kept: PlacedRow | null
}

export function seatView(board: GameState, who: PlayerIndex): SeatView {
  const usable = usableCards(board, who)
  return {
    who,
    player: board.players[who],
    usable,
    active: new Map(CARD_ORDER.map((c) => [c, usable.has(c) ? kindsNow(board, who, c) : []])),
    kept: keptRow(board, who),
  }
}

/** このターンに使い終わったカード。使用済みと書く */
export function usedUp(seat: SeatView, card: CardId): boolean {
  return seat.player.usedCards.includes(card) && !seat.usable.has(card)
}

/** 公開した行動を、カードに置いたダイスとして見せる。パスなら null */
export function revealed(a: Action): Shown | null {
  const row = rowOf(a)
  return row && { ...row, complete: true }
}

interface CurrentOptions {
  /** 公開の最中 */
  revealing: boolean
  /** カードに置いているか、公開しているダイス */
  shown: Shown | null
  /** 名前を押して選んだカード */
  focus: CardId | null
  usable: Set<CardId>
}

/**
 * 狭い画面で自分の席に大きく出すカード。公開の間は使ったカードを、選んでいる間は名前を押したカードを出す。
 * 名前を押していなければダイスを置いたカード、それも無ければ使える最初のカード
 */
export function currentCard({ revealing, shown, focus, usable }: CurrentOptions): CardId {
  return (
    (revealing ? shown?.card : undefined) ??
    focus ??
    shown?.card ??
    CARD_ORDER.find((c) => usable.has(c)) ??
    CARD_ORDER[0]
  )
}
