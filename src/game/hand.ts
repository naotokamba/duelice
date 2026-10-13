// 手元の操作。決定するまでの、カードに置きかけたダイスと持ち上げたダイスを扱う。
// 対局の結果には影響しない途中経過で、決定した行動だけが match.ts の submit に渡る。
// ダイスは選んだ置き場にそのまま入り、並べ替えたり空いた置き場へ詰めたりはしない。
// 置く時点では目の組み合わせを問わない。行動にならない置き方なら、決定できない理由を返す。
// 置けるのはふつう1ステップに1枚で、行動の回数を増やすカードに置いていれば、さらに決まった枚数まで置ける。
// 好きな目のダイスは、置いてから目を選ぶ。選んだ目はダイスごとに覚え、置き場を移しても変わらない。
// 画面は操作をそのまま出来事として渡し、ここで次の手元を決める。

import { ACTION_DEFS, type ActionKind, type CardId, kindsOfCard } from './cards'
import { isLegal, legalActions, partsOf, placeableDice, playLegal } from './rules'
import { filled, fillsRequired, MARK_SLOT, type PlacedRow, rowValues, type Slots, slotsOf } from './slots'
import { type Action, type GameState, type Play, type PlayerIndex, WILD } from './types'

/** カードに置いたダイス */
export interface Placement {
  card: CardId
  slots: Slots
}

export interface Hand {
  /**
   * 今のステップにカードに置いたダイス。置いた順に並ぶ。ふつうは1枚で、
   * 行動の回数を増やすカードに置いていれば、そのカードと、一緒に使うカードを決まった枚数まで持つ
   */
  drafts: Placement[]
  /** 持ち上げたダイス。次に選んだ置き場に置く。引きずっている間は、置いてあるダイスを持つこともある */
  held: number | null
  /** 好きな目のダイスに選んだ目。ダイスの番号ごと。まだ選んでいなければ持たない */
  chosen?: Record<number, number>
}

export const EMPTY_HAND: Hand = { drafts: [], held: null }

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
  /** 好きな目のダイスの目を選ぶ */
  | { type: 'choose'; die: number; value: number }
  /**
   * 狭い画面で、カードの名前を押すか、名前の上にダイスを落とした。名前は置き場ではないので何も置かない。
   * 別のカードに替えたなら、そのカードを使うことを考えているので、置いたダイスも手元に戻す。
   * 行動の回数を増やすカードに置いていれば、ほかのカードにも置くので、置いたダイスはそのまま
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

/** そのカードで一緒に使えるカードの枚数。行動の回数を増やすカードでなければ 0 */
export function multiOf(card: CardId): number {
  return Math.max(0, ...kindsOfCard(card).map((k) => ACTION_DEFS[k].multi ?? 0))
}

/** 盤ごとの、使えるカード。合法手を数えるのは重いので、同じ盤には一度だけ求める */
const usableCache = new WeakMap<GameState, [Set<CardId>, Set<CardId>]>()

/** 今のステップで使えるカード。行動の回数を増やすカードと一緒にだけ使えるカードも含む */
export function usableCards(state: GameState, who: PlayerIndex): Set<CardId> {
  const hit = usableCache.get(state)
  if (hit) return hit[who]
  const both = ([0, 1] as const).map((w) => {
    const set = new Set<CardId>()
    for (const a of legalActions(state, w)) for (const x of partsOf(a)) set.add(ACTION_DEFS[x.kind].card)
    return set
  }) as [Set<CardId>, Set<CardId>]
  usableCache.set(state, both)
  return both[who]
}

/**
 * die を card の置き場に置けるか。今のステップで使えるカードになら、空いたダイスはどの置き場にも置ける。
 * 凍らされた目のダイスは置けない。目の組み合わせが行動になるかは、置いた後に placementIssue で確かめる
 */
export function canPut(state: GameState, who: PlayerIndex, card: CardId, die: number): boolean {
  return placeableDice(state.players[who]).includes(die) && usableCards(state, who).has(card)
}

/** そのカードに今のステップで並べる置き場の数。置ける行が無ければ 0 */
function slotCount(state: GameState, who: PlayerIndex, card: CardId): number {
  const kind = rowNow(state, who, card)
  return kind ? slotsOf(ACTION_DEFS[kind]) : 0
}

/**
 * 置いたダイスの並びを整える。ダイスの無くなったカードは外す。
 * 行動の回数を増やすカードに置いていなければ、置けるのは1枚なので、latest のカードだけを残す。latest が無ければ最初の1枚を残す。
 * 置いていれば、そのカードと、一緒に使うカードを決まった枚数まで残す。
 * 決まった枚数を超えるのは、新しいカードに置いて並びの最後に加わったときだけなので、その一つ前に置いたカードと入れ替える
 */
