// 手元のダイス。カードに置いたダイスと、1ステップ目からカードに残っているダイスは、手元では空いた跡だけになる。
// 持ち越しや振り足しでダイスが4個より多いときは、跡を残さず、残っているダイスだけを並べて席の幅に収める。
// 凍って置けないダイスは押せず、持ち上げられない。

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

/** 跡を残してもダイスが席の幅に収まる、手元のダイスの数 */
export const SOCKETS_UP_TO = 4

/** 手元に並べるダイスと跡の数 */
export function trayCount(seat: SeatView, shown: Shown | null): number {
  const { roll } = seat.player
  if (roll.length <= SOCKETS_UP_TO) return roll.length
  const free = freeDice(seat.player)
  return free.filter((i) => !shown?.slots.includes(i)).length
}

export function Tray({ seat, shown, rolling, play }: Props) {
  const free = freeDice(seat.player)
  const away = (i: number) => !free.includes(i) || !!shown?.slots.includes(i)
  const sockets = seat.player.roll.length <= SOCKETS_UP_TO
  return (
    <fieldset
      className={rolling ? 'tray is-rolling' : 'tray'}
      aria-label="ダイス"
      data-drop={play ? dropAttr({ type: 'tray' }) : undefined}
    >
      {seat.player.roll.map((v, i) => {
        if (away(i)) return sockets && <span key={i} className="socket" aria-hidden="true" />
        const mark = seat.marks[i] ?? undefined
        if (!play || mark === 'frozen') return <Die key={i} value={v} mark={mark} />
        return (
          <Die
            key={i}
            value={v}
            mark={mark}
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
