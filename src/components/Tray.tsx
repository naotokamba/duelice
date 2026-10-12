// 手元のダイス。カードに置いたダイスと、1ステップ目からカードに残っているダイスは、手元では空いた跡だけになる。

import { freeDice } from '../game/rules'
import { Die } from './Die'
import { dropAttr } from './drop'
import type { SeatView, Shown } from './seatView'
import type { DragHandlers } from './useDiceDrag'

/** 自分の席で選んでいる間だけ渡す操作 */
export interface TrayPlay {
  /** 持ち上げたダイス */
  held: number | null
  onTap: (die: number) => void
  drag: (die: number) => DragHandlers
  /** 引きずっている途中のダイス */
  lifted: number | null
}

interface Props {
  seat: SeatView
  /** カードに置いているか、公開しているダイス */
  shown: Shown | null
  /** 新しいターンに振ったところ。転がる動きを付ける */
  rolling: boolean
  play?: TrayPlay
}

export function Tray({ seat, shown, rolling, play }: Props) {
  const free = freeDice(seat.player)
  const away = (i: number) => !free.includes(i) || !!shown?.slots.includes(i)
  return (
    <fieldset
      className={rolling ? 'tray is-rolling' : 'tray'}
      aria-label="ダイス"
      data-drop={play ? dropAttr({ type: 'tray' }) : undefined}
    >
      {seat.player.roll.map((v, i) => {
        if (away(i)) return <span key={i} className="socket" aria-hidden="true" />
        if (!play) return <Die key={i} value={v} />
        return (
          <Die
            key={i}
            value={v}
            selected={play.held === i}
            hint={play.held === null}
            onClick={() => play.onTap(i)}
            drag={play.drag(i)}
            lifted={play.lifted === i}
          />
        )
      })}
    </fieldset>
  )
}