function settle(list: Placement[], latest?: CardId): Placement[] {
  const live = list.filter((p) => p.slots.some((d) => d !== null))
  const top = live.find((p) => multiOf(p.card) > 0)
  if (!top) {
    const keep = live.find((p) => p.card === latest) ?? live[0]
    return keep ? [keep] : []
  }
  const limit = multiOf(top.card)
  const more = live.filter((p) => p !== top)
  const kept = more.length > limit ? more.filter((_, i) => i !== limit - 1) : more
  return live.filter((p) => p === top || kept.includes(p))
}

/**
 * die をカードの slot 番目の置き場に置いた後の、置いたダイスの並び。置き場が無いか、使えないカードや使用済みのダイスなら null。
 * 置き場にあったダイスは手元に戻る。同じカードの別の置き場から移したときは、二つを入れ替える。
 * 別のカードに置いてあったダイスは、そのカードから外れる。
 * 一枚しか置けない間に別のカードへ置くと、前のカードのダイスは手元に戻る
 */
export function placeDie(
  state: GameState,
  who: PlayerIndex,
  drafts: readonly Placement[],
  card: CardId,
  die: number,
  slot: number,
): Placement[] | null {
  const n = slotCount(state, who, card)
  if (!(slot >= 0 && slot < n) || !canPut(state, who, card, die)) return null
  const here = drafts.find((p) => p.card === card)
  const slots = here ? [...here.slots] : Array<number | null>(n).fill(null)
  const from = slots.indexOf(die)
  if (from >= 0) slots[from] = slots[slot]
  slots[slot] = die
  const placed: Placement = { card, slots }
  const rest = drafts.map((p) =>
    p.card === card ? placed : { card: p.card, slots: p.slots.map((d) => (d === die ? null : d)) },
  )
  return settle(here ? rest : [...rest, placed], card)
}

/** die を手元に戻した後の、置いたダイスの並び */
export function removeDie(drafts: readonly Placement[], die: number): Placement[] {
  return settle(drafts.map((p) => ({ card: p.card, slots: p.slots.map((d) => (d === die ? null : d)) })))
}

/** 好きな目のダイスに選べる目か。1から6で、凍らされた目でない */
export function choosable(state: GameState, who: PlayerIndex, value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 6 && value !== state.players[who].frozen
}

/** 好きな目のダイスか */
export function isWild(state: GameState, who: PlayerIndex, die: number): boolean {
  return state.players[who].roll[die] === WILD
}

