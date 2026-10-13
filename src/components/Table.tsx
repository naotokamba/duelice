// 対局の画面。上に相手の席、中央に二人の間の段、下に自分の席を置き、公開の演出は卓の上に重ねた幕で見せる。
// 対局の中身は渡された match が決め、ここは盤を見せることと、操作を手元や対局へ渡すことだけをする。
// 手元の対戦もオンライン対戦も、自分を席0とした同じ形で渡す。解決の結果は、届いたら公開する。
// 対局が始まるたびに作り直すので、公開の時計や手元は新しい対局ごとに初めの状態から始まる。

import { CircleCheck, SkipForward, WifiOff } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { CardId } from '../game/cards'
import type { MatchView } from '../game/match'
import type { Action } from '../game/types'
import type { EndReason } from '../online/protocol'
import { type AfterMatch, Arena } from './Arena'
import type { CardPlay } from './Card'
import { Countdown } from './Countdown'
import { ConfirmDialog, Modal } from './Dialog'
import { Die } from './Die'
import { ClashSide, Exchange } from './Exchange'
import { Seat } from './Seat'
import { SeatCard, SeatCards } from './SeatCards'
import { currentCard, revealed, type Shown, seatView } from './seatView'
import { Tray } from './Tray'
import { issueText, reportLines } from './text'
import { useHand } from './useHand'
import { type Resolved, useRevealClock } from './useRevealClock'

/** 卓に渡す対局。自分を席0とした向き */
export interface TableMatch {
  /** 見せてよい対局の様子。自分が今のステップに出した行動と、相手がもう出したかを含む */
  view: MatchView
  /** この対局で一番新しい解決。n が前より増えたら公開する */
  resolved: Resolved | null
  /** 自分の行動を出す。解決したら resolved が届く */
  submit: (action: Action) => void
}

interface Props {
  match: TableMatch
  narrow: boolean
  /** 相手の名前 */
  opponent?: string
  /** 相手の画面とのつながりが切れている */
  opponentAway?: boolean
  /** 今のステップの持ち時間。期限は画面の時計の時刻。無ければ時計を出さない */
  timer?: { deadline: number; stepMs: number } | null
  /** 決着の理由。無ければ体力 */
  reason?: EndReason
  /** 決着した後の操作 */
  after: AfterMatch
  /** 降参する。手元の対戦ではタイトルに戻る */
  onSurrender: () => void
}

/** 名前に添える印 */
function Mark({ icon: Icon, label }: { icon: typeof CircleCheck; label: string }) {
  return (
    <span className="seat-mark" role="img" aria-label={label} title={label}>
      <Icon aria-hidden="true" />
    </span>
  )
}

