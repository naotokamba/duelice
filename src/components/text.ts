// 画面に出す文。対局の記録や決定できない理由は文を持たないので、ここで見ている側から文にする。

import { ACTION_DEFS } from '../game/cards'
import type { Issue } from '../game/hand'
import { partsOf } from '../game/rules'
import type { Action, Move, PlayerIndex, StepReport, Strike } from '../game/types'
import type { EndReason } from '../online/protocol'

/** 公開や履歴に出す行動の名前 */
export function actionLabel(a: Action): string {
  return a.kind === 'pass' ? '何もしない' : ACTION_DEFS[a.kind].label
}

/**
 * ステップの記録の、who の行動の名前。一緒に使ったカードは「・」でつなぎ、
 * 直前の効果をもう一度出したカードは、出した効果を「→」の後に並べる
 */
export function playLabel(report: StepReport, who: PlayerIndex): string {
  const a = report.actions[who]
  if (a.kind === 'pass') return actionLabel(a)
  const echoed = report.moves[who].filter((m) => m.echoed).map((m) => ACTION_DEFS[m.kind].label)
  return partsOf(a)
    .map((x) => {
      const label = ACTION_DEFS[x.kind].label
      return ACTION_DEFS[x.kind].echo && echoed.length > 0 ? `${label}→${echoed.join('・')}` : label
    })
    .join('・')
}

/** 効果を一文にする。s はその効果が放った攻撃か、守りが返したダメージ */
function moveLine(report: StepReport, who: PlayerIndex, name: string, m: Move, s: Strike | undefined): string {
  const def = ACTION_DEFS[m.kind]
  const other: PlayerIndex = who === 0 ? 1 : 0
  const done = `${name}は ${m.vals.join('と')} で${def.done ?? def.label}`
  if (!s) return done
  // 攻撃を受けた側の構え。守りか、攻撃を返す構えか、打ち消す構え
  const stances = liveMoves(report, other).filter((x) => {
    const d = ACTION_DEFS[x.kind]
    return d.guard || d.reflects || d.cancels !== undefined
  })
  const answer = stances.map((x) => ACTION_DEFS[x.kind].label).join('と')
  const head = `${name}の${def.label} ${s.power}点`
  switch (s.outcome) {
    case 'pierced':
      return `${head}、${answer}をすり抜けた`
    case 'reflected':
      return `${head}、${answer}に返されて自分が ${s.dealt}点受けた`
    case 'countered': {
      const by = stances.filter((x) => ACTION_DEFS[x.kind].cancels !== undefined)
      return `${head}、${by.map((x) => ACTION_DEFS[x.kind].label).join('と')}に打ち消された`
    }
    case 'guarded': {
      const guards = stances.filter((x) => ACTION_DEFS[x.kind].guard)
      const vals = guards.flatMap((x) => x.vals)
      return `${head}、${guards.map((x) => ACTION_DEFS[x.kind].label).join('と')} ${vals.join('と')} に削られて ${s.dealt}点`
    }
    case 'returned':
      // 守りや打ち消す構えが攻撃を受けて返した。構えた目も添える
      return `${done}。${s.dealt}点を返した`
    default:
      return head
  }
}

/**
 * who の行動を文にする。効果ごとに一文で、放った攻撃はその行方まで書く。
 * 一緒に使ったカードがあれば、その前に何を一緒に使ったかを、直前の効果をもう一度出したなら、何を出したかを書く
 */
