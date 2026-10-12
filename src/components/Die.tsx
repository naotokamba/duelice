// ダイス。目は九つの升に点を打って描く。押せるダイスはボタン、押せないダイスは絵として読み上げる。

import type { DragHandlers } from './useDiceDrag'

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
}

export function Die({ value, selected, hint, onClick, size = 'large', label, drag, lifted, kept }: Props) {
  const cls = [
    'die',
    `die-${size}`,
    kept && 'die-kept',
    selected && 'die-selected',
    hint && 'die-hint',
    drag && 'die-drag',
    lifted && 'die-lifted',
  ]
    .filter(Boolean)
    .join(' ')
  const name = label ?? `${value}の目`
  const pips = (
    <span className="die-face" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={PIPS[value].includes(i) ? 'pip' : 'pip pip-empty'} />
      ))}
    </span>
  )
  if (!onClick) {
    return (
      <span className={cls} role="img" aria-label={name}>
        {pips}
      </span>
    )
  }
  return (
    <button type="button" className={cls} onClick={onClick} aria-pressed={selected} aria-label={name} {...drag}>
      {pips}
    </button>
  )
}
