// 評価で選んだデッキの表。カードを選ぶ対戦では、CPU がこの中から一つを無作為に持ち込む。
// カードを調整したら、pnpm eval:pool の全体の強さの上位から選び直す。カードの表のほかで、カードを名前で並べてよいのはここだけ。

import { type CardId, POOL, STARTER } from './cards'
import type { Rng } from './types'

/** カードの表の順に並べ替える。選んだ順によらず、席には同じ順で並べる */
export function inPoolOrder(cards: readonly CardId[]): CardId[] {
  return [...cards].sort((a, b) => POOL.indexOf(a) - POOL.indexOf(b))
}

/**
 * CPU の持ち込むデッキ。カードの調整を終えた評価で、全体の強さの上位から型の違うものを十と、スターター。
 * 平均で7ターンより長くかかるデッキは、守りばかりの長い対局になりやすいので入れない
 */
export const CPU_DECKS: readonly (readonly CardId[])[] = (
  [
    // 背水と延焼に、過負荷で4個にして双竜を撃つ。残響で大技を重ねる
    ['lastStand', 'wildfire', 'overload', 'twinDragon', 'echo'],
    // 全開と迅雷と魔槍を、残響で重ねる
    ['barrier', 'spear', 'allOut', 'thunder', 'echo'],
    // 風陣と反撃で返し、瞑想で4個にして双竜を撃つ
    ['galeWard', 'thunder', 'twinDragon', 'meditate', 'counter'],
    // 風壁と闇壁で守り、過負荷で4個にして全開を撃つ
    ['barrier', 'interrupt', 'allOut', 'darkWall', 'overload'],
    // 錬成の好きな目と、過負荷の4個で、全開と魔弾を撃つ
    ['bullet', 'allOut', 'overload', 'transmute', 'echo'],
    // スターターの氷礫の代わりに背水
    ['barrier', 'bullet', 'spear', 'interrupt', 'lastStand'],
    // 二重詠唱で過負荷を重ね、隕石、全開、双竜で押す
    ['meteor', 'allOut', 'overload', 'twinDragon', 'doubleCast'],
    // 凍結と風陣で止め、過負荷で全開を撃つ
    ['bullet', 'allOut', 'freeze', 'galeWard', 'overload'],
    // 反撃と凍結で受け、魔槍を残響で重ねる
    ['barrier', 'spear', 'freeze', 'echo', 'counter'],
    // 迅雷と延焼で速く削る
    ['barrier', 'bullet', 'thunder', 'wildfire', 'echo'],
    STARTER,
  ] satisfies (readonly CardId[])[]
).map(inPoolOrder)

/** CPU の持ち込むデッキを、表から無作為に一つ選ぶ */
export function pickCpuDeck(rng: Rng): readonly CardId[] {
  return CPU_DECKS[Math.floor(rng() * CPU_DECKS.length)]
}