function sentences(report: StepReport, who: PlayerIndex, name: string): string[] {
  const a = report.actions[who]
  if (a.kind === 'pass') return [`${name}は何もしなかった`]
  const lines: string[] = []
  const parts = partsOf(a)
  const more = parts.slice(1).map((x) => ACTION_DEFS[x.kind].label)
  if (more.length > 0) lines.push(`${name}は${ACTION_DEFS[a.kind].label}で、${more.join('と')}を一緒に使った`)
  const echoed = report.moves[who].filter((m) => m.echoed)
  if (echoed.length > 0) {
    const what = echoed.map((m) => ACTION_DEFS[m.kind].label).join('と')
    lines.push(
      `${name}は${parts.map((x) => ACTION_DEFS[x.kind]).find((d) => d.echo)?.label}で、${what}をもう一度出した`,
    )
  }
  if (report.cancelled[who]) lines.push(`${name}は先に倒れて、${playLabel(report, who)}は起きなかった`)
  // 効果ごとに、その効果が放った攻撃か、守りが返したダメージを、記録の順に一つずつ結びつける
  const taken = new Set<Strike>()
  const strikeOf = (m: Move) => {
    const def = ACTION_DEFS[m.kind]
    const s = report.strikes.find(
      (x) =>
        !taken.has(x) &&
        x.from === who &&
        x.phase !== 'end' &&
        x.kind === m.kind &&
        (x.outcome === 'returned') === !def.power,
    )
    if (s) taken.add(s)
    return s
  }
  for (const m of liveMoves(report, who)) {
    // 行動の回数を増やすカードの効果は、何を一緒に使ったかを前に書いたので、ここでは書かない
    if (ACTION_DEFS[m.kind].multi) continue
    lines.push(moveLine(report, who, name, m, strikeOf(m)))
  }
  return lines
}

/** 決着した後に中央に大きく出す勝敗。見ている側から、勝ち、負け、引き分けのどれかだけを短く書き、どの幅でも1行に収める */
export function resultText(winner: PlayerIndex | 'draw', viewer: PlayerIndex): string {
  if (winner === 'draw') return '引き分け'
  return winner === viewer ? '勝ち' : '負け'
}

/**
 * 決着の詳しい文。戦闘履歴に出す。同時に体力が0以下になって決着したときは相打ちと書き、
 * はみ出した体力を見ている側から並べて、残りの多い方の勝ちか、同じで引き分けかを示す。
 * 持ち時間切れか降参で決着したときは、その理由を書く
 */
export function endingText(
  winner: PlayerIndex | 'draw',
  hp: [number, number],
  viewer: PlayerIndex,
  reason: EndReason = 'hp',
): string {
  const result = winner === 'draw' ? '引き分け' : winner === viewer ? 'あなたの勝ち' : 'あなたの負け'
  if (reason === 'timeout') return `時間切れで、${result}`
  if (reason === 'resign') return `降参で、${result}`
  const mine = hp[viewer]
  const theirs = hp[viewer === 0 ? 1 : 0]
  if (mine > 0 || theirs > 0) return result
  return `相打ち。${signed(mine)} 対 ${signed(theirs)} で、${result}`
}

/** 体力の数。マイナスは記号の − で書く */
const signed = (n: number) => (n < 0 ? `−${-n}` : String(n))

/** who の起きた効果。先に当たる攻撃で倒れた側は、先に当たる攻撃のほかは起きない */
function liveMoves(report: StepReport, who: PlayerIndex): Move[] {
  return report.moves[who].filter((m) => !report.cancelled[who] || ACTION_DEFS[m.kind].fast)
}

/**
 * who の構えのうち、攻撃が来ずに外して、自分が受けた構え。返す構えは返した攻撃が、打ち消す構えは打ち消した攻撃が一つも無かったもの
 */
function missedWards(report: StepReport, who: PlayerIndex): Move[] {
  const reflected = report.strikes.some((s) => s.outcome === 'reflected' && s.from !== who)
  const countered = report.strikes.some((s) => s.outcome === 'countered' && s.to === who)
  return liveMoves(report, who).filter((m) => {
    const def = ACTION_DEFS[m.kind]
    if (!def.missBurn || def.missBurn(m.vals) <= 0) return false
    return !((def.reflects && reflected) || (def.cancels !== undefined && countered))
  })
}

/**
 * ステップの記録を、viewer から見た文にする。自分をあなた、相手を相手と呼び、自分、相手の順に一行ずつ並べる。
 * 守りがダメージを返したならそれを、詠唱したならその結果を、自分も受けたダメージがあればその量を、後に添える
 */
