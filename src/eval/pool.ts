// カードの強さの評価。pnpm eval:pool で動かす。重いので pnpm check には含めない。
// 差し替え、無作為なデッキ、上位のデッキどうし、互換の疑い、見積もりの比べを順に測り、
// reports/eval/latest.json と latest.md に書き出す。対戦の結果は reports/eval/cache に覚え、同じ組は測り直さない。
//
// 使い方: pnpm eval:pool [--games 24] [--rr-games 8] [--sample 120] [--opponents 8] [--sample-games 4]
//                        [--top 10] [--meta-games 20] [--positions 0.05] [--rows-games 40]
//                        [--estimate-games 0] [--workers N] [--md 書き出す道] [--phases swap,sample,meta,rows,estimates]

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'
import { ACTION_DEFS, CARD_DEFS, type CardId, DECK_SIZE, kindsOfCard, POOL, STARTER } from '../game/cards'
import { CPU_VERSION, ESTIMATES, type Estimates } from '../game/cpu'
import { emptyTally, mergeTally, type RowTally } from './dominance'
import { type GameRecord, seeded } from './game'
import { renderMarkdown } from './report'
import { bradleyTerry, close, mean, type PairResult, type Rate, wilson } from './stats'
import { canonical, deckKey, deckOf, type PairEntry, Store, seatsOf, seedOf } from './store'
import type { Task } from './worker'

const ROOT = resolve(import.meta.dirname, '..', '..')
const OUT = join(ROOT, 'reports', 'eval')

const { values: opts } = parseArgs({
  options: {
    games: { type: 'string', default: '24' },
    'max-games': { type: 'string', default: '48' },
    'rr-games': { type: 'string', default: '8' },
    sample: { type: 'string', default: '120' },
    opponents: { type: 'string', default: '8' },
    'sample-games': { type: 'string', default: '4' },
    top: { type: 'string', default: '10' },
    'meta-games': { type: 'string', default: '20' },
    positions: { type: 'string', default: '0.05' },
    'rows-games': { type: 'string', default: '40' },
    'estimate-games': { type: 'string', default: '0' },
    workers: { type: 'string', default: String(Math.max(1, availableParallelism() - 1)) },
    md: { type: 'string' },
    phases: { type: 'string', default: 'swap,sample,meta,rows,estimates' },
    seed: { type: 'string', default: '1' },
  },
})
const num = (k: keyof typeof opts) => Number(opts[k])
const phases = new Set(String(opts.phases).split(','))

// ---- 働き手 ----

/** 仕事を働き手に配る。空いた働き手から順に次の仕事を渡す */
class Crew {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: { task: Task; done: (r: unknown) => void; fail: (e: unknown) => void }[] = []
  private pending = new Map<number, { done: (r: unknown) => void; fail: (e: unknown) => void }>()
  private next = 0
  done = 0

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url))
      w.on('message', ({ id, result }: { id: number; result: unknown }) => {
        this.pending.get(id)?.done(result)
        this.pending.delete(id)
        this.done++
        this.idle.push(w)
        this.pump()
      })
      w.on('error', (e) => {
        for (const p of this.pending.values()) p.fail(e)
      })
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  run<T>(task: Task): Promise<T> {
    return new Promise((done, fail) => {
      this.queue.push({ task, done: done as (r: unknown) => void, fail })
      this.pump()
    })
  }

  private pump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop() as Worker
      const job = this.queue.shift() as (typeof this.queue)[number]
      const id = this.next++
      this.pending.set(id, job)
      w.postMessage({ id, task: job.task })
    }
  }

  close() {
    for (const w of this.workers) w.terminate()
  }
}