export function Table({ match, narrow, opponent = '相手', opponentAway, timer, reason, after, onSurrender }: Props) {
  const { view, resolved, submit } = match
  const clock = useRevealClock(resolved, view.state.history.length === 0 && view.state.winner === null)
  /** 見せる盤。公開の最中は、解決した直後の盤を見せる */
  const board = clock.reveal?.state ?? view.state
  const hand = useHand(board)
  const seats = useMemo(() => [seatView(board, 0), seatView(board, 1)] as const, [board])
  const passDialog = useRef<HTMLDialogElement>(null)
  const surrenderDialog = useRef<HTMLDialogElement>(null)
  /** 狭い画面で、名前を押して大きく見ている相手のカード */
  const [peek, setPeek] = useState<CardId | null>(null)
  const peekDialog = useRef<HTMLDialogElement>(null)

  const revealing = clock.reveal !== null
  /** 自分の行動を選べる。公開の最中、決着の後、このステップの行動を出した後は選べない */
  const choosing = !revealing && view.state.winner === null && view.mine === null
  /** 決着して、最後の公開の動きも終わった。時間切れや降参なら公開を待たない */
  const over = board.winner !== null && (clock.ended || !revealing) ? board.winner : null

  /** 自分のカードに置いて見せるダイス。行動を出した後は、出した行動を相手の決定を待つ間も見せる */
  const myShown: Shown | null = clock.reveal
    ? revealed(clock.reveal.report.actions[0])
    : view.mine
      ? revealed(view.mine)
      : hand.row && { ...hand.row, complete: hand.action !== null }
  const cpuShown = clock.reveal ? revealed(clock.reveal.report.actions[1]) : null
  const myCurrent = currentCard({ revealing, shown: myShown, focus: hand.focus, usable: seats[0].usable })

  /** 自分の行動を出す。公開が終わっても、狭い画面では今見ているカードを出し続ける */
  const commit = (mine: Action) => {
    submit(mine)
    hand.clear()
    hand.look(myCurrent)
  }

  const playFor = (c: CardId): CardPlay | undefined => {
    if (!choosing) return undefined
    const here = hand.draft?.card === c
    const { action, issue } = hand
    return {
      targets: hand.targets.get(c) ?? [],
      hint: hand.held === null,
      onSlot: (slot) => hand.act({ type: 'put', card: c, slot }),
      onPlaced: (slot, die) => hand.tap({ type: 'tapPlaced', card: c, slot, die }),
      drag: hand.dragDie,
      lifted: hand.dragging?.die ?? null,
      onConfirm: action && here ? () => commit(action) : undefined,
      issue: here && issue ? issueText(issue) : null,
    }
  }

  const hp = (who: 0 | 1) => seats[who].player.hp + clock.unlanded(who)
  const maxHp = board.config.maxHp
  const rolling = !!clock.banner?.turn
  const marks = (
    <>
      {!revealing && board.winner === null && view.opponentReady && <Mark icon={CircleCheck} label="相手は決定した" />}
      {over !== null && after.opponentWaiting && <Mark icon={CircleCheck} label="相手はもう一戦を押した" />}
      {opponentAway && <Mark icon={WifiOff} label="相手の接続が切れている" />}
    </>
  )

  return (
    <main className="table">
      <h1 className="sr-only">Duelice</h1>

      <Modal ref={peekDialog} title="相手のカード" className="modal-peek" onClose={() => setPeek(null)}>
        {peek && (
          <ul className="cards cards-one">
            <SeatCard seat={seats[1]} card={peek} shown={null} revealing={false} />
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        ref={passDialog}
        title="パスしますか？"
        cancel="やめる"
        confirm="パスする"
        onConfirm={() => commit({ kind: 'pass' })}
      />
      <ConfirmDialog
        ref={surrenderDialog}
        title="降参しますか？"
        cancel="続ける"
        confirm="降参する"
        danger
        onConfirm={onSurrender}
      />

      <Seat
        side="cpu"
        name={opponent}
        marks={marks}
        hp={hp(1)}
        maxHp={maxHp}
        chant={clock.quiet ? 'none' : seats[1].player.chant}
        tray={<Tray key={board.turn} seat={seats[1]} shown={cpuShown} rolling={rolling} />}
        cards={
          <SeatCards
            seat={seats[1]}
            shown={cpuShown}
            revealing={revealing}
            narrow={narrow}
            onPick={(c) => {
              setPeek(c)
              peekDialog.current?.showModal()
            }}
          />
        }
      />

      {clock.reveal && over === null && (
        <Exchange
          key={board.history.length}
          report={clock.reveal.report}
          top={<ClashSide side="cpu" name={opponent} hp={hp(1)} maxHp={maxHp} />}
          bottom={<ClashSide side="me" name="あなた" hp={hp(0)} maxHp={maxHp} />}
        />
      )}

      <Arena
        turn={clock.reveal?.report.turn ?? board.turn}
        step={clock.reveal?.report.step ?? board.step}
        history={board.history}
        revealing={revealing}
        lines={clock.reveal && reportLines(clock.reveal.report, 0)}
        over={over === null ? null : { ...after, winner: over, hp: [board.players[0].hp, board.players[1].hp], reason }}
        banner={clock.banner}
        timer={timer && !revealing && board.winner === null && <Countdown {...timer} />}
        onSurrender={board.winner === null ? () => surrenderDialog.current?.showModal() : undefined}
      />

      <Seat
        side="me"
        name="あなた"
        hp={hp(0)}
        maxHp={maxHp}
        chant={clock.quiet ? 'none' : seats[0].player.chant}
        tray={
          <Tray
            key={board.turn}
            seat={seats[0]}
            shown={myShown}
            rolling={rolling}
            play={
              choosing
                ? {
                    held: hand.held,
                    onTap: (die) => hand.tap({ type: 'tapTray', die }),
                    drag: hand.dragDie,
                    lifted: hand.dragging?.die ?? null,
                  }
                : undefined
            }
          />
        }
        extra={
          <button
            type="button"
            className="pass"
            aria-label="パス"
            title="パス"
            disabled={!choosing}
            onClick={() => passDialog.current?.showModal()}
          >
            <SkipForward aria-hidden="true" />
          </button>
        }
        cards={
          <SeatCards
            seat={seats[0]}
            shown={myShown}
            revealing={revealing}
            narrow={narrow}
            current={myCurrent}
            onPick={choosing ? (c) => hand.act({ type: 'consider', card: c }) : undefined}
            hint={choosing && hand.held === null}
            playFor={playFor}
          />
        }
      />
      {/* 決定できない理由が変わったら読み上げる。見た目は決定の場所の札で伝える */}
      <p className="sr-only" role="status">
        {choosing && hand.issue ? issueText(hand.issue) : ''}
      </p>

      {hand.dragging && (
        <div className="drag-ghost" style={{ left: hand.dragging.x, top: hand.dragging.y }} aria-hidden="true">
          <Die value={board.players[0].roll[hand.dragging.die]} />
        </div>
      )}
    </main>
  )
}
