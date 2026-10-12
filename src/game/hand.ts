// 手元の操作。決定するまでの、カードに置きかけたダイスと持ち上げたダイスを扱う。
// 対局の結果には影響しない途中経過で、決定した行動だけが match.ts の submit に渡る。
// ダイスは選んだ置き場にそのまま入り、並べ替えたり空いた置き場へ詰めたりはしない。
// 置く時点では目の組み合わせを問わない。行動にならない置き方なら、決定できない理由を返す。
// 画面は操作をそのまま出来事として渡し、ここで次の手元を決める。

import { ACTION_DEFS, type ActionKind, type CardId, kindsOfCard } from './cards'
import { freeDice, isLegal, legalActions } from './rules'
import { filled, fillsRequired, MARK_SLOT, type PlacedRow, type Slots, slotsOf } from './slots'
import type { Action, GameState, PlayerIndex } from './types'

/** カードに置いたダイス。置けるのは1ステップに1枚だけ */
export interface Placement {
  card: CardId
  slots: Slots
}

export interface Hand {
  /** 今のステップにカードに置いたダイス */
  draft: Placement | null
  /** 持ち上げたダイス。次に選んだ置き場に置く。引きずっている間は、置いてあるダイスを持つこともある */
  held: number | null
}

export const EMPTY_HAND: Hand = { draft: null, held: null }

/** 手元への操作 */
export type HandEvent =
  /** 手元のダイスを押した。持ち上げる。持っていたダイスなら下ろす */
  | { type: 'tapTray'; die: number }
  /** ダイスを引きずり始めた */
  | { type: 'grab'; die: number }
  /** 置き場に置く。die を省くと持っているダイスを置く */
  | { type: 'put'; card: CardId; slot: number; die?: number }
  /** 置き場のダイスを押した。ダイスを持っていれば入れ替え、持っていなければそのダイスを手元に戻す */
  | { type: 'tapPlaced'; card: CardId; slot: number; die: number }
  /** ダイスを手元に戻す */
  | { type: 'takeBack'; die: number }
  /**
   * 狭い画面で、カードの名前を押すか、名前の上にダイスを落とした。名前は置き場ではないので何も置かない。
   * 別のカードに替えたなら、そのカードを使うことを考えているので、置いたダイスも手元に戻す
   */
  | { type: 'consider'; card: CardId }
  /** 持っているダイスを下ろす */
  | { type: 'release' }
  /** 決定した。手元を空にする */
  | { type: 'clear' }

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

/**
 * 今のステップにダイスを置く、そのカードの行の行動。置ける行が無ければ undefined。
 * カード面は1行が1ステップぶんなので、1枚のカードが1つのステップに使える行は1つに限る。この約束はテストで検査する
 */
export function rowNow(state: GameState, who: PlayerIndex, card: CardId): ActionKind | undefined {
  return kindsNow(state, who, card)[0]
}

/** 今のステップで使えるカード */
export function usableCards(state: GameState, who: PlayerIndex): Set<CardId> {
  const set = new Set<CardId>()
  for (const a of legalActions(state, who)) if (a.kind !== 'pass') set.add(ACTION_DEFS[a.kind].card)
  return set
}

/**
 * die を card の置き場に置けるか。今のステップで使えるカードになら、空いたダイスはどの置き場にも置ける。
 * 目の組み合わせが行動になるかは、置いた後に placementIssue で確かめる
 */
export function canPut(state: GameState, who: PlayerIndex, card: CardId, die: number): boolean {
  return freeDice(state.players[who]).includes(die) && usableCards(state, who).has(card)
}

/** そのカードに今のステップで並べる置き場の数。置ける行が無ければ 0 */
function slotCount(state: GameState, who: PlayerIndex, card: CardId): number {
  const kind = rowNow(state, who, card)
  return kind ? slotsOf(ACTION_DEFS[kind]) : 0
}

/**
 * die をカードの slot 番目の置き場に置いた後の配置。置き場が無いか、使えないカードや使用済みのダイスなら null。
 * 置き場にあったダイスは手元に戻る。同じカードの別の置き場から移したときは、二つを入れ替える。
 * 別のカードに置いてあったダイスは手元に戻る
 */
export function placeDie(
  state: GameState,
  who: PlayerIndex,
  draft: Placement | null,
  card: CardId,
  die: number,
  slot: number,
): Placement | null {
  const n = slotCount(state, who, card)
  if (!(slot >= 0 && slot < n) || !canPut(state, who, card, die)) return null
  const slots = draft?.card === card ? [...draft.slots] : Array<number | null>(n).fill(null)
  const from = slots.indexOf(die)
  if (from >= 0) slots[from] = slots[slot]
  slots[slot] = die
  return { card, slots }
}

/** die を手元に戻した後の配置。どの置き場も空になったら null */
export function removeDie(draft: Placement | null, die: number): Placement | null {
  if (!draft) return null
  const slots = draft.slots.map((d) => (d === die ? null : d))
  return slots.some((d) => d !== null) ? { card: draft.card, slots } : null
}

