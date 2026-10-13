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
 * burn は使うと自分が受けるダメージ。炎の魔法で自分も焼ける効果に使う。endBurn は使ったターンの終わりに自分が受けるダメージ。
 * chant は詠唱、disrupt は相手の詠唱を崩す。この二つは数を持たない。
 * 詠唱が崩れる決まりはルールの画面で説明し、カードには書かない。
 * wound は失った体力で威力が増えること、frost は相手が次のステップに置けない目、refund は防ぎきったらダイスが戻ること、
 * reflect は受けた攻撃を返すこと、fast は相手より先に当たること、ignite はターンの終わりに焼けた分を与えること、
 * extra は振り足すダイスの数、carry は次のターンへ持ち越す目
 */
export type EffectIcon =
  | 'damage'
  | 'pierce'
  | 'guard'
  | 'thorns'
  | 'burn'
  | 'endBurn'
  | 'chant'
  | 'disrupt'
  | 'wound'
  | 'frost'
  | 'refund'
  | 'reflect'
  | 'fast'
  | 'ignite'
  | 'extra'
  | 'carry'

/** 数を持たない印。置いた目や個数から値を入れない */
export const BARE_ICONS: readonly EffectIcon[] = ['chant', 'disrupt', 'wound', 'refund', 'reflect', 'fast', 'ignite']

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
   * ほかの置き場に置いたダイスは、cost の記号を書いた置き場なら、その目の分だけ自分も焼けるダイスに、そうでなければ払うだけのダイスになる。
   * 効果の値に記号を含む式を書くと、ダイスを置いたときに式ごと値に置き換わる。X+2 や 2X など
   */
  mark?: string
  /**
   * 印の置き場の次の置き場に書く記号。この置き場に置いた目の分だけ、使うと自分も焼ける。
   * 効果の値にこの記号を書くと、ダイスを置いたときに自分が焼ける値に置き換わる
   */
  cost?: string
  /** 省いてもよい置き場の中に書く記号。置くと効果がこれだけ増えることを示す。増える量は power と揃える決まりで、テストが検査する */
  extra?: string
  /** 置き場の間に書く記号。= は同じ目を置く置き場で、印の記号を使う行動なら、どの置き場にもその記号を書く */
  join?: '+' | '='
  /** 置き場の前に「Y =」の形で書く記号。置いた目から計算した値が効果の値になる */
  sum?: string
  /** 置き場ごとに書く記号。同じ記号の置き場には同じ目を置く。二組のゾロ目を置く行動に使う */
  labels?: readonly string[]
  /** 効果。文はなるべく使わず、印で描く */
  effect: readonly EffectPart[]
}

/** 威力を決めるときに読む、使った側の様子 */
export interface PowerCtx {
  hp: number
  maxHp: number
}

/** 体力が減っていない様子。様子を渡さずに効果の値を求めるときに使う */
export const UNHURT: PowerCtx = { hp: 1, maxHp: 1 }

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
  /** 置く4個のダイスが、二組のゾロ目になる必要がある。4個とも同じ目でもよい */
  twoPairs?: boolean
  /** 詠唱。同じステップに相手が詠唱を崩す行動をすると崩れる。攻撃のダメージでは崩れない */
  chant?: boolean
  /** 詠唱が保たれているときだけ使える。カードの使用回数は詠唱で消費済み */
  needsCharge?: boolean
  /**
   * 攻撃の威力。障壁の前の値。
   * vals はダイスを置いた置き場の目を、置き場の順に並べたもの。空けた置き場は飛ばす。
   * face.mark のある行動では印の置き場が必ず埋まっているので、vals[0] が印の置き場の目になる。
   * ctx は使った側の、ステップを解決する前の体力
   */
  power?: (vals: number[], ctx: PowerCtx) => number
  /** 障壁を無視する。受けた攻撃を返す構えにも返されない */
  piercing?: boolean
  /** 相手の行動より先に当たる。それで相手が倒れたら、相手のそのステップの行動は起きない。互いに先に当たる攻撃なら同時 */
  fast?: boolean
  /** 受ける攻撃を減らす量。vals は power と同じ */
  guard?: (vals: number[]) => number
  /**
   * 守っているステップに、障壁で減る攻撃を受けたら、攻撃した相手に返すダメージ。
   * 防ぎきっても、超えられても同じだけ返す。障壁で減らない攻撃には返さない
   */
  thorns?: number
  /** 守りで防ぎきったら、置いたダイスが戻り、同じターンの次のステップで使える。障壁で減る攻撃を防ぎきったときだけ */
  refund?: boolean
  /** 同じステップに受けた攻撃を、攻撃した相手に返す。障壁で減らない攻撃は返さない */
  reflects?: boolean
  /** 同じステップに相手が詠唱していたら、その詠唱を崩す */
  disrupts?: boolean
  /** 相手の次のステップに、印の置き場の目と同じ目のダイスを置けなくする。二ステップ目に使えば、次のターンの一ステップ目 */
  freezes?: boolean
  /** 使うと炎で自分も焼けて受けるダメージ。障壁では減らない。vals は power と同じ */
  burn?: (vals: number[]) => number
  /** ターンの終わりに、このターンに自分が焼けて受けたダメージの合計を、相手に与える。障壁では減らない */
  ignite?: boolean
  /** 使うとダイスをこの数だけ振り足す。振り足したダイスは同じターンの次のステップで使える */
  extraDice?: number
  /** 使ったターンの終わりに、炎で自分も焼けて受けるダメージ */
  endBurn?: number
  /** 印の置き場に置いたダイスを、目ごと次のターンへ持ち越す。次のターンは振ったダイスにこの1個が加わる */
  carries?: boolean
  /** 攻撃以外の行動を公開したときの文。「あなたは 3 で」に続く */
  done?: string
  /** カード面の描き方 */
  face: Face
}

