// 評価の結果を Markdown の表にする。数字は latest.json にもそのまま残す。

import { type CardId, POOL, STARTER } from '../game/cards'
import type { RowTally } from './dominance'
import type { Rate } from './stats'

interface Fun {
  games: number
  forced1: number
  forced2: number
  stakes1: number
  stakes2: number
  turns: number
  draws: number
}

export interface Report {
  cpuVersion: number
  engine: string
  estimates: Record<string, number>
  options: Record<string, unknown>
  seconds: number
  games: number
  swap?: { into: CardId; out: CardId; vsStarter: Rate; elo: number }[]
  swapStarterElo?: number
  replacement?: { context: CardId; from: CardId; to: CardId; mean: number; worse: number; opponents: number }[]
  cards?: { card: CardId; decks: number; contribution: number; usage: number; firstUsage: number }[]
  skips?: { deck: string; reason: string }[]
  meta?: {
    decks: { deck: string; elo: number; fun: Fun }[]
    matrix: (Rate | null)[][]
    dominant: string[]
    sureDominant: string[]
  }
  starterMirror?: Fun
  rows?: RowTally
  estimateCheck?: { deck: CardId[]; variants: Record<string, Rate> }
  mechanics?: { multi: Record<string, number>; wild: number[]; echoed: Partial<Record<CardId, number>> }
  elo: { deck: string; elo: number; games: number }[]
}

interface Names {
  deckName: (key: string) => string
  name: (c: CardId) => string
}

