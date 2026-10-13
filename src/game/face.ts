// カード面に描く効果の値。置いたダイスの目から、印に書く数を決める。
// 目が決まるまでは X や Y の記号のまま描き、記号を使わない行動は置いた個数で決まる値を描く。

import { ACTION_DEFS, type ActionDef, type ActionKind, type EffectPart, effectValue } from './cards'
import { requiredSlots, slotsOf } from './slots'

/**
 * n 個の置き場を埋めたときの目の代わり。記号を使わない行動は、目ではなく個数で値が決まるので、どの目でもよい。
 * 目で値が変わる行動はカード面に記号が要るので、記号の無い行動ではこの決まりが成り立つ。invariants.test.ts で検査する
 */
const anyVals = (n: number) => Array<number>(n).fill(1)

/**
 * カード面の効果。目が分かっていれば、記号をその目から決まる値に置き換える。
 * 記号を含む値の欄は、記号ごと効果の値になる。X+2 なら、X が 3 なら 5 になる。記号を含まない値の欄はそのまま描く。
 * vals はダイスを置いた置き場の目を置き場の順に並べたもので、空けた置き場は飛ばす。
 * 記号を使わない行動は、値を書かない印に、置いた個数で決まる値を入れる。置く前は空けられない置き場だけを埋めた値にし、
 * 省いてもよい置き場まで埋めると値が増えるなら、その値も添える。血の印には払う血の値を、ほかの印には効果の値を入れる
 */
export function effectParts(kind: ActionKind, vals?: number[]): EffectPart[] {
  return faceParts(ACTION_DEFS[kind], vals)
}

/** 印の値。血の印なら払う血、ほかの印なら効果の値 */
function partValue(def: ActionDef, part: EffectPart, vals: number[]): string {
  return String(part.icon === 'blood' && def.blood ? def.blood(vals) : effectValue(def, vals))
}

/** effectParts を定義そのものから作る。定義表に無い仮のカードでも確かめられるように分けてある */
export function faceParts(def: ActionDef, vals?: number[]): EffectPart[] {
  const sym = def.face.mark ?? def.face.sum
  if (sym) {
    if (!vals) return [...def.face.effect]
    const value = String(effectValue(def, vals))
    return def.face.effect.map((p) => ({
      ...p,
      value: p.value?.includes(sym) ? value : p.value,
      text: p.text?.replaceAll(sym, value),
    }))
  }
  if (!def.power && !def.guard) return [...def.face.effect]
  const now = vals ?? anyVals(requiredSlots(def))
  const all = anyVals(slotsOf(def))
  return def.face.effect.map((p) => {
    if (!p.icon || p.value !== undefined) return p
    const value = partValue(def, p, now)
    const full = partValue(def, p, all)
    return { ...p, value, ...(full !== value && { full }) }
  })
}
