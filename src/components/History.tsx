// 戦闘履歴。一つ前の結果は中央に常に出し、全ての履歴は履歴の印からモーダルで見る。
// 履歴の印は、中央の段の右端にメニューと縦に並べるので、一つ前の結果とは別に置く。
// 上下の並びは卓と同じで、上が相手、下が自分。

import { History as HistoryIcon, SkipForward, X } from 'lucide-react'
import { useRef } from 'react'
import { ACTION_DEFS } from '../game/cards'
import type { PlayerIndex, StepReport } from '../game/types'
import { Die } from './Die'
import { closeOnBackdrop } from './dialog'
import { actionLabel } from './text'

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

/** 戦闘履歴を開く印と、全ての履歴のモーダル。履歴が無いうちは出さない */
export function HistoryButton({ history }: { history: StepReport[] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  if (history.length === 0) return null
  const items = [...history].reverse()
  return (
    <>
      <button
        type="button"
        className="history-open"
        aria-label="戦闘履歴"
        title="戦闘履歴"
        onClick={() => dialog.current?.showModal()}
      >
        <HistoryIcon aria-hidden="true" />
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 外を押して閉じるのはマウスと指のため。キーボードでは Esc で閉じる */}
      <dialog ref={dialog} className="history-dialog" aria-labelledby="history-title" onClick={closeOnBackdrop}>
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
