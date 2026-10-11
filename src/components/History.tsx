// 戦闘履歴。一つ前の結果は常に出し、それより前は開けば見られる。
// 上下の並びは卓と同じで、上が相手、下が自分。

import { ChevronDown, ChevronUp, SkipForward } from 'lucide-react'
import { useState } from 'react'
import { ACTION_DEFS } from '../game/cards'
import { actionLabel, type PlayerIndex, type StepReport } from '../game/rules'
import { Die } from './Die'

export function History({ history }: { history: StepReport[] }) {
  const [open, setOpen] = useState(false)
  if (history.length === 0) return null
  const items = [...history].reverse()
  return (
    <section className="history" aria-label="戦闘履歴">
      <ol className="history-list">
        {(open ? items : items.slice(0, 1)).map((r) => (
          <Entry key={`${r.turn}-${r.step}`} report={r} />
        ))}
      </ol>
      {items.length > 1 && (
        <button
          type="button"
          className="history-toggle"
          aria-expanded={open}
          aria-label={open ? '閉じる' : 'これまで'}
          title={open ? '閉じる' : 'これまで'}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      )}
    </section>
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
