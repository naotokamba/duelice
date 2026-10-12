// ゲーム全体で共有する型と設定。カードと行動の種類は cards.ts の表から決まる

import type { ActionKind, CardId } from './cards'

export type { ActionKind, CardId }

export type PlayerIndex = 0 | 1

/**
 * dice はカードの行の置き場ごとに、置いたダイスの番号を書く。空けた置き場は null。
 * 長さはその行の置き場の数。ダイスの番号はそのターンに振ったダイスの位置で、値は roll から引く。
 * 盤の上と同じく、どの置き場に何を置いたかだけを記録し、置いた順は持たない
 */
export type Action = { kind: 'pass' } | { kind: ActionKind; dice: (number | null)[] }

export type ChantState = 'none' | 'charged' | 'broken'

export interface PlayerState {
  hp: number
  roll: number[]
  usedDice: number[]
  usedCards: CardId[]
  chant: ChantState
}

export interface Config {
  maxHp: number
  diceCount: number
}

export const DEFAULT_CONFIG: Config = {
  maxHp: 20,
  diceCount: 3,
}

/** 攻撃が相手の構えに当たってどうなったか。当たった、障壁に削られた、障壁をすり抜けた、反射で返された */
export type Outcome = 'hit' | 'guarded' | 'pierced' | 'reflected'

/** 一つの攻撃の行方。画面はこれを矢印に描き、ダメージもこれから数える */
export interface Strike {
  from: PlayerIndex
  kind: ActionKind
  power: number
  outcome: Outcome
  /** ダメージを受けた側。反射されたら攻撃した側に返る */
  to: PlayerIndex
  dealt: number
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
  /** 双方がダイスを置いた置き場の目を、置き場の順に並べたもの。空けた置き場は飛ばす */
  values: [number[], number[]]
  /** 放たれた攻撃と、その行方 */
  strikes: Strike[]
  /** 双方が受けたダメージ */
  damage: [number, number]
  chants: [ChantResult, ChantResult]
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
