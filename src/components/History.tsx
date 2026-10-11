// 戦いの流れと戦闘履歴。
// 1ターンを左右2つに割った牌で表し、左がステップ1、右がステップ2。行動するたびに半分ずつ埋まっていく。
// 牌はターンごとに右へ並ぶので、1ターンが2ステップでできていることと、一つ前の結果が一度に見える。
// 半分の中も卓と同じく、上が相手、下が自分。全ての履歴の細かい中身は、履歴の印からモーダルで見る。

import { History as HistoryIcon, SkipForward, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { ACTION_DEFS } from '../game/cards'
import { actionLabel, type PlayerIndex, type StepReport } from '../game/rules'
import { Die } from './Die'

interface Props {
  history: StepReport[]
  /** 今のターンとステップ */
  turn: number
  step: 1 | 2
  /** 今のステップを選んでいる途中。その半分を光らせる */
  choosing: boolean
}

export function History({ history, turn, step, choosing }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const items = [...history].reverse()
  const turns = Array.from({ length: turn }, (_, i) => i + 1)

  // ターンが進んで牌が増えたら、右端の今の牌が見えるところまで送る
  useEffect(() => {
    const el = scroller.current
    if (el && turn > 0) el.scrollLeft = el.scrollWidth
  }, [turn])

  return (
    <>
      <section className="history" aria-label="戦いの流れ">
        <div className="tiles-scroll" ref={scroller}>
          <ol className="tiles">
            {turns.map((t) => (
              <li key={t} className="tile" aria-label={`Turn ${t}`}>
                <span className="tile-turn">Turn {t}</span>
                <ol className="tile-halves">
                  {([1, 2] as const).map((s) => {
                    const report = history.find((r) => r.turn === t && r.step === s)
                    const now = choosing && t === turn && s === step
                    return (
                      <li
                        key={s}
                        aria-label={`ステップ${s}`}
                        aria-current={now ? 'step' : undefined}
                        className={['half', report && 'is-done', now && 'is-now'].filter(Boolean).join(' ')}
                      >
                        <span className="half-step" aria-hidden="true">
                          {s}
                        </span>
                        {report && ([1, 0] as const).map((who) => <Mini key={who} who={who} report={report} />)}
                      </li>
                    )
                  })}
                </ol>
              </li>
            ))}
          </ol>
        </div>
        <button
          type="button"
          className="history-open"
          aria-label="戦闘履歴"
          title="戦闘履歴"
          onClick={() => dialog.current?.showModal()}
        >
          <HistoryIcon aria-hidden="true" />
        </button>
      </section>
      <dialog ref={dialog} className="history-dialog" aria-labelledby="history-title">
        <div className="rules-head">
          <h2 id="history-title" className="dialog-title">
            戦闘履歴
          </h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="閉じる"
            title="閉じる"
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <ol className="history-list">
          {items.map((r) => (
            <Entry key={`${r.turn}-${r.step}`} report={r} />
          ))}
        </ol>
      </dialog>
    </>
  )
}

/** 牌の半分に入れる、片方の席の行動と受けたダメージ */
function Mini({ who, report }: { who: PlayerIndex; report: StepReport }) {
  const a = report.actions[who]
  const taken = report.damage[who]
  return (
    <div className={`mini side-${who === 0 ? 'me' : 'cpu'}`}>
      {a.kind === 'pass' ? (
        <span className="mini-act history-pass" role="img" aria-label="パス">
          <SkipForward aria-hidden="true" />
        </span>
      ) : (
        <span className={`mini-act card-${ACTION_DEFS[a.kind].card}`}>{ACTION_DEFS[a.kind].label}</span>
      )}
      {taken > 0 && (
        <span className="history-hit" role="img" aria-label={`${taken}ダメージ`}>
          −{taken}
        </span>
      )}
    </div>
  )
}

function Entry({ report }: { report: StepReport }) {
  return (
    <li className="history-entry">
      <span className="history-when">
        {report.turn}-{report.step}
      </span>
      {([1, 0] as const).map((who) => (
        <Side key={who} who={who} report={report} />
      ))}
    </li>
  )
}

function Side({ who, report }: { who: PlayerIndex; report: StepReport }) {
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
      {taken > 0 && (
        <span className="history-hit" role="img" aria-label={`${taken}ダメージ`}>
          −{taken}
        </span>
      )}
    </div>
  )
}
