// 構成の決まりを、文で頼むかわりにテストで守る。
// 対局の中身 src/game はオンライン対戦でサーバがそのまま動かすので、画面にも時刻にも乱数の既定値にも頼らない。
// カードの知識は cards.ts の表に集め、ほかのファイルはカードを名前で呼ばずに表の性質で分岐する。
// 評価で選んだデッキの表 decks.ts は、カードを名前で並べるだけの表なので、名前で呼んでよい。

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { NARROW_QUERY } from './components/useNarrow'
import { ACTION_DEFS, ACTION_KINDS, CARD_DEFS, POOL } from './game/cards'

const SRC = join(import.meta.dirname)

/** dir の下の、テストでないソースファイル */
function sources(dir: string): string[] {
  return readdirSync(join(SRC, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(SRC, dir, f))
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
}

/** ファイルの中の全ての節 */
function* nodes(n: ts.Node): Generator<ts.Node> {
  yield n
  for (const c of n.getChildren()) yield* nodes(c)
}

/** 違反を「ファイル:行 内容」の形で並べる */
function where(sf: ts.SourceFile, n: ts.Node, what: string): string {
  const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
  return `${relative(SRC, sf.fileName)}:${line} ${what}`
}

describe('対局の中身', () => {
  it('src/game は画面の部品にも、時刻にも、乱数の既定値にも、画面の外の世界にも頼らない', () => {
    const banned = new Set(['document', 'window', 'localStorage', 'setTimeout', 'setInterval', 'requestAnimationFrame'])
    const bannedCalls = new Set(['Math.random', 'Date.now', 'performance.now'])
    const found: string[] = []
    for (const file of sources('game')) {
      const sf = parse(file)
      for (const n of nodes(sf)) {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
          const from = n.moduleSpecifier.text
          if (!from.startsWith('./')) found.push(where(sf, n, `import ${from}`))
        }
        if (ts.isIdentifier(n) && banned.has(n.text)) found.push(where(sf, n, n.text))
        if (ts.isPropertyAccessExpression(n) && bannedCalls.has(n.getText())) found.push(where(sf, n, n.getText()))
      }
    }
    expect(found).toEqual([])
  })
})

/** ファイルの import 先。相対の import は src からの道に直す。例 game/match */
function imports(file: string): { sf: ts.SourceFile; n: ts.Node; from: string }[] {
  const sf = parse(file)
  const list: { sf: ts.SourceFile; n: ts.Node; from: string }[] = []
  for (const n of nodes(sf)) {
    if (!(ts.isImportDeclaration(n) || ts.isExportDeclaration(n))) continue
    const spec = n.moduleSpecifier
    if (!spec || !ts.isStringLiteral(spec)) continue
    const from = spec.text.startsWith('.') ? relative(SRC, resolve(dirname(file), spec.text)) : spec.text
    list.push({ sf, n, from })
  }
  return list
}

/** 時刻と乱数を、外から受け取らずに作る呼び出し */
const CLOCK_AND_RANDOM = new Set([
  'Math.random',
  'Date.now',
  'performance.now',
  'crypto.getRandomValues',
  'crypto.randomUUID',
])

