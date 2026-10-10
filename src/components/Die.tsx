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
  used?: boolean
  selected?: boolean
  onClick?: () => void
  disabled?: boolean
  size?: 'large' | 'small'
}

export function Die({ value, used, selected, onClick, disabled, size = 'large' }: Props) {
  const cls = ['die', `die-${size}`, used && 'die-used', selected && 'die-selected'].filter(Boolean).join(' ')
  const pips = (
    <span className="die-face" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={PIPS[value].includes(i) ? 'pip' : 'pip pip-empty'} />
      ))}
    </span>
  )
  if (!onClick) {
    return (
      <span className={cls} role="img" aria-label={`${value}の目${used ? '、使用済み' : ''}`}>
        {pips}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${value}の目${used ? '、使用済み' : ''}`}
    >
      {pips}
    </button>
  )
}
