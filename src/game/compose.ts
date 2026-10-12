// 画面の操作から行動を組み立てる処理。
// プレイヤーは手元のダイスを、カードの置き場を一つずつ選んで置いていくので、その途中経過を扱う。
// ダイスは選んだ置き場にそのまま入り、並べ替えたり空いた置き場へ詰めたりはしない。
// 画面から切り離した純粋関数にして、カードを足したときも定義表から自動で追従する。

import { ACTION_DEFS, type EffectPart, kindsOfCard } from './cards'
import { diceValues, freeDice, isLegal, legalActions } from './rules'
import type { Action, ActionKind, CardId, GameState, PlayerIndex } from './types'

/** カードに置いたダイス。置けるのは1ステップに1枚だけ。slots は置き場ごとのダイスで、空いた置き場は null */
export interface Placement {
  card: CardId
  slots: (number | null)[]
}

/** 置いたダイスを置き場の順に並べる。空いた置き場は飛ばす。行動のダイスはこの順になる */
export function placedDice(placement: Placement | null): number[] {
  return placement?.slots.filter((d): d is number => d !== null) ?? []
}

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

/** 今のステップで使えるカード */
export function availableCards(state: GameState, who: PlayerIndex): Set<CardId> {
  const set = new Set<CardId>()
  for (const a of legalActions(state, who)) if (a.kind !== 'pass') set.add(ACTION_DEFS[a.kind].card)
  return set
}

/** カードと置いたダイスから合法な行動を組み立てる。足りなければ null */
export function composeAction(state: GameState, who: PlayerIndex, card: CardId, picked: number[]): Action | null {
  for (const kind of kindsNow(state, who, card)) {
    if (!ACTION_DEFS[kind].dice.includes(picked.length)) continue
    const a: Action = { kind, dice: picked }
    if (isLegal(state, who, a)) return a
  }
  return null
}

/** vals の目が全て、all の中に重複を数えて含まれる */
function containsValues(all: number[], vals: number[]): boolean {
  const rest = [...all]
  return vals.every((v) => {
    const i = rest.indexOf(v)
    if (i < 0) return false
    rest.splice(i, 1)
    return true
  })
}

/**
 * dice を全てカードに置いた状態が、足りないダイスを足せば合法な行動になるか。
 * 合法かどうかは目の値だけで決まり、置き場の順には左右されないので、合法手の目に含まれるかで判定する
 */
export function canHold(state: GameState, who: PlayerIndex, card: CardId, dice: number[]): boolean {
  const p = state.players[who]
  const free = freeDice(p)
  if (new Set(dice).size !== dice.length || !dice.every((d) => free.includes(d))) return false
  const vals = dice.map((i) => p.roll[i])
  return legalActions(state, who).some(
    (a) => a.kind !== 'pass' && ACTION_DEFS[a.kind].card === card && containsValues(diceValues(p, a), vals),
  )
}

/** そのカードに今のステップで並べる置き場の数。使える行動が無ければ 0 */
export function slotCount(state: GameState, who: PlayerIndex, card: CardId): number {
  const kind = kindsNow(state, who, card)[0]
  return kind ? Math.max(...ACTION_DEFS[kind].dice) : 0
}

/**
 * die をカードの slot 番目の置き場に置いた後の配置。置けなければ null。
 * 置き場にあったダイスは手元に戻る。同じカードの別の置き場から移したときは、二つを入れ替える。
 * 別のカードに置いてあったダイスは手元に戻る
 */
export function placeDie(
  state: GameState,
  who: PlayerIndex,
  placement: Placement | null,
  card: CardId,
  die: number,
  slot: number,
): Placement | null {
  const n = slotCount(state, who, card)
  if (!(slot >= 0 && slot < n)) return null
  const slots = placement?.card === card ? [...placement.slots] : Array<number | null>(n).fill(null)
  const from = slots.indexOf(die)
  if (from >= 0) slots[from] = slots[slot]
  slots[slot] = die
  const next = { card, slots }
  return canHold(state, who, card, placedDice(next)) ? next : null
}

/** die を手元に戻した後の配置。どの置き場も空になったら null */
export function removeDie(placement: Placement | null, die: number): Placement | null {
  if (!placement) return null
  const slots = placement.slots.map((d) => (d === die ? null : d))
  return slots.some((d) => d !== null) ? { card: placement.card, slots } : null
}

/**
 * 置いたダイスを描く行動。カード面は1行が1ステップぶんなので、1枚のカードが1つのステップに使える行動は1つに限る。
 * この約束は compose.test.ts で検査する
 */
export function placedKind(state: GameState, who: PlayerIndex, placement: Placement): ActionKind {
  return kindsNow(state, who, placement.card)[0]
}

/** カード面の効果。目が分かっていれば、記号をその目から決まる値に置き換える。vals は置き場の順に並んだ目 */
export function effectParts(kind: ActionKind, vals?: number[]): EffectPart[] {
  const def = ACTION_DEFS[kind]
  const sym = def.face.mark ?? def.face.sum
  if (!vals || !sym) return [...def.face.effect]
  // 記号の値は、攻撃なら威力、障壁なら減らす量、詠唱なら崩れる境目になる置いた目
  const value = String(def.power?.(vals) ?? def.guard?.(vals) ?? vals[0])
  return def.face.effect.map((p) => ({
    ...p,
    value: p.value?.replaceAll(sym, value),
    text: p.text?.replaceAll(sym, value),
  }))
}
