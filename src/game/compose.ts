// 画面の操作から行動を組み立てる処理。
// プレイヤーは手元のダイスをカードの置き場に置いていくので、その途中経過を扱う。
// 画面から切り離した純粋関数にして、カードを足したときも定義表から自動で追従する。

import { ACTION_DEFS, kindsOfCard } from './cards'
import { diceValues, freeDice, isLegal, legalActions } from './rules'
import type { Action, ActionKind, CardId, GameState, PlayerIndex } from './types'

/** カードに置いたダイス。置けるのは1ステップに1枚だけ */
export interface Placement {
  card: CardId
  dice: number[]
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
 * picked を置いたカードに、さらに die を置けるか。置いた後に、足りないダイスを足せば合法な行動になるなら置ける。
 * 合法かどうかは目の値だけで決まるので、合法手の目に含まれるかで判定する
 */
export function canPlace(state: GameState, who: PlayerIndex, card: CardId, picked: number[], die: number): boolean {
  const p = state.players[who]
  if (picked.includes(die) || !freeDice(p).includes(die)) return false
  const vals = [...picked, die].map((i) => p.roll[i])
  return legalActions(state, who).some(
    (a) => a.kind !== 'pass' && ACTION_DEFS[a.kind].card === card && containsValues(diceValues(p, a), vals),
  )
}

/** die をカードに置いた後の配置。置けなければ null。別のカードに置いてあったダイスは手元に戻る */
export function placeDie(
  state: GameState,
  who: PlayerIndex,
  placement: Placement | null,
  card: CardId,
  die: number,
): Placement | null {
  const base = placement?.card === card ? placement.dice.filter((d) => d !== die) : []
  return canPlace(state, who, card, base, die) ? { card, dice: [...base, die] } : null
}

/** die を手元に戻した後の配置 */
export function removeDie(placement: Placement | null, die: number): Placement | null {
  const dice = placement?.dice.filter((d) => d !== die) ?? []
  return placement && dice.length > 0 ? { card: placement.card, dice } : null
}

/**
 * 置いたダイスを描く行動。カード面は1行が1ステップぶんなので、1枚のカードが1つのステップに使える行動は1つに限る。
 * この約束は compose.test.ts で検査する
 */
export function placedKind(state: GameState, who: PlayerIndex, placement: Placement): ActionKind {
  return kindsNow(state, who, placement.card)[0]
}

/** 置き場に並べる順。高い目から並べるので、最初の置き場には一番高い目が入る */
export function slotOrder(roll: number[], dice: number[]): number[] {
  return [...dice].sort((a, b) => roll[b] - roll[a] || a - b)
}

/** カード面の効果の文。目が分かっていれば、記号をその目から決まる値に置き換える */
export function effectText(kind: ActionKind, vals?: number[]): string {
  const def = ACTION_DEFS[kind]
  const sym = def.face.mark ?? def.face.sum
  if (!vals || !sym) return def.face.effect
  // 記号の値は、攻撃なら威力、障壁なら減らす量、詠唱なら崩れる境目になる置いた目
  const value = def.power?.(vals) ?? def.guard?.(vals) ?? vals[0]
  return def.face.effect.replaceAll(sym, String(value))
}
