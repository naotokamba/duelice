// カードを選ぶ対戦で、前に選んだ5枚をブラウザに覚える。次にカードを選ぶ画面を開いたら、その5枚を選んだ状態から始める。
// 覚えられない画面でも遊べるように、読み書きに失敗したら覚えていないものとして続ける。
// カードの表が変わって覚えた5枚が持ち込めなくなっていたら、覚えていないものとする。

import { type CardId, isDeck } from '../game/cards'
import { inPoolOrder } from '../game/decks'

const DECK_KEY = 'duelice.deck'

/** 前に選んだ5枚。覚えていなければ null */
export function loadDeck(): CardId[] | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DECK_KEY) ?? 'null')
    return Array.isArray(raw) && isDeck(raw) ? inPoolOrder(raw) : null
  } catch {
    return null
  }
}

export function saveDeck(deck: readonly CardId[]) {
  try {
    localStorage.setItem(DECK_KEY, JSON.stringify(deck))
  } catch {
    // 覚えられなくても遊べる
  }
}