describe('オンライン対戦', () => {
  it('取り決め src/online は対局の中身だけを読み、サーバにも画面にも Cloudflare にも頼らない', () => {
    const found = sources('online').flatMap((file) =>
      imports(file)
        .filter(({ from }) => !from.startsWith('game/') && !from.startsWith('online/'))
        .map(({ sf, n, from }) => where(sf, n, `import ${from}`)),
    )
    expect(found).toEqual([])
  })

  it('サーバ src/server は画面の部品も React も読まない', () => {
    const found = sources('server').flatMap((file) =>
      imports(file)
        .filter(({ from }) => from.startsWith('components/') || from.startsWith('routes/') || from.startsWith('react'))
        .map(({ sf, n, from }) => where(sf, n, `import ${from}`)),
    )
    expect(found).toEqual([])
  })

  it('部屋とロビーの中身は、時刻も乱数も外から受け取る。Cloudflare に触るのは Durable Object の殻 *-object.ts だけ', () => {
    const found: string[] = []
    for (const file of sources('server')) {
      if (file.endsWith('-object.ts')) continue
      for (const { sf, n, from } of imports(file)) if (from.startsWith('cloudflare:')) found.push(where(sf, n, from))
      const sf = parse(file)
      for (const n of nodes(sf)) {
        if (ts.isPropertyAccessExpression(n) && CLOCK_AND_RANDOM.has(n.getText())) found.push(where(sf, n, n.getText()))
      }
    }
    expect(found).toEqual([])
  })

  it('評価 src/eval は対局の中身と node だけを読み、画面もサーバも読まない', () => {
    const found = sources('eval').flatMap((file) =>
      imports(file)
        .filter(({ from }) => !from.startsWith('game/') && !from.startsWith('eval/') && !from.startsWith('node:'))
        .map(({ sf, n, from }) => where(sf, n, `import ${from}`)),
    )
    expect(found).toEqual([])
  })

  it('画面 src/components はサーバのコードも Cloudflare も読まない', () => {
    const found = sources('components').flatMap((file) =>
      imports(file)
        .filter(({ from }) => from === 'server' || from.startsWith('server/') || from.startsWith('cloudflare:'))
        .map(({ sf, n, from }) => where(sf, n, `import ${from}`)),
    )
    expect(found).toEqual([])
  })
})

describe('カードの知識', () => {
  it('cards.ts と、デッキの表 decks.ts のほかでは、カードや行動を名前で呼ばない', () => {
    const ids = new Set<string>([...POOL, ...ACTION_KINDS])
    const names = [...POOL.map((c) => CARD_DEFS[c].name), ...ACTION_KINDS.map((k) => ACTION_DEFS[k].label)]
    const found: string[] = []
    for (const file of [...sources('game'), ...sources('components'), ...sources('eval')]) {
      if (file.endsWith(join('game', 'cards.ts')) || file.endsWith(join('game', 'decks.ts'))) continue
      const sf = parse(file)
      for (const n of nodes(sf)) {
        const text =
          ts.isStringLiteralLike(n) ||
          ts.isTemplateHead(n) ||
          ts.isTemplateMiddle(n) ||
          ts.isTemplateTail(n) ||
          ts.isJsxText(n)
            ? n.text
            : undefined
        if (text === undefined) continue
        if (ids.has(text) || names.some((name) => text.includes(name))) found.push(where(sf, n, JSON.stringify(text)))
      }
    }
    expect(found).toEqual([])
  })
})

describe('画面', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')

  it('狭い画面の境目は、styles.css と useNarrow.ts で同じ', () => {
    expect(css).toContain(`@media ${NARROW_QUERY}`)
  })

  it('どのカードにも、明るい画面と暗い画面の色があり、カードの面と矢印の色につながっている', () => {
    const light = css.match(/^:root\s*\{([^}]*)\}/m)?.[1] ?? ''
    const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? ''
    const missing: string[] = []
    for (const card of POOL) {
      // 帯や矢印の鮮やかな色と、背景に対して読める文字の色
      for (const name of [`--${card}:`, `--${card}-ink:`]) {
        if (!light.includes(name)) missing.push(`明るい画面の ${name}`)
        if (!dark.includes(name)) missing.push(`暗い画面の ${name}`)
      }
      const face = css.match(new RegExp(`\\.card-${card}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
      for (const use of [
        `--spell: var(--${card})`,
        `--spell-ink: var(--${card}-ink)`,
        `--card-ink: var(--${card}-ink)`,
      ]) {
        if (!face.includes(use)) missing.push(`.card-${card} の ${use}`)
      }
    }
    expect(missing).toEqual([])
  })
})