/** 操作を受けた後の手元 */
export function reduceHand(state: GameState, who: PlayerIndex, hand: Hand, e: HandEvent): Hand {
  // 凍らされた目のダイスは置けないので、持ち上げもしない
  const free = (die: number) => placeableDice(state.players[who]).includes(die)
  const put = (card: CardId, slot: number, die: number): Hand => ({
    ...hand,
    drafts: placeDie(state, who, hand.drafts, card, die, slot) ?? hand.drafts,
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
      return hand.held !== null
        ? put(e.card, e.slot, hand.held)
        : { ...hand, drafts: removeDie(hand.drafts, e.die), held: null }
    case 'takeBack':
      return { ...hand, drafts: removeDie(hand.drafts, e.die), held: null }
    case 'choose':
      if (!isWild(state, who, e.die) || !choosable(state, who, e.value)) return hand
      return { ...hand, chosen: { ...hand.chosen, [e.die]: e.value } }
    case 'consider': {
      const multi = hand.drafts.some((p) => multiOf(p.card) > 0)
      const same = hand.drafts.length === 1 && hand.drafts[0].card === e.card
      return { ...hand, drafts: multi || same ? hand.drafts : [], held: null }
    }
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

/** 置き場ごとの、好きな目のダイスに選んだ目。好きな目のダイスを置いていなければ undefined。まだ選んでいない置き場は null */
function setOf(
  state: GameState,
  who: PlayerIndex,
  slots: Slots,
  chosen: Hand['chosen'],
): (number | null)[] | undefined {
  if (!filled(slots).some((d) => isWild(state, who, d))) return undefined
  // Stryker disable next-line ConditionalExpression,LogicalOperator: 空けた置き場の null で引いた目は好きな目にならず、好きな目でないダイスの目は選べないので、どちらも null になる
  return slots.map((d) => (d !== null && isWild(state, who, d) ? (chosen?.[d] ?? null) : null))
}

/** 置いたダイスを、カードの行に置いたダイスとして読む。置いた順に並ぶ */
export function draftRows(state: GameState, who: PlayerIndex, hand: Hand): PlacedRow[] {
  return hand.drafts.flatMap((p) => {
    const kind = rowNow(state, who, p.card)
    if (!kind) return []
    const set = setOf(state, who, p.slots, hand.chosen)
    const row: PlacedRow = { card: p.card, kind, slots: p.slots }
    return [set ? { ...row, set } : row]
  })
}

/**
 * カードと置き場ごとのダイスから、カード1枚の合法な行動を組み立てる。行動にならなければ null。
 * 行動は置き場ごとのダイスをそのまま持ち、空けた置き場も空けたまま記録する。好きな目のダイスには選んだ目を添える。
 * 行動の回数を増やすカードは、一緒に使うカードを除いて、そのカード1枚で行動になるかを見る
 */
export function composeAction(
  state: GameState,
  who: PlayerIndex,
  card: CardId,
  slots: Slots,
  chosen?: Hand['chosen'],
): Play | null {
  const set = setOf(state, who, slots, chosen)
  for (const kind of kindsNow(state, who, card)) {
    const x: Play = set ? { kind, dice: [...slots], set } : { kind, dice: [...slots] }
    if (ACTION_DEFS[kind].multi ? playLegal(state, who, x) : isLegal(state, who, x)) return x
  }
  return null
}

/**
 * 置いたダイスから組み立てた行動。行動にならなければ null。
 * 行動の回数を増やすカードに置いていれば、そのカードの行動に、ほかのカードの行動を置いた順に添える
 */
export function draftAction(state: GameState, who: PlayerIndex, hand: Hand): Action | null {
  const plays = hand.drafts.map((p) => composeAction(state, who, p.card, p.slots, hand.chosen))
  if (plays.length === 0 || plays.some((x) => x === null)) return null
  const list = plays as Play[]
  const top = list.find((x) => ACTION_DEFS[x.kind].multi)
  const a: Action = top ? { ...top, with: list.filter((x) => x !== top) } : list[0]
  return isLegal(state, who, a) ? a : null
}

/**
 * 置ける個数 counts のどれかになるまでに、あと何個置けばよいか。置いた個数で足りているか、もう足しても届かなければ null。
 * 点線の置き場があって個数を選べる行動もあるので、置いた個数より多い中で一番少ない個数を目指す
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
  /** 好きな目のダイスの目を、まだ選んでいない */
  | { type: 'pick' }
  /** 同じ目を揃える行動で、目が揃っていない */
  | { type: 'same'; count: number }
  /** 行動の回数を増やすカードだけに置いて、一緒に使うカードに置いていない */
  | { type: 'with' }
  /** 決まった理由に当たらない。カードを足して新しい条件が増えても、何かは伝える */
  | { type: 'unusable' }

/**
 * カード1枚に置いたダイスが行動にならないとき、決定できない理由を返す。行動になるなら null。
 * 理由は定義表の性質から決めるので、カードを足しても追従する。
 * 印の置き場が空いていれば、そこに置くこと。個数が足りなければ、あと何個置くか。
 * 個数は足りていても空けられない置き場が空いていれば、左の枠に置くこと。
 * 好きな目のダイスの目をまだ選んでいなければ、選ぶこと。同じ目を揃える行動なら、目が揃っていないこと
 */
export function placementIssue(
  state: GameState,
  who: PlayerIndex,
  draft: Placement,
  chosen?: Hand['chosen'],
): Issue | null {
  if (composeAction(state, who, draft.card, draft.slots, chosen)) return null
  const kind = rowNow(state, who, draft.card)
  if (kind === undefined) return { type: 'unusable' }
  const def = ACTION_DEFS[kind]
  const picked = filled(draft.slots)
  // 印の置き場の目が効果の値になるので、ほかの置き場が足りていても、まず印の置き場を埋めてもらう。
  // 同じ目を揃える行動は、どの置き場にも同じ目が入るので、印の置き場を名指ししない
  const { mark } = def.face
  if (mark !== undefined && !def.sameValues && draft.slots[MARK_SLOT] === null) return { type: 'mark', mark }
  const missing = missingDice(def.dice, picked.length)
  if (missing !== null) return { type: 'more', count: missing, same: !!def.sameValues }
  if (!fillsRequired(def, draft.slots)) return { type: 'left' }
  if (filled(draft.slots).some((d) => isWild(state, who, d) && chosen?.[d] === undefined)) return { type: 'pick' }
  const vals = rowValues(state.players[who].roll, { slots: draft.slots, set: setOf(state, who, draft.slots, chosen) })
  if (def.sameValues && new Set(vals).size > 1) return { type: 'same', count: picked.length }
  return { type: 'unusable' }
}

/**
 * 置いたダイスが行動にならない理由。置いていないか、行動になるなら null。置いたカードの順に、最初の理由を返す。
 * どのカードもそれぞれ行動になるのに、まとめて行動にならないのは、行動の回数を増やすカードだけに置いたときに限る。
 * 一緒に置いたカードは、置くときにダイスもカードも重ならず、枚数も決まった数までにそろえているので
 */
export function draftIssue(state: GameState, who: PlayerIndex, hand: Hand): Issue | null {
  if (hand.drafts.length === 0) return null
  for (const p of hand.drafts) {
    const issue = placementIssue(state, who, p, hand.chosen)
    if (issue) return issue
  }
  return draftAction(state, who, hand) ? null : { type: 'with' }
}
