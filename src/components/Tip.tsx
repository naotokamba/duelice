// 印に添える一行の説明。マウスなら重ねたとき、指なら押したとき、キーボードなら選んだときに出す。
// 開いているのは一つだけにし、外を押すか Esc で閉じる。

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

/** 別の説明が開いたことを知らせる合図 */
const OPEN_EVENT = 'duelice-tip-open'
/** 説明の吹き出しを、画面の端からこれだけ離す */
const MARGIN = 8

interface Props {
  /** 説明の一行。読み上げの名前にも使う */
  text: string
  className?: string
  children: ReactNode
}

export function Tip({ text, className, children }: Props) {
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)

  const show = () => {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
    setShift(0)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== id) setOpen(false)
    }
    const onOutside = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener(OPEN_EVENT, onOther)
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOther)
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, id])

  // 吹き出しが画面の端からはみ出すなら、内側へずらす
  useLayoutEffect(() => {
    if (!open || !bubble.current) return
    const r = bubble.current.getBoundingClientRect()
    const over = Math.max(0, MARGIN - r.left) - Math.max(0, r.right - (window.innerWidth - MARGIN))
    setShift(over)
  }, [open])

  return (
    <button
      ref={button}
      type="button"
      className={`tip ${className ?? ''}`}
      aria-label={text}
      aria-describedby={open ? id : undefined}
      onClick={show}
      onFocus={show}
      onBlur={() => setOpen(false)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      {children}
      {open && (
        <span ref={bubble} id={id} role="tooltip" className="tip-bubble" style={{ marginLeft: shift }}>
          {text}
        </span>
      )}
    </button>
  )
}
