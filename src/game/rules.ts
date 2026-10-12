// Duelice のルール本体。
// 状態と双方の行動を受け取って次の状態を返す純粋関数だけで書く。
// 乱数は外から渡すので、同じ入力なら必ず同じ結果になる。
// オンライン対戦では、この関数をそのままサーバ側で動かす想定。
// カード固有の知識は持たず、cards.ts の定義表に書かれた性質だけを見て処理する。

import { ACTION_DEFS, ACTION_KINDS, type ActionDef, CARD_DEFS, MARK_SLOT, readsMark, slotsOf } from './cards'
import type { Action, ActionKind, CardId, Config, GameState, PlayerIndex, PlayerState, Rng, StepReport } from './types'
import { DEFAULT_CONFIG } from './types'

export * from './types'

export const CARD_NAMES = Object.fromEntries(Object.entries(CARD_DEFS).map(([k, d]) => [k, d.name])) as Record<
  CardId,
  string
>

export function actionLabel(a: Action): string {
  return a.kind === 'pass' ? '何もしない' : ACTION_DEFS[a.kind].label
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

/** 行動が使うダイスの番号。空けた置き場を飛ばし、置き場の順に並べる */
export function actionDice(a: Action): number[] {
  return a.kind === 'pass' ? [] : a.dice.filter((d): d is number => d !== null)
}

/** 行動が使う目。空けた置き場を飛ばし、置き場の順に並べる。効果の計算はこの目から行う */
export function diceValues(p: PlayerState, a: Action): number[] {
  return actionDice(a).map((i) => p.roll[i])
}

export function freeDice(p: PlayerState): number[] {
  return p.roll.map((_, i) => i).filter((i) => !p.usedDice.includes(i))
}

/**
 * 印の置き場の目を値にする行動なら、印の置き場が埋まっているか。印の無い行動はいつも true。
 * 今のカードでは個数の決まりでも同じになるが、印の置き場のほかに省いてよい置き場を持つカードを足したときに効く
 */
export function fillsMark(def: ActionDef, dice: (number | null)[]): boolean {
  return !readsMark(def) || dice[MARK_SLOT] !== null
}

/** 行動がこのステップで合法か */
export function isLegal(state: GameState, who: PlayerIndex, a: Action): boolean {
  if (a.kind === 'pass') return true
  const def = ACTION_DEFS[a.kind]
  const p = state.players[who]
  const free = freeDice(p)
  const dice = actionDice(a)
  if (a.dice.length !== slotsOf(def)) return false
  if (!fillsMark(def, a.dice)) return false
  if (!def.dice.includes(dice.length)) return false
  if (new Set(dice).size !== dice.length) return false
  if (!dice.every((i) => free.includes(i))) return false
  if (def.step !== undefined && def.step !== state.step) return false
  if (def.needsCharge) return p.chant === 'charged'
  if (p.usedCards.includes(def.card)) return false
  if (def.sameValues && new Set(diceValues(p, a)).size !== 1) return false
  return true
}

function combinations(items: number[], k: number): number[][] {
  if (k === 0) return [[]]
  const out: number[][] = []
  items.forEach((x, i) => {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([x, ...rest])
  })
  return out
}

/**
 * ダイスの組を置き場に置く形。効果の変わらない置き方は一つにまとめ、前の置き場から詰めて空きを後ろに残す。
 * 印の置き場の目を値にする行動は、どのダイスを印の置き場に置くかで効果が変わるので、それぞれを別の置き方にする
 */
function placements(def: ActionDef, dice: number[]): (number | null)[][] {
  const fill = (xs: number[]) => Array.from({ length: slotsOf(def) }, (_, k) => xs[k] ?? null)
  if (!readsMark(def)) return [fill(dice)]
  return dice.map((d) => fill([d, ...dice.filter((x) => x !== d)]))
}

/**
 * 同じ手かどうかを見分ける鍵。どの置き場に置いたかは問わず、目の組が同じなら同じ手とみなす。
 * 印の置き場の目を値にする行動は、印の置き場の目も同じときだけ同じ手になる。
 * 合法な手なら印の置き場は埋まっていて、置き場の順に並べた目の最初がその目になる
 */
export function actionKey(p: PlayerState, a: Action): string {
  if (a.kind === 'pass') return a.kind
  const vals = diceValues(p, a)
  const set = [...vals].sort((x, y) => x - y).join(',')
  return `${a.kind}:${readsMark(ACTION_DEFS[a.kind]) ? `${vals[0]}|${set}` : set}`
}

/**
 * このステップで選べる行動を全て列挙する。効果の同じ手は一つにまとめる。
 * 同じ値のダイスの入れ替えや、効果の変わらない置き場の違いは、前から詰めた置き方だけを残す
 */
export function legalActions(state: GameState, who: PlayerIndex): Action[] {
  const p = state.players[who]
  const free = freeDice(p)
  const out: Action[] = [{ kind: 'pass' }]
  const seen = new Set<string>()
  for (const kind of ACTION_KINDS) {
    const def = ACTION_DEFS[kind]
    for (const k of def.dice) {
      for (const dice of combinations(free, k).flatMap((c) => placements(def, c))) {
        const a: Action = { kind, dice }
        if (!isLegal(state, who, a)) continue
        const key = actionKey(p, a)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(a)
      }
    }
  }
  return out
}

function reflects(a: Action): boolean {
  return a.kind !== 'pass' && !!ACTION_DEFS[a.kind].reflects
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

/** 一つのステップで放たれた攻撃を全て、その行方とともに返す */
export function strikes(vals: [number[], number[]], acts: [Action, Action]): Strike[] {
  const out: Strike[] = []
  for (const from of [0, 1] as const) {
    const a = acts[from]
    if (a.kind === 'pass') continue
    const def = ACTION_DEFS[a.kind]
    if (!def.power) continue
    const power = def.power(vals[from])
    const other: PlayerIndex = from === 0 ? 1 : 0
    const b = acts[other]
    const guardOf = b.kind === 'pass' ? undefined : ACTION_DEFS[b.kind].guard
    const guard = guardOf && !def.piercing ? guardOf(vals[other]) : 0
    const outcome: Outcome = reflects(b) ? 'reflected' : guardOf ? (def.piercing ? 'pierced' : 'guarded') : 'hit'
    out.push({
      from,
      kind: a.kind,
      power,
      outcome,
      to: outcome === 'reflected' ? from : other,
      dealt: Math.max(0, power - guard),
    })
  }
  return out
}

/** 一つのステップで双方が受けるダメージ [0が受ける, 1が受ける] */
export function stepDamage(vals: [number[], number[]], acts: [Action, Action]): [number, number] {
  const dmg: [number, number] = [0, 0]
  for (const s of strikes(vals, acts)) dmg[s.to] += s.dealt
  return dmg
}

/** 詠唱に置いた目以上のダメージを受けると、詠唱は崩れる */
export function breaksChant(vals: number[], taken: number): boolean {
  return taken >= vals[0]
}

function describe(who: string, vals: number[], a: Action, ovals: number[], b: Action, dealt: number) {
  if (a.kind === 'pass') return `${who}は何もしなかった`
  const def = ACTION_DEFS[a.kind]
  if (def.power) {
    const p = def.power(vals)
    if (b.kind !== 'pass' && reflects(b)) return `${who}の${def.label} ${p}点は${ACTION_DEFS[b.kind].label}で返された`
    const guard = b.kind === 'pass' ? undefined : ACTION_DEFS[b.kind]
    if (guard?.guard && def.piercing) return `${who}の${def.label} ${p}点、${guard.label}をすり抜けた`
    if (guard?.guard) return `${who}の${def.label} ${p}点、${guard.label} ${ovals.join('と')} に削られて ${dealt}点`
    return `${who}の${def.label} ${p}点`
  }
  return `${who}は ${vals.join('と')} で${def.done ?? def.label}`
}

/** 双方の行動を同時に解決して次の状態を返す。ターン終わりの振り直しは nextTurn で行う */
export function resolveStep(state: GameState, acts: [Action, Action]): GameState {
  if (state.winner !== null) throw new Error('ゲームは終了している')
  acts.forEach((a, i) => {
    if (!isLegal(state, i as PlayerIndex, a)) throw new Error(`不正な行動: ${JSON.stringify(a)}`)
  })
  const vals: [number[], number[]] = [diceValues(state.players[0], acts[0]), diceValues(state.players[1], acts[1])]
  const dmg = stepDamage(vals, acts)
  const names = ['あなた', '相手']
  const lines = [
    describe(names[0], vals[0], acts[0], vals[1], acts[1], dmg[1]),
    describe(names[1], vals[1], acts[1], vals[0], acts[0], dmg[0]),
  ]

  const update = (p: PlayerState, i: 0 | 1): PlayerState => {
    const a = acts[i]
    if (a.kind === 'pass') return { ...p, hp: p.hp - dmg[i] }
    const def = ACTION_DEFS[a.kind]
    let chant = p.chant
    if (def.chant) {
      const broken = breaksChant(vals[i], dmg[i])
      chant = broken ? 'broken' : 'charged'
      lines.push(broken ? `${names[i]}の詠唱は ${dmg[i]}点を受けて崩れた` : `${names[i]}の詠唱は保たれた`)
    }
    if (def.needsCharge) chant = 'none'
    return {
      ...p,
      hp: p.hp - dmg[i],
      usedDice: [...p.usedDice, ...actionDice(a)],
      usedCards: p.usedCards.includes(def.card) ? p.usedCards : [...p.usedCards, def.card],
      chant,
    }
  }
  const players: [PlayerState, PlayerState] = [update(state.players[0], 0), update(state.players[1], 1)]

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
  return { ...state, turn: state.turn + 1, step: 1, players: [reset(state.players[0]), reset(state.players[1])] }
}
