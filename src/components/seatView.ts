// 盤から、席ごとに画面へ出すものを求める。合法手を数えるのは重いので、盤が変わったときに一度だけ求める。
// 対局の中身は変えず、見せ方だけを決める純粋な関数を置く。

import type { ActionKind, CardId, PowerCtx } from '../game/cards'
import { kindsNow, usableCards } from '../game/hand'
import { ctxOf, freeDice, keptRow } from '../game/rules'
import { type PlacedRow, rowOf } from '../game/slots'
import type { Action, GameState, PlayerIndex, PlayerState } from '../game/types'
import type { DieMark } from './Die'

/** カードに置いて見せるダイス。complete は行動として組み上がっていること。効果の記号を値に置き換える */
export type Shown = PlacedRow & { complete: boolean }

export interface SeatView {
  who: PlayerIndex
  player: PlayerState
  /** 今のステップで使えるカード */
  usable: Set<CardId>
  /** カードごとの、今使える行。使えないカードは空 */
  active: Map<CardId, ActionKind[]>
  /**
   * カードごとの、このステップに置ける行。出目のせいで使えなくても入れ、ステップや詠唱の都合で使えない行と使い終わったカードは入れない。
   * カードの色は、この行があるかで決める。出目で使えないだけなら色を変えない
   */
  rows: Map<CardId, ActionKind[]>
  /** 1ステップ目に使い、ターンが変わるまでカードの置き場に残るダイス */
  kept: PlacedRow | null
  /** 席の様子。失った体力で威力の変わるカードの値に効く */
  ctx: PowerCtx
  /** ダイスごとの印。前のターンから持ち越した、このターンに振り足した、凍って次のステップに置けない。印の無いダイスは null */
  marks: (DieMark | null)[]
}

export function seatView(board: GameState, who: PlayerIndex): SeatView {
  const usable = usableCards(board, who)
  const player = board.players[who]
  const spent = (c: CardId) => player.usedCards.includes(c) && !usable.has(c)
  return {
    who,
    player,
    usable,
    active: new Map(player.deck.map((c) => [c, usable.has(c) ? kindsNow(board, who, c) : []])),
    rows: new Map(player.deck.map((c) => [c, spent(c) ? [] : kindsNow(board, who, c)])),
    kept: keptRow(board, who),
    ctx: ctxOf(board, who),
    marks: diceMarks(board, who),
  }
}

/**
 * ダイスごとの印。ターンの初めに振ったダイスの後ろに、持ち越したダイス、このターンに振り足したダイスの順に並ぶ。
 * まだ使っていないダイスのうち、凍らされた目のものは凍って置けない
 */
export function diceMarks(board: GameState, who: PlayerIndex): (DieMark | null)[] {
  const p = board.players[who]
  const rolled = board.config.diceCount
  const extra = board.history.filter((r) => r.turn === board.turn).reduce((n, r) => n + r.extra[who].length, 0)
  const free = freeDice(p)
  return p.roll.map((v, i) => {
    if (free.includes(i) && v === p.frozen) return 'frozen'
    if (i >= p.roll.length - extra) return 'extra'
    return i >= rolled ? 'carried' : null
  })
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
  /** 席の5枚。並べる順 */
  deck: readonly CardId[]
}

/**
 * 狭い画面で自分の席に大きく出すカード。公開の間は使ったカードを、選んでいる間は名前を押したカードを出す。
 * 名前を押していなければダイスを置いたカード、それも無ければ使える最初のカード
 */
export function currentCard({ revealing, shown, focus, usable, deck }: CurrentOptions): CardId {
  return (revealing ? shown?.card : undefined) ?? focus ?? shown?.card ?? deck.find((c) => usable.has(c)) ?? deck[0]
}
