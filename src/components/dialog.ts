// モーダルの共通の振る舞い

import type { MouseEvent } from 'react'

/**
 * モーダルの外、暗くした背景を押したら閉じる。
 * 背景を押すとモーダル自身に届くが、モーダルの余白を押しても同じく届くので、押した位置がモーダルの外かで見分ける。
 * 中のボタンを押したときや、キーボードで押したときは閉じない
 */
export function closeOnBackdrop(e: MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return
  const r = e.currentTarget.getBoundingClientRect()
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  if (!inside) e.currentTarget.close()
}