/**
 * カードの表。対局で選べるカードの全て。並びはカードを選ぶ画面に並べる順で、最初の5枚がスターター。
 * 属性は名前と印だけで伝え、ルールの文には書かない。炎は自分も焼け、氷は止め、風は吹き返し、魔は貫き、闇は吸い込み、雷は速い
 */
// Stryker disable next-line ObjectLiteral: 表を空にするとテストの読み込みが失敗し、見つけたと数えられない。並びと名前は cards.test.ts で確かめる
const CARDS = {
  flameStrike: { name: '炎撃' },
  barrier: { name: '風壁' },
  bullet: { name: '魔弾' },
  spear: { name: '魔槍' },
  interrupt: { name: '氷礫' },
  meteor: { name: '隕石' },
  allOut: { name: '全開' },
  lastStand: { name: '背水' },
  freeze: { name: '凍結' },
  darkWall: { name: '闇壁' },
  galeWard: { name: '風陣' },
  thunder: { name: '迅雷' },
  wildfire: { name: '延焼' },
  overload: { name: '過負荷' },
  twinDragon: { name: '双竜' },
  meditate: { name: '瞑想' },
} satisfies Record<string, CardDef>

/** カードの種類。表に足すと増える */
export type CardId = keyof typeof CARDS

export const CARD_DEFS: Record<CardId, CardDef> = CARDS

/** 選べるカードの全て。カードを選ぶ画面に並べる順 */
export const POOL = Object.keys(CARDS) as readonly CardId[]

/** 一人が対局に持ち込むカードの枚数 */
export const DECK_SIZE = 5

/** 初めから使える5枚。カードを選ばない対局では、二人ともこの5枚を、この順で並べる */
export const STARTER: readonly CardId[] = ['flameStrike', 'barrier', 'bullet', 'spear', 'interrupt']

/** 対局に持ち込める5枚か。表にある、互いに違うカードを5枚 */
export function isDeck(cards: readonly string[]): cards is CardId[] {
  return cards.length === DECK_SIZE && new Set(cards).size === DECK_SIZE && cards.every((c) => Object.hasOwn(CARDS, c))
}

