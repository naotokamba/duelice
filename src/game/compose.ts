// 画面の操作から行動を組み立てる処理。
// プレイヤーは手元のダイスを、カードの置き場を一つずつ選んで置いていくので、その途中経過を扱う。
// ダイスは選んだ置き場にそのまま入り、並べ替えたり空いた置き場へ詰めたりはしない。
// 行動も置き場ごとにダイスを記録するので、決定した後も、公開でも次のステップでも、置いた置き場にそのまま残る。
// 置く時点では目の組み合わせを問わない。行動にならない置き方なら、決定を押せない理由を返す。
// 画面から切り離した純粋関数にして、カードを足したときも定義表から自動で追従する。

import {
  ACTION_DEFS,
  type ActionDef,
  type EffectPart,
  kindsOfCard,
  MARK_SLOT,
  readsMark,
  requiredSlots,
  slotsOf,
} from './cards'
import { fillsRequired, freeDice, isLegal, legalActions } from './rules'
import type { Action, ActionKind, CardId, GameState, PlayerIndex } from './types'

/** カードに置いたダイス。置けるのは1ステップに1枚だけ。slots は置き場ごとのダイスで、空いた置き場は null */
export interface Placement {
  card: CardId
  slots: (number | null)[]
}

/** 前のステップで使い、カードの上に残っているダイス。kind はダイスの載っている行の行動 */
export interface Settled {
  card: CardId
  kind: ActionKind
  /** 置き場ごとのダイス。空いた置き場は null */
  slots: (number | null)[]
}

/**
 * このターンの1ステップ目に who が使ったダイス。盤の上の駒のように、ターンが変わるまでカードの置き場に残す。
 * 1ステップ目を解決してから次のターンまで返し、パスしたときや、まだ1ステップ目を解決していなければ null。
 * 行動は置き場ごとにダイスを記録しているので、置いた置き場にそのまま残る
 */
export function firstStepDice(state: GameState, who: PlayerIndex): Settled | null {
  // 履歴はステップの順に並ぶので、このターンの最初の記録が1ステップ目になる
  const report = state.history.find((r) => r.turn === state.turn)
  const a = report?.actions[who]
  if (!a || a.kind === 'pass') return null
  return { card: ACTION_DEFS[a.kind].card, kind: a.kind, slots: [...a.dice] }
}

/** 置いたダイスを置き場の順に並べる。空いた置き場は飛ばす */
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

/**
 * カードと置き場ごとのダイスから合法な行動を組み立てる。行動にならなければ null。
 * 行動は置き場ごとのダイスをそのまま持ち、空けた置き場も空けたまま記録する
 */
export function composeAction(
  state: GameState,
  who: PlayerIndex,
  card: CardId,
  slots: (number | null)[],
): Action | null {
  for (const kind of kindsNow(state, who, card)) {
    const a: Action = { kind, dice: [...slots] }
    if (isLegal(state, who, a)) return a
  }
  return null
}

/**
 * die を card の置き場に置けるか。今のステップで使えるカードになら、空いたダイスはどの置き場にも置ける。
 * 目の組み合わせが行動になるかは置いた後に placementIssue で確かめる
 */
export function canPut(state: GameState, who: PlayerIndex, card: CardId, die: number): boolean {
  return freeDice(state.players[who]).includes(die) && availableCards(state, who).has(card)
}

/** そのカードに今のステップで並べる置き場の数。使える行動が無ければ 0 */
export function slotCount(state: GameState, who: PlayerIndex, card: CardId): number {
  const kind = kindsNow(state, who, card)[0]
  return kind ? Math.max(...ACTION_DEFS[kind].dice) : 0
}

/**
 * die をカードの slot 番目の置き場に置いた後の配置。置き場が無いか、使えないカードや使用済みのダイスなら null。
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
  if (!(slot >= 0 && slot < n) || !canPut(state, who, card, die)) return null
  const slots = placement?.card === card ? [...placement.slots] : Array<number | null>(n).fill(null)
  const from = slots.indexOf(die)
  if (from >= 0) slots[from] = slots[slot]
  slots[slot] = die
  return { card, slots }
}

/**
 * 置ける個数 counts のどれかになるまでに、あと何個置けばよいか。置いた個数で足りているか、もう足しても届かなければ null。
 * 魔弾のように個数を選べる行動もあるので、置いた個数より多い中で一番少ない個数を目指す
 */
