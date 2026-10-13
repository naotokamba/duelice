// オンライン対戦の、対局に入るまでの画面。名前を入れ、ロビーで部屋を作るか、合言葉を入れて部屋に入る。
// 文字は最小限にし、括弧は使わない。

import { ArrowLeft } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cleanName, type JoinError, type LobbyRoom, NAME_MAX, validCode } from '../online/protocol'
import { Modal } from './Dialog'
import { createRoom, type Entered, joinRoom, type RoomOptions } from './onlineApi'
import { codeInput, randomCode, type Session } from './onlineStore'
import { Beta } from './Title'
import { useLobby } from './useLobby'

/** オンライン対戦の画面の見出し。戻る先があれば、左に戻るボタンを置く */
export function OnlineHead({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="online-head">
      {onBack && (
        <button type="button" className="icon-button" aria-label="戻る" title="戻る" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </button>
      )}
      <h1 className="online-title">
        {title} <Beta />
      </h1>
    </div>
  )
}

/** ロビーへ入る前に名前を入れる。前に入れた名前を既定にする */
export function NameEntry({
  initial,
  onDone,
  onBack,
}: {
  initial: string
  onDone: (name: string) => void
  onBack: () => void
}) {
  const [value, setValue] = useState(initial)
  const hint = useId()
  const name = cleanName(value)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name) onDone(name)
  }
  return (
    <main className="online">
      <OnlineHead title="オンライン対戦" onBack={onBack} />
      <form className="online-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">名前</span>
          <input
            className="field-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="nickname"
            enterKeyHint="go"
            aria-describedby={hint}
          />
        </label>
        <p id={hint} className="field-hint">
          {NAME_MAX}文字まで
        </p>
        <button type="submit" className="btn btn-primary btn-large" disabled={!name}>
          ロビーへ
        </button>
      </form>
    </main>
  )
}

/** 部屋に入れなかった理由 */
const REFUSED: Record<JoinError | 'network', string> = {
  code: '合言葉が違います',
  full: 'もう二人そろっています',
  gone: '部屋がもうありません',
  bad: '名前か合言葉が正しくありません',
  network: 'つながりませんでした',
}

/** 合言葉を入れる窓。開いたら入れ物に合言葉を入れ、送って入れたら onDone、入れなければ理由を出す */
function CodeDialog({
  title,
  action,
  initial,
  send,
  onDone,
  onClose,
}: {
  title: string
  action: string
  initial: string
  send: (code: string) => Promise<Entered>
  onDone: (s: Session) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [code, setCode] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hint = useId()
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validCode(code) || busy) return
    setBusy(true)
    const r = await send(code)
    setBusy(false)
    if (r.ok) onDone(r.session)
    else setError(REFUSED[r.error])
  }
  return (
    <Modal ref={ref} title={title} className="modal-code" onClose={onClose}>
      <form className="code-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">合言葉</span>
          <input
            className="field-input code-input"
            value={code}
            onChange={(e) => {
              setCode(codeInput(e.target.value))
              setError(null)
            }}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="go"
            aria-describedby={hint}
            aria-invalid={error !== null}
          />
        </label>
        <p id={hint} className={error ? 'field-hint is-error' : 'field-hint'} role={error ? 'alert' : undefined}>
          {error ?? '半角数字4桁'}
        </p>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!validCode(code) || busy}>
            {action}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** 部屋の様子の短い名前 */
const STATUS: Record<LobbyRoom['status'], string> = { waiting: '待機中', playing: '対戦中' }

/** ロビー。部屋の一覧を見て、部屋を作るか、相手を待っている部屋に合言葉を入れて入る */
export function Lobby({
  name,
  options,
  onEnter,
  onBack,
}: {
  name: string
  options?: RoomOptions
  onEnter: (s: Session) => void
  onBack: () => void
}) {
  const rooms = useLobby()
  /** 開いている合言葉の窓。部屋を作るか、入る部屋 */
  const [open, setOpen] = useState<'create' | LobbyRoom | null>(null)
  const close = () => setOpen(null)

  let list: ReactNode
  if (rooms === null) list = <p className="online-note">つないでいます</p>
  else if (rooms.length === 0) list = <p className="online-note">部屋はまだありません</p>
  else
    list = (
      <ul className="room-list">
        {rooms.map((r) => (
          <li key={r.id} className="room-row">
            <span className="room-host" title={r.host}>
              {r.host}
            </span>
            <span className={`room-status is-${r.status}`}>{STATUS[r.status]}</span>
            {r.status === 'waiting' && (
              <button type="button" className="btn" aria-label={`${r.host}の部屋に入る`} onClick={() => setOpen(r)}>
                入る
              </button>
            )}
          </li>
        ))}
      </ul>
    )

  return (
    <main className="online">
      <OnlineHead title="ロビー" onBack={onBack} />
      <button type="button" className="btn btn-primary btn-large" onClick={() => setOpen('create')}>
        部屋を作る
      </button>
      <section className="rooms" aria-label="部屋の一覧">
        {list}
      </section>
      {open === 'create' && (
        <CodeDialog
          title="部屋を作る"
          action="作る"
          initial={randomCode()}
          send={(code) => createRoom({ name, code, ...options })}
          onDone={onEnter}
          onClose={close}
        />
      )}
      {open !== null && open !== 'create' && (
        <CodeDialog
          key={open.id}
          title={`${open.host}の部屋`}
          action="入る"
          initial=""
          send={(code) => joinRoom(open.id, { name, code })}
          onDone={onEnter}
          onClose={close}
        />
      )}
    </main>
  )
}