/** 数えるものが無くて求まらない値は — と書く */
const known = (x: number, text: (x: number) => string) => (Number.isFinite(x) ? text(x) : '—')
const pct = (x: number) => known(x, (v) => `${Math.round(v * 100)}%`)
const signed = (x: number) => known(x, (v) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`)
const fixed = (x: number, d = 2) => known(x, (v) => v.toFixed(d))

/** 勝率と区間。区間が 0.5 より上なら太字、下なら斜体 */
function rate(r: Rate): string {
  const text = `${pct(r.rate)} (${pct(r.lo)}–${pct(r.hi)})`
  if (r.lo > 0.5) return `**${text}**`
  if (r.hi < 0.5) return `*${text}*`
  return text
}

const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join(
    '\n',
  )

export function renderMarkdown(r: Report, { deckName, name }: Names): string {
  const out: string[] = []
  out.push('# カードの強さの評価')
  out.push(
    `CPU の版 ${r.cpuVersion}、対局の中身の指紋 \`${r.engine}\`、見積もり ${JSON.stringify(r.estimates)}。` +
      `この回に戦わせた ${r.games} 局、${Math.round(r.seconds)} 秒。記録にあった組は測り直していない。`,
  )
  out.push(`設定: \`${JSON.stringify(r.options)}\``)

  if (r.swap) {
    out.push('## 差し替え: スターター相手の勝率')
    out.push(
      'スターターの1枚 (列) を拡張のカード (行) に替えたデッキが、スターターと戦った勝率と 95% 区間。' +
        '太字は勝ち越し、斜体は負け越しがはっきりしたもの。Elo は差し替えたデッキどうしとスターターの総当たりの強さで、スターターを0とする。',
    )
    const expansion = POOL.filter((c) => !STARTER.includes(c))
    const base = r.swapStarterElo ?? 0
    const rows = expansion.map((into) => {
      const cells = STARTER.map((out) => r.swap?.find((s) => s.into === into && s.out === out))
      const elos = cells.map((c) => (c?.elo ?? 0) - base)
      return [
        name(into),
        ...cells.map((c) => (c ? `${rate(c.vsStarter)} ${signed((c.elo ?? 0) - base)}` : '')),
        signed(elos.reduce((a, b) => a + b, 0) / elos.length),
      ]
    })
    out.push(table(['入れたカード', ...STARTER.map((c) => `${name(c)}を抜く`), 'Elo 平均'], rows))
  }

  if (r.cards) {
    out.push('## カードごとの寄与と使われ方')
    out.push(
      '無作為な5枚のデッキでの強さ。寄与はそのカードを含むデッキの Elo の平均から、全体の平均を引いたもの。' +
        '使用率は、そのカードを持っている側のステップのうち、そのカードを使った割合。一手目は一ステップ目だけで数えた割合。',
    )
    const rows = [...r.cards]
      .sort((a, b) => b.contribution - a.contribution)
      .map((c) => [name(c.card), signed(c.contribution), pct(c.usage), pct(c.firstUsage), String(c.decks)])
    out.push(table(['カード', '寄与', '使用率', '一手目の使用率', '含むデッキ'], rows))
  }

  if (r.meta) {
    const { meta } = r
    out.push('## 上位のデッキ')
    out.push(
      '全ての対戦から求めた強さの上位と、スターター。上位どうしの総当たりの Elo と、面白さの目安。' +
        '一択率は、最適戦略がほぼ一つの手に決まって読み合いの無かったステップの割合。' +
        '賭け金は、読みが当たるか外れるかで動く得点の、最適戦略での平均。',
    )
    const rows = meta.decks.map((d, i) => [
      String(i + 1),
      deckName(d.deck),
      signed(d.elo),
      pct(d.fun.forced1),
      pct(d.fun.forced2),
      fixed(d.fun.stakes1),
      fixed(d.fun.stakes2),
      fixed(d.fun.turns, 1),
      pct(d.fun.draws),
    ])
    if (r.starterMirror) {
      const f = r.starterMirror
      rows.push([
        '',
        'スターターどうし',
        '',
        pct(f.forced1),
        pct(f.forced2),
        fixed(f.stakes1),
        fixed(f.stakes2),
        fixed(f.turns, 1),
        pct(f.draws),
      ])
    }
    out.push(
      table(
        [
          '#',
          'デッキ',
          'Elo',
          '一手目の一択率',
          '二手目の一択率',
          '一手目の賭け金',
          '二手目の賭け金',
          'ターン',
          '引き分け',
        ],
        rows,
      ),
    )
    out.push('### 相性表')
    out.push('行のデッキが列のデッキと戦った勝率。')
    out.push(
      table(
        ['', ...meta.decks.map((_, i) => String(i + 1))],
        meta.matrix.map((row, i) => [String(i + 1), ...row.map((c) => (c ? rate(c) : '—'))]),
      ),
    )
    const all = meta.sureDominant.length > 0 ? meta.sureDominant : meta.dominant
    out.push(
      all.length === 0
        ? '全てに勝ち越すデッキは無い。'
        : `全てに勝ち越すデッキ${meta.sureDominant.length > 0 ? ' (区間でもはっきり)' : ''}: ${all.map(deckName).join('、')}`,
    )
  }

  if (r.mechanics) {
    const { multi, wild, echoed } = r.mechanics
    const share = (n: number, all: number) => `${pct(n / all)} (${n})`
    out.push('## 新しい仕組みの使われ方')
    out.push(
      '全ての対戦で、行動の回数を増やすカードを使ったステップに使ったカードの枚数、好きな目のダイスに選んだ目、' +
        'もう一度出す行動が繰り返した効果のカード。',
    )
    const uses = Object.values(multi).reduce((a, b) => a + b, 0)
    const chosen = wild.reduce((a, b) => a + b, 0)
    const repeated = Object.values(echoed).reduce((a, b) => a + (b ?? 0), 0)
    const echoRows = (Object.entries(echoed) as [CardId, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => [name(c), share(n, repeated)])
    out.push(
      uses === 0
        ? '一ステップに複数のカードを使ったステップは無い。'
        : table(
            ['使ったカード', '割合'],
            Object.entries(multi)
              .sort()
              .map(([k, n]) => [`${k}枚`, share(n, uses)]),
          ),
    )
    out.push(
      chosen === 0
        ? '好きな目のダイスに目を選んだことは無い。'
        : table(
            ['選んだ目', '割合'],
            [1, 2, 3, 4, 5, 6].map((v) => [String(v), share(wild[v], chosen)]),
          ),
    )
    out.push(repeated === 0 ? 'もう一度出した効果は無い。' : table(['繰り返した効果', '割合'], echoRows))
  }

  if (r.rows) {
    out.push('## 互換の疑い: 局面')
    out.push(
      '対局の途中の局面で、その局面だけ全てのカードを持っているとして行列ゲームを作り、' +
        '行動の回数を増やすカードは、一緒に使う手がほかのカードの効果を含んでしまうので、全てのカードに入れない。' +
        'A の行動の行が全て B の行動の行のどれかに弱く支配された局面の割合。A を使えた局面だけを数える。80% 以上を並べる。',
    )
    const rows: string[][] = []
    for (const a of POOL) {
      const n = r.rows.applicable[a] ?? 0
      for (const b of POOL) {
        const d = r.rows.dominated[a]?.[b] ?? 0
        if (n >= 5 && d / n >= 0.8) rows.push([name(a), name(b), `${d}/${n}`, pct(d / n)])
      }
    }
    rows.sort((x, y) => Number.parseFloat(y[3]) - Number.parseFloat(x[3]))
    out.push(rows.length === 0 ? '該当なし。' : table(['A (下)', 'B (上)', '局面', '割合'], rows))
  }

  if (r.replacement) {
    out.push('## 互換の疑い: 差し替え')
    out.push(
      '同じ1枚を A から B に替えたデッキを、総当たりの共通の相手ごとに比べた。' +
        'B の方がはっきり悪い (z < −1.96) 相手が一つも無く、平均で B が 5 ポイント以上上回る組のうち、' +
        '抜いたカードの5通りの文脈の3つ以上で疑いが出たものを並べる。',
    )
    const flagged = r.replacement.filter((x) => x.worse === 0 && x.mean > 0.05)
    const byPair = new Map<string, { from: CardId; to: CardId; contexts: CardId[]; mean: number[] }>()
    for (const x of flagged) {
      const k = `${x.from}>${x.to}`
      const e = byPair.get(k) ?? { from: x.from, to: x.to, contexts: [], mean: [] }
      e.contexts.push(x.context)
      e.mean.push(x.mean)
      byPair.set(k, e)
    }
    const rows = [...byPair.values()]
      .filter((e) => e.contexts.length >= 3)
      .sort((a, b) => b.contexts.length - a.contexts.length)
      .map((e) => [
        name(e.from),
        name(e.to),
        String(e.contexts.length),
        e.contexts.map(name).join('・'),
        `+${Math.round((e.mean.reduce((a, b) => a + b, 0) / e.mean.length) * 100)}`,
      ])
    out.push(
      rows.length === 0
        ? '該当なし。'
        : table(['A (下)', 'B (上)', '文脈の数', '抜いたカード', '平均の差 (ポイント)'], rows),
    )
  }

  if (r.estimateCheck) {
    const check = r.estimateCheck
    out.push('## 見積もりの比べ')
    out.push(
      `${check.deck.map(name).join('・')} の同じデッキどうしで、既定の見積もりの CPU が、見積もりを変えた CPU と戦った勝率。`,
    )
    out.push(
      table(
        ['相手の見積もり', '既定の勝率'],
        Object.entries(check.variants).map(([k, v]) => [k, rate(v)]),
      ),
    )
  }

  if (r.skips && r.skips.length > 0) {
    out.push('## 見送ったデッキ')
    out.push('明らかに弱いので、カードが変わるまで無作為の評価から外すデッキ。')
    out.push(
      table(
        ['デッキ', '理由'],
        r.skips.map((s) => [deckName(s.deck), s.reason]),
      ),
    )
  }

  out.push('## 全体の強さ')
  out.push('全ての対戦から求めた Elo の上位20と下位10。')
  const pick = [...r.elo.slice(0, 20), ...(r.elo.length > 30 ? r.elo.slice(-10) : [])]
  out.push(
    table(
      ['デッキ', 'Elo', '対戦数'],
      pick.map((e) => [deckName(e.deck), signed(e.elo), String(e.games)]),
    ),
  )
  return `${out.join('\n\n')}\n`
}
