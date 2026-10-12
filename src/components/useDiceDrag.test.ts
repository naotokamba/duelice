// @vitest-environment happy-dom
// ダイスを押している間の指の動きを、ページが受け取ったことにするか。
// 受け取らずにおくと、素早く払って離したときにブラウザが払う動きとして扱い、直後の一押しが効かなくなる

import { cleanup, renderHook } from '@testing-library/react'
import type { PointerEvent } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useDiceDrag } from './useDiceDrag'

afterEach(cleanup)

/** 指を動かしたときに届く、止められる touchmove を送り、止められたかを返す */
function moveFinger(): boolean {
  const e = new Event('touchmove', { cancelable: true })
  document.dispatchEvent(e)
  return e.defaultPrevented
}

/** ダイスを指で押した、または離したときの出来事 */
const press = (x = 0, y = 0) =>
  ({
    button: 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
    currentTarget: document.body,
  }) as unknown as PointerEvent<HTMLElement>

describe('ダイスを押している間の指の動き', () => {
  it('ダイスを押している間だけ、ページの既定の動きを止める', () => {
    const { result } = renderHook(() => useDiceDrag())
    const handlers = result.current.bind(0, { start: () => {}, drop: () => {} })
    // 何も押していないときは、ページを送るなどの動きを止めない
    expect(moveFinger()).toBe(false)

    handlers.onPointerDown(press())
    expect(moveFinger()).toBe(true)
    handlers.onPointerUp(press())
    expect(moveFinger()).toBe(false)

    // 引きずりが取り消されたときも、止めるのをやめる
    handlers.onPointerDown(press())
    handlers.onPointerCancel()
    expect(moveFinger()).toBe(false)
  })

  it('画面から外したら、止めるのをやめる', () => {
    const { result, unmount } = renderHook(() => useDiceDrag())
    result.current.bind(0, { start: () => {}, drop: () => {} }).onPointerDown(press())
    unmount()
    expect(moveFinger()).toBe(false)
  })
})