export function missingDice(counts: readonly number[], placed: number): number | null {
  if (counts.includes(placed)) return null
  const more = counts.filter((n) => n > placed)
  return more.length > 0 ? Math.min(...more) - placed : null
}

/** 決まった理由に当たらない置き方。カードを足して新しい条件が増えても、何かは伝える */
export const CANNOT_USE = 'この置き方では使えない'

/** 個数は足りているが、点線の枠にだけ置いて、空けられない置き場が空いているとき。空けられない置き場は行の前、左に並ぶ */
export const FILL_LEFT = '左の枠に置く'

/**
 * 置いたダイスが行動にならないとき、決定を押せない理由を短く返す。行動になるなら null。
 * 理由は定義表の性質から決めるので、カードを足しても追従する。
 * 印の置き場が空いていれば、そこに置くこと。個数が足りなければ、あと何個置くか。
 * 個数は足りていても空けられない置き場が空いていれば、左の枠に置くこと。
 * 同じ目を揃える行動なら、目が揃っていないこと
 */
export function placementIssue(state: GameState, who: PlayerIndex, placement: Placement): string | null {
  const picked = placedDice(placement)
  if (composeAction(state, who, placement.card, placement.slots)) return null
  const kind = kindsNow(state, who, placement.card)[0]
  if (kind === undefined) return CANNOT_USE
  const def = ACTION_DEFS[kind]
  // 印の置き場の目が効果の値になるので、ほかの置き場が足りていても、まず印の置き場を埋めてもらう。
  // 置き場の名前で伝えられるので、左の枠より分かりやすい
  if (readsMark(def) && placement.slots[MARK_SLOT] === null) return `${def.face.mark} の枠に置く`
  const missing = missingDice(def.dice, picked.length)
  if (missing !== null) return `${def.sameValues ? '同じ目を' : ''}あと${missing}個置く`
  if (!fillsRequired(def, placement.slots)) return FILL_LEFT
  const vals = picked.map((i) => state.players[who].roll[i])
  if (def.sameValues && new Set(vals).size > 1) return `同じ目を${picked.length}個置く`
  return CANNOT_USE
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

/** 効果の値。攻撃なら威力、障壁なら減らす量、詠唱なら崩れる境目になる置いた目 */
function effectValue(def: ActionDef, vals: number[]): number {
  return def.power?.(vals) ?? def.guard?.(vals) ?? vals[0]
}

/**
 * n 個の置き場を埋めたときの目の代わり。記号を使わない行動は、目ではなく個数で値が決まるので、どの目でもよい。
 * 目で値が変わる行動はカード面に記号が要るので、記号の無い行動ではこの決まりが成り立つ。invariants.test.ts で検査する
 */
const anyVals = (n: number) => Array<number>(n).fill(1)

/**
 * カード面の効果。目が分かっていれば、記号をその目から決まる値に置き換える。
 * vals はダイスを置いた置き場の目を置き場の順に並べたもので、空けた置き場は飛ばす。
 * 記号を使わない行動は、値を書かない印に、置いた個数で決まる値を入れる。置く前は空けられない置き場だけを埋めた値にし、
 * 省いてもよい置き場まで埋めると値が増えるなら、その値も添える
 */
export function effectParts(kind: ActionKind, vals?: number[]): EffectPart[] {
  return faceParts(ACTION_DEFS[kind], vals)
}

/** effectParts を定義そのものから作る。定義表に無い仮のカードでも確かめられるように分けてある */
export function faceParts(def: ActionDef, vals?: number[]): EffectPart[] {
  const sym = def.face.mark ?? def.face.sum
  if (sym) {
    if (!vals) return [...def.face.effect]
    const value = String(effectValue(def, vals))
    return def.face.effect.map((p) => ({
      ...p,
      value: p.value?.replaceAll(sym, value),
      text: p.text?.replaceAll(sym, value),
    }))
  }
  if (!def.power && !def.guard) return [...def.face.effect]
  const value = String(effectValue(def, vals ?? anyVals(requiredSlots(def))))
  const full = String(effectValue(def, anyVals(slotsOf(def))))
  return def.face.effect.map((p) =>
    p.icon && p.value === undefined ? { ...p, value, ...(full !== value && { full }) } : p,
  )
}
