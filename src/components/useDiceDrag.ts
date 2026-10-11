// ダイスを指やマウスで引きずって、カードの置き場や手元に置く。
// 少し動かすまではタップとして扱うので、タップで選んでタップで置く操作と両立する。
// 落とした先は、data-drop を持つ一番近い祖先の値で伝える。

import { type PointerEvent, useRef, useState } from 'react'

export interface DragHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: () => void
}

export interface DragCallbacks {
  /** 引きずり始めた */
  start: () => void
  /** 指を離した。target は落とした先の data-drop の値 */
  drop: (target: string | null) => void
}

/** 引きずっている途中のダイスの位置 */
export interface DragView {
  die: number
  x: number
  y: number
}

/** この距離より動かしたら引きずりとみなす */
const THRESHOLD = 6

export function useDiceDrag() {
  const [view, setView] = useState<DragView | null>(null)
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const justDropped = useRef(false)

  const bind = (die: number, on: DragCallbacks): DragHandlers => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return
      press.current = { x: e.clientX, y: e.clientY, dragging: false }
      // 指が要素の外に出ても move と up を受け取り続ける
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e) => {
      const p = press.current
      if (!p) return
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return
        p.dragging = true
        on.start()
      }
      setView({ die, x: e.clientX, y: e.clientY })
    },
    onPointerUp: (e) => {
      const p = press.current
      press.current = null
      if (!p?.dragging) return
      setView(null)
      // 離した直後に同じ要素へ届くクリックを、タップと取り違えないようにする
      justDropped.current = true
      setTimeout(() => {
        justDropped.current = false
      }, 0)
      const el = document.elementFromPoint(e.clientX, e.clientY)
      on.drop(el?.closest('[data-drop]')?.getAttribute('data-drop') ?? null)
    },
    onPointerCancel: () => {
      press.current = null
      setView(null)
    },
  })

  /** 引きずりの直後に届いたクリックなら true */
  const afterDrop = () => justDropped.current

  return { view, bind, afterDrop }
}
