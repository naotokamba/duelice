// オンライン対戦の入口。名前、ロビー、部屋の順に進む。部屋では、相手を待つ間は合言葉を出し、二人そろえば卓を出す。
// 部屋の席の合言葉はブラウザに覚え、再読み込みしたら同じ部屋の同じ席に戻る。

import { useEffect, useState } from 'react'
import { Lobby, NameEntry, OnlineHead } from './Lobby'
import type { RoomOptions } from './onlineApi'
import { clearSession, loadName, loadSession, type Session, saveName, saveSession } from './onlineStore'
import { Table } from './Table'
import { useRoom } from './useRoom'

/** 相手を待っている部屋。合言葉を出し、相手に伝えてもらう。前の相手が抜けて戻ってきたなら、そう伝える */
function WaitingRoom({ code, left, onLeave }: { code: string; left: boolean; onLeave: () => void }) {
  return (
    <main className="online">
      <OnlineHead title="部屋" />
      {left && <p className="online-note">相手が抜けました</p>}
      <dl className="room-code">
        <dt>合言葉</dt>
        <dd>{code}</dd>
      </dl>
      <p className="online-wait">相手を待っています</p>
      <button type="button" className="btn btn-large" onClick={onLeave}>
        ロビーへ
      </button>
    </main>
  )
}

/** 部屋。つないで様子が届くまでは、つないでいると出す。部屋がもう無ければロビーへ戻る */
function Room({ session, narrow, onLobby }: { session: Session; narrow: boolean; onLobby: () => void }) {
  const room = useRoom(session)
  const snap = room.snapshot

  useEffect(() => {
    if (room.gone) onLobby()
  }, [room.gone, onLobby])

  /** 部屋を出る。サーバに知らせてから、返事を待たずにロビーへ戻る */
  const leave = () => {
    room.send({ type: 'leave' })
    onLobby()
  }

  if (!snap) {
    return (
      <main className="online">
        <OnlineHead title="部屋" />
        <p className="online-note">つないでいます</p>
      </main>
    )
  }
  if (!room.match) return <WaitingRoom code={snap.code} left={snap.matchNo > 0} onLeave={leave} />
  const other = snap.seat === 0 ? 1 : 0
  return (
    <Table
      key={snap.matchNo}
      match={room.match}
      narrow={narrow}
      opponent={snap.names[other] ?? undefined}
      opponentAway={!snap.online[other]}
      timer={room.deadline === null ? null : { deadline: room.deadline, stepMs: snap.stepMs }}
      reason={snap.end?.reason}
      after={{
        onAgain: () => room.send({ type: 'again' }),
        waiting: snap.again[snap.seat],
        opponentWaiting: snap.again[other],
        leave: { label: 'ロビーへ', onClick: leave },
      }}
      onSurrender={() => room.send({ type: 'resign' })}
    />
  )
}

interface Props {
  narrow: boolean
  /** 開発のテストだけ。作る部屋の持ち時間と体力 */
  options?: RoomOptions
  /** タイトルへ戻る */
  onExit: () => void
}

export function Online({ narrow, options, onExit }: Props) {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [name, setName] = useState(loadName)
  const [screen, setScreen] = useState<'name' | 'lobby'>('name')

  const enter = (s: Session) => {
    saveSession(s)
    setSession(s)
  }
  const toLobby = () => {
    clearSession()
    setSession(null)
    setScreen(name ? 'lobby' : 'name')
  }

  if (session) return <Room key={session.id} session={session} narrow={narrow} onLobby={toLobby} />
  if (screen === 'lobby')
    return <Lobby name={name} options={options} onEnter={enter} onBack={() => setScreen('name')} />
  return (
    <NameEntry
      initial={name}
      onDone={(n) => {
        saveName(n)
        setName(n)
        setScreen('lobby')
      }}
      onBack={onExit}
    />
  )
}
