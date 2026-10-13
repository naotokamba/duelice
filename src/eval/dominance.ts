// 上位互換と下位互換を機械的に探す。
// 局面で見るときは、その局面で全てのカードを持っていることにして行列ゲームを作り、
// カード A の行動の行が、どれもカード B の行動の行のどれかに弱く支配されるかを数える。
// 相手の列は、相手が本当に持ち込んだ5枚の行動のまま。
// 行動の回数を増やすカードは、全てのカードに入れない。一緒に使う手は、ほかのカードの行の効果を含んで弱く支配しやすく、
// カードどうしの比べにならないうえ、組の数が増えて重い。このカードの強さは、差し替えと無作為なデッキで測る。

import { ACTION_DEFS, type CardId, kindsOfCard, POOL } from '../game/cards'
import { Thinker } from '../game/cpu'
import type { GameState, PlayerIndex } from '../game/types'

/** 局面で比べるときに持たせるカード。行動の回数を増やすカードを除いた全て */
export const COMPARED = POOL.filter((c) => !kindsOfCard(c).some((k) => ACTION_DEFS[k].multi))

/** 比べるときに同じとみなす幅 */
const EPS = 1e-9

/** 局面ごとの数え。applicable[A] は A を使えた局面、dominated[A][B] は A の行が全て B の行に弱く支配された局面 */
export interface RowTally {
  applicable: Partial<Record<CardId, number>>
  dominated: Partial<Record<CardId, Partial<Record<CardId, number>>>>
}

export const emptyTally = (): RowTally => ({ applicable: {}, dominated: {} })

/** 行 b が行 a を弱く支配するか。どの列でも同じか上 */
const covers = (b: number[], a: number[]) => b.every((v, j) => v >= a[j] - EPS)

/** 二つの数えを足す */
export function mergeTally(into: RowTally, add: RowTally): RowTally {
  for (const [a, n] of Object.entries(add.applicable) as [CardId, number][])
    into.applicable[a] = (into.applicable[a] ?? 0) + n
  for (const [a, row] of Object.entries(add.dominated) as [CardId, Partial<Record<CardId, number>>][]) {
    const to = into.dominated[a] ?? {}
    for (const [b, n] of Object.entries(row) as [CardId, number][]) to[b] = (to[b] ?? 0) + n
    into.dominated[a] = to
  }
  return into
}

/**
 * who が行動の回数を増やすカードを除いた全てのカードを持っているとした局面で、カードごとの行動の行を比べる。
 * このステップに使える行動の無いカードは数えない。二ステップ目の価値も、全てのカードを持っているとして求める
 */
export function tallyRows(state: GameState, who: PlayerIndex, thinker = new Thinker()): RowTally {
  const players = [...state.players] as GameState['players']
  players[who] = { ...players[who], deck: [...COMPARED] }
  const g = thinker.game({ ...state, players }, who)
  const rows = new Map<CardId, number[][]>()
  g.mine.forEach((a, i) => {
    if (a.kind === 'pass') return
    const card = ACTION_DEFS[a.kind].card
    rows.set(card, [...(rows.get(card) ?? []), g.payoff[i]])
  })
  const tally = emptyTally()
  for (const [a, ra] of rows) {
    tally.applicable[a] = 1
    const by: Partial<Record<CardId, number>> = {}
    for (const [b, rb] of rows) {
      if (a !== b && ra.every((x) => rb.some((y) => covers(y, x)))) by[b] = 1
    }
    if (Object.keys(by).length > 0) tally.dominated[a] = by
  }
  return tally
}
