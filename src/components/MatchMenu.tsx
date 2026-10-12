// 対局中のメニュー。ルールと降参はめったに使わないので、二人の間の段の右端の「⋯」にしまっておく。
// 対局中はヘッダーを出さず、そのぶん卓を広く使う。

import { CircleHelp, Ellipsis, Flag } from 'lucide-react'
import { type MouseEvent, useRef } from 'react'
import { Dialog } from './Dialog'
import { RulesDialog } from './RulesButton'

/** メニューと、開いたボタンや画面の端との間 */
const GAP = 8

interface Props {
  /** 降参を選んだとき。決着した後は渡さず、メニューに出さない */
  onSurrender?: () => void
}

export function MatchMenu({ onSurrender }: Props) {
  const menu = useRef<HTMLDialogElement>(null)
  const rules = useRef<HTMLDialogElement>(null)

  /** メニューを開いて、押したボタンのそばに置く。メニューはボタンと一緒に描くので、押せる時にはいつもある */
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const d = menu.current as HTMLDialogElement
    d.showModal()
    place(d, e.currentTarget)
  }
  /** メニューを閉じてから、選んだものを開く */
  const choose = (then: () => void) => {
    menu.current?.close()
    then()
  }

  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="メニュー"
        title="メニュー"
        aria-haspopup="dialog"
        onClick={open}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      <Dialog ref={menu} className="menu-dialog" label="メニュー">
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
      </Dialog>
      <RulesDialog ref={rules} />
    </>
  )
}

/** メニューを、開いたボタンの右端に揃えて下に出す。下に収まらなければ上に出す */
export function place(d: HTMLDialogElement, from: HTMLElement) {
  const r = from.getBoundingClientRect()
  const h = d.getBoundingClientRect().height
  const below = r.bottom + GAP + h <= window.innerHeight - GAP
  d.style.top = `${below ? r.bottom + GAP : Math.max(GAP, r.top - GAP - h)}px`
  d.style.right = `${Math.max(GAP, window.innerWidth - r.right)}px`
}
