// 対局中のメニュー。ルールと降参はめったに使わないので、二人の間の段の右端の「⋯」にしまっておく。
// 対局中はヘッダーを出さず、そのぶん卓を広く使う。

import { CircleHelp, Ellipsis, Flag } from 'lucide-react'
import { useRef } from 'react'
import { closeOnBackdrop } from './dialog'
import { RulesDialog } from './RulesButton'

/** メニューと、開いたボタンや画面の端との間 */
const GAP = 8

interface Props {
  /** 降参を選んだとき。決着した後は渡さず、メニューに出さない */
  onSurrender?: () => void
}

export function MatchMenu({ onSurrender }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const rules = useRef<HTMLDialogElement>(null)

  const open = () => {
    const d = menu.current
    if (!d) return
    d.showModal()
    if (button.current) place(d, button.current)
  }
  /** メニューを閉じてから、選んだものを開く */
  const choose = (then: () => void) => {
    menu.current?.close()
    then()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="menu-button"
        aria-label="メニュー"
        title="メニュー"
        aria-haspopup="dialog"
        onClick={open}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 外を押して閉じるのはマウスと指のため。キーボードでは Esc で閉じる */}
      <dialog ref={menu} className="menu-dialog" aria-label="メニュー" onClick={closeOnBackdrop}>
        <button type="button" className="menu-item" onClick={() => choose(() => rules.current?.showModal())}>
          <CircleHelp aria-hidden="true" />
          ルール
        </button>
        {onSurrender && (
          <button type="button" className="menu-item" onClick={() => choose(onSurrender)}>
            <Flag aria-hidden="true" />
            降参
          </button>
        )}
      </dialog>
      <RulesDialog ref={rules} />
    </>
  )
}

/** メニューを、開いたボタンの右端に揃えて下に出す。下に収まらなければ上に出す */
function place(d: HTMLDialogElement, from: HTMLElement) {
  const r = from.getBoundingClientRect()
  const h = d.getBoundingClientRect().height
  const below = r.bottom + GAP + h <= window.innerHeight - GAP
  d.style.top = `${below ? r.bottom + GAP : Math.max(GAP, r.top - GAP - h)}px`
  d.style.right = `${Math.max(GAP, window.innerWidth - r.right)}px`
}
