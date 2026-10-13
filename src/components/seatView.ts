// 盤から、席ごとに画面へ出すものを求める。合法手を数えるのは重いので、盤が変わったときに一度だけ求める。
// 対局の中身は変えず、見せ方だけを決める純粋な関数を置く。

import type { ActionKind, CardId, PowerCtx } from '../game/cards'
import { kindsNow, usableCards } from '../game/hand'
import { ctxOf, freeDice } from '../game/rules'
import { type PlacedRow, rowsOf } from '../game/slots'
import type { Action, GameState, PlayerIndex, PlayerState } from '../game/types'
import { WILD } from '../game/types'
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
  /** 1ステップ目に使い、ターンが変わるまでカードの置き場に残るダイス。一緒に使ったカードにも残る */
  kept: PlacedRow[]
  /** 席の様子。失った体力で威力の変わるカードの値に効く */
  ctx: PowerCtx
  /** ダイスごとの印。前のターンから持ち越した、このターンに効果で足した、凍って次のステップに置けない。印の無いダイスは null */
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
    kept: keptRows(board, who),
    ctx: ctxOf(board, who),
    marks: diceMarks(board, who),
  }
}

/**
 * ダイスごとの印。ターンの初めに振ったダイスの後ろに、持ち越したダイス、このターンに効果で足したダイスの順に並ぶ。
 * まだ使っていないダイスのうち、凍らされた目のものは凍って置けない。好きな目のダイスは、目の無い面で見分けるので印を付けない
 */
export function diceMarks(board: GameState, who: PlayerIndex): (DieMark | null)[] {
  const p = board.players[who]
  const rolled = board.config.diceCount
  const added = board.history.filter((r) => r.turn === board.turn).reduce((n, r) => n + r.added[who].length, 0)
  const free = freeDice(p)
  const wild = p.roll.filter((v) => v === WILD).length
  return p.roll.map((v, i) => {
    if (v === WILD) return null
    if (free.includes(i) && v === p.frozen) return 'frozen'
    if (i >= p.roll.length - wild - added) return 'extra'
    return i >= rolled ? 'carried' : null
  })
}

/**
 * このターンの1ステップ目に who が使ったダイス。盤の上の駒のように、ターンが変わるまでカードの置き場に残る。
 * 一緒に使ったカードのダイスも、それぞれのカードに残る。防ぎきって戻ったダイスのように、もう使っていないダイスは手元にあるので残さない。
 * 1ステップ目を解決してから次のターンまで返し、パスしたときや、まだ1ステップ目を解決していなければ空
 */
export function keptRows(board: GameState, who: PlayerIndex): PlacedRow[] {
  // 履歴はステップの順に並ぶので、このターンの最初の記録が1ステップ目になる
  const report = board.history.find((r) => r.turn === board.turn)
  if (!report) return []
  const { usedDice } = board.players[who]
  return rowsOf(report.actions[who]).flatMap((row) => {
    const slots = row.slots.map((d) => (d !== null && usedDice.includes(d) ? d : null))
    return slots.some((d) => d !== null) ? [{ ...row, slots }] : []
  })
}

/** このターンに使い終わったカード。使用済みと書く */
export function usedUp(seat: SeatView, card: CardId): boolean {
  return seat.player.usedCards.includes(card) && !seat.usable.has(card)
}

/** 公開した行動を、カードに置いたダイスとして見せる。一緒に使ったカードも並べる。パスなら空 */
export function revealed(a: Action): Shown[] {
  return rowsOf(a).map((row) => ({ ...row, complete: true }))
}

/** card に置いているか、公開しているダイス。無ければ null */
export function shownOn(shown: readonly Shown[], card: CardId): Shown | null {
  return shown.find((s) => s.card === card) ?? null
}

interface CurrentOptions {
  /** 公開の最中 */
  revealing: boolean
  /** カードに置いているか、公開しているダイス。置いた順 */
  shown: readonly Shown[]
  /** 名前を押して選んだカード */
  focus: CardId | null
  usable: Set<CardId>
  /** 席の5枚。並べる順 */
  deck: readonly CardId[]
}

/**
 * 狭い画面で自分の席に大きく出すカード。公開の間は使ったカードを、選んでいる間は名前を押したカードを出す。
 * 名前を押していなければダイスを置いたカード、それも無ければ使える最初のカード。
 * 一緒に使ったカードがあれば、公開の間は最後に置いたカードを、選んでいる間は最初に置いたカードを出す
 */
export function currentCard({ revealing, shown, focus, usable, deck }: CurrentOptions): CardId {
  const first = shown[0]?.card
  return (revealing ? shown.at(-1)?.card : undefined) ?? focus ?? first ?? deck.find((c) => usable.has(c)) ?? deck[0]
}
