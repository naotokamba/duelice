// カードの定義表。カードに関する知識はここに集める。
// ルール本体と画面はこの表を読むだけなので、カードを足すときは原則ここに書けば追従する。
// 既存の性質で表せない新しい仕組みが必要なときだけ、ActionDef に性質を足し、rules.ts でその性質を処理する。

import type { ActionKind, CardId } from './types'

/** カードの効果は文で書かず、ActionDef の face から置き場と短い文で描く */
export interface CardDef {
  name: string
}

/**
 * カード面に描くダイス置き場と効果。行動1つが1行で、横に並ぶ置き場が1ステップぶん。
 * 置き場の数は dice の最大、dice の最小を超える置き場は省いてもよい置き場として描く
 */
export interface Face {
  /** 最初の置き場の中に書く記号。置いた目が効果の値になる */
  mark?: string
  /** 置き場の間に書く記号 */
  join?: '+' | '='
  /** 置き場の前に「Y =」の形で書く記号。置いた目から計算した値が効果の値になる */
  sum?: string
  /** 効果の短い文。mark か sum の記号は、ダイスを置くと値に置き換わる */
  effect: string
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
  /** 攻撃の威力。障壁や反射の前の値 */
  power?: (vals: number[]) => number
  /** 障壁を無視する */
  piercing?: boolean
  /** 受ける攻撃を減らす量 */
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
    power: (v) => Math.max(...v),
    face: { mark: 'X', effect: 'Xダメージ' },
  },
  barrier: {
    card: 'barrier',
    label: '障壁',
    dice: [1],
    guard: (v) => v[0],
    done: '障壁を張った',
    face: { mark: 'X', effect: '受けるダメージをX減らす' },
  },
  bullet: {
    card: 'bullet',
    label: '魔弾',
    dice: [1, 2],
    power: (v) => (v.length === 1 ? 2 : 3),
    piercing: true,
    face: { effect: '1個で2、2個で3ダメージ。障壁を無視' },
  },
  spearChant: {
    card: 'spear',
    label: '雷槍の詠唱',
    dice: [1],
    step: 1,
    chant: true,
    done: '雷槍を詠唱',
    face: { mark: 'X', effect: '詠唱。X以上受けると崩れる' },
  },
  spearCast: {
    card: 'spear',
    label: '雷槍の発動',
    dice: [2],
    step: 2,
    needsCharge: true,
    power: (v) => v[0] + v[1],
    face: { join: '+', sum: 'Y', effect: 'Yダメージ' },
  },
  reflect: {
    card: 'reflect',
    label: '反射',
    dice: [2],
    sameValues: true,
    reflects: true,
    done: '反射を構えた',
    face: { join: '=', effect: '受ける攻撃をはね返す' },
  },
}

export const ACTION_KINDS = Object.keys(ACTION_DEFS) as ActionKind[]

/** そのカードに属する行動の種類 */
export function kindsOfCard(card: CardId): ActionKind[] {
  return ACTION_KINDS.filter((k) => ACTION_DEFS[k].card === card)
}
