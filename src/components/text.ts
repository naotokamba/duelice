// 画面に出す文。対局の記録や決定できない理由は文を持たないので、ここで見ている側から文にする。

import { ACTION_DEFS } from '../game/cards'
import type { Issue } from '../game/hand'
import type { Action, PlayerIndex, StepReport } from '../game/types'

/** 公開や履歴に出す行動の名前 */
export function actionLabel(a: Action): string {
  return a.kind === 'pass' ? '何もしない' : ACTION_DEFS[a.kind].label
}

/** who の行動を一文にする */
function sentence(report: StepReport, who: PlayerIndex, name: string): string {
  const a = report.actions[who]
  if (a.kind === 'pass') return `${name}は何もしなかった`
  const def = ACTION_DEFS[a.kind]
  const other: PlayerIndex = who === 0 ? 1 : 0
  const b = report.actions[other]
  const answer = b.kind === 'pass' ? '' : ACTION_DEFS[b.kind].label
  const s = report.strikes.find((x) => x.from === who)
  const done = `${name}は ${report.values[who].join('と')} で${def.done ?? def.label}`
  if (!s) return done
  const head = `${name}の${def.label} ${s.power}点`
  switch (s.outcome) {
    case 'pierced':
      return `${head}、${answer}をすり抜けた`
    case 'guarded':
      return `${head}、${answer} ${report.values[other].join('と')} に削られて ${s.dealt}点`
    case 'returned':
      // 守りが攻撃を受けて返した。守った目も添える
      return `${done}。${s.dealt}点を返した`
    default:
      return head
  }
}

/** 勝敗の文。同時に体力が0以下になって決着したときは、はみ出した体力を見ている側から並べて示す */
export function resultText(winner: PlayerIndex | 'draw', hp: [number, number], viewer: PlayerIndex): string {
  if (winner === 'draw') return '相打ち。引き分けです'
  const who = winner === viewer ? 'あなたの勝ち' : '相手の勝ち'
  const mine = hp[viewer]
  const theirs = hp[viewer === 0 ? 1 : 0]
  if (mine > 0 || theirs > 0) return who
  return `相打ち。${signed(mine)} 対 ${signed(theirs)} で、${who}`
}

/** 体力の数。マイナスは記号の − で書く */
const signed = (n: number) => (n < 0 ? `−${-n}` : String(n))

/**
 * ステップの記録を、viewer から見た文にする。自分をあなた、相手を相手と呼び、自分、相手の順に一行ずつ並べる。
 * 守りがダメージを返したならそれを、詠唱したならその結果を、自分も焼けたならその量を、後に添える
 */
export function reportLines(report: StepReport, viewer: PlayerIndex): string[] {
  const order: [PlayerIndex, string][] = [
    [viewer, 'あなた'],
    [viewer === 0 ? 1 : 0, '相手'],
  ]
  const lines = order.map(([who, name]) => sentence(report, who, name))
  for (const [who, name] of order) {
    const chant = report.chants[who]
    // 詠唱は、相手の詠唱を崩す行動でだけ崩れる
    const by = actionLabel(report.actions[who === 0 ? 1 : 0])
    if (chant === 'broken') lines.push(`${name}の詠唱は${by}で崩れた`)
    if (chant === 'kept') lines.push(`${name}の詠唱は保たれた`)
  }
  for (const [who, name] of order) {
    const paid = report.burn[who]
    if (paid > 0) lines.push(`${name}は${actionLabel(report.actions[who])}で自分も ${paid}点焼けた`)
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
    default:
      return CANNOT_USE
  }
}
