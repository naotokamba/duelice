// ゲーム全体で共有する型と設定。カードと行動の種類は cards.ts の表から決まる

import type { ActionKind, CardId } from './cards'

export type { ActionKind, CardId }

export type PlayerIndex = 0 | 1

/**
 * カード1枚の行動。
 * dice はカードの行の置き場ごとに、置いたダイスの番号を書く。空けた置き場は null。
 * 長さはその行の置き場の数。ダイスの番号はそのターンに振ったダイスの位置で、値は roll から引く。
 * 盤の上と同じく、どの置き場に何を置いたかだけを記録し、置いた順は持たない
 */
export interface Play {
  kind: ActionKind
  dice: (number | null)[]
  /** 好きな目のダイスを置いた置き場ごとの、選んだ目。ほかの置き場は null。好きな目のダイスを置かなければ持たない */
  set?: (number | null)[]
  /** 同じステップに一緒に使うカードの行動。行動の回数を増やすカードの行動だけが持ち、置いた順に並べる */
  with?: Play[]
}

/** 一つのステップに出す行動。何もしないか、カードの行動 */
export type Action = { kind: 'pass' } | Play

/** 好きな目のダイス。roll にこの値で入り、置くときに目を選ぶ */
export const WILD = 0

/**
 * 行動が起こす効果。行動の種類と、置き場の順に並べた目。
 * もう一度出す行動は、直前のステップの効果をダイスを置かずに出すので、echoed を付ける
 */
export interface Move {
  kind: ActionKind
  vals: number[]
  echoed?: true
}

export type ChantState = 'none' | 'charged' | 'broken'

export interface PlayerState {
  hp: number
  /** このターンのダイスの目。効果で足したり持ち越したりすると、3個より多くなる。好きな目のダイスは WILD */
  roll: number[]
  usedDice: number[]
  usedCards: CardId[]
  chant: ChantState
  /** 対局に持ち込んだ5枚。画面にこの順で並べる。相手にも見える */
  deck: CardId[]
  /** 次のステップに置けない目。相手に凍らされていなければ null */
  frozen: number | null
  /** このターンに炎で自分が焼けて受けたダメージの合計 */
  burned: number
  /** 次のターンへ持ち越すダイスの目。持ち越さなければ null */
  carry: number | null
  /**
   * 直前のステップに起こした効果。もう一度出す行動は、これを繰り返す。ターンをまたいで残る。
   * 行動の回数を増やすカードの効果は含まず、もう一度出した効果は、出した効果として含む
   */
  last: Move[]
  /** このターンに起きた効果の種類。もう一度出した効果も数える。ターンの終わりに起きることは、ここから決まる */
  acted: ActionKind[]
}

export interface Config {
  maxHp: number
  diceCount: number
}

export const DEFAULT_CONFIG: Config = {
  maxHp: 20,
  diceCount: 3,
}

/**
 * 攻撃が相手の構えに当たってどうなったか。当たった、守りに削られた、守りをすり抜けた、構えに返されて自分に当たった、構えに打ち消された。
 * returned は、守りや打ち消す構えが攻撃を受けて、攻撃した側へ返したダメージ
 */
export type Outcome = 'hit' | 'guarded' | 'pierced' | 'reflected' | 'countered' | 'returned'

/**
 * 攻撃が当たった時。fast は相手の行動より先、main はステップの行動と同時、end はターンの終わり。
 * 記録はこの順に並ぶ
 */
export type Phase = 'fast' | 'main' | 'end'

/** 一つの攻撃の行方。画面はこれを矢印に描き、ダメージもこれから数える */
export interface Strike {
  from: PlayerIndex
  /** 放った行動。守りが返したダメージなら、その守りの行動 */
  kind: ActionKind
  power: number
  outcome: Outcome
  /** ダメージを受けた側。構えに返された攻撃は、放った側 */
  to: PlayerIndex
  /** to が受けたダメージ。守りに削られたら、削られた後の値。打ち消されたら0 */
  dealt: number
  phase: Phase
}

/** 詠唱したステップの結果。詠唱しなかった側は null */
export type ChantResult = 'kept' | 'broken' | null

/**
 * 一つのステップの記録。双方の行動と、そこから決まった結果だけを持ち、どちらの視点の文も持たない。
 * 文は画面が、見ている側から書く
 */
export interface StepReport {
  turn: number
  step: 1 | 2
  actions: [Action, Action]
  /** 双方がダイスを置いた置き場の目を、置き場の順に並べたもの。空けた置き場は飛ばす。一緒に使った行動の目も続けて並べる */
  values: [number[], number[]]
  /** 双方が起こそうとした効果。もう一度出した効果も含む。倒れて起きなかった効果も含む */
  moves: [Move[], Move[]]
  /** 放たれた攻撃と、その行方。守りが返したダメージも含む */
  strikes: Strike[]
  /** 双方が炎で自分も焼けて受けたダメージ。自分も焼ける行動をしなかった側は0 */
  burn: [number, number]
  /** 双方がターンの終わりに炎で自分も焼けて受けたダメージ。一ステップ目は0 */
  endBurn: [number, number]
  /** 双方が受けたダメージ。攻撃で受けた分と、自分が焼けた分の合計 */
  damage: [number, number]
  chants: [ChantResult, ChantResult]
  /** 相手の先に当たる攻撃で倒れて、行動が起きなかった側 */
  cancelled: [boolean, boolean]
  /** 守りで防ぎきって、置いたダイスが戻った側 */
  refunded: [boolean, boolean]
  /** 双方が、このステップの効果で手元に足したダイスの目。次のステップに使える */
  added: [number[], number[]]
}

export interface GameState {
  config: Config
  turn: number
  step: 1 | 2
  players: [PlayerState, PlayerState]
  history: StepReport[]
  winner: PlayerIndex | 'draw' | null
}

export type Rng = () => number
