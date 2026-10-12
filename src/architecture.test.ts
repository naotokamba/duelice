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
  it('狭い画面の境目は、styles.css と useNarrow.ts で同じ', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
    expect(css).toContain(`@media ${NARROW_QUERY}`)
  })
})