export function reportLines(report: StepReport, viewer: PlayerIndex): string[] {
  const order: [PlayerIndex, string][] = [
    [viewer, 'あなた'],
    [viewer === 0 ? 1 : 0, '相手'],
  ]
  const lines = order.flatMap(([who, name]) => sentences(report, who, name))
  for (const [who, name] of order) {
    const chant = report.chants[who]
    // 詠唱は、相手の詠唱を崩す効果でだけ崩れる
    const other: PlayerIndex = who === 0 ? 1 : 0
    const breaker = liveMoves(report, other).find((m) => ACTION_DEFS[m.kind].disrupts)
    const by = breaker ? ACTION_DEFS[breaker.kind].label : actionLabel(report.actions[other])
    if (chant === 'broken') lines.push(`${name}の詠唱は${by}で崩れた`)
    if (chant === 'kept') lines.push(`${name}の詠唱は保たれた`)
  }
  for (const [who, name] of order) {
    // 凍らせる攻撃を受けた側は、次のステップに凍らされた目を置けない。凍らせるのは印の置き場の目
    // 凍らせる効果が重なれば、大きい目を凍らせる
    const frost = liveMoves(report, who === 0 ? 1 : 0)
      .filter((m) => ACTION_DEFS[m.kind].freezes)
      .map((m) => m.vals[0])
    if (frost.length > 0) lines.push(`${name}は次のステップに ${Math.max(...frost)} の目を置けない`)
  }
  for (const [who, name] of order) {
    // 自分が受けた分のうち、炎で焼けた分と、構えに攻撃が来ずに受けた分を分けて書く
    const live = liveMoves(report, who)
    const burners = live.filter((m) => (ACTION_DEFS[m.kind].burn?.(m.vals) ?? 0) > 0)
    const burnt = burners.reduce((sum, m) => sum + (ACTION_DEFS[m.kind].burn?.(m.vals) ?? 0), 0)
    const by = [...new Set(burners.map((m) => ACTION_DEFS[m.kind].label))].join('と')
    if (burnt > 0) lines.push(`${name}は${by}で自分も ${burnt}点受けた`)
    for (const m of missedWards(report, who)) {
      const def = ACTION_DEFS[m.kind]
      const what = def.cancels === undefined ? '返す' : '打ち消す'
      lines.push(`${name}の${def.label}に${what}攻撃が来ず、自分が ${def.missBurn?.(m.vals)}点受けた`)
    }
    if (report.refunded[who]) lines.push(`${name}は防ぎきって、ダイスが戻った`)
    const added = report.added[who]
    if (added.length > 0) {
      const kinds = [...new Set(added)].map((v) => `${v} のダイスを${added.filter((x) => x === v).length}個`)
      lines.push(`${name}は ${kinds.join('と、')}足した`)
    }
  }
  for (const [who, name] of order) {
    const late = report.endBurn[who]
    if (late > 0) lines.push(`ターンの終わりに、${name}は自分も ${late}点受けた`)
  }
  for (const s of report.strikes.filter((x) => x.phase === 'end')) {
    const name = s.from === viewer ? 'あなた' : '相手'
    lines.push(`ターンの終わりに、${name}の${ACTION_DEFS[s.kind].label} ${s.dealt}点`)
  }
  return lines
}

/** 決まった理由に当たらない置き方 */
export const CANNOT_USE = 'この置き方では使えない'

/** 決定できない理由を、決定の場所に出す短い文にする */
export function issueText(issue: Issue): string {
  switch (issue.type) {
    case 'mark':
      return `${issue.mark} の枠に置く`
    case 'more':
      return `${issue.same ? '同じ目を' : ''}あと${issue.count}個置く`
    case 'left':
      return '左の枠に置く'
    case 'same':
      return `同じ目を${issue.count}個置く`
    case 'pick':
      return '好きな目を選ぶ'
    case 'with':
      return 'ほかのカードにも置く'
    default:
      return CANNOT_USE
  }
}
