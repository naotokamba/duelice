// 戦闘履歴。一つ前の結果は中央に常に出し、全ての履歴は履歴の印からモーダルで見る。
// 履歴の印は、中央の段の右端にメニューと縦に並べるので、一つ前の結果とは別に置く。
// 上下の並びは卓と同じで、上が相手、下が自分。
// モーダルでは、そのステップで起きたことの内訳も、カード面や公開と同じ印で並べる。印は読み上げず、同じ中身を公開の文で読み上げる。

import { History as HistoryIcon, SkipForward } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { ACTION_DEFS, type ActionKind, type CardId } from '../game/cards'
import type { Action, PlayerIndex, StepReport } from '../game/types'
import { Modal } from './Dialog'
import { Die } from './Die'
import { BurnGlyph, ChantGlyph, PierceStar, ShieldGlyph, Star, ThornsGlyph } from './glyphs'
import { actionLabel, endingText, reportLines } from './text'

/** 一つ前の結果。今どのステップかは左端のステップの箱で分かるので、中央にはこれだけを出す */
export function Recent({ history }: { history: StepReport[] }) {
  const last = history.at(-1)
  if (!last) return null
  return (
    <section className="history" aria-label="一つ前の結果">
      <ol className="history-list history-recent">
        <Entry report={last} />
      </ol>
    </section>
  )
}

/** 決着したときの勝敗と双方の体力。席の順 */
interface Ending {
  winner: PlayerIndex | 'draw'
  hp: [number, number]
}

/**
 * 戦闘履歴を開く印と、全ての履歴のモーダル。履歴が無いうちは出さない。
 * 決着した後は、いちばん上に決着の行を足し、相打ちならはみ出した体力の比べまで書く
 */
export function HistoryButton({ history, over }: { history: StepReport[]; over?: Ending | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  if (history.length === 0) return null
  const items = [...history].reverse()
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="戦闘履歴"
        title="戦闘履歴"
        onClick={() => dialog.current?.showModal()}
      >
        <HistoryIcon aria-hidden="true" />
      </button>
      <Modal ref={dialog} title="戦闘履歴" className="modal-history">
        <ol className="history-list">
          {over && (
            <li className="history-entry history-end">
              <span className="history-when">決着</span>
              <span className="history-end-text">{endingText(over.winner, over.hp, 0)}</span>
            </li>
          )}
          {items.map((r) => (
            <Entry key={`${r.turn}-${r.step}`} report={r} detail />
          ))}
        </ol>
      </Modal>
    </>
  )
}

/** 一つのステップ。detail なら、起きたことの内訳の印と、読み上げる公開の文も添える */
function Entry({ report, detail }: { report: StepReport; detail?: boolean }) {
  return (
    <li className="history-entry">
      <span className="history-when">
        {report.turn}-{report.step}
      </span>
      {([1, 0] as const).map((who) => (
        <Side key={who} who={who} report={report} detail={detail} />
      ))}
      {detail && <span className="sr-only">{reportLines(report, 0).join('。')}</span>}
    </li>
  )
}

/** 内訳の印一つ。印はそのカードの色で描く */
interface Fx {
  key: string
  card: CardId
  glyph: ReactNode
}

/** 行動のカード。パスでない行動にだけ使う */
const cardOf = (a: Action): CardId => ACTION_DEFS[(a as { kind: ActionKind }).kind].card

/**
 * who の行で起きたことの内訳。カードの色で、放った攻撃の威力、守りで減らした分、守りが返した分、自分も受けた分、詠唱の結果を並べる。
 * 貫通した攻撃は、守りを突き抜けた星で描く
 */
function details(report: StepReport, who: PlayerIndex): Fx[] {
  const out: Fx[] = []
  report.strikes.forEach((s, i) => {
    const card = ACTION_DEFS[s.kind].card
    if (s.from === who && s.outcome === 'returned') {
      out.push({ key: `r${i}`, card, glyph: <ThornsGlyph value={String(s.dealt)} /> })
    } else if (s.from === who) {
      const glyph = s.outcome === 'pierced' ? <PierceStar value={String(s.power)} /> : <Star value={String(s.power)} />
      out.push({ key: `a${i}`, card, glyph })
    }
    // 自分の守りが減らした分は、守った側の行に出す
    if (s.to === who && s.outcome === 'guarded') {
      out.push({ key: `g${i}`, card: cardOf(report.actions[who]), glyph: <ShieldGlyph value={s.power - s.dealt} /> })
    }
  })
  const burn = report.burn[who]
  if (burn > 0) out.push({ key: 'burn', card: cardOf(report.actions[who]), glyph: <BurnGlyph value={String(burn)} /> })
  const chant = report.chants[who]
  if (chant) {
    const broken = chant === 'broken'
    const glyph = <ChantGlyph broken={broken} className={broken ? 'is-broken' : 'is-kept'} />
    out.push({ key: 'chant', card: cardOf(report.actions[who]), glyph })
  }
  return out
}

function Side({ who, report, detail }: { who: PlayerIndex; report: StepReport; detail?: boolean }) {
  const a = report.actions[who]
  const taken = report.damage[who]
  const name = who === 0 ? 'あなた' : '相手'
  return (
    <div className={`history-side side-${who === 0 ? 'me' : 'cpu'}`}>
      <span className="history-who">{name}</span>
      {a.kind === 'pass' ? (
        <span className="history-act history-pass" role="img" aria-label="パス">
          <SkipForward aria-hidden="true" />
        </span>
      ) : (
        <span className={`history-act card-${ACTION_DEFS[a.kind].card}`}>{actionLabel(a)}</span>
      )}
      <span className="history-dice">
        {report.values[who].map((v, i) => (
          <Die key={i} value={v} size="small" />
        ))}
      </span>
      {detail && <Detail items={details(report, who)} />}
      {taken > 0 && (
        <span className="history-hit" role="img" aria-label={`${taken}ダメージ`}>
          −{taken}
        </span>
      )}
    </div>
  )
}

/** 内訳の印の並び。印は読み上げない */
function Detail({ items }: { items: Fx[] }) {
  if (items.length === 0) return null
  return (
    <span className="history-detail" aria-hidden="true">
      {items.map((it) => (
        <span key={it.key} className={`history-fx card-${it.card}`}>
          {it.glyph}
        </span>
      ))}
    </span>
  )
}
