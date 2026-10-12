// 二人の間の段。左端に今のターンとステップ、中央に一つ前の結果か勝敗、右端に履歴の印とメニューを置く。
// 対局中はヘッダーを出さず、ルールと降参はこの段の右端のメニューにしまう。
// ステップやターンが切り替わったら、段を幕で覆って知らせる。

import type { PlayerIndex, StepReport } from '../game/types'
import { HistoryButton, Recent } from './History'
import { MatchMenu } from './MatchMenu'
import type { Banner } from './useRevealClock'

/**
 * 今のターンとステップ。ターンの下にステップの札を縦に並べる。
 * 終わったステップを埋め、今のステップを枠で強調する。押せるものではないので動かさない
 */
export function TurnLabel({ turn, step }: { turn: number; step: 1 | 2 }) {
  return (
    <p className="turn-label">
      <span className="sr-only">{`Turn ${turn} - Step ${step}`}</span>
      <span className="turn-num" aria-hidden="true">
        Turn {turn}
      </span>
      <span className="steps" aria-hidden="true">
        {([1, 2] as const).map((s) => (
          <span key={s} className={`step-pill${s < step ? ' is-done' : s === step ? ' is-now' : ''}`}>
            {s}
          </span>
        ))}
      </span>
    </p>
  )
}

/** 決着した後の勝敗と、次の対局の始め方 */
export interface Over {
  winner: PlayerIndex | 'draw'
  onAgain: () => void
  onRelevel: () => void
}

function Result({ winner, onAgain, onRelevel }: Over) {
  return (
    <div className="result">
      <p className="result-text">
        {winner === 'draw' ? '相打ち。引き分けです' : winner === 0 ? 'あなたの勝ち' : '相手の勝ち'}
      </p>
      <div className="result-actions">
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          もう一戦
        </button>
        <button type="button" className="btn" onClick={onRelevel}>
          強さを選び直す
        </button>
      </div>
    </div>
  )
}

interface Props {
  turn: number
  step: 1 | 2
  history: StepReport[]
  /** 公開の最中。公開しているステップは卓の上の幕で見せるので、中央の結果は出さない */
  revealing: boolean
  /** 公開した内容を読み上げる文 */
  lines: string[] | null
  /** 決着して、最後の公開の動きも終わった */
  over: Over | null
  banner: Banner | null
  /** 降参。決着した後は渡さない */
  onSurrender?: () => void
}

export function Arena({ turn, step, history, revealing, lines, over, banner, onSurrender }: Props) {
  return (
    <section className="arena">
      {lines && (
        <ul className="sr-only" aria-live="polite">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      <div className="arena-row">
        <TurnLabel turn={turn} step={step} />
        <div className="arena-main">
          {over && <Result {...over} />}
          {(!revealing || over) && <Recent history={history} />}
        </div>
        {/* 履歴の印とメニューを縦に並べる。メニューは下に揃えて、履歴が出ても動かさない */}
        <div className="arena-tools">
          {(!revealing || over) && <HistoryButton history={history} />}
          <MatchMenu onSurrender={onSurrender} />
        </div>
      </div>
      {banner && !revealing && (
        <p key={banner.text} className="banner">
          <span>{banner.text}</span>
        </p>
      )}
    </section>
  )
}
