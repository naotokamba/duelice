// 一つのステップの解決。盤の状態と双方の行動を受け取って、次の状態と記録を返す純粋関数だけで書く。
// 乱数は外から渡すので、同じ入力なら必ず同じ結果になる。対局の進め方は match.ts にある。
// カード固有の知識は持たず、cards.ts の定義表に書かれた性質だけを見て処理する。
// 行動は、カードの行動を一つか、行動の回数を増やすカードで複数持つ。解決は、行動が起こす効果の並びで行う。

import { ACTION_DEFS, type ActionDef, type ActionKind, type CardId, kindsOfCard, type PowerCtx, STARTER } from './cards'
import { filled, fillsRequired, type PlacedRow, readsMark, rowOf, slotsOf } from './slots'
import type {
  Action,
  ChantResult,
  Config,
  GameState,
  Move,
  Outcome,
  Phase,
  Play,
  PlayerIndex,
  PlayerState,
  Rng,
  StepReport,
  Strike,
} from './types'
import { DEFAULT_CONFIG, WILD } from './types'

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
    last: [],
    acted: [],
  })
  return { config, turn: 1, step: 1, players: [fresh(decks[0]), fresh(decks[1])], history: [], winner: null }
}

/** 行動に含まれるカードの行動。行動の回数を増やすカードなら、それ自身の後に、一緒に使う行動を置いた順に並べる */
export function partsOf(a: Action): Play[] {
  return a.kind === 'pass' ? [] : [a, ...(a.with ?? [])]
}

/** 行動が使うダイスの番号。空けた置き場を飛ばし、置き場の順に並べる。一緒に使う行動のダイスも続けて並べる */
export function actionDice(a: Action): number[] {
  return partsOf(a).flatMap((x) => filled(x.dice))
}

/** カードの行動一つが使う目。空けた置き場を飛ばし、置き場の順に並べる。好きな目のダイスは選んだ目 */
function playValues(p: PlayerState, x: Play): number[] {
  const out: number[] = []
  x.dice.forEach((d, k) => {
    if (d === null) return
    out.push(p.roll[d] === WILD ? (x.set?.[k] ?? WILD) : p.roll[d])
  })
  return out
}

/** 行動が使う目。空けた置き場を飛ばし、置き場の順に並べる。一緒に使う行動の目も続けて並べる。効果の計算は movesOf の目から行う */
export function diceValues(p: PlayerState, a: Action): number[] {
  return partsOf(a).flatMap((x) => playValues(p, x))
}

/**
 * 行動が起こす効果を、置いた順に並べる。もう一度出す行動は、直前のステップの効果に置き換わる。
 * 行動の回数を増やすカードの行動も、何も起こさない効果として並べる
 */
export function movesOf(p: PlayerState, a: Action): Move[] {
  return partsOf(a).flatMap((x): Move[] =>
    ACTION_DEFS[x.kind].echo ? p.last.map((m) => ({ ...m, echoed: true })) : [{ kind: x.kind, vals: playValues(p, x) }],
  )
}

export function freeDice(p: PlayerState): number[] {
  return p.roll.map((_, i) => i).filter((i) => !p.usedDice.includes(i))
}

/** まだ使っていないダイスのうち、今のステップに置けるもの。凍らされた目は置けない。好きな目のダイスは置ける */
export function placeableDice(p: PlayerState): number[] {
  return freeDice(p).filter((i) => p.roll[i] !== p.frozen)
}

/** 4個の目が二組のゾロ目か。4個とも同じ目でもよい */
export function isTwoPairs(vals: number[]): boolean {
  const [a, b, c, d] = [...vals].sort((x, y) => x - y)
  return vals.length === 4 && a === b && c === d
}

/** 効果の定義 */
const defOf = (m: Move): ActionDef => ACTION_DEFS[m.kind]

/** 置き場のダイスが好きな目のダイスか。空けた置き場は違う */
// Stryker disable next-line ConditionalExpression: 空けた置き場の null で引いた目は undefined で、好きな目にならない
const wildAt = (p: PlayerState, d: number | null) => d !== null && p.roll[d] === WILD

/** 好きな目のダイスに選べる目か。1から6で、凍らされた目でない */
const choosable = (p: PlayerState, v: number | null): boolean =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 6 && v !== p.frozen

