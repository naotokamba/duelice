// オンライン対戦の部屋。部屋の WebSocket につなぎ、届いた様子を持ち、行動やもう一戦を送る。
// サーバは席0と席1のまま送るので、卓には自分を席0とした向きに直して渡す。卓に渡す形は手元の対戦 useLocalMatch と同じ。

import { useMemo, useState } from 'react'
import { resolutionFor, stateFor } from '../game/perspective'
import type { Action } from '../game/types'
import type { ClientMessage, RoomMessage, RoomSnapshot } from '../online/protocol'
import { roomPath } from './onlineApi'
import type { Session } from './onlineStore'
import type { TableMatch } from './Table'
import { useSocket } from './useSocket'

/** 送ったが、まだサーバから受け付けたと届いていない行動。どの対局の、何回目の解決の後のステップに出したか */
interface Sending {
  action: Action
  at: string
}

/** 今のステップを指す印。対局と、その対局で何回解決したかで決まる */
const stepAt = (s: RoomSnapshot) => `${s.matchNo}:${s.last?.n ?? 0}`

/**
 * 部屋の様子を、自分を席0とした卓の形に直す。送ったばかりでまだ届いていない行動も、出したものとして見せる
 */
export function tableMatch(
  snap: RoomSnapshot | null,
  sending: Sending | null,
  submit: (a: Action) => void,
): TableMatch | null {
  if (!snap?.view) return null
  const { seat, view, last } = snap
  const pending = sending?.at === stepAt(snap) ? sending.action : null
  return {
    view: { state: stateFor(view.state, seat), mine: view.mine ?? pending, opponentReady: view.opponentReady },
    resolved: last && { n: last.n, resolution: resolutionFor(last.resolution, seat) },
    submit,
  }
}

export function useRoom(session: Session) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  /** サーバの時計から画面の時計を引いたずれ */
  const [offset, setOffset] = useState(0)
  const [gone, setGone] = useState(false)
  const [sending, setSending] = useState<Sending | null>(null)

  const socket = useSocket(roomPath(session), (msg) => {
    const m = msg as RoomMessage
    if (m.type === 'room') {
      setSnapshot(m)
      setOffset(m.now - Date.now())
    } else if (m.type === 'gone') {
      setGone(true)
    } else if (m.type === 'rejected') {
      // 受け付けられなかったら、選び直せるようにする
      setSending(null)
    }
  })
  const send = (msg: ClientMessage) => socket(msg)

  const match = useMemo(
    () =>
      tableMatch(snapshot, sending, (action) => {
        if (snapshot && socket({ type: 'act', action } satisfies ClientMessage)) {
          setSending({ action, at: stepAt(snapshot) })
        }
      }),
    [snapshot, sending, socket],
  )

  return {
    snapshot,
    /** 部屋がもう無い */
    gone,
    match,
    /** 今のステップの期限を、画面の時計の時刻に直したもの */
    deadline: snapshot?.deadline == null ? null : snapshot.deadline - offset,
    send,
  }
}
