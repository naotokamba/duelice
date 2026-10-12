// 一つのステップの解決。盤の状態と双方の行動を受け取って、次の状態と記録を返す純粋関数だけで書く。
// 乱数は外から渡すので、同じ入力なら必ず同じ結果になる。対局の進め方は match.ts にある。
// カード固有の知識は持たず、cards.ts の定義表に書かれた性質だけを見て処理する。

import { ACTION_DEFS, ACTION_KINDS, type ActionDef, effectValue } from './cards'
import { filled, fillsRequired, type PlacedRow, readsMark, rowOf, slotsOf } from './slots'
import type {
  Action,
  ChantResult,
  Config,
  GameState,
  Outcome,
  PlayerIndex,
  PlayerState,
  Rng,
  StepReport,
  Strike,
} from './types'
import { DEFAULT_CONFIG } from './types'

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
  return a.kind === 'pass' ? [] : filled(a.dice)
}

/** 行動が使う目。空けた置き場を飛ばし、置き場の順に並べる。効果の計算はこの目から行う */
export function diceValues(p: PlayerState, a: Action): number[] {
  return actionDice(a).map((i) => p.roll[i])
}

export function freeDice(p: PlayerState): number[] {
  return p.roll.map((_, i) => i).filter((i) => !p.usedDice.includes(i))
}

/** 行動がこのステップで合法か */
export function isLegal(state: GameState, who: PlayerIndex, a: Action): boolean {
  if (a.kind === 'pass') return true
  const def = ACTION_DEFS[a.kind]
  const p = state.players[who]
  const free = freeDice(p)
  const dice = actionDice(a)
  if (a.dice.length !== slotsOf(def)) return false
  if (!fillsRequired(def, a.dice)) return false
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
    // Stryker disable next-line MethodExpression: 重なりや並べ替えた組が混ざっても、合法かと同じ手かの判定で除かれる
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
  // Stryker disable next-line ConditionalExpression: 印の無い行動の置き方を増やしても、同じ手として一つにまとまる。速さだけが変わる
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
  // Stryker disable next-line StringLiteral: 目は一桁なので、区切りが無くても組を取り違えない
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

/** 攻撃が双方に与えたダメージ [0が受ける, 1が受ける] */
function damageOf(list: Strike[]): [number, number] {
  const dmg: [number, number] = [0, 0]
  for (const s of list) dmg[s.to] += s.dealt
  return dmg
}

/** 一つのステップで双方が受けるダメージ [0が受ける, 1が受ける] */
export function stepDamage(vals: [number[], number[]], acts: [Action, Action]): [number, number] {
  return damageOf(strikes(vals, acts))
}

/** 詠唱に置いた目以上のダメージを受けると、詠唱は崩れる。詠唱の目は、詠唱の効果の値 */
export function breaksChant(def: ActionDef, vals: number[], taken: number): boolean {
  return taken >= effectValue(def, vals)
}

/**
 * 双方の行動を同時に解決して次の状態を返す。不正な行動や、決着した後の解決は例外にする。
 * ターン終わりの振り直しは nextTurn で行う。対局を進めるときは match.ts の submit を使う
 */
export function resolveStep(state: GameState, acts: [Action, Action]): GameState {
  if (state.winner !== null) throw new Error('ゲームは終了している')
  acts.forEach((a, i) => {
    if (!isLegal(state, i as PlayerIndex, a)) throw new Error(`不正な行動: ${JSON.stringify(a)}`)
  })
  const vals: [number[], number[]] = [diceValues(state.players[0], acts[0]), diceValues(state.players[1], acts[1])]
  const list = strikes(vals, acts)
  const dmg = damageOf(list)
  const chants: [ChantResult, ChantResult] = [null, null]

  const update = (p: PlayerState, i: PlayerIndex): PlayerState => {
    const a = acts[i]
    if (a.kind === 'pass') return { ...p, hp: p.hp - dmg[i] }
    const def = ACTION_DEFS[a.kind]
    let chant = p.chant
    if (def.chant) {
      const broken = breaksChant(def, vals[i], dmg[i])
      chant = broken ? 'broken' : 'charged'
      chants[i] = broken ? 'broken' : 'kept'
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

  const report: StepReport = {
    turn: state.turn,
    step: state.step,
    actions: acts,
    values: vals,
    strikes: list,
    damage: dmg,
    chants,
  }
  return { ...state, players, history: [...state.history, report], winner: winnerOf(players), step: 2 }
}

/**
 * 勝敗。体力が0以下になった方の負け。同時に0以下になったら、体力の残りが多い方の勝ちで、同じなら引き分け。
 * 体力は0で止めずにマイナスまで持つので、どれだけはみ出したかで比べられる
 */
export function winnerOf(players: [PlayerState, PlayerState]): GameState['winner'] {
  const [a, b] = [players[0].hp, players[1].hp]
  if (a > 0 && b > 0) return null
  if (a === b) return 'draw'
  // Stryker disable next-line EqualityOperator: 同じ体力は前の行で引き分けにしているので、>= にしても結果は変わらない
  return a > b ? 0 : 1
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

/**
 * このターンの1ステップ目に who が使ったダイス。盤の上の駒のように、ターンが変わるまでカードの置き場に残る。
 * 1ステップ目を解決してから次のターンまで返し、パスしたときや、まだ1ステップ目を解決していなければ null。
 * 行動は置き場ごとにダイスを記録しているので、置いた置き場にそのまま残る
 */
export function keptRow(state: GameState, who: PlayerIndex): PlacedRow | null {
  // 履歴はステップの順に並ぶので、このターンの最初の記録が1ステップ目になる
  const report = state.history.find((r) => r.turn === state.turn)
  return report ? rowOf(report.actions[who]) : null
}