/** 選んだ目が、好きな目のダイスを置いた置き場にだけあり、選べる目か */
function setOk(p: PlayerState, x: Play): boolean {
  const wild = x.dice.map((d) => wildAt(p, d))
  if (x.set === undefined) return !wild.includes(true)
  if (!Array.isArray(x.set) || x.set.length !== x.dice.length) return false
  return x.set.every((v, k) => (wild[k] ? choosable(p, v) : v === null))
}

/** カードの行動一つが、このステップで合法か。同じダイスを重ねていないかと、ほかの行動とカードが重ならないかは isLegal が見る */
function playLegal(state: GameState, who: PlayerIndex, x: Play): boolean {
  if (!Object.hasOwn(ACTION_DEFS, x.kind) || !Array.isArray(x.dice)) return false
  const def = ACTION_DEFS[x.kind]
  const p = state.players[who]
  if (!p.deck.includes(def.card)) return false
  const free = placeableDice(p)
  const dice = filled(x.dice)
  if (x.dice.length !== slotsOf(def)) return false
  if (!fillsRequired(def, x.dice)) return false
  if (!def.dice.includes(dice.length)) return false
  if (!dice.every((i) => free.includes(i))) return false
  if (!setOk(p, x)) return false
  if (def.step !== undefined && def.step !== state.step) return false
  if (def.echo && p.last.length === 0) return false
  if (def.needsCharge) return p.chant === 'charged'
  if (p.usedCards.includes(def.card)) return false
  const vals = playValues(p, x)
  if (def.twoPairs && !isTwoPairs(vals)) return false
  return !def.sameValues || new Set(vals).size === 1
}

/**
 * 行動がこのステップで合法か。行動の回数を増やすカードは、一緒に使う行動を1つから決まった数まで持つ。
 * 一緒に使う行動は、それぞれが合法で、ダイスもカードも重ならない
 */
