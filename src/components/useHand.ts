// 手元の操作を画面につなぐ。決定するまでの手元は hand.ts の reduceHand で進め、ここでは引きずる操作と、
// 狭い画面で大きく出すカードを扱う。大きく出すカードは選んだターンの間だけ覚え、新しいターンには左端のカードに戻す。
// 好きな目のダイスを置いたら、目を選ぶ窓を出す。置いたダイスを押しても出す。

import { useMemo, useState } from 'react'
import type { CardId } from '../game/cards'
import {
  draftAction,
  draftIssue,
  draftRows,
  EMPTY_HAND,
  type Hand,
  type HandEvent,
  isWild,
  reduceHand,
  targets,
} from '../game/hand'
import type { GameState } from '../game/types'
import { dropEvent } from './drop'
import { useDiceDrag } from './useDiceDrag'

/** 置いたダイス全て */
const placedDice = (h: Hand) => new Set(h.drafts.flatMap((p) => p.slots.filter((d): d is number => d !== null)))

export function useHand(board: GameState) {
  const [hand, setHand] = useState<Hand>(EMPTY_HAND)
  const [focus, setFocus] = useState<{ card: CardId; turn: number } | null>(null)
  /** 目を選んでいる好きな目のダイス */
  const [asking, setAsking] = useState<number | null>(null)
  const drag = useDiceDrag()

  /** 狭い画面で card を大きく出す。このターンの間だけ覚える */
  const look = (card: CardId) => setFocus({ card, turn: board.turn })

  const act = (e: HandEvent) => {
    const next = reduceHand(board, 0, hand, e)
    setHand(next)
    // 名前を押したカードか、ダイスを置いたカードを大きく出す
    if (e.type === 'consider') look(e.card)
    else if ((e.type === 'put' || e.type === 'tapPlaced') && next.drafts !== hand.drafts) {
      if (next.drafts.some((p) => p.card === e.card)) look(e.card)
    }
    // 新しく置いた好きな目のダイスで、まだ目を選んでいなければ、目を選ぶ窓を出す
    const before = placedDice(hand)
    const fresh = [...placedDice(next)].find(
      (d) => !before.has(d) && isWild(board, 0, d) && next.chosen?.[d] === undefined,
    )
    if (fresh !== undefined) setAsking(fresh)
  }

  const derived = useMemo(
    () => ({
      /** 置いたダイスから組み立てた行動。行動にならなければ null */
      action: draftAction(board, 0, hand),
      /** 置いたダイスが行動にならない理由 */
      issue: draftIssue(board, 0, hand),
      /** 置いたダイスを、カードの行として読んだもの。置いた順 */
      rows: draftRows(board, 0, hand),
      /** カードごとの、持っているダイスを置ける置き場 */
      targets: new Map(board.players[0].deck.map((c) => [c, targets(board, 0, hand, c)])),
    }),
    [board, hand],
  )

  return {
    /** 持ち上げたダイス */
    held: hand.held,
    /** 今のステップにカードに置いたダイス */
    drafts: hand.drafts,
    /** 好きな目のダイスに選んだ目 */
    chosen: hand.chosen,
    ...derived,
    /** 狭い画面で選んだカード。新しいターンには忘れる */
    focus: focus?.turn === board.turn ? focus.card : null,
    act,
    look,
    /** 目を選んでいる好きな目のダイス。置いたダイスに残っているときだけ */
    asking: asking !== null && placedDice(hand).has(asking) ? asking : null,
    /** 好きな目のダイスの目を選ぶ窓を出す */
    ask: (die: number) => setAsking(die),
    /** 目を選ぶ窓を閉じる */
    stopAsking: () => setAsking(null),
    /** 押した。引きずりの直後に届くクリックは、タップとして扱わない */
    tap: (e: HandEvent) => {
      if (!drag.afterDrop()) act(e)
    },
    /** ダイスを引きずる操作 */
    dragDie: (die: number) =>
      drag.bind(die, {
        start: () => act({ type: 'grab', die }),
        drop: (t) => act(dropEvent(t, die)),
      }),
    /** 引きずっている途中のダイスと位置 */
    dragging: drag.view,
    /** 手元を空にする。決定したとき */
    clear: () => {
      setHand(EMPTY_HAND)
      setAsking(null)
    },
  }
}
