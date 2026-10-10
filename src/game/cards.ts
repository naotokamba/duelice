// カードの定義表。カードに関する知識はここに集める。
// ルール本体と画面はこの表を読むだけなので、カードを足すときは原則ここに書けば追従する。
// 既存の性質で表せない新しい仕組みが必要なときだけ、ActionDef に性質を足し、rules.ts でその性質を処理する。

import type { ActionKind, CardId } from './types'

export interface CardDef {
  name: string
  /** 画面とルール説明に出す効果の文 */
  text: string
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
}

/** 画面に並べる順 */
export const CARD_ORDER: readonly CardId[] = ['fireball', 'barrier', 'bullet', 'spear', 'reflect']

export const CARD_DEFS: Record<CardId, CardDef> = {
  fireball: { name: '火球', text: '2個置く。高い方の目のダメージ' },
  barrier: { name: '障壁', text: '1個置く。このステップに受ける攻撃を、置いた目だけ減らす。魔弾は防げない' },
  bullet: { name: '魔弾', text: '1個で2点、2個で3点。目は問わず、障壁をすり抜ける' },
  spear: {
    name: '雷槍',
    text: '一ステップ目に1個で詠唱。置いた目以上のダメージを受けると崩れる。二ステップ目に2個で発動し、合計のダメージ',
  },
  reflect: { name: '反射', text: '同じ目を2個置く。このステップに受ける攻撃を無効化し、相手に返す' },
}

export const ACTION_DEFS: Record<ActionKind, ActionDef> = {
  fireball: {
    card: 'fireball',
    label: '火球',
    dice: [2],
    power: (v) => Math.max(...v),
  },
  barrier: {
    card: 'barrier',
    label: '障壁',
    dice: [1],
    guard: (v) => v[0],
    done: '障壁を張った',
  },
  bullet: {
    card: 'bullet',
    label: '魔弾',
    dice: [1, 2],
    power: (v) => (v.length === 1 ? 2 : 3),
    piercing: true,
  },
  spearChant: {
    card: 'spear',
    label: '雷槍の詠唱',
    dice: [1],
    step: 1,
    chant: true,
    done: '雷槍を詠唱',
  },
  spearCast: {
    card: 'spear',
    label: '雷槍の発動',
    dice: [2],
    step: 2,
    needsCharge: true,
    power: (v) => v[0] + v[1],
  },
  reflect: {
    card: 'reflect',
    label: '反射',
    dice: [2],
    sameValues: true,
    reflects: true,
    done: '反射を構えた',
  },
}

export const ACTION_KINDS = Object.keys(ACTION_DEFS) as ActionKind[]

/** そのカードに属する行動の種類 */
export function kindsOfCard(card: CardId): ActionKind[] {
  return ACTION_KINDS.filter((k) => ACTION_DEFS[k].card === card)
}
