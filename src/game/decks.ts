// 評価で選んだデッキの表。カードを選ぶ対戦では、CPU がこの中から一つを無作為に持ち込む。
// カードを調整したら、pnpm eval:pool の全体の強さの上位から選び直す。カードの表のほかで、カードを名前で並べてよいのはここだけ。

import { type CardId, POOL, STARTER } from './cards'
import type { Rng } from './types'

/** カードの表の順に並べ替える。選んだ順によらず、席には同じ順で並べる */
export function inPoolOrder(cards: readonly CardId[]): CardId[] {
  return [...cards].sort((a, b) => POOL.indexOf(a) - POOL.indexOf(b))
}

/** CPU の持ち込むデッキ。評価の1回目の全体の強さの上位十と、スターター */
export const CPU_DECKS: readonly (readonly CardId[])[] = (
  [
    ['barrier', 'interrupt', 'allOut', 'darkWall', 'meditate'],
    ['barrier', 'bullet', 'spear', 'interrupt', 'lastStand'],
    ['barrier', 'bullet', 'spear', 'interrupt', 'meteor'],
    ['flameStrike', 'barrier', 'spear', 'interrupt', 'lastStand'],
    ['flameStrike', 'barrier', 'spear', 'interrupt', 'meteor'],
    ['barrier', 'bullet', 'lastStand', 'darkWall', 'meditate'],
    ['flameStrike', 'barrier', 'bullet', 'interrupt', 'lastStand'],
    ['flameStrike', 'allOut', 'galeWard', 'overload', 'meditate'],
    ['barrier', 'bullet', 'spear', 'interrupt', 'thunder'],
    ['bullet', 'interrupt', 'allOut', 'darkWall', 'overload'],
    STARTER,
  ] satisfies (readonly CardId[])[]
).map(inPoolOrder)

/** CPU の持ち込むデッキを、表から無作為に一つ選ぶ */
export function pickCpuDeck(rng: Rng): readonly CardId[] {
  return CPU_DECKS[Math.floor(rng() * CPU_DECKS.length)]
}
