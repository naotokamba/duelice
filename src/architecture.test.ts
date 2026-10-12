// 構成の決まりを、文で頼むかわりにテストで守る。
// 対局の中身 src/game はオンライン対戦でサーバがそのまま動かすので、画面にも時刻にも乱数の既定値にも頼らない。
// カードの知識は cards.ts の表に集め、ほかのファイルはカードを名前で呼ばずに表の性質で分岐する。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { NARROW_QUERY } from './components/useNarrow'
import { ACTION_DEFS, ACTION_KINDS, CARD_DEFS, CARD_ORDER } from './game/cards'

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

describe('カードの知識', () => {
  it('cards.ts のほかでは、カードや行動を名前で呼ばない', () => {
    const ids = new Set<string>([...CARD_ORDER, ...ACTION_KINDS])
    const names = [...CARD_ORDER.map((c) => CARD_DEFS[c].name), ...ACTION_KINDS.map((k) => ACTION_DEFS[k].label)]
    const found: string[] = []
    for (const file of [...sources('game'), ...sources('components')]) {
      if (file.endsWith(join('game', 'cards.ts'))) continue
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
    for (const card of CARD_ORDER) {
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
