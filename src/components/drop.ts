// 引きずったダイスを落とす先。落とせる要素は data-drop に行き先を書き、指を離した位置の要素から読む。
// 行き先は手元、カードの置き場、狭い画面のカードの名前の三つ。

import { CARD_ORDER, type CardId } from '../game/cards'
import type { HandEvent } from '../game/hand'

export type DropTarget = { type: 'tray' } | { type: 'slot'; card: CardId; slot: number } | { type: 'tab'; card: CardId }

/** 行き先を data-drop に書く値にする */
export function dropAttr(t: DropTarget): string {
  switch (t.type) {
    case 'tray':
      return 'tray'
    case 'slot':
      return `slot:${t.card}:${t.slot}`
    case 'tab':
      return `tab:${t.card}`
  }
}

const isCard = (s: string | undefined): s is CardId => CARD_ORDER.includes(s as CardId)

/** data-drop の値から行き先を読む。行き先でなければ null */
export function readDrop(attr: string | null): DropTarget | null {
  const [type, card, slot] = attr?.split(':') ?? []
  if (type === 'tray' && card === undefined) return { type: 'tray' }
  if (type === 'tab' && isCard(card) && slot === undefined) return { type: 'tab', card }
  if (type === 'slot' && isCard(card) && /^\d+$/.test(slot ?? '')) return { type: 'slot', card, slot: Number(slot) }
  return null
}

/**
 * die を t に落とした時の、手元への操作。手元に落とせば戻し、置き場に落とせばそこに置く。
 * カードの名前は置き場ではないので、そのカードを考えるだけで置かない。行き先が無ければ下ろすだけ
 */
export function dropEvent(t: DropTarget | null, die: number): HandEvent {
  switch (t?.type) {
    case 'tray':
      return { type: 'takeBack', die }
    case 'slot':
      return { type: 'put', card: t.card, slot: t.slot, die }
    case 'tab':
      return { type: 'consider', card: t.card }
    default:
      return { type: 'release' }
  }
}