const crew = new Crew(num('workers'))
const store = new Store(ROOT)
const started = Date.now()
const log = (msg: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${msg}`)

// ---- 対戦の数え ----

/** 組の記録から、a の勝ち点 */
function rateOf(entry: PairEntry, a: string): Rate {
  let score = 0
  let n = 0
  for (const [i, g] of Object.entries(entry.games)) {
    const seats = seatsOf(entry, Number(i))
    const mine = seats[0] === a ? 0 : 1
    score += g.winner === 'draw' ? 0.5 : g.winner === mine ? 1 : 0
    n++
  }
  return wilson(score, n)
}

/** 組の記録の一局を、デッキ a の席から見たもの */
function* gamesOf(entry: PairEntry, a: string): Generator<{ g: GameRecord; seat: 0 | 1 }> {
  for (const [i, g] of Object.entries(entry.games)) {
    const seats = seatsOf(entry, Number(i))
    yield { g, seat: seats[0] === a ? 0 : 1 }
  }
}

/**
 * 組ごとに base 局まで戦わせる。区間が 0.5 をまたぐ接戦の組は、step 局ずつ max 局まで足す。
 * 席は一局ごとに入れ替え、入れ替えた二局は同じダイスで戦う
 */
async function playPairs(pairs: [string, string][], base: number, max = base, step = 8, tag = '') {
  const want = new Map(pairs.map(([a, b]) => [`${a}|${b}`, base]))
  for (;;) {
    const jobs: Promise<void>[] = []
    for (const [a, b] of pairs) {
      const entry = store.pair(a, b, tag)
      const target = want.get(`${a}|${b}`) as number
      for (let i = 0; i < target; i++) {
        if (entry.games[i]) continue
        const [s0, s1] = seatsOf(entry, i)
        const task: Task = { type: 'game', decks: [deckOf(s0), deckOf(s1)], seed: seedOf(entry, i) }
        jobs.push(crew.run<GameRecord>(task).then((g) => store.put(a, b, i, g, tag)))
      }
    }
    if (jobs.length > 0) {
      await Promise.all(jobs)
      store.flush()
    }
    let more = false
    for (const [a, b] of pairs) {
      const key = `${a}|${b}`
      const n = want.get(key) as number
      if (n < max && close(rateOf(store.pair(a, b, tag), a))) {
        want.set(key, Math.min(max, n + step))
        more = true
      }
    }
    if (!more) return
  }
}

/** 全ての記録から、組ごとの勝ち点 */
function results(pairs: [string, string][]): PairResult[] {
  return pairs.map(([a, b]) => {
    const r = rateOf(store.pair(a, b), a)
    return { a, b, score: r.score, n: r.n }
  })
}

const uniquePairs = (list: [string, string][]) => {
  const seen = new Set<string>()
  return list.filter(([a, b]) => {
    if (a === b) return false
    const k = [a, b].sort().join('|')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const roundRobin = (decks: string[]): [string, string][] =>
  uniquePairs(decks.flatMap((a, i) => decks.slice(i + 1).map((b): [string, string] => [a, b])))

// ---- 見送るデッキ ----

interface Skip {
  deck: string
  /** 記録したときのカードの指紋。カードが変わったら見送りを解く */
  fingerprints: Record<string, string>
  reason: string
}

const SKIP_FILE = join(OUT, 'skip.json')
const fingerprints = (key: string) => Object.fromEntries(deckOf(key).map((c) => [c, store.fingerprint(c)]))
/** 見送りの一覧。カードの指紋が今と違うものは解く */
const skips: Skip[] = (existsSync(SKIP_FILE) ? (JSON.parse(readFileSync(SKIP_FILE, 'utf8')) as Skip[]) : []).filter(
  (s) => Object.entries(s.fingerprints).every(([c, fp]) => store.fingerprint(c as CardId) === fp),
)
const skipped = new Set(skips.map((s) => s.deck))

// ---- 測る ----

const starter = deckKey(STARTER)
const EXPANSION = POOL.filter((c) => !STARTER.includes(c))
const name = (c: CardId) => CARD_DEFS[c].name
const deckName = (key: string) => deckOf(key).map(name).join('・')

/** 差し替えたデッキ。スターターの out を into に替える */
const swapped = (out: CardId, into: CardId) => deckKey(STARTER.map((c) => (c === out ? into : c)))

async function main() {
  log(`働き手 ${num('workers')}、CPU の版 ${CPU_VERSION}、対局の中身の指紋 ${store.engineId}`)
  const allPairs: [string, string][] = []
  const report: Record<string, unknown> = {
    cpuVersion: CPU_VERSION,
    engine: store.engineId,
    estimates: ESTIMATES,
    options: opts,
  }

  // 差し替え
  const swaps = EXPANSION.flatMap((into) => STARTER.map((out) => ({ out, into, key: swapped(out, into) })))
  const swapDecks = [starter, ...swaps.map((s) => s.key)]
  if (phases.has('swap')) {
    const vsStarter = swaps.map((s): [string, string] => [s.key, starter])
    await playPairs(vsStarter, num('games'), num('max-games'))
    log(`差し替え: スターター相手 ${vsStarter.length} 組`)
    const rr = roundRobin(swapDecks)
    await playPairs(rr, num('rr-games'))
    log(`差し替え: 総当たり ${rr.length} 組`)
    allPairs.push(...vsStarter, ...rr)
    const elo = bradleyTerry(results(rr))
    report.swap = swaps.map((s) => ({
      into: s.into,
      out: s.out,
      vsStarter: rateOf(store.pair(s.key, starter), s.key),
      elo: elo.get(s.key),
    }))
    report.swapStarterElo = elo.get(starter)
    report.replacement = replacementCheck(rr)
  }

  // 無作為なデッキ
  const rng = seeded(num('seed'))
  const sample: string[] = []
  if (phases.has('sample')) {
    const seen = new Set<string>()
    for (let tries = 0; sample.length < num('sample') && tries < num('sample') * 50; tries++) {
      const deck = [...POOL]
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      const key = deckKey(deck.slice(0, DECK_SIZE))
      if (seen.has(key) || skipped.has(key)) continue
      seen.add(key)
      sample.push(key)
    }
    const field = [...sample, starter]
    const pairs = uniquePairs(
      sample.flatMap((a) =>
        Array.from({ length: num('opponents') }, (): [string, string] => [a, field[Math.floor(rng() * field.length)]]),
      ),
    )
    await playPairs(pairs, num('sample-games'))
    log(`無作為: ${sample.length} デッキ、${pairs.length} 組`)
    allPairs.push(...pairs)
  }

  // 全ての結果から強さを求める
  const all = uniquePairs(allPairs)
  const elo = bradleyTerry(results(all))
  const games = new Map<string, number>()
  for (const r of results(all)) for (const k of [r.a, r.b]) games.set(k, (games.get(k) ?? 0) + r.n)

  report.mechanics = mechanicsOf(all)

  if (phases.has('sample')) {
    report.cards = cardStats(sample, elo, all)
    report.lengths = lengthsOf(all)
    // 明らかに弱いデッキは、理由を添えて次から見送る
    const weak = sample.filter((k) => {
      const n = games.get(k) ?? 0
      const won = all.filter(([a, b]) => a === k || b === k).map(([a, b]) => rateOf(store.pair(a, b), k))
      const score = won.reduce((acc, r) => acc + r.score, 0)
      return n >= 16 && score / n <= 0.15
    })
    for (const k of weak) {
      const n = games.get(k) ?? 0
      const won = all.filter(([a, b]) => a === k || b === k).map(([a, b]) => rateOf(store.pair(a, b), k))
      const score = won.reduce((acc, r) => acc + r.score, 0)
      if (!skipped.has(k))
        skips.push({ deck: k, fingerprints: fingerprints(k), reason: `勝率 ${pct(score / n)}（${n}戦）` })
    }
    mkdirSync(OUT, { recursive: true })
    writeFileSync(SKIP_FILE, JSON.stringify(skips, null, 2))
    report.skips = skips.map((s) => ({ deck: s.deck, reason: s.reason }))
  }

  // 上位のデッキどうし
  if (phases.has('meta')) {
    const ranked = [...elo.entries()].filter(([k]) => (games.get(k) ?? 0) >= 8).sort((x, y) => y[1] - x[1])
    const top = ranked.slice(0, num('top')).map(([k]) => k)
    if (!top.includes(starter)) top.push(starter)
    const rr = roundRobin(top)
    await playPairs(rr, num('meta-games'), num('meta-games') * 2)
    log(`上位: ${top.length} デッキの総当たり ${rr.length} 組`)
    const metaElo = bradleyTerry(results(rr))
    const matrix = top.map((a) => top.map((b) => (a === b ? null : rateOf(store.pair(a, b), a))))
    const beats = (i: number, ok: (r: Rate) => boolean) =>
      top.length > 1 && matrix[i].every((r, j) => j === i || (r !== null && ok(r)))
    const dominant = top.filter((_, i) => beats(i, (r) => r.rate > 0.5))
    const sureDominant = top.filter((_, i) => beats(i, (r) => r.lo > 0.5))
    report.meta = {
      decks: top.map((k) => ({ deck: k, elo: metaElo.get(k), fun: funOf(k, rr) })),
      matrix,
      dominant,
      sureDominant,
    }
    report.starterMirror = funMirror()
  }

  // 局面で見る互換
  if (phases.has('rows')) {
    const field = (report.meta as { decks: { deck: string }[] } | undefined)?.decks.map((d) => d.deck) ?? swapDecks
    const tally = emptyTally()
    const jobs: Promise<void>[] = []
    for (let i = 0; i < num('rows-games'); i++) {
      const a = field[i % field.length]
      const b = field[(i * 7 + 3) % field.length]
      const task: Task = { type: 'rows', decks: [deckOf(a), deckOf(b)], seed: 9000 + i, rate: num('positions') }
      jobs.push(crew.run<RowTally>(task).then((t) => void mergeTally(tally, t)))
    }
    await Promise.all(jobs)
    log(`互換: ${num('rows-games')} 局の局面`)
    report.rows = tally
  }

  // 見積もりの比べ
  if (phases.has('estimates') && num('estimate-games') > 0) report.estimateCheck = await compareEstimates()

  report.elo = [...elo.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([deck, e]) => ({ deck, elo: e, games: games.get(deck) ?? 0 }))
  report.seconds = (Date.now() - started) / 1000
  report.games = crew.done

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'latest.json'), JSON.stringify(report, null, 2))
  writeFileSync(join(OUT, 'latest.md'), renderMarkdown(report as never, { deckName, name }))
  if (opts.md) {
    mkdirSync(dirname(resolve(opts.md)), { recursive: true })
    copyFileSync(join(OUT, 'latest.md'), resolve(opts.md))
  }
  log(`書き出した: ${join(OUT, 'latest.md')}、${crew.done} 局`)
  crew.close()
}

const pct = (x: number) => `${Math.round(x * 100)}%`

/**
 * 差し替えの総当たりから、上位互換の疑いを探す。同じ1枚を替えた二つのデッキ A と B を、共通の相手ごとに比べ、
 * B の方がはっきり悪い相手が無く、平均では B が上回るなら、B は A の上位互換の疑いがある
 */
function replacementCheck(rr: [string, string][]) {
  const decks = [...new Set(rr.flat())]
  const rate = (a: string, b: string) => rateOf(store.pair(a, b), a)
  const out: { context: CardId; from: CardId; to: CardId; mean: number; worse: number; opponents: number }[] = []
  for (const slot of STARTER) {
    const variants: [CardId, string][] = [
      [slot, starter],
      ...EXPANSION.map((e): [CardId, string] => [e, swapped(slot, e)]),
    ]
    for (const [ca, da] of variants)
      for (const [cb, db] of variants) {
        if (da === db) continue
        const opponents = decks.filter((o) => o !== da && o !== db)
        const diffs = opponents.map((o) => {
          const ra = rate(da, o)
          const rb = rate(db, o)
          // 二つの勝率の差を、ばらつきで割った値
          const se =
            Math.sqrt((ra.rate * (1 - ra.rate)) / ra.n + (rb.rate * (1 - rb.rate)) / rb.n) || 1 / Math.sqrt(ra.n)
          return { d: rb.rate - ra.rate, z: (rb.rate - ra.rate) / se }
        })
        const worse = diffs.filter((x) => x.z < -1.96).length
        const m = mean(diffs.map((x) => x.d))
        out.push({ context: slot, from: ca, to: cb, mean: m, worse, opponents: opponents.length })
      }
  }
  return out
}

/** これ以上のターンかかった対局を、長い対局として数える。我慢比べの兆しを見る */
const LONG_TURNS = 8

/** 対局の長さ。平均のターン、引き分けの割合、長い対局の割合 */
function lengthOf(games: GameRecord[]) {
  const n = games.length
  return {
    turns: n > 0 ? mean(games.map((g) => g.turns)) : 0,
    draws: n > 0 ? games.filter((g) => g.winner === 'draw').length / n : 0,
    long: n > 0 ? games.filter((g) => g.turns >= LONG_TURNS).length / n : 0,
  }
}

/** 無作為なデッキどうしの全ての対局の長さ。カードごとの長さと比べる基準 */
function lengthsOf(pairs: [string, string][]) {
  return lengthOf(pairs.flatMap(([a, b]) => Object.values(store.pair(a, b).games)))
}

/** カードごとの、無作為なデッキでの強さへの寄与と、使われ方と、それを持つデッキの対局の長さ */
function cardStats(sample: string[], elo: Map<string, number>, pairs: [string, string][]) {
  const avg = mean(sample.map((k) => elo.get(k) ?? 0))
  return POOL.map((c) => {
    const holders = sample.filter((k) => deckOf(k).includes(c))
    let steps = 0
    let used = 0
    let firstSteps = 0
    let first = 0
    const played: GameRecord[] = []
    for (const [a, b] of pairs) {
      for (const k of [a, b]) {
        if (!deckOf(k).includes(c)) continue
        for (const { g, seat } of gamesOf(store.pair(a, b), k)) {
          const s = g.seats[seat]
          steps += s.steps[0] + s.steps[1]
          firstSteps += s.steps[0]
          used += s.cards[c] ?? 0
          first += s.first[c] ?? 0
          played.push(g)
        }
      }
    }
    return {
      card: c,
      decks: holders.length,
      contribution: mean(holders.map((k) => elo.get(k) ?? 0)) - avg,
      /** 持っている側のステップのうち、このカードを使った割合 */
      usage: steps > 0 ? used / steps : 0,
      /** 持っている側の一ステップ目のうち、このカードを使った割合 */
      firstUsage: firstSteps > 0 ? first / firstSteps : 0,
      /** このカードを持つデッキの対局の長さ。両方が持つ対局は二度数える */
      length: lengthOf(played),
    }
  })
}

/** 一ステップに複数のカードを使う、好きな目のダイス、もう一度出す行動の使われ方。全ての対戦の席から数える */
function mechanicsOf(pairs: [string, string][]) {
  const multi: Record<string, number> = {}
  const wild = [0, 0, 0, 0, 0, 0, 0]
  const echoed: Partial<Record<CardId, number>> = {}
  for (const [a, b] of pairs) {
    for (const g of Object.values(store.pair(a, b).games)) {
      for (const seat of g.seats) {
        for (const [k, n] of Object.entries(seat.multi ?? {})) multi[k] = (multi[k] ?? 0) + n
        seat.wild?.forEach((n, v) => {
          wild[v] += n
        })
        for (const [c, n] of Object.entries(seat.echoed ?? {}) as [CardId, number][]) echoed[c] = (echoed[c] ?? 0) + n
      }
    }
  }
  return { multi, wild, echoed }
}

/** デッキの、上位どうしの対戦での面白さの目安 */
function funOf(key: string, pairs: [string, string][]) {
  const list = pairs.filter(([a, b]) => a === key || b === key).flatMap(([a, b]) => [...gamesOf(store.pair(a, b), key)])
  return funFrom(list)
}

function funFrom(list: { g: GameRecord; seat: 0 | 1 }[]) {
  let steps1 = 0
  let steps2 = 0
  let forced1 = 0
  let forced2 = 0
  let stakes1 = 0
  let stakes2 = 0
  let turns = 0
  let draws = 0
  for (const { g, seat } of list) {
    const s = g.seats[seat]
    steps1 += s.steps[0]
    steps2 += s.steps[1]
    forced1 += s.forced[0]
    forced2 += s.forced[1]
    stakes1 += g.stakes[0]
    stakes2 += g.stakes[1]
    turns += g.turns
    if (g.winner === 'draw') draws++
  }
  return {
    games: list.length,
    forced1: forced1 / steps1,
    forced2: forced2 / steps2,
    stakes1: stakes1 / steps1,
    stakes2: stakes2 / steps2,
    turns: turns / list.length,
    draws: draws / list.length,
  }
}

/** 物差しにする、スターターどうしの面白さの目安。上位の総当たりと同じ数だけ戦わせる */
function funMirror() {
  const entry = store.pair(starter, starter)
  return funFrom([...gamesOf(entry, starter)])
}

/**
 * 見積もりの違うCPUどうしを、同じデッキで戦わせる。持ち越しと凍結を含むデッキで、既定の見積もりが、
 * 見積もりを0にしたものや大きくしたものに負けないかを見る
 */
async function compareEstimates() {
  // 持ち越すカードと凍らせるカードに、スターターを足して5枚にする
  const estimated = POOL.filter((c) => kindsOfCard(c).some((k) => ACTION_DEFS[k].carries || ACTION_DEFS[k].freezes))
  const deck = canonical([...estimated, ...STARTER.slice(0, DECK_SIZE - estimated.length)])
  const variants: Record<string, Estimates> = {
    'carry 0': { ...ESTIMATES, carry: 0 },
    'carry 3': { ...ESTIMATES, carry: 3 },
    'freeze 0': { ...ESTIMATES, freeze: 0 },
    'freeze 2': { ...ESTIMATES, freeze: 2 },
  }
  const out: Record<string, Rate> = {}
  for (const [label, est] of Object.entries(variants)) {
    let score = 0
    const n = num('estimate-games')
    const jobs = Array.from({ length: n }, (_, i) => {
      // 偶数は既定が席0、奇数は席1
      const estimates: [Estimates, Estimates] = i % 2 === 0 ? [ESTIMATES, est] : [est, ESTIMATES]
      const task: Task = { type: 'game', decks: [deck, deck], seed: 7000 + Math.floor(i / 2), estimates }
      return crew.run<GameRecord>(task).then((g) => {
        const mine = i % 2 === 0 ? 0 : 1
        score += g.winner === 'draw' ? 0.5 : g.winner === mine ? 1 : 0
      })
    })
    await Promise.all(jobs)
    out[label] = wilson(score, n)
  }
  log('見積もりの比べ')
  return { deck, variants: out }
}

// スターターどうしの物差しは、上位の総当たりと同じ数だけ戦わせておく
async function prepareMirror() {
  if (!phases.has('meta')) return
  const entry = store.pair(starter, starter)
  const jobs: Promise<void>[] = []
  for (let i = 0; i < num('meta-games'); i++) {
    if (entry.games[i]) continue
    const task: Task = { type: 'game', decks: [STARTER as CardId[], STARTER as CardId[]], seed: seedOf(entry, i) }
    jobs.push(crew.run<GameRecord>(task).then((g) => store.put(starter, starter, i, g)))
  }
  await Promise.all(jobs)
  store.flush()
}

prepareMirror()
  .then(main)
  .catch((e) => {
    console.error(e)
    crew.close()
    process.exitCode = 1
  })
