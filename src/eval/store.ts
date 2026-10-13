// 評価の記録の置き場。対戦の結果は、二つのデッキと、カードの定義の指紋と、対局の中身とCPUの指紋と、種ごとに覚える。
// カードの定義を変えると、そのカードを含む組の指紋だけが変わり、その組だけを測り直す。
// 置き場は reports/eval の下で、git には入れない。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ACTION_DEFS, CARD_DEFS, type CardId, kindsOfCard, POOL } from '../game/cards'
import { CPU_VERSION } from '../game/cpu'
import type { GameRecord } from './game'

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** 定義の中の関数も、書かれた式ごと指紋に含める */
const serialize = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === 'function' ? `fn:${v.toString()}` : v))

/** カードの指紋。名前と、そのカードの全ての行動の定義から作る */
export function cardFingerprint(card: CardId): string {
  return hash(serialize([CARD_DEFS[card], kindsOfCard(card).map((k) => ACTION_DEFS[k])]))
}

/** 対局の中身とCPUのソースの置き場。ここのファイルが変わると、全ての記録を取り直す */
const ENGINE = ['rules.ts', 'match.ts', 'cpu.ts', 'matrixGame.ts', 'types.ts', 'slots.ts']

/** 対局の中身とCPUの指紋。CPU の版も含める */
export function engineFingerprint(root: string): string {
  const sources = ENGINE.map((f) => readFileSync(join(root, 'src', 'game', f), 'utf8'))
  return hash(serialize([CPU_VERSION, sources]))
}

/** 並びを選べるカードの順にそろえたデッキ。並びは強さに関わらないので、同じ5枚は同じデッキとして数える */
export function canonical(deck: readonly CardId[]): CardId[] {
  return [...deck].sort((a, b) => POOL.indexOf(a) - POOL.indexOf(b))
}

/** デッキの名前。そろえた並びをつなぐ */
export const deckKey = (deck: readonly CardId[]) => canonical(deck).join('+')

/** デッキを名前から戻す */
export const deckOf = (key: string) => key.split('+') as CardId[]

/** 組の記録。first が組の最初のデッキで、名前の順に並べる */
export interface PairEntry {
  first: string
  second: string
  /** 種の番号ごとの一局。偶数の番号は first が席0、奇数は second が席0 */
  games: Record<number, GameRecord>
}

/** 記録の置き場 */
export class Store {
  private dir: string
  private engine: string
  private cards = new Map<CardId, string>()
  private pairs = new Map<string, PairEntry>()
  private dirty = new Set<string>()

  constructor(root: string) {
    this.dir = join(root, 'reports', 'eval', 'cache')
    this.engine = engineFingerprint(root)
    for (const c of POOL) this.cards.set(c, cardFingerprint(c))
  }

  /** 組の記録の名前。二つのデッキと、そのカードの指紋と、対局の中身の指紋から作る */
  fileOf(a: string, b: string, tag = ''): string {
    const [first, second] = [a, b].sort()
    const fps = [first, second].map((k) => deckOf(k).map((c) => this.cards.get(c)))
    return join(this.dir, `${hash(serialize([first, second, fps, this.engine, tag]))}.json`)
  }

  /** 組の記録。無ければ空の記録 */
  pair(a: string, b: string, tag = ''): PairEntry {
    const file = this.fileOf(a, b, tag)
    const hit = this.pairs.get(file)
    if (hit) return hit
    const [first, second] = [a, b].sort()
    const entry: PairEntry = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as PairEntry)
      : { first, second, games: {} }
    this.pairs.set(file, entry)
    return entry
  }

  /** 一局の結果を覚える。書き出すのは flush のとき */
  put(a: string, b: string, index: number, record: GameRecord, tag = '') {
    this.pair(a, b, tag).games[index] = record
    this.dirty.add(this.fileOf(a, b, tag))
  }

  /** 覚えた結果のうち、まだ書き出していないものを書き出す */
  flush() {
    for (const file of this.dirty) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(this.pairs.get(file)))
    }
    this.dirty.clear()
  }

  /** カードの指紋 */
  fingerprint(card: CardId): string {
    return this.cards.get(card) as string
  }

  get engineId(): string {
    return this.engine
  }
}

/** 組の種の番号 index で、席0に座るデッキ。偶数なら名前の順の最初 */
export function seatsOf(entry: Pick<PairEntry, 'first' | 'second'>, index: number): [string, string] {
  return index % 2 === 0 ? [entry.first, entry.second] : [entry.second, entry.first]
}

/** 組の種の番号 index の一局に使う乱数の種。席を入れ替えた二局は同じ種で、同じダイスを振る */
export function seedOf(entry: Pick<PairEntry, 'first' | 'second'>, index: number): number {
  const h = createHash('sha256').update(`${entry.first}|${entry.second}`).digest()
  return (h.readUInt32LE(0) + Math.floor(index / 2) * 2654435761) >>> 0
}
