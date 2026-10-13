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
 * thorns は守っているときに攻撃を受けると、攻撃した相手に返すダメージ、
 * blood は使うと自分が受けるダメージ。ダイスはマナで、体力は血。血を払う効果に使う。
 * chant は詠唱、disrupt は相手の詠唱を崩す。この二つは数を持たない。
 * 詠唱が崩れる決まりはルールの画面で説明し、カードには書かない
 */
export type EffectIcon = 'damage' | 'pierce' | 'guard' | 'thorns' | 'blood' | 'chant' | 'disrupt'

/** 数を持たない印。置いた目や個数から値を入れない */
export const BARE_ICONS: readonly EffectIcon[] = ['chant', 'disrupt']

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
   * ほかの置き場に置いたダイスは、cost の記号を書いた置き場なら血を払うダイスに、そうでなければ払うだけのダイスになる。
   * 効果の値に記号を含む式を書くと、ダイスを置いたときに式ごと値に置き換わる。X+2 や 2X など
   */
  mark?: string
  /**
   * 印の置き場の次の置き場に書く記号。この置き場に置いた目の分だけ、使うと自分が血を払う。
   * 効果の値にこの記号を書くと、ダイスを置いたときに払う血の値に置き換わる
   */
  cost?: string
  /** 省いてもよい置き場の中に書く記号。置くと効果がこれだけ増えることを示す。増える量は power と揃える決まりで、テストが検査する */
  extra?: string
  /** 置き場の間に書く記号。= は同じ目を置く置き場で、印の記号を使う行動なら、どの置き場にもその記号を書く */
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
  /** 置くダイスが全て同じ目である必要がある。ゾロ目 */
  sameValues?: boolean
  /** 詠唱。同じステップに相手が詠唱を崩す行動をすると崩れる。攻撃のダメージでは崩れない */
  chant?: boolean
  /** 詠唱が保たれているときだけ使える。カードの使用回数は詠唱で消費済み */
  needsCharge?: boolean
  /**
   * 攻撃の威力。障壁の前の値。
   * vals はダイスを置いた置き場の目を、置き場の順に並べたもの。空けた置き場は飛ばす。
   * face.mark のある行動では印の置き場が必ず埋まっているので、vals[0] が印の置き場の目になる
   */
  power?: (vals: number[]) => number
  /** 障壁を無視する */
  piercing?: boolean
  /** 受ける攻撃を減らす量。vals は power と同じ */
  guard?: (vals: number[]) => number
  /**
   * 守っているステップに、障壁で減る攻撃を受けたら、攻撃した相手に返すダメージ。
   * 防ぎきっても、超えられても同じだけ返す。障壁で減らない攻撃には返さない
   */
  thorns?: number
  /** 同じステップに相手が詠唱していたら、その詠唱を崩す */
  disrupts?: boolean
  /** 使うと自分が受けるダメージ。体力を血として払う。障壁では減らない。vals は power と同じ */
  blood?: (vals: number[]) => number
  /** 攻撃以外の行動を公開したときの文。「あなたは 3 で」に続く */
  done?: string
  /** カード面の描き方 */
  face: Face
}

/** カードの表。並びは画面に並べる順 */
// Stryker disable next-line ObjectLiteral: 表を空にするとテストの読み込みが失敗し、見つけたと数えられない。並びと名前は cards.test.ts で確かめる
const CARDS = {
  bloodBullet: { name: '血弾' },
  barrier: { name: '炎壁' },
  bullet: { name: '魔弾' },
  spear: { name: '雷槍' },
  interrupt: { name: '妨害' },
} satisfies Record<string, CardDef>

/** カードの種類。表に足すと増える */
export type CardId = keyof typeof CARDS

export const CARD_DEFS: Record<CardId, CardDef> = CARDS

/** 画面に並べる順 */
export const CARD_ORDER = Object.keys(CARDS) as readonly CardId[]

/** 行動の表。1枚のカードが複数の行動を持つことがある。雷槍の詠唱と発動など */
const ACTIONS = {
  bloodBullet: {
    card: 'bloodBullet',
    label: '血弾',
    dice: [2],
    // X の枠に置いた目に2を足した威力になる。もう一つの枠に置いた目の分だけ、自分が血を払う
    power: (v) => v[0] + 2,
    blood: (v) => v[1],
    face: {
      mark: 'X',
      cost: 'Y',
      effect: [
        { icon: 'damage', value: 'X+2' },
        { icon: 'blood', value: 'Y' },
      ],
    },
  },
  barrier: {
    card: 'barrier',
    label: '炎壁',
    dice: [1],
    // 置いた目の倍を減らす。減らせる攻撃を受けたら、防ぎきっても超えられても、攻撃した相手に3を返す
    guard: (v) => 2 * v[0],
    thorns: 3,
    done: '炎壁を張った',
    face: {
      mark: 'X',
      effect: [
        { icon: 'guard', value: '2X' },
        { icon: 'thorns', value: '3' },
      ],
    },
  },
  bullet: {
    card: 'bullet',
    label: '魔弾',
    dice: [2],
    sameValues: true,
    // 同じ目を2個置く。目に関係なく、障壁で減らない4の威力
    power: () => 4,
    piercing: true,
    // 目は威力に関わらないので、置き場に記号は書かず、= で同じ目を置くことだけを示す
    face: { join: '=', effect: [{ icon: 'pierce', value: '4' }] },
  },
  spearChant: {
    card: 'spear',
    label: '雷槍の詠唱',
    dice: [1],
    step: 1,
    chant: true,
    done: '雷槍を詠唱',
    // 詠唱は置くだけでよく、目は効果に関わらないので、置き場に記号を書かない
    face: { effect: [{ icon: 'chant' }] },
  },
  spearCast: {
    card: 'spear',
    label: '雷槍の発動',
    dice: [2],
    step: 2,
    needsCharge: true,
    power: (v) => v[0] + v[1],
    piercing: true,
    face: { join: '+', sum: 'Y', effect: [{ icon: 'pierce', value: 'Y' }] },
  },
  interrupt: {
    card: 'interrupt',
    label: '妨害',
    dice: [1],
    // 目に関係なく2の威力。同じステップに相手が詠唱していたら、その詠唱を崩す
    power: () => 2,
    disrupts: true,
    face: { effect: [{ icon: 'damage' }, { icon: 'disrupt' }] },
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
 * 効果の値。攻撃なら威力、守りなら減らす量。どちらでもない行動は値を持たないので 0。
 * vals は power と同じく、ダイスを置いた置き場の目を置き場の順に並べたもの
 */
export function effectValue(def: ActionDef, vals: number[]): number {
  return def.power?.(vals) ?? def.guard?.(vals) ?? 0
}

/** 受けるダメージを減らす行動の名前。障壁で減らない攻撃の説明に使う */
// Stryker disable next-line OptionalChaining,StringLiteral: 減らす行動が表に無いときの備え。今の表では通らない
// Stryker disable next-line ArrowFunction: 表を読めなくするとこのファイルの読み込みが失敗し、見つけたと数えられない。名前は cards.test.ts で確かめる
export const GUARD_LABEL = ACTION_KINDS.map((k) => ACTION_DEFS[k]).find((d) => d.guard)?.label ?? ''