/** 行動の表。1枚のカードが複数の行動を持つことがある。魔槍の詠唱と発動など */
const ACTIONS = {
  flameStrike: {
    card: 'flameStrike',
    label: '炎撃',
    dice: [2],
    // X の枠に置いた目に2を足した威力になる。もう一つの枠に置いた目の分だけ、自分も焼ける
    power: (v) => v[0] + 2,
    burn: (v) => v[1],
    face: {
      mark: 'X',
      cost: 'Y',
      effect: [
        { icon: 'damage', value: 'X+2' },
        { icon: 'burn', value: 'Y' },
      ],
    },
  },
  barrier: {
    card: 'barrier',
    label: '風壁',
    dice: [1],
    // 置いた目の倍を減らす。減らせる攻撃を受けたら、防ぎきっても超えられても、攻撃した相手に3を返す
    guard: (v) => 2 * v[0],
    thorns: 3,
    done: '風壁を張った',
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
    label: '魔槍の詠唱',
    dice: [1],
    step: 1,
    chant: true,
    done: '魔槍を詠唱',
    // 詠唱は置くだけでよく、目は効果に関わらないので、置き場に記号を書かない
    face: { effect: [{ icon: 'chant' }] },
  },
  spearCast: {
    card: 'spear',
    label: '魔槍の発動',
    dice: [2],
    step: 2,
    needsCharge: true,
    power: (v) => v[0] + v[1],
    piercing: true,
    face: { join: '+', sum: 'Y', effect: [{ icon: 'pierce', value: 'Y' }] },
  },
  interrupt: {
    card: 'interrupt',
    label: '氷礫',
    dice: [1],
    // 目に関係なく2の威力。同じステップに相手が詠唱していたら、その詠唱を崩す
    power: () => 2,
    disrupts: true,
    face: { effect: [{ icon: 'damage' }, { icon: 'disrupt' }] },
  },
  meteor: {
    card: 'meteor',
    label: '隕石',
    dice: [3],
    step: 1,
    // 一ステップ目に3個を全て置き、合計の威力で落とす。障壁で減る
    power: (v) => v[0] + v[1] + v[2],
    face: { join: '+', sum: 'Y', effect: [{ icon: 'damage', value: 'Y' }] },
  },
  allOut: {
    card: 'allOut',
    label: '全開',
    dice: [1, 2, 3, 4],
    // 目に関係なく、置いた個数の二乗の威力。1個で1、4個で16
    power: (v) => v.length * v.length,
    face: { effect: [{ icon: 'damage' }] },
  },
  lastStand: {
    card: 'lastStand',
    label: '背水',
    dice: [2],
    // X の枠の目に、失った体力4ごとに1を足した威力。もう1個は払うだけ
    power: (v, c) => v[0] + Math.floor((c.maxHp - c.hp) / 4),
    face: {
      mark: 'X',
      effect: [{ icon: 'damage', value: 'X+' }, { icon: 'wound' }],
    },
  },
  freeze: {
    card: 'freeze',
    label: '凍結',
    dice: [1],
    // 相手の次のステップに、X と同じ目のダイスを置けなくする。ダメージは無い
    freezes: true,
    done: '凍らせた',
    face: { mark: 'X', effect: [{ icon: 'frost', value: 'X' }] },
  },
  darkWall: {
    card: 'darkWall',
    label: '闇壁',
    dice: [1],
    // 置いた目の倍を減らし、返さない。障壁で減る攻撃を防ぎきったら、置いたダイスが戻る
    guard: (v) => 2 * v[0],
    refund: true,
    done: '闇壁を張った',
    face: {
      mark: 'X',
      effect: [{ icon: 'guard', value: '2X' }, { icon: 'refund' }],
    },
  },
  galeWard: {
    card: 'galeWard',
    label: '風陣',
    dice: [2],
    sameValues: true,
    // 同じ目を2個置く。受けた攻撃をそのまま返す。障壁で減らない攻撃は返さない
    reflects: true,
    done: '風陣を張った',
    face: { join: '=', effect: [{ icon: 'reflect' }] },
  },
  thunder: {
    card: 'thunder',
    label: '迅雷',
    dice: [2],
    // X の枠の目の威力で、相手より先に当たる。もう1個は払うだけ
    power: (v) => v[0],
    fast: true,
    face: { mark: 'X', effect: [{ icon: 'damage', value: 'X' }, { icon: 'fast' }] },
  },
  wildfire: {
    card: 'wildfire',
    label: '延焼',
    dice: [1],
    // ターンの終わりに、このターン自分が焼けた分を相手に与える。前のステップに焼けた分も数える
    ignite: true,
    done: '延焼を放った',
    face: { effect: [{ icon: 'ignite' }] },
  },
  overload: {
    card: 'overload',
    label: '過負荷',
    dice: [1],
    step: 1,
    // ダイスを2個振り足し、二ステップ目に使える。ターンの終わりに自分も2焼ける
    extraDice: 2,
    endBurn: 2,
    done: '過負荷をかけた',
    face: {
      effect: [
        { icon: 'extra', value: '2' },
        { icon: 'endBurn', value: '2' },
      ],
    },
  },
  twinDragon: {
    card: 'twinDragon',
    label: '双竜',
    dice: [4],
    twoPairs: true,
    // 二組のゾロ目を4個置く。目に関係なく20の威力。障壁で減る
    power: () => 20,
    face: { labels: ['A', 'A', 'B', 'B'], effect: [{ icon: 'damage', value: '20' }] },
  },
  meditate: {
    card: 'meditate',
    label: '瞑想',
    dice: [1],
    // 置いたダイスを目ごと次のターンへ持ち越す
    carries: true,
    done: '瞑想した',
    face: { mark: 'X', effect: [{ icon: 'carry', value: 'X' }] },
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
 * 効果の値。攻撃なら威力、守りなら減らす量、置けなくする目や持ち越す目なら印の置き場の目。どれでもない行動は値を持たないので 0。
 * vals は power と同じく、ダイスを置いた置き場の目を置き場の順に並べたもの。ctx は power に渡す、使った側の様子
 */
export function effectValue(def: ActionDef, vals: number[], ctx: PowerCtx = UNHURT): number {
  return def.power?.(vals, ctx) ?? def.guard?.(vals) ?? (def.freezes || def.carries ? vals[0] : 0)
}

/** 受けるダメージを減らす行動の名前。障壁で減らない攻撃の説明に使う */
// Stryker disable next-line OptionalChaining,StringLiteral: 減らす行動が表に無いときの備え。今の表では通らない
// Stryker disable next-line ArrowFunction: 表を読めなくするとこのファイルの読み込みが失敗し、見つけたと数えられない。名前は cards.test.ts で確かめる
export const GUARD_LABEL = ACTION_KINDS.map((k) => ACTION_DEFS[k]).find((d) => d.guard)?.label ?? ''
