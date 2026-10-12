// ゲーム全体で共有する型と設定

export type PlayerIndex = 0 | 1

/** カードの種類。追加したら cards.ts の CARD_DEFS にも定義が必要で、無ければ型エラーになる */
export type CardId = 'fireball' | 'barrier' | 'bullet' | 'spear' | 'reflect'

/** 行動の種類。1枚のカードが複数の行動を持つことがある。雷槍の詠唱と発動など */
export type ActionKind = 'fireball' | 'barrier' | 'bullet' | 'spearChant' | 'spearCast' | 'reflect'

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

export interface StepReport {
  turn: number
  step: 1 | 2
  actions: [Action, Action]
  values: [number[], number[]]
  damage: [number, number]
  lines: string[]
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
