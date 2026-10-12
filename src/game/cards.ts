// カードの定義表。カードに関する知識はここに集める。
// ルール本体と画面はこの表を読むだけなので、カードを足すときは原則ここに書けば追従する。
// 既存の性質で表せない新しい仕組みが必要なときだけ、ActionDef に性質を足し、rules.ts でその性質を処理する。

import type { ActionKind, CardId } from './types'

/** カードの効果は文で書かず、ActionDef の face から置き場と短い文で描く */
export interface CardDef {
  name: string
}

/**
 * 効果を描く印。数を添える印は、印の中に数を描く。
 * damage はダメージ、pierce は障壁で減らない貫通ダメージ、guard は受けるダメージを減らす、
 * reflect は受けた攻撃を返す、chant は詠唱で、数はそのステップに受けても崩れないダメージの境目。
 * 詠唱が崩れる決まりはルールの画面で説明し、カードには書かない
 */
export type EffectIcon = 'damage' | 'pierce' | 'guard' | 'reflect' | 'chant'

/**
 * カード面の効果の部品。印に値を添えるか、短い文を並べる。値と文の中の mark や sum の記号は、ダイスを置くと値に置き換わる。
 * mark も sum も無い行動では、値を書かない印に、置いた個数から決まる値を compose.ts の effectParts が入れる
 */
export interface EffectPart {
  icon?: EffectIcon
  value?: string
  text?: string
  /** 省いてよい置き場まで全て埋めたときの値。value と違うときだけ effectParts が入れ、印の説明に添える */
  full?: string
}

/**
 * カード面に描くダイス置き場と効果。行動1つが1行で、横に並ぶ置き場が1ステップぶん。
 * 置き場の数は dice の最大。行の前から dice の最小の数の置き場は空けられず、残りは省いてもよい置き場として点線で描く。
 * 省いてもよい置き場は、置くと効果が増える置き場で、そこだけに置いても行動にならない
 */
export interface Face {
  /**
   * 最初の置き場の中に書く記号。この置き場に置いた目が効果の値になり、この置き場は空けられない。
   * ほかの置き場に置いたダイスは、払うだけのダイスになる
   */
  mark?: string
  /** 省いてもよい置き場の中に書く記号。置くと効果がこれだけ増えることを示す。増える量は power と揃える決まりで、テストが検査する */
  extra?: string
  /** 置き場の間に書く記号 */
  join?: '+' | '='
  /** 置き場の前に「Y =」の形で書く記号。置いた目から計算した値が効果の値になる */
  sum?: string
  /** 効果。文はなるべく使わず、印で描く */
  effect: readonly EffectPart[]
}

export interface ActionDef {
  card: CardId
  /** 公開時などに出す行動名 */
  label: string
  /** 置けるダイスの個数 */
  dice: readonly number[]
  /** 使えるステップを限定する */
  step?: 1 | 2
  /** 置くダイスが全て同じ目である必要がある */
  sameValues?: boolean
  /** 詠唱。置いた目以上のダメージをそのステップに受けると崩れる */
  chant?: boolean
  /** 詠唱が保たれているときだけ使える。カードの使用回数は詠唱で消費済み */
  needsCharge?: boolean
  /**
   * 攻撃の威力。障壁や反射の前の値。
   * vals はダイスを置いた置き場の目を、置き場の順に並べたもの。空けた置き場は飛ばす。
   * face.mark のある行動では印の置き場が必ず埋まっているので、vals[0] が印の置き場の目になる
   */
  power?: (vals: number[]) => number
  /** 障壁を無視する */
  piercing?: boolean
  /** 受ける攻撃を減らす量。vals は power と同じ */
  guard?: (vals: number[]) => number
  /** 受ける攻撃を無効化して相手に返す */
  reflects?: boolean
  /** 攻撃以外の行動を公開したときの文。「あなたは 3 で」に続く */
  done?: string
  /** カード面の描き方 */
  face: Face
}

/** 画面に並べる順 */
export const CARD_ORDER: readonly CardId[] = ['fireball', 'barrier', 'bullet', 'spear', 'reflect']

export const CARD_DEFS: Record<CardId, CardDef> = {
  fireball: { name: '火球' },
  barrier: { name: '障壁' },
  bullet: { name: '魔弾' },
  spear: { name: '雷槍' },
  reflect: { name: '反射' },
}

export const ACTION_DEFS: Record<ActionKind, ActionDef> = {
  fireball: {
    card: 'fireball',
    label: '火球',
    dice: [2],
    // X の枠に置いた目が威力になる。もう一つの枠は払うだけのダイス
    power: (v) => v[0],
    face: { mark: 'X', effect: [{ icon: 'damage', value: 'X' }] },
  },
  barrier: {
    card: 'barrier',
    label: '障壁',
    dice: [1],
    guard: (v) => v[0],
    done: '障壁を張った',
    face: { mark: 'X', effect: [{ icon: 'guard', value: 'X' }] },
  },
  bullet: {
    card: 'bullet',
    label: '魔弾',
    dice: [1, 2],
    // 左の枠に置けば2、点線の枠にも置くと1増えて3
    power: (v) => (v.length === 1 ? 2 : 3),
    piercing: true,
    face: { extra: '+1', effect: [{ icon: 'pierce' }] },
  },
  spearChant: {
    card: 'spear',
    label: '雷槍の詠唱',
    dice: [1],
    step: 1,
    chant: true,
    done: '雷槍を詠唱',
    face: { mark: 'X', effect: [{ icon: 'chant', value: 'X' }] },
  },
  spearCast: {
    card: 'spear',
    label: '雷槍の発動',
    dice: [2],
    step: 2,
    needsCharge: true,
    power: (v) => v[0] + v[1],
    face: { join: '+', sum: 'Y', effect: [{ icon: 'damage', value: 'Y' }] },
  },
  reflect: {
    card: 'reflect',
    label: '反射',
    dice: [2],
    sameValues: true,
    reflects: true,
    done: '反射を構えた',
    face: { join: '=', effect: [{ icon: 'reflect' }] },
  },
}

export const ACTION_KINDS = Object.keys(ACTION_DEFS) as ActionKind[]

/** そのカードに属する行動の種類 */
export function kindsOfCard(card: CardId): ActionKind[] {
  return ACTION_KINDS.filter((k) => ACTION_DEFS[k].card === card)
}

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
