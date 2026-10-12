// 置き場。カードの1行には置き場が横に並び、1行が1ステップぶんの行動になる。
// 行動は置き場ごとに、置いたダイスか空きかを記録する。盤の上と同じく、どこに何を置いたかだけを持ち、置いた順は持たない。
// 行の前から dice の最小の数の置き場は空けられず、残りは省いてもよい置き場になる。
// face.mark を書く行動は、行の最初の置き場に置いた目が効果の値になる。

import { ACTION_DEFS, type ActionDef, type ActionKind, type CardId } from './cards'
import type { Action } from './types'

/** 置き場ごとのダイスの番号。空いた置き場は null */
export type Slots = (number | null)[]

/** 行に並べる置き場の数 */
export function slotsOf(def: ActionDef): number {
  return Math.max(...def.dice)
}

/** 空けられない置き場の数。行の前からこの数の置き場は必ず埋める。残りは省いてもよい置き場 */
export function requiredSlots(def: ActionDef): number {
  return Math.min(...def.dice)
}

/** face.mark を書く置き場。行の最初の置き場で、空けられない置き場に含まれる */
export const MARK_SLOT = 0

/** 印の置き場に置いた目を効果の値にする行動か */
export function readsMark(def: ActionDef): boolean {
  return def.face.mark !== undefined
}

/** 置いたダイスを置き場の順に並べる。空いた置き場は飛ばす */
export function filled(slots: readonly (number | null)[]): number[] {
  return slots.filter((d): d is number => d !== null)
}

/**
 * 空けられない置き場が全て埋まっているか。省いてもよい置き場は、置くと効果が増えるだけで、そこだけに置いても行動にならない。
 * 印の置き場は行の最初の置き場なので、空けられない置き場に含まれる
 */
export function fillsRequired(def: ActionDef, slots: readonly (number | null)[]): boolean {
  return slots.slice(0, requiredSlots(def)).every((d) => d !== null)
}

/** カードの1行に置いたダイス。kind はその行の行動 */
export interface PlacedRow {
  card: CardId
  kind: ActionKind
  slots: Slots
}

/** 行動を、カードの行に置いたダイスとして読む。パスは null */
export function rowOf(a: Action): PlacedRow | null {
  if (a.kind === 'pass') return null
  return { card: ACTION_DEFS[a.kind].card, kind: a.kind, slots: [...a.dice] }
}
