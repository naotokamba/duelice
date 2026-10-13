// カード面に描く効果の値。置いたダイスの目から、印に書く数を決める。
// 目が決まるまでは X や Y の記号のまま描き、記号を使わない行動は置いた個数で決まる値を描く。

import {
  ACTION_DEFS,
  type ActionDef,
  type ActionKind,
  BARE_ICONS,
  type EffectPart,
  effectValue,
  type PowerCtx,
  UNHURT,
} from './cards'
import { requiredSlots, slotsOf } from './slots'

/**
 * n 個の置き場を埋めたときの目の代わり。記号を使わない行動は、目ではなく個数で値が決まるので、どの目でもよい。
 * 目で値が変わる行動はカード面に記号が要るので、記号の無い行動ではこの決まりが成り立つ。invariants.test.ts で検査する
 */
const anyVals = (n: number) => Array<number>(n).fill(1)

/**
 * カード面の効果。目が分かっていれば、記号をその目から決まる値に置き換える。
 * 記号を含む値の欄は、記号ごと効果の値になる。X+2 なら、X が 3 なら 5 になる。記号を含まない値の欄はそのまま描く。
 * 焼ける置き場の記号を含む値の欄は、自分が焼ける値になる。
 * vals はダイスを置いた置き場の目を置き場の順に並べたもので、空けた置き場は飛ばす。
 * 記号を使わない行動は、値を書かない印に、置いた個数で決まる値を入れる。置く前は空けられない置き場だけを埋めた値にし、
 * 省いてもよい置き場まで埋めると値が増えるなら、その値も添える。焼ける印には自分が焼ける値を、ほかの印には効果の値を入れる
 */
export function effectParts(kind: ActionKind, vals?: number[], ctx: PowerCtx = UNHURT): EffectPart[] {
  return faceParts(ACTION_DEFS[kind], vals, ctx)
}

/**
 * 印の値。焼ける印なら自分が焼ける量、返す攻撃や打ち消す攻撃が来なかったときの印なら自分が受ける量、
 * 凍らせる目や持ち越す目の印なら印の置き場の目、ほかの印なら効果の値。足す目は効果の値が印の置き場の目になる
 */
function partValue(def: ActionDef, part: EffectPart, vals: number[], ctx: PowerCtx): string {
  if (part.icon === 'burn' && def.burn) return String(def.burn(vals))
  if ((part.icon === 'miss' || part.icon === 'whiff') && def.missBurn) return String(def.missBurn(vals))
  if (part.icon === 'frost' || part.icon === 'carry') return String(vals[0])
  return String(effectValue(def, vals, ctx))
}

/**
 * effectParts を定義そのものから作る。定義表に無い仮のカードでも確かめられるように分けてある。
 * ctx は使う側の様子で、失った体力で威力の変わる行動に効く
 */
export function faceParts(def: ActionDef, vals?: number[], ctx: PowerCtx = UNHURT): EffectPart[] {
  const sym = def.face.mark ?? def.face.sum
  if (sym) {
    if (!vals) return [...def.face.effect]
    const value = String(effectValue(def, vals, ctx))
    const { cost } = def.face
    // 記号を含む値は、印ごとに決まる値に置き換える。炎撃の X+2 は威力に、Y は焼ける量になる
    const written = (v: string) => v.includes(sym) || (!!cost && v.includes(cost))
    return def.face.effect.map((p) => ({
      ...p,
      value: p.value && written(p.value) ? partValue(def, p, vals, ctx) : p.value,
      text: p.text?.replaceAll(sym, value),
    }))
  }
  if (!def.power && !def.guard) return [...def.face.effect]
  const now = vals ?? anyVals(requiredSlots(def))
  const all = anyVals(slotsOf(def))
  return def.face.effect.map((p) => {
    // 2+ のように + で終わる値は増える基の値で、置いた後は効果の値にする
    if (vals && p.value?.endsWith('+')) return { ...p, value: partValue(def, p, vals, ctx) }
    if (!p.icon || p.value !== undefined || BARE_ICONS.includes(p.icon)) return p
    const value = partValue(def, p, now, ctx)
    const full = partValue(def, p, all, ctx)
    return { ...p, value, ...(full !== value && { full }) }
  })
}
