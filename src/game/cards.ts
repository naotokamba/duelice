// カードの定義表。カードに関する知識はここに集める。
// カードと行動の種類の名前もこの表から決まり、ほかのファイルはカードを名前で呼ばずに表の性質だけを読む。
// カードを足すときは原則ここに書けば、ルールも画面も追従する。
// 既存の性質で表せない新しい仕組みが必要なときだけ ActionDef に性質を足し、その性質で分岐する。

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
export type EffectIcon = 'damage' | 'pierce' | 'guard' | 'bounce' | 'chant'

/**
 * カード面の効果の部品。印に値を添えるか、短い文を並べる。値と文の中の mark や sum の記号は、ダイスを置くと値に置き換わる。
 * mark も sum も無い行動では、値を書かない印に、置いた個数から決まる値を face.ts の effectParts が入れる
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

/** カードの表。並びは画面に並べる順 */
// Stryker disable next-line ObjectLiteral: 表を空にするとテストの読み込みが失敗し、見つけたと数えられない。並びと名前は cards.test.ts で確かめる
const CARDS = {
  fireball: { name: '火球' },
  barrier: { name: '障壁' },
  bullet: { name: '魔弾' },
  spear: { name: '雷槍' },
  reflect: { name: '反射' },
} satisfies Record<string, CardDef>

/** カードの種類。表に足すと増える */
export type CardId = keyof typeof CARDS

export const CARD_DEFS: Record<CardId, CardDef> = CARDS

/** 画面に並べる順 */
export const CARD_ORDER = Object.keys(CARDS) as readonly CardId[]

/** 行動の表。1枚のカードが複数の行動を持つことがある。雷槍の詠唱と発動など */
const ACTIONS = {
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
    face: { join: '=', effect: [{ icon: 'bounce' }] },
  },
} satisfies Record<string, ActionDef>

/** 行動の種類。表に足すと増える */
export type ActionKind = keyof typeof ACTIONS

export const ACTION_DEFS: Record<ActionKind, ActionDef> = ACTIONS

export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[]

/** そのカードに属する行動の種類 */
export function kindsOfCard(card: CardId): ActionKind[] {
  return ACTION_KINDS.filter((k) => ACTION_DEFS[k].card === card)
}

/**
 * 効果の値。攻撃なら威力、障壁なら減らす量、詠唱なら崩れる境目になる印の置き場の目。
 * vals は power と同じく、ダイスを置いた置き場の目を置き場の順に並べたもの
 */
export function effectValue(def: ActionDef, vals: number[]): number {
  return def.power?.(vals) ?? def.guard?.(vals) ?? vals[0]
}

/** 受けるダメージを減らす行動の名前。障壁で減らない攻撃の説明に使う */
// Stryker disable next-line OptionalChaining,StringLiteral: 減らす行動が表に無いときの備え。今の表では通らない
// Stryker disable next-line ArrowFunction: 表を読めなくするとこのファイルの読み込みが失敗し、見つけたと数えられない。名前は cards.test.ts で確かめる
export const GUARD_LABEL = ACTION_KINDS.map((k) => ACTION_DEFS[k]).find((d) => d.guard)?.label ?? ''
