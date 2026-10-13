// 好きな目のダイスの目を選ぶ窓。カードに置いた好きな目のダイスを押すか、置いた直後に出す。
// 1から6の目を並べ、凍らされた目は押せない。手元に戻すこともできる。

import { useEffect, useRef } from 'react'
import { Modal } from './Dialog'
import { Die } from './Die'

interface Props {
  /** 目を選んでいる好きな目のダイス。選んでいなければ null で、窓を閉じる */
  die: number | null
  /** 前に選んだ目 */
  chosen?: number
  /** 凍らされて選べない目 */
  frozen: number | null
  onChoose: (value: number) => void
  /** ダイスを手元に戻す */
  onReturn: () => void
  /** 窓が閉じた */
  onClose: () => void
}

export function WildPicker({ die, chosen, frozen, onChoose, onReturn, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const open = die !== null

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const pick = (fn: () => void) => () => {
    fn()
    ref.current?.close()
  }

  return (
    <Modal ref={ref} title="目を選ぶ" className="modal-wild" onClose={onClose}>
      <ul className="wild-faces">
        {[1, 2, 3, 4, 5, 6].map((v) => (
          <li key={v}>
            {v === frozen ? (
              <Die value={v} mark="frozen" label={`${v}の目`} />
            ) : (
              <Die value={v} label={`${v}の目`} selected={v === chosen} onClick={pick(() => onChoose(v))} />
            )}
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={pick(onReturn)}>
          手元に戻す
        </button>
      </div>
    </Modal>
  )
}