/** 操作を受けた後の手元 */
export function reduceHand(state: GameState, who: PlayerIndex, hand: Hand, e: HandEvent): Hand {
  const free = (die: number) => freeDice(state.players[who]).includes(die)
  const put = (card: CardId, slot: number, die: number): Hand => ({
    draft: placeDie(state, who, hand.draft, card, die, slot) ?? hand.draft,
    held: null,
  })
  switch (e.type) {
    case 'tapTray':
      if (!free(e.die)) return hand
      return { ...hand, held: hand.held === e.die ? null : e.die }
    case 'grab':
      return free(e.die) ? { ...hand, held: e.die } : hand
    case 'put': {
      const die = e.die ?? hand.held
      // Stryker disable next-line ConditionalExpression: 持っていない手で置いても、置けずに下ろすだけで手元は同じ
      return die === null ? hand : put(e.card, e.slot, die)
    }
    case 'tapPlaced':
      return hand.held !== null ? put(e.card, e.slot, hand.held) : { draft: removeDie(hand.draft, e.die), held: null }
    case 'takeBack':
      return { draft: removeDie(hand.draft, e.die), held: null }
    case 'consider':
      return { draft: hand.draft?.card === e.card ? hand.draft : null, held: null }
    case 'release':
      return { ...hand, held: null }
    case 'clear':
      return EMPTY_HAND
  }
}

/** 持っているダイスを置ける、そのカードの置き場の番号。使えるカードなら、目を問わずどの置き場にも置ける */
export function targets(state: GameState, who: PlayerIndex, hand: Hand, card: CardId): number[] {
  const { held } = hand
  // Stryker disable next-line ConditionalExpression: 持っていなければ canPut も置けないと答える
  if (held === null || !canPut(state, who, card, held)) return []
  return Array.from({ length: slotCount(state, who, card) }, (_, k) => k)
}

/** 置いたダイスを、カードの行に置いたダイスとして読む。置いていなければ null */
export function draftRow(state: GameState, who: PlayerIndex, hand: Hand): PlacedRow | null {
  const { draft } = hand
  const kind = draft && rowNow(state, who, draft.card)
  return draft && kind ? { card: draft.card, kind, slots: draft.slots } : null
}

/**
 * カードと置き場ごとのダイスから合法な行動を組み立てる。行動にならなければ null。
 * 行動は置き場ごとのダイスをそのまま持ち、空けた置き場も空けたまま記録する
 */
export function composeAction(state: GameState, who: PlayerIndex, card: CardId, slots: Slots): Action | null {
  for (const kind of kindsNow(state, who, card)) {
    const a: Action = { kind, dice: [...slots] }
    if (isLegal(state, who, a)) return a
  }
  return null
}

/** 置いたダイスから組み立てた行動。行動にならなければ null */
export function draftAction(state: GameState, who: PlayerIndex, hand: Hand): Action | null {
  return hand.draft && composeAction(state, who, hand.draft.card, hand.draft.slots)
}

/**
 * 置ける個数 counts のどれかになるまでに、あと何個置けばよいか。置いた個数で足りているか、もう足しても届かなければ null。
 * 魔弾のように個数を選べる行動もあるので、置いた個数より多い中で一番少ない個数を目指す
 */
export function missingDice(counts: readonly number[], placed: number): number | null {
  if (counts.includes(placed)) return null
  // Stryker disable next-line EqualityOperator: 置いた個数と同じ個数は前の行で除いている
  const more = counts.filter((n) => n > placed)
  return more.length > 0 ? Math.min(...more) - placed : null
}

/** 置いたダイスが行動にならない理由。画面はこれを短い文にして、決定の場所に出す */
export type Issue =
  /** 印の置き場が空いている。印の置き場の目が効果の値になるので、まずそこに置く */
  | { type: 'mark'; mark: string }
  /** 個数が足りない。same は同じ目を揃える行動 */
  | { type: 'more'; count: number; same: boolean }
  /** 個数は足りているが、点線の枠にだけ置いて、空けられない置き場が空いている。空けられない置き場は行の前、左に並ぶ */
  | { type: 'left' }
  /** 同じ目を揃える行動で、目が揃っていない */
  | { type: 'same'; count: number }
  /** 決まった理由に当たらない。カードを足して新しい条件が増えても、何かは伝える */
  | { type: 'unusable' }

/**
 * 置いたダイスが行動にならないとき、決定できない理由を返す。行動になるなら null。
 * 理由は定義表の性質から決めるので、カードを足しても追従する。
 * 印の置き場が空いていれば、そこに置くこと。個数が足りなければ、あと何個置くか。
 * 個数は足りていても空けられない置き場が空いていれば、左の枠に置くこと。
 * 同じ目を揃える行動なら、目が揃っていないこと
 */
export function placementIssue(state: GameState, who: PlayerIndex, draft: Placement): Issue | null {
  if (composeAction(state, who, draft.card, draft.slots)) return null
  const kind = rowNow(state, who, draft.card)
  if (kind === undefined) return { type: 'unusable' }
  const def = ACTION_DEFS[kind]
  const picked = filled(draft.slots)
  // 印の置き場の目が効果の値になるので、ほかの置き場が足りていても、まず印の置き場を埋めてもらう
  const { mark } = def.face
  if (mark !== undefined && draft.slots[MARK_SLOT] === null) return { type: 'mark', mark }
  const missing = missingDice(def.dice, picked.length)
  if (missing !== null) return { type: 'more', count: missing, same: !!def.sameValues }
  if (!fillsRequired(def, draft.slots)) return { type: 'left' }
  const vals = picked.map((i) => state.players[who].roll[i])
  if (def.sameValues && new Set(vals).size > 1) return { type: 'same', count: picked.length }
  return { type: 'unusable' }
}

/** 置いたダイスが行動にならない理由。置いていないか、行動になるなら null */
export function draftIssue(state: GameState, who: PlayerIndex, hand: Hand): Issue | null {
  return hand.draft && placementIssue(state, who, hand.draft)
}
