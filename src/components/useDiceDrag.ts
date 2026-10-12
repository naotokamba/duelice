// ダイスを指やマウスで引きずって、カードの置き場や手元に置く。
// 少し動かすまではタップとして扱うので、タップで選んでタップで置く操作と両立する。
// 落とした先は、data-drop を持つ一番近い祖先の値を drop.ts で読んで伝える。

import { type PointerEvent, useEffect, useRef, useState } from 'react'
import { type DropTarget, readDrop } from './drop'

export interface DragHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: () => void
}

export interface DragCallbacks {
  /** 引きずり始めた */
  start: () => void
  /** 指を離した。落とした先が行き先でなければ null */
  drop: (target: DropTarget | null) => void
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

  // ダイスを押している間の指の動きは、ページが受け取ったことにする。
  // touch-action: none でページは動かないが、受け取らずにおくと、素早く払って離したときにブラウザが払う動きとして扱い、
  // 直後の一押しを払う動きの停止に使ってしまう。そうなると、続けて押したカードの名前や置き場が効かない。
  // React の touchmove は受け身の登録で既定の動きを止められないので、document に直接登録する
  useEffect(() => {
    const hold = (e: TouchEvent) => {
      if (press.current && e.cancelable) e.preventDefault()
    }
    document.addEventListener('touchmove', hold, { passive: false })
    return () => document.removeEventListener('touchmove', hold)
  }, [])

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
      on.drop(readDrop(el?.closest('[data-drop]')?.getAttribute('data-drop') ?? null))
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
