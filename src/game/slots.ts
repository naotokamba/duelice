// 置き場。カードの1行には置き場が横に並び、1行が1ステップぶんの行動になる。
// 行動は置き場ごとに、置いたダイスか空きかを記録する。盤の上と同じく、どこに何を置いたかだけを持ち、置いた順は持たない。
// 行の前から dice の最小の数の置き場は空けられず、残りは省いてもよい置き場になる。
// face.mark を書く行動は、行の最初の置き場に置いた目が効果の値になる。

import { ACTION_DEFS, type ActionDef, type ActionKind, type CardId } from './cards'
import type { Action, Play } from './types'
import { WILD } from './types'

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

/** カードの1行に置いたダイス。kind はその行の行動。set は好きな目のダイスに選んだ目で、置き場ごとに並ぶ */
export interface PlacedRow {
  card: CardId
  kind: ActionKind
  slots: Slots
  set?: (number | null)[]
}

/** カードの行動一つを、カードの行に置いたダイスとして読む */
export function playRow(x: Play): PlacedRow {
  const row: PlacedRow = { card: ACTION_DEFS[x.kind].card, kind: x.kind, slots: [...x.dice] }
  return x.set ? { ...row, set: [...x.set] } : row
}

/** 行動を、カードの行に置いたダイスとして読む。パスは null。一緒に使う行動は rowsOf で読む */
export function rowOf(a: Action): PlacedRow | null {
  return a.kind === 'pass' ? null : playRow(a)
}

/** 行動を、使ったカードごとの行に置いたダイスとして読む。一緒に使う行動も、置いた順に並べる。パスは空 */
export function rowsOf(a: Action): PlacedRow[] {
  return a.kind === 'pass' ? [] : [a, ...(a.with ?? [])].map(playRow)
}

/** 置き場ごとの目。空けた置き場は飛ばし、好きな目のダイスは選んだ目にする。まだ選んでいなければ WILD のまま */
export function rowValues(roll: readonly number[], row: Pick<PlacedRow, 'slots' | 'set'>): number[] {
  const out: number[] = []
  row.slots.forEach((d, k) => {
    if (d === null) return
    out.push(roll[d] === WILD ? (row.set?.[k] ?? WILD) : roll[d])
  })
  return out
}
