// ダイス。目は九つの升に点を打って描く。押せるダイスはボタン、押せないダイスは絵として読み上げる。
// 前のターンから持ち越したダイス、振り足したダイス、凍って置けないダイスは、角に小さな印を付けて見分ける。

import { ArrowRight, Plus, Snowflake } from 'lucide-react'
import type { DragHandlers } from './useDiceDrag'

/** ダイスの出どころや様子の印。持ち越した、振り足した、凍って置けない */
export type DieMark = 'carried' | 'extra' | 'frozen'

const MARKS: Record<DieMark, { icon: typeof Plus; note: string }> = {
  carried: { icon: ArrowRight, note: '前のターンから持ち越した' },
  extra: { icon: Plus, note: '振り足した' },
  frozen: { icon: Snowflake, note: '凍って置けない' },
}

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

interface Props {
  value: number
  selected?: boolean
  /** 置ける場所があることを知らせる */
  hint?: boolean
  onClick?: () => void
  /** slot はカードの置き場いっぱいに描く */
  size?: 'large' | 'small' | 'slot'
  /** 読み上げの名前。既定は目の値 */
  label?: string
  /** 引きずって動かすためのハンドラ */
  drag?: DragHandlers
  /** 引きずっている途中。元の位置は薄く残す */
  lifted?: boolean
  /** 前のステップで使い、カードの上に残っている。色を変えて、今置けるダイスと見分ける */
  kept?: boolean
  /** 角に付ける印。読み上げでは説明として添える */
  mark?: DieMark
}

export function Die({ value, selected, hint, onClick, size = 'large', label, drag, lifted, kept, mark }: Props) {
  const cls = [
    'die',
    `die-${size}`,
    kept && 'die-kept',
    mark && `die-${mark}`,
    selected && 'die-selected',
    hint && 'die-hint',
    drag && 'die-drag',
    lifted && 'die-lifted',
  ]
    .filter(Boolean)
    .join(' ')
  const name = label ?? `${value}の目`
  const badge = mark && MARKS[mark]
  const Icon = badge?.icon
  const pips = (
    <>
      <span className="die-face" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={PIPS[value].includes(i) ? 'pip' : 'pip pip-empty'} />
        ))}
      </span>
      {Icon && (
        <span className="die-badge" aria-hidden="true">
          <Icon strokeWidth={3} />
        </span>
      )}
    </>
  )
  if (!onClick) {
    return (
      <span className={cls} role="img" aria-label={name} aria-description={badge?.note}>
        {pips}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={name}
      aria-description={badge?.note}
      {...drag}
    >
      {pips}
    </button>
  )
}
