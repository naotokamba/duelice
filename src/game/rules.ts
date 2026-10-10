// Duelice のルール本体。
// 状態と双方の行動を受け取って次の状態を返す純粋関数だけで書く。
// 乱数は外から渡すので、同じ入力なら必ず同じ結果になる。
// オンライン対戦では、この関数をそのままサーバ側で動かす想定。

export type PlayerIndex = 0 | 1

export type CardId = 'fireball' | 'barrier' | 'bullet' | 'spear' | 'reflect'

export type Action =
  | { kind: 'pass' }
  | { kind: 'fireball'; dice: [number, number] }
  | { kind: 'barrier'; dice: [number] }
  | { kind: 'bullet'; dice: [number] | [number, number] }
  | { kind: 'spearChant'; dice: [number] }
  | { kind: 'spearCast'; dice: [number, number] }
  | { kind: 'reflect'; dice: [number, number] }

// dice はそのターンに振ったダイスの位置。値は roll から引く

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
  bulletOne: number
  bulletTwo: number
}

export const DEFAULT_CONFIG: Config = {
  maxHp: 20,
  diceCount: 3,
  bulletOne: 2,
  bulletTwo: 3,
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

export const CARD_NAMES: Record<CardId, string> = {
  fireball: '火球',
  barrier: '障壁',
  bullet: '魔弾',
  spear: '雷槍',
  reflect: '反射',
}

export function actionCard(a: Action): CardId | null {
  switch (a.kind) {
    case 'pass':
      return null
    case 'spearChant':
    case 'spearCast':
      return 'spear'
    default:
      return a.kind
  }
}

export function actionLabel(a: Action): string {
  switch (a.kind) {
    case 'pass':
      return '何もしない'
    case 'spearChant':
      return '雷槍の詠唱'
    case 'spearCast':
      return '雷槍の発動'
    default:
      return CARD_NAMES[a.kind]
  }
}

function rollDice(n: number, rng: Rng): number[] {
  return Array.from({ length: n }, () => 1 + Math.floor(rng() * 6))
}

export function newGame(rng: Rng, config: Config = DEFAULT_CONFIG): GameState {
  const fresh = (): PlayerState => ({
    hp: config.maxHp,
    roll: rollDice(config.diceCount, rng),
    usedDice: [],
    usedCards: [],
    chant: 'none',
  })
  return { config, turn: 1, step: 1, players: [fresh(), fresh()], history: [], winner: null }
}

export function diceValues(p: PlayerState, a: Action): number[] {
  return a.kind === 'pass' ? [] : a.dice.map((i) => p.roll[i])
}

export function freeDice(p: PlayerState): number[] {
  return p.roll.map((_, i) => i).filter((i) => !p.usedDice.includes(i))
}

/** 行動がこのステップで合法か */
export function isLegal(state: GameState, who: PlayerIndex, a: Action): boolean {
  const p = state.players[who]
  if (a.kind === 'pass') return true
  const free = freeDice(p)
  const dice = a.dice as number[]
  if (new Set(dice).size !== dice.length) return false
  if (!dice.every((i) => free.includes(i))) return false
  const card = actionCard(a)!
  switch (a.kind) {
    case 'fireball':
    case 'barrier':
    case 'bullet':
    case 'reflect':
      if (p.usedCards.includes(card)) return false
      if (a.kind === 'reflect' && p.roll[dice[0]] !== p.roll[dice[1]]) return false
      return true
    case 'spearChant':
      return state.step === 1 && !p.usedCards.includes('spear')
    case 'spearCast':
      return state.step === 2 && p.chant === 'charged'
  }
}

/** このステップで選べる行動を全て列挙する。同じ値のダイスの入れ替えは一つにまとめる */
export function legalActions(state: GameState, who: PlayerIndex): Action[] {
  const p = state.players[who]
  const free = freeDice(p)
  const out: Action[] = [{ kind: 'pass' }]
  const seen = new Set<string>()
  const push = (a: Action) => {
    if (!isLegal(state, who, a)) return
    const key = a.kind + ':' + diceValues(p, a).sort().join(',')
    if (seen.has(key)) return
    seen.add(key)
    out.push(a)
  }
  const singles = free.map((i) => [i] as [number])
  const pairs: [number, number][] = []
  for (let x = 0; x < free.length; x++)
    for (let y = x + 1; y < free.length; y++) pairs.push([free[x], free[y]])
  for (const d of pairs) push({ kind: 'fireball', dice: d })
  for (const d of singles) push({ kind: 'barrier', dice: d })
  for (const d of singles) push({ kind: 'bullet', dice: d })
  for (const d of pairs) push({ kind: 'bullet', dice: d })
  for (const d of singles) push({ kind: 'spearChant', dice: d })
  for (const d of pairs) push({ kind: 'spearCast', dice: d })
  for (const d of pairs) push({ kind: 'reflect', dice: d })
  return out
}

/** 攻撃の素のダメージ。相手の障壁は反映し、反射は別で処理する */
function rawDamage(config: Config, atk: number[], a: Action, defVals: number[], b: Action): number {
  const barrier = b.kind === 'barrier' ? defVals[0] : 0
  switch (a.kind) {
    case 'fireball':
      return Math.max(0, Math.max(...atk) - barrier)
    case 'spearCast':
      return Math.max(0, atk[0] + atk[1] - barrier)
    case 'bullet':
      return atk.length === 1 ? config.bulletOne : config.bulletTwo
    default:
      return 0
  }
}

/** 一つのステップで双方が受けるダメージ [0が受ける, 1が受ける] */
export function stepDamage(
  config: Config,
  vals: [number[], number[]],
  acts: [Action, Action],
): [number, number] {
  const to1 = rawDamage(config, vals[0], acts[0], vals[1], acts[1])
  const to0 = rawDamage(config, vals[1], acts[1], vals[0], acts[0])
  let take0 = to0
  let take1 = to1
  if (acts[1].kind === 'reflect') {
    take1 -= to1
    take0 += to1
  }
  if (acts[0].kind === 'reflect') {
    take0 -= to0
    take1 += to0
  }
  return [take0, take1]
}

function describe(config: Config, who: string, vals: number[], a: Action, ovals: number[], b: Action, dealt: number): string[] {
  const lines: string[] = []
  const v = vals.join('と')
  switch (a.kind) {
    case 'pass':
      return [`${who}は何もしなかった`]
    case 'fireball': {
      const hi = Math.max(...vals)
      if (b.kind === 'reflect') lines.push(`${who}の火球 ${hi}点は反射された`)
      else if (b.kind === 'barrier') lines.push(`${who}の火球 ${hi}点、障壁 ${ovals[0]} に削られて ${dealt}点`)
      else lines.push(`${who}の火球 ${hi}点`)
      break
    }
    case 'spearCast': {
      const s = vals[0] + vals[1]
      if (b.kind === 'reflect') lines.push(`${who}の雷槍 ${s}点は反射された`)
      else if (b.kind === 'barrier') lines.push(`${who}の雷槍 ${s}点、障壁 ${ovals[0]} に削られて ${dealt}点`)
      else lines.push(`${who}の雷槍 ${s}点`)
      break
    }
    case 'bullet': {
      const d = vals.length === 1 ? config.bulletOne : config.bulletTwo
      if (b.kind === 'reflect') lines.push(`${who}の魔弾 ${d}点は反射された`)
      else lines.push(`${who}の魔弾 ${d}点${b.kind === 'barrier' ? '、障壁をすり抜けた' : ''}`)
      break
    }
    case 'barrier':
      lines.push(`${who}は障壁 ${v} を張った`)
      break
    case 'spearChant':
      lines.push(`${who}は ${v} で雷槍を詠唱`)
      break
    case 'reflect':
      lines.push(`${who}は ${v} のゾロ目で反射を構えた`)
      break
  }
  return lines
}

/** 双方の行動を同時に解決して次の状態を返す。ターン終わりの振り直しは nextTurn で行う */
export function resolveStep(state: GameState, acts: [Action, Action]): GameState {
  if (state.winner !== null) throw new Error('ゲームは終了している')
  acts.forEach((a, i) => {
    if (!isLegal(state, i as PlayerIndex, a)) throw new Error(`不正な行動: ${JSON.stringify(a)}`)
  })
  const [p0, p1] = state.players
  const vals: [number[], number[]] = [diceValues(p0, acts[0]), diceValues(p1, acts[1])]
  const dmg = stepDamage(state.config, vals, acts)
  const names = ['あなた', '相手']
  const lines = [
    ...describe(state.config, names[0], vals[0], acts[0], vals[1], acts[1], dmg[1]),
    ...describe(state.config, names[1], vals[1], acts[1], vals[0], acts[0], dmg[0]),
  ]

  const players = state.players.map((p, i) => {
    const a = acts[i]
    const card = actionCard(a)
    let chant = p.chant
    if (a.kind === 'spearChant') {
      const broken = dmg[i] >= vals[i][0]
      chant = broken ? 'broken' : 'charged'
      lines.push(broken ? `${names[i]}の詠唱は ${dmg[i]}点を受けて崩れた` : `${names[i]}の詠唱は保たれた`)
    }
    if (a.kind === 'spearCast') chant = 'none'
    return {
      ...p,
      hp: p.hp - dmg[i],
      usedDice: a.kind === 'pass' ? p.usedDice : [...p.usedDice, ...a.dice],
      usedCards: card && !p.usedCards.includes(card) ? [...p.usedCards, card] : p.usedCards,
      chant,
    }
  }) as [PlayerState, PlayerState]

  const report: StepReport = { turn: state.turn, step: state.step, actions: acts, values: vals, damage: dmg, lines }
  const dead0 = players[0].hp <= 0
  const dead1 = players[1].hp <= 0
  const winner: GameState['winner'] = dead0 && dead1 ? 'draw' : dead0 ? 1 : dead1 ? 0 : null
  return { ...state, players, history: [...state.history, report], winner, step: 2 }
}

/** 二ステップ目まで終わったか */
export function turnOver(state: GameState): boolean {
  const last = state.history[state.history.length - 1]
  return !!last && last.turn === state.turn && last.step === 2
}

/** 次のターンへ。ダイスを振り直し、使用済みの記録を消す */
export function nextTurn(state: GameState, rng: Rng): GameState {
  const reset = (p: PlayerState): PlayerState => ({
    ...p,
    roll: rollDice(state.config.diceCount, rng),
    usedDice: [],
    usedCards: [],
    chant: 'none',
  })
  const players: [PlayerState, PlayerState] = [reset(state.players[0]), reset(state.players[1])]
  return { ...state, turn: state.turn + 1, step: 1, players }
}
