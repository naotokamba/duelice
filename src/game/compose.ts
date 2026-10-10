// 画面の操作から行動を組み立てる処理。
// プレイヤーはカードを選んでからダイスを選ぶので、その途中経過を扱う。
// 画面から切り離した純粋関数にして、カードを足したときも定義表から自動で追従する。

import { ACTION_DEFS, kindsOfCard } from './cards'
import { isLegal, legalActions } from './rules'
import type { Action, ActionKind, CardId, GameState, PlayerIndex } from './types'

/** 今のステップで、そのカードが取りうる行動の種類 */
export function kindsNow(state: GameState, who: PlayerIndex, card: CardId): ActionKind[] {
  const p = state.players[who]
  return kindsOfCard(card).filter((k) => {
    const def = ACTION_DEFS[k]
    if (def.step !== undefined && def.step !== state.step) return false
    if (def.needsCharge) return p.chant === 'charged'
    return true
  })
}

/** そのカードに今置けるダイスの最大数 */
export function maxDice(state: GameState, who: PlayerIndex, card: CardId): number {
  return Math.max(0, ...kindsNow(state, who, card).flatMap((k) => ACTION_DEFS[k].dice))
}

/** 今のステップで使えるカード */
export function availableCards(state: GameState, who: PlayerIndex): Set<CardId> {
  const set = new Set<CardId>()
  for (const a of legalActions(state, who)) if (a.kind !== 'pass') set.add(ACTION_DEFS[a.kind].card)
  return set
}

/** カードと選んだダイスから合法な行動を組み立てる。足りなければ null */
export function composeAction(state: GameState, who: PlayerIndex, card: CardId, picked: number[]): Action | null {
  for (const kind of kindsNow(state, who, card)) {
    if (!ACTION_DEFS[kind].dice.includes(picked.length)) continue
    const a: Action = { kind, dice: picked }
    if (isLegal(state, who, a)) return a
  }
  return null
}

function countText(counts: number[]): string {
  return `${counts.join('個か')}個`
}

/** 選択中の内容を一行で説明する */
export function previewText(state: GameState, who: PlayerIndex, card: CardId, picked: number[]): string {
  const kinds = kindsNow(state, who, card)
  const p = state.players[who]
  const vals = picked.map((i) => p.roll[i])
  const a = composeAction(state, who, card, picked)
  if (a && a.kind !== 'pass') {
    const def = ACTION_DEFS[a.kind]
    const v = vals.join('と')
    if (def.power) {
      const n = def.power(vals)
      return `${def.label}：${v}、${n}点${def.piercing ? '、防御をすり抜ける' : ''}`
    }
    if (def.guard) return `${def.label}：${v}、受ける攻撃を${def.guard(vals)}減らす`
    if (def.chant) return `${def.label}：${v}。${vals[0]}以上のダメージを受けると崩れる`
    if (def.reflects) return `${def.label}：${v}、受ける攻撃を返す`
    return `${def.label}：${v}`
  }
  const def = ACTION_DEFS[kinds[0]]
  if (def.sameValues && picked.length > 0) return `${def.label}：同じ目を${Math.max(...def.dice)}個選んでください`
  const counts = [...new Set(kinds.flatMap((k) => ACTION_DEFS[k].dice))].sort((x, y) => x - y)
  return `${def.label}：ダイスを${countText(counts)}選んでください`
}
