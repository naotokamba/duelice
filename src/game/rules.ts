// 一つのステップの解決。盤の状態と双方の行動を受け取って、次の状態と記録を返す純粋関数だけで書く。
// 乱数は外から渡すので、同じ入力なら必ず同じ結果になる。対局の進め方は match.ts にある。
// カード固有の知識は持たず、cards.ts の定義表に書かれた性質だけを見て処理する。

import { ACTION_DEFS, type ActionDef, type ActionKind, type CardId, kindsOfCard, type PowerCtx, STARTER } from './cards'
import { filled, fillsRequired, type PlacedRow, readsMark, rowOf, slotsOf } from './slots'
import type {
  Action,
  ChantResult,
  Config,
  GameState,
  Outcome,
  Phase,
  PlayerIndex,
  PlayerState,
  Rng,
  StepReport,
  Strike,
} from './types'
import { DEFAULT_CONFIG } from './types'

export function rollDice(n: number, rng: Rng): number[] {
  return Array.from({ length: n }, () => 1 + Math.floor(rng() * 6))
}

/** 双方が対局に持ち込む5枚 [0の5枚, 1の5枚] */
export type Decks = readonly [readonly CardId[], readonly CardId[]]

/** 二人ともスターターの5枚 */
export const STARTER_DECKS: Decks = [STARTER, STARTER]