export function isLegal(state: GameState, who: PlayerIndex, a: Action): boolean {
  if (a.kind === 'pass') return true
  if (!Object.hasOwn(ACTION_DEFS, a.kind)) return false
  const top = ACTION_DEFS[a.kind]
  const more = a.with
  if (top.multi) {
    if (!Array.isArray(more) || more.length === 0 || more.length > top.multi) return false
  } else if (more !== undefined) return false
  const parts = partsOf(a)
  if (!parts.every((x) => playLegal(state, who, x))) return false
  // 一緒に使う行動は、行動の回数を増やせず、さらに一緒に使う行動も持たない
  if (parts.slice(1).some((x) => x.with !== undefined || ACTION_DEFS[x.kind].multi)) return false
  const dice = actionDice(a)
  if (new Set(dice).size !== dice.length) return false
  const cards = parts.map((x) => ACTION_DEFS[x.kind].card)
  return new Set(cards).size === cards.length
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

/** 好きな目のダイスを置いた置き場に、選べる目を割り当てる全ての組。好きな目のダイスが無ければ、選ぶものの無い一つ */
function choices(p: PlayerState, dice: (number | null)[]): ((number | null)[] | undefined)[] {
  const wild = dice.map((d) => wildAt(p, d))
  if (!wild.includes(true)) return [undefined]
  // Stryker disable next-line MethodExpression,ConditionalExpression: 凍らされた目を外さなくても、合法かの判定で除かれる。速さだけが変わる
  const values = [1, 2, 3, 4, 5, 6].filter((v) => v !== p.frozen)
  let out: (number | null)[][] = [[]]
  for (const w of wild) out = out.flatMap((rest) => (w ? values.map((v) => [...rest, v]) : [[...rest, null]]))
  return out
}

/**
 * 効果の署名。目から決まる効果を、性質の関数を呼んで全て並べる。威力は失った体力でも変わりうるので、全ての体力で求める。
 * 署名が同じ目の組は、もう一度出すときも含めて、どの局面でも同じ効果になる
 */
function signature(def: ActionDef, vals: number[], maxHp: number): string {
  const power = def.power
  // Stryker disable next-line ArithmeticOperator,ArrayDeclaration: 体力の範囲が少しずれても、威力を持たない行動に何を並べても、今の表の行動は同じに見分けられる
  const powers = power ? Array.from({ length: maxHp }, (_, i) => power(vals, { hp: i + 1, maxHp })) : []
  const mark = def.freezes || def.carries ? vals[0] : null
  return JSON.stringify([vals.length, powers, def.guard?.(vals), def.burn?.(vals), mark])
}

/** 行動の後に残るダイスの目の組。どのダイスを使ったかではなく、残った目の組だけが次のステップに効く */
function restOf(p: PlayerState, used: number[]): number[] {
  // Stryker disable next-line BooleanLiteral: 使ったダイスの目の組でも、残る目の組と一対一に決まるので、同じ手の見分けは変わらない
  const rest = freeDice(p).filter((d) => !used.includes(d))
  return rest.map((d) => p.roll[d]).sort((a, b) => a - b)
}

/** カードの行動一つを見分ける鍵。種類と、効果の署名と、残るダイスの目の組が同じなら、同じ置き方とみなす */
function playKey(p: PlayerState, x: Play, maxHp: number): string {
  return JSON.stringify([x.kind, signature(ACTION_DEFS[x.kind], playValues(p, x), maxHp), restOf(p, filled(x.dice))])
}

/**
 * 同じ手かどうかを見分ける鍵。行動の後の盤が、相手がどう動いても同じになる手を、同じ手とみなす。
 * 鍵は、使うカードの行動の種類と、起こす効果の署名と、残るダイスの目の組で、どれも並びは問わない。
 * 一緒に使う行動の効果は同時に起き、守りが減らす量も合計で効くので、置いた順が違っても結果は同じになる。
 * 二ステップ目の後はダイスを振り直し、残りのダイスを捨てる効果の後はダイスが残らないので、残るダイスは数えない
 */
export function actionKey(state: GameState, who: PlayerIndex, a: Action): string {
  const p = state.players[who]
  const { maxHp } = state.config
  const moves = movesOf(p, a)
  const kinds = partsOf(a)
    .map((x) => x.kind)
    .sort()
  const effects = moves.map((m) => m.kind + signature(defOf(m), m.vals, maxHp)).sort()
  const gone = state.step === 2 || moves.some((m) => defOf(m).transmute)
  return JSON.stringify([kinds, effects, gone ? null : restOf(p, actionDice(a))])
}

/**
 * dice のダイスで出せる、カードの行動一つを全て列挙する。効果の同じ手は一つにまとめる。
 * kinds の順に並べ、行動の回数を増やすカードの行動は、一緒に使う行動を持たない形で出す
 */
function playsWith(state: GameState, who: PlayerIndex, kinds: ActionKind[], dice: number[]): Play[] {
  const p = state.players[who]
  const out: Play[] = []
  const seen = new Set<string>()
  for (const kind of kinds) {
    const def = ACTION_DEFS[kind]
    for (const k of def.dice) {
      for (const placed of combinations(dice, k).flatMap((c) => placements(def, c))) {
        for (const set of choices(p, placed)) {
          const x: Play = set ? { kind, dice: placed, set } : { kind, dice: placed }
          if (!playLegal(state, who, x)) continue
          const key = playKey(p, x, state.config.maxHp)
          // Stryker disable next-line ConditionalExpression: ここでまとめなくても、legalActions が同じ鍵の手をまとめる。速さだけが変わる
          if (seen.has(key)) continue
          // Stryker disable next-line CallExpression: 同じ
          seen.add(key)
          out.push(x)
        }
      }
    }
  }
  return out
}

/** 行動の回数を増やす行動 top に、残りのダイスで一緒に使う行動を、limit 個まで足した全ての手 */
function withMore(state: GameState, who: PlayerIndex, kinds: ActionKind[], top: Play, limit: number): Action[] {
  const free = placeableDice(state.players[who])
  const out: Action[] = []
  const grow = (more: Play[]) => {
    if (more.length === limit) return
    const parts = [top, ...more]
    const taken = new Set(parts.flatMap((x) => filled(x.dice)))
    const cards = new Set(parts.map((x) => ACTION_DEFS[x.kind].card))
    const rest = kinds.filter((k) => !ACTION_DEFS[k].multi && !cards.has(ACTION_DEFS[k].card))
    for (const x of playsWith(
      state,
      who,
      rest,
      free.filter((d) => !taken.has(d)),
    )) {
      const next = [...more, x]
      out.push({ ...top, with: next })
      grow(next)
    }
  }
  grow([])
  return out
}

/**
 * このステップで選べる行動を全て列挙する。効果の同じ手は一つにまとめる。
 * 同じ値のダイスの入れ替えや、効果の変わらない置き場の違いは、前から詰めた置き方だけを残す。
 * 持ち込んだ5枚の並びの順に並べ、行動の回数を増やすカードは、一緒に使う行動との組を全て並べる
 */
export function legalActions(state: GameState, who: PlayerIndex): Action[] {
  const p = state.players[who]
  const kinds = p.deck.flatMap(kindsOfCard)
  const out: Action[] = [{ kind: 'pass' }]
  const seen = new Set<string>()
  for (const x of playsWith(state, who, kinds, placeableDice(p))) {
    const limit = ACTION_DEFS[x.kind].multi
    for (const a of limit ? withMore(state, who, kinds, x, limit) : [x]) {
      const key = actionKey(state, who, a)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(a)
    }
  }
  return out
}

/** 体力の減っていない様子。双方の様子を渡さずに攻撃を求めるときに使う */
export const FRESH: readonly [PowerCtx, PowerCtx] = [
  { hp: DEFAULT_CONFIG.maxHp, maxHp: DEFAULT_CONFIG.maxHp },
  { hp: DEFAULT_CONFIG.maxHp, maxHp: DEFAULT_CONFIG.maxHp },
]

/** 威力を決めるときに読む、who の様子 */
export function ctxOf(state: GameState, who: PlayerIndex): PowerCtx {
  return { hp: state.players[who].hp, maxHp: state.config.maxHp }
}

const otherOf = (i: PlayerIndex): PlayerIndex => (i === 0 ? 1 : 0)

/** 守りの減らす量の合計 */
const guardOf = (moves: readonly Move[]) => moves.reduce((sum, m) => sum + (defOf(m).guard?.(m.vals) ?? 0), 0)

/**
 * 一つのステップの、ぶつかり合いの途中。守りの残りの量と、守りが返したかを、先に当たる攻撃から続けて持つ
 */
interface Field {
  /** 双方の守りが、まだ減らせる量 */
  pool: [number, number]
  /** 双方の守りが、減らせる攻撃を受けて、もう返したか */
  returned: [boolean, boolean]
}

/**
 * phase の時に放たれた攻撃を全て、その行方とともに返す。fast は先に当たる攻撃、main はほかの攻撃。
 * 受けた側が攻撃を返す構えなら、障壁で減る攻撃は攻撃した側にそのまま当たる。
 * 受けた側が守っていれば、障壁で減る攻撃を、置いた順に守りの量の残りから減らす。
 * 減らせる攻撃を受けた守りのうち、返す性質を持つものは、守りのカードごとにステップに1回、攻撃した側へ返す。
 * 攻撃した側への返しは、攻撃した側の守りでは減らない
 */
function attacks(moves: readonly [Move[], Move[]], ctx: readonly [PowerCtx, PowerCtx], phase: Phase, f: Field) {
  const out: Strike[] = []
  // Stryker disable next-line ArrayDeclaration: 空の配列でも、まだ受けていない側は undefined で、受けていないと読む
  const hit: [boolean, boolean] = [false, false]
  for (const from of [0, 1] as const) {
    const to = otherOf(from)
    const answer = moves[to]
    const reflects = answer.some((m) => defOf(m).reflects)
    const guards = answer.some((m) => defOf(m).guard)
    for (const m of moves[from]) {
      const def = defOf(m)
      if (!def.power || !!def.fast !== (phase === 'fast')) continue
      const power = def.power(m.vals, ctx[from])
      if (reflects && !def.piercing) {
        out.push({ from, kind: m.kind, power, outcome: 'reflected', to: from, dealt: power, phase })
        continue
      }
      if (guards && !def.piercing) {
        const dealt = Math.max(0, power - f.pool[to])
        f.pool[to] = Math.max(0, f.pool[to] - power)
        hit[to] = true
        out.push({ from, kind: m.kind, power, outcome: 'guarded', to, dealt, phase })
        continue
      }
      const outcome: Outcome = guards || reflects ? 'pierced' : 'hit'
      out.push({ from, kind: m.kind, power, outcome, to, dealt: power, phase })
    }
  }
  // 返しは、返した先の席の順に並べる
  for (const to of [0, 1] as const) {
    const by = otherOf(to)
    if (!hit[by] || f.returned[by]) continue
    f.returned[by] = true
    for (const m of moves[by]) {
      const back = defOf(m).thorns
      if (back) out.push({ from: by, kind: m.kind, power: back, outcome: 'returned', to, dealt: back, phase })
    }
  }
  return out
}

/** 一つのステップの、ターンの終わりを除いたぶつかり合い */
export interface Clash {
  /** 先に当たる攻撃、ほかの攻撃の順に並べた、攻撃とその行方 */
  strikes: Strike[]
  /** 双方が炎で自分も焼けて受けるダメージ */
  burn: [number, number]
  /** 先に当たる攻撃で倒れて、先に当たる攻撃のほかの効果が起きなかった側。何もしなかった側も倒れれば入る */
  cancelled: [boolean, boolean]
  /** 双方が受けるダメージ。攻撃で受けた分と、自分が焼けた分を足す */
  damage: [number, number]
  /** 双方の、起きた効果 */
  live: [Move[], Move[]]
  /** 守った側が、障壁で減る攻撃を一つ以上受け、全て防ぎきったか */
  blocked: [boolean, boolean]
}

/**
 * 双方の効果のぶつかり合い。先に当たる攻撃を解決し、それで倒れた側の、先に当たる攻撃のほかの効果は起きなかったことにして、
 * 残りを同時に解決する。先に当たる攻撃は、もう起きているので、放った側が倒れても起きている。
 * 守りの量は、先に当たる攻撃から続けて減っていく。ctx は双方の、ステップを解決する前の様子
 */
export function clash(moves: readonly [Move[], Move[]], ctx: readonly [PowerCtx, PowerCtx] = FRESH): Clash {
  // Stryker disable next-line ArrayDeclaration: 空の配列でも、まだ返していない側は undefined で、返していないと読む
  const f: Field = { pool: [guardOf(moves[0]), guardOf(moves[1])], returned: [false, false] }
  const first = attacks(moves, ctx, 'fast', f)
  const hp = [ctx[0].hp, ctx[1].hp]
  for (const s of first) hp[s.to] -= s.dealt
  const down = (i: PlayerIndex) => hp[i] <= 0 && !(moves[i].length > 0 && moves[i].every((m) => defOf(m).fast))
  const cancelled: [boolean, boolean] = [down(0), down(1)]
  const live: [Move[], Move[]] = [0, 1].map((i) =>
    cancelled[i] ? moves[i].filter((m) => defOf(m).fast) : moves[i],
  ) as [Move[], Move[]]
  const list = [...first, ...attacks(live, ctx, 'main', f)]
  const burn = burnOf(live)
  const damage: [number, number] = [...burn]
  for (const s of list) damage[s.to] += s.dealt
  const blocked = ([0, 1] as const).map((i) => {
    const guarded = list.filter((s) => s.to === i && s.outcome === 'guarded')
    return guarded.length > 0 && guarded.every((s) => s.dealt === 0)
  }) as [boolean, boolean]
  return { strikes: list, burn, cancelled, damage, live, blocked }
}

/** 一つのステップで放たれた攻撃を全て、その行方とともに返す。ターンの終わりの攻撃は含まない */
export function strikes(moves: readonly [Move[], Move[]], ctx: readonly [PowerCtx, PowerCtx] = FRESH): Strike[] {
  return clash(moves, ctx).strikes
}

/** 双方が炎で自分も焼けて受けるダメージ [0が受ける, 1が受ける]。障壁では減らない */
export function burnOf(moves: readonly [Move[], Move[]]): [number, number] {
  const pay = (list: Move[]) => list.reduce((sum, m) => sum + (defOf(m).burn?.(m.vals) ?? 0), 0)
  return [pay(moves[0]), pay(moves[1])]
}

/** 一つのステップで双方が受けるダメージ [0が受ける, 1が受ける]。ターンの終わりの分は含まない */
export function stepDamage(
  moves: readonly [Move[], Move[]],
  ctx: readonly [PowerCtx, PowerCtx] = FRESH,
): [number, number] {
  return clash(moves, ctx).damage
}

/** 詠唱は、同じステップに相手が詠唱を崩す効果を起こしたときだけ崩れる。攻撃のダメージでは崩れない */
export function breaksChant(by: readonly Move[]): boolean {
  return by.some((m) => defOf(m).disrupts)
}

/**
 * 行動で振り足すダイスの数。振り足したダイスは次のステップに使うので、二ステップ目には振らない。
 * 好きな目のダイスを得る効果と一緒なら、振り足したダイスも捨てるので振らない
 */
export function extraDiceOf(state: GameState, who: PlayerIndex, a: Action): number {
  if (state.step === 2) return 0
  const moves = movesOf(state.players[who], a)
  if (moves.some((m) => defOf(m).transmute)) return 0
  return moves.reduce((sum, m) => sum + (defOf(m).extraDice ?? 0), 0)
}

/** 目の中で一番大きいもの。無ければ null */
const largest = (vals: number[]): number | null => (vals.length === 0 ? null : Math.max(...vals))

/**
 * ターンの終わりに起きること。このターンに起きた効果の、ターンの終わりに自分も焼ける分を払い、
 * それを足したこのターンに焼けた分を、延焼の性質を持つ効果を起こした回数だけ、相手に与える。障壁では減らない
 */
function turnEnd(players: readonly [PlayerState, PlayerState]): { endBurn: [number, number]; strikes: Strike[] } {
  const pay = (p: PlayerState) => p.acted.reduce((sum, k) => sum + (ACTION_DEFS[k].endBurn ?? 0), 0)
  const endBurn: [number, number] = [pay(players[0]), pay(players[1])]
  const list: Strike[] = []
  for (const from of [0, 1] as const) {
    const power = players[from].burned + endBurn[from]
    for (const kind of players[from].acted.filter((k) => ACTION_DEFS[k].ignite))
      list.push({ from, kind, power, outcome: 'hit', to: otherOf(from), dealt: power, phase: 'end' })
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
    if (extra[i].length !== extraDiceOf(state, i as PlayerIndex, a))
      throw new Error(`振り足すダイスの数が違う: ${JSON.stringify(extra[i])}`)
  })
  const vals: [number[], number[]] = [diceValues(state.players[0], acts[0]), diceValues(state.players[1], acts[1])]
  const moves: [Move[], Move[]] = [movesOf(state.players[0], acts[0]), movesOf(state.players[1], acts[1])]
  const c = clash(moves, [ctxOf(state, 0), ctxOf(state, 1)])
  const chants: [ChantResult, ChantResult] = [null, null]
  const refunded: [boolean, boolean] = [false, false]

  const update = (p: PlayerState, i: PlayerIndex): PlayerState => {
    const theirs = c.live[otherOf(i)]
    // 相手が凍らせた目は、次のステップに置けない。凍らされていなければ、前の凍結はこのステップで解ける
    const base = {
      ...p,
      hp: p.hp - c.damage[i],
      burned: p.burned + c.burn[i],
      frozen: largest(theirs.filter((m) => defOf(m).freezes).map((m) => m.vals[0])),
      last: [],
    }
    // 何もしなかった側は、起きた効果もダイスも無いので、下の更新をしても同じ盤になる
    const a = acts[i]
    if (c.cancelled[i]) return base
    const mine = c.live[i]
    const parts = partsOf(a)
    let chant = p.chant
    if (mine.some((m) => defOf(m).chant)) {
      const broken = breaksChant(theirs)
      chant = broken ? 'broken' : 'charged'
      chants[i] = broken ? 'broken' : 'kept'
    }
    if (parts.some((x) => ACTION_DEFS[x.kind].needsCharge)) chant = 'none'
    // 障壁で減る攻撃を全て防ぎきったら、防ぎきると戻る守りに置いたダイスが戻る
    const back = new Set(parts.filter((x) => ACTION_DEFS[x.kind].refund && c.blocked[i]).flatMap((x) => filled(x.dice)))
    refunded[i] = back.size > 0
    let roll = [...p.roll, ...extra[i]]
    let usedDice = [...p.usedDice, ...actionDice(a).filter((d) => !back.has(d))]
    const forged = largest(mine.map((m) => defOf(m).transmute ?? 0).filter((n) => n > 0))
    if (state.step === 1 && forged !== null) {
      // 残ったダイスを全て捨て、好きな目のダイスを得る
      usedDice = roll.map((_, k) => k)
      roll = [...roll, ...Array<number>(forged).fill(WILD)]
    }
    const cards = parts.map((x) => ACTION_DEFS[x.kind].card).filter((card) => !p.usedCards.includes(card))
    return {
      ...base,
      roll,
      usedDice,
      usedCards: [...p.usedCards, ...cards],
      chant,
      carry: largest(mine.filter((m) => defOf(m).carries).map((m) => m.vals[0])) ?? p.carry,
      last: mine.filter((m) => !defOf(m).multi).map((m) => ({ kind: m.kind, vals: m.vals })),
      acted: [...p.acted, ...mine.map((m) => m.kind)],
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
    moves,
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
 * 二ステップ目に凍らされた目は、次のターンの一ステップ目まで置けない。直前のステップの効果は、もう一度出せるように残す
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
    acted: [],
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
