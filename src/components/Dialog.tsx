// モーダル。どのモーダルも、外の暗くした背景を押すと閉じ、キーボードでは Esc で閉じる。
// 見出しと閉じるボタンを持つ窓は Modal、はいかいいえを確かめる窓は ConfirmDialog を使う。

import { X } from 'lucide-react'
import { type MouseEvent, type ReactNode, type RefObject, useId } from 'react'

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

interface DialogProps {
  ref: RefObject<HTMLDialogElement | null>
  className: string
  /** 読み上げの名前。見出しがあれば labelledBy で見出しを指す */
  label?: string
  labelledBy?: string
  onClose?: () => void
  children: ReactNode
}

/** 外を押すと閉じるモーダルの土台。開くのは呼ぶ側で、ref の showModal を呼ぶ */
export function Dialog({ ref, className, label, labelledBy, onClose, children }: DialogProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 外を押して閉じるのはマウスと指のため。キーボードでは Esc で閉じる
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      aria-labelledby={labelledBy}
      onClick={closeOnBackdrop}
      onClose={onClose}
    >
      {children}
    </dialog>
  )
}

interface ModalProps {
  ref: RefObject<HTMLDialogElement | null>
  title: string
  /** 窓の大きさや中身に合わせた見た目 */
  className: string
  onClose?: () => void
  children: ReactNode
}

/** 見出しと閉じるボタンを持つ窓 */
export function Modal({ ref, title, className, onClose, children }: ModalProps) {
  const id = useId()
  return (
    <Dialog ref={ref} className={`modal ${className}`} labelledBy={id} onClose={onClose}>
      <div className="dialog-head">
        <h2 id={id} className="dialog-title">
          {title}
        </h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="閉じる"
          title="閉じる"
          onClick={() => ref.current?.close()}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      {children}
    </Dialog>
  )
}

interface ConfirmProps {
  ref: RefObject<HTMLDialogElement | null>
  /** 問い。読み上げの名前にもなる */
  title: string
  /** やめる側のボタン。誤って押したときのために、開いたときはこちらを選んでおく */
  cancel: string
  /** 進める側のボタン */
  confirm: string
  /** 取り返しのつかない操作。進める側を赤くする */
  danger?: boolean
  onConfirm: () => void
}

/** 取り消せない操作の前に確かめる窓 */
export function ConfirmDialog({ ref, title, cancel, confirm, danger, onConfirm }: ConfirmProps) {
  const id = useId()
  const close = () => ref.current?.close()
  return (
    <Dialog ref={ref} className="modal modal-confirm" labelledBy={id}>
      <h2 id={id} className="dialog-title">
        {title}
      </h2>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>
          {cancel}
        </button>
        <button
          type="button"
          className={danger ? 'btn btn-danger' : 'btn btn-primary'}
          onClick={() => {
            close()
            onConfirm()
          }}
        >
          {confirm}
        </button>
      </div>
    </Dialog>
  )
}