export function newGame(rng: Rng, config: Config = DEFAULT_CONFIG, decks: Decks = STARTER_DECKS): GameState {
  const fresh = (deck: readonly CardId[]): PlayerState => ({
    hp: config.maxHp,
    roll: rollDice(config.diceCount, rng),
    usedDice: [],
    usedCards: [],
    chant: 'none',
    deck: [...deck],
    frozen: null,
    burned: 0,
    carry: null,
  })
  return { config, turn: 1, step: 1, players: [fresh(decks[0]), fresh(decks[1])], history: [], winner: null }
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

/** まだ使っていないダイスのうち、今のステップに置けるもの。凍らされた目は置けない */
export function placeableDice(p: PlayerState): number[] {
  return freeDice(p).filter((i) => p.roll[i] !== p.frozen)
}

/** 4個の目が二組のゾロ目か。4個とも同じ目でもよい */
export function isTwoPairs(vals: number[]): boolean {
  const [a, b, c, d] = [...vals].sort((x, y) => x - y)
  return vals.length === 4 && a === b && c === d
}

/** 行動がこのステップで合法か */
export function isLegal(state: GameState, who: PlayerIndex, a: Action): boolean {
  if (a.kind === 'pass') return true
  const def = ACTION_DEFS[a.kind]
  const p = state.players[who]
  if (!p.deck.includes(def.card)) return false
  const free = placeableDice(p)
  const dice = actionDice(a)
  if (a.dice.length !== slotsOf(def)) return false
  if (!fillsRequired(def, a.dice)) return false
  if (!def.dice.includes(dice.length)) return false
  if (new Set(dice).size !== dice.length) return false
  if (!dice.every((i) => free.includes(i))) return false
  if (def.step !== undefined && def.step !== state.step) return false
  if (def.needsCharge) return p.chant === 'charged'
  if (p.usedCards.includes(def.card)) return false
  if (def.twoPairs && !isTwoPairs(diceValues(p, a))) return false
  return !def.sameValues || new Set(diceValues(p, a)).size === 1
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
  const free = placeableDice(p)
  const out: Action[] = [{ kind: 'pass' }]
  const seen = new Set<string>()
  for (const kind of p.deck.flatMap(kindsOfCard)) {
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

/** 行動の定義。パスは null */
// Stryker disable next-line ConditionalExpression,StringLiteral: パスを表で引いても undefined になり、null と同じく性質を持たない行動として扱われる
const defOf = (a: Action): ActionDef | null => (a.kind === 'pass' ? null : ACTION_DEFS[a.kind])

const PASS: Action = { kind: 'pass' }

/** 体力の減っていない様子。双方の様子を渡さずに攻撃を求めるときに使う */
export const FRESH: readonly [PowerCtx, PowerCtx] = [
  { hp: DEFAULT_CONFIG.maxHp, maxHp: DEFAULT_CONFIG.maxHp },
  { hp: DEFAULT_CONFIG.maxHp, maxHp: DEFAULT_CONFIG.maxHp },
]

/** 威力を決めるときに読む、who の様子 */
export function ctxOf(state: GameState, who: PlayerIndex): PowerCtx {
  return { hp: state.players[who].hp, maxHp: state.config.maxHp }
}

/**
 * phase の時に放たれた攻撃を全て、その行方とともに返す。fast は先に当たる攻撃、main はほかの攻撃。
 * 受けた側が攻撃を返す構えなら、障壁で減る攻撃は攻撃した側にそのまま当たる。
 * 守りで減った攻撃があり、その守りが返す性質を持つなら、攻撃した側へ返すダメージも攻撃として並べる。
 * 攻撃した側は守っていないので、返すダメージは減らない
 */
function attacks(
  vals: readonly [number[], number[]],
  acts: readonly [Action, Action],
  ctx: readonly [PowerCtx, PowerCtx],
  phase: Phase,
): Strike[] {
  const out: Strike[] = []
  for (const from of [0, 1] as const) {
    const a = acts[from]
    if (a.kind === 'pass') continue
    const def = ACTION_DEFS[a.kind]
    if (!def.power || !!def.fast !== (phase === 'fast')) continue
    const power = def.power(vals[from], ctx[from])
    const other: PlayerIndex = from === 0 ? 1 : 0
    const answer = defOf(acts[other])
    if (answer?.reflects && !def.piercing) {
      out.push({ from, kind: a.kind, power, outcome: 'reflected', to: from, dealt: power, phase })
      continue
    }
    const guardOf = answer?.guard
    const guard = guardOf && !def.piercing ? guardOf(vals[other]) : 0
    const stance = !!guardOf || !!answer?.reflects
    const outcome: Outcome = stance ? (def.piercing ? 'pierced' : 'guarded') : 'hit'
    out.push({ from, kind: a.kind, power, outcome, to: other, dealt: Math.max(0, power - guard), phase })
  }
  for (const s of [...out]) {
    const b = acts[s.to]
    // Stryker disable next-line ConditionalExpression,StringLiteral: 守りで減った攻撃なら、守った側の行動はパスではない。型を絞るための条件で、結果は変わらない
    if (s.outcome !== 'guarded' || b.kind === 'pass') continue
    const back = ACTION_DEFS[b.kind].thorns
    if (back) out.push({ from: s.to, kind: b.kind, power: back, outcome: 'returned', to: s.from, dealt: back, phase })
  }
  return out
}

/** 一つのステップの、ターンの終わりを除いたぶつかり合い */
export interface Clash {
  /** 先に当たる攻撃、ほかの攻撃の順に並べた、攻撃とその行方 */
  strikes: Strike[]
  /** 双方が炎で自分も焼けて受けるダメージ */
  burn: [number, number]
  /** 先に当たる攻撃で倒れて、行動が起きなかった側 */
  cancelled: [boolean, boolean]
  /** 双方が受けるダメージ。攻撃で受けた分と、自分が焼けた分を足す */
  damage: [number, number]
}

/**
 * 双方の行動のぶつかり合い。先に当たる攻撃を解決し、それで倒れた側の行動は起きなかったことにして、残りを同時に解決する。
 * 先に当たる攻撃を放った側は、もう行動を終えているので、倒れても行動は起きている。
 * ctx は双方の、ステップを解決する前の様子
 */
export function clash(
  vals: readonly [number[], number[]],
  acts: readonly [Action, Action],
  ctx: readonly [PowerCtx, PowerCtx] = FRESH,
): Clash {
  const first = attacks(vals, acts, ctx, 'fast')
  const hp = [ctx[0].hp, ctx[1].hp]
  for (const s of first) hp[s.to] -= s.dealt
  const down = (i: PlayerIndex) => hp[i] <= 0 && !defOf(acts[i])?.fast
  const cancelled: [boolean, boolean] = [down(0), down(1)]
  const live = liveActs(acts, cancelled)
  const list = [...first, ...attacks(vals, live, ctx, 'main')]
  const burn = burnOf(vals, live)
  const damage: [number, number] = [...burn]
  for (const s of list) damage[s.to] += s.dealt
  return { strikes: list, burn, cancelled, damage }
}

/** 起きた行動。倒れて行動が起きなかった側はパスにする */
function liveActs(acts: readonly [Action, Action], cancelled: readonly [boolean, boolean]): [Action, Action] {
  return [cancelled[0] ? PASS : acts[0], cancelled[1] ? PASS : acts[1]]
}

/** 一つのステップで放たれた攻撃を全て、その行方とともに返す。ターンの終わりの攻撃は含まない */
export function strikes(
  vals: readonly [number[], number[]],
  acts: readonly [Action, Action],
  ctx: readonly [PowerCtx, PowerCtx] = FRESH,
): Strike[] {
  return clash(vals, acts, ctx).strikes
}

/** 双方が炎で自分も焼けて受けるダメージ [0が受ける, 1が受ける]。障壁では減らない */
export function burnOf(vals: readonly [number[], number[]], acts: readonly [Action, Action]): [number, number] {
  const pay = (who: PlayerIndex) => defOf(acts[who])?.burn?.(vals[who]) ?? 0
  return [pay(0), pay(1)]
}

/** 一つのステップで双方が受けるダメージ [0が受ける, 1が受ける]。ターンの終わりの分は含まない */
export function stepDamage(
  vals: readonly [number[], number[]],
  acts: readonly [Action, Action],
  ctx: readonly [PowerCtx, PowerCtx] = FRESH,
): [number, number] {
  return clash(vals, acts, ctx).damage
}

/** 詠唱は、同じステップに相手が詠唱を崩す行動をしたときだけ崩れる。攻撃のダメージでは崩れない */
export function breaksChant(by: Action): boolean {
  return !!defOf(by)?.disrupts
}

/** 行動で振り足すダイスの数 */
export function extraDiceOf(a: Action): number {
  return defOf(a)?.extraDice ?? 0
}

/** このターンに使ったカードの行動の種類。ターンの終わりに起きることは、使ったカードから決まる */
function usedKinds(p: PlayerState): ActionKind[] {
  return p.usedCards.flatMap(kindsOfCard)
}

/**
 * ターンの終わりに起きること。使ったカードの、ターンの終わりに自分も焼ける分を払い、
 * それを足したこのターンに焼けた分を、延焼の性質を持つカードを使った側が相手に与える。障壁では減らない
 */
function turnEnd(players: readonly [PlayerState, PlayerState]): { endBurn: [number, number]; strikes: Strike[] } {
  const pay = (p: PlayerState) => usedKinds(p).reduce((sum, k) => sum + (ACTION_DEFS[k].endBurn ?? 0), 0)
  const endBurn: [number, number] = [pay(players[0]), pay(players[1])]
  const list: Strike[] = []
  for (const from of [0, 1] as const) {
    const kind = usedKinds(players[from]).find((k) => ACTION_DEFS[k].ignite)
    if (!kind) continue
    const power = players[from].burned + endBurn[from]
    list.push({ from, kind, power, outcome: 'hit', to: from === 0 ? 1 : 0, dealt: power, phase: 'end' })
  }
  return { endBurn, strikes: list }
}

/**
 * 双方の行動を同時に解決して次の状態を返す。不正な行動や、決着した後の解決は例外にする。
 * extra は双方が振り足したダイスの目で、振り足す行動をした側はその数だけ渡す。乱数は外で振る。
 * 二ステップ目なら、ターンの終わりに起きることもここで解決する。
 * ターン終わりの振り直しは nextTurn で行う。対局を進めるときは match.ts の submit を使う
 */
export function resolveStep(
  state: GameState,
  acts: [Action, Action],
  extra: [number[], number[]] = [[], []],
): GameState {
  if (state.winner !== null) throw new Error('ゲームは終了している')
  acts.forEach((a, i) => {
    if (!isLegal(state, i as PlayerIndex, a)) throw new Error(`不正な行動: ${JSON.stringify(a)}`)
    if (extra[i].length !== extraDiceOf(a)) throw new Error(`振り足すダイスの数が違う: ${JSON.stringify(extra[i])}`)
  })
  const vals: [number[], number[]] = [diceValues(state.players[0], acts[0]), diceValues(state.players[1], acts[1])]
  const c = clash(vals, acts, [ctxOf(state, 0), ctxOf(state, 1)])
  const live = liveActs(acts, c.cancelled)
  const chants: [ChantResult, ChantResult] = [null, null]
  const refunded: [boolean, boolean] = [false, false]

  const update = (p: PlayerState, i: PlayerIndex): PlayerState => {
    const other: PlayerIndex = i === 0 ? 1 : 0
    // 相手が凍らせた目は、次のステップに置けない。凍らされていなければ、前の凍結はこのステップで解ける
    const by = defOf(live[other])
    const base = {
      ...p,
      hp: p.hp - c.damage[i],
      burned: p.burned + c.burn[i],
      frozen: by?.freezes ? vals[other][0] : null,
    }
    const a = live[i]
    if (a.kind === 'pass') return base
    const def = ACTION_DEFS[a.kind]
    let chant = p.chant
    if (def.chant) {
      const broken = breaksChant(live[other])
      chant = broken ? 'broken' : 'charged'
      chants[i] = broken ? 'broken' : 'kept'
    }
    if (def.needsCharge) chant = 'none'
    // 障壁で減る攻撃を防ぎきったら、置いたダイスが戻る
    // Stryker disable next-line ConditionalExpression,LogicalOperator: 守る側は攻撃しないので、ステップの攻撃は全て自分に向いた攻撃で、0 しか通らないのは守りで減ったときだけ。読む人のために条件を書いている
    refunded[i] = !!def.refund && c.strikes.some((s) => s.to === i && s.outcome === 'guarded' && s.dealt === 0)
    return {
      ...base,
      roll: [...p.roll, ...extra[i]],
      usedDice: refunded[i] ? p.usedDice : [...p.usedDice, ...actionDice(a)],
      usedCards: p.usedCards.includes(def.card) ? p.usedCards : [...p.usedCards, def.card],
      chant,
      carry: def.carries ? vals[i][0] : p.carry,
    }
  }
  let players: [PlayerState, PlayerState] = [update(state.players[0], 0), update(state.players[1], 1)]
  const damage: [number, number] = [...c.damage]
  let endBurn: [number, number] = [0, 0]
  let late: Strike[] = []
  if (state.step === 2) {
    const end = turnEnd(players)
    endBurn = end.endBurn
    late = end.strikes
    for (const i of [0, 1] as const) damage[i] += endBurn[i]
    for (const s of late) damage[s.to] += s.dealt
    players = [0, 1].map((i) => ({
      ...players[i],
      hp: state.players[i].hp - damage[i],
      burned: players[i].burned + endBurn[i],
    })) as [PlayerState, PlayerState]
  }

  const report: StepReport = {
    turn: state.turn,
    step: state.step,
    actions: acts,
    values: vals,
    strikes: [...c.strikes, ...late],
    burn: c.burn,
    endBurn,
    damage,
    chants,
    cancelled: c.cancelled,
    refunded,
    extra,
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

/**
 * 次のターンへ。ダイスを振り直し、使用済みの記録を消す。持ち越したダイスは、振ったダイスの後ろに目ごと加える。
 * 二ステップ目に凍らされた目は、次のターンの一ステップ目まで置けない
 */
export function nextTurn(state: GameState, rng: Rng): GameState {
  const reset = (p: PlayerState): PlayerState => ({
    ...p,
    roll: [...rollDice(state.config.diceCount, rng), ...(p.carry === null ? [] : [p.carry])],
    usedDice: [],
    usedCards: [],
    chant: 'none',
    burned: 0,
    carry: null,
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
  // 防ぎきって戻ったダイスは手元にあるので、カードには残さない
  return report && !report.refunded[who] ? rowOf(report.actions[who]) : null
}
