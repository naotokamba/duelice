import { Flag, SkipForward } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ACTION_DEFS, CARD_ORDER } from '../game/cards'
import {
  availableCards,
  composeAction,
  kindsNow,
  type Placement,
  placeDie,
  placedKind,
  removeDie,
} from '../game/compose'
import { LEVEL_NAMES, type Level, Thinker } from '../game/cpu'
import {
  type Action,
  type CardId,
  freeDice,
  type GameState,
  newGame,
  nextTurn,
  type PlayerIndex,
  type PlayerState,
  type Rng,
  resolveStep,
  strikes,
  turnOver,
} from '../game/rules'
import { Card, type CardPlay, CardTabs, type Shown } from './Card'
import { Die } from './Die'
import { Exchange, IMPACT_MS, landsAt, revealMs } from './Exchange'
import { History } from './History'
import { RulesButton } from './RulesButton'
import { useDiceDrag } from './useDiceDrag'
import { useNarrow } from './useNarrow'

/** 相手の手を決める関数。既定はCPU。テストやオンライン対戦で差し替える */
export type Opponent = (state: GameState, level: Level, rng: Rng) => Action

interface GameProps {
  /** テストでは固定の乱数を渡す */
  rng?: Rng
  opponent?: Opponent
}

/** 公開した行動を、カードに置いたダイスとして見せる */
function shownOf(a: Action | undefined): (Shown & { card: CardId }) | null {
  if (!a || a.kind === 'pass') return null
  return { card: ACTION_DEFS[a.kind].card, kind: a.kind, dice: a.dice, complete: true }
}

function isCardId(s: string | null): s is CardId {
  return CARD_ORDER.includes(s as CardId)
}

/** ステップやターンの切り替わりを知らせる帯を出す時間 */
export const BANNER_MS = 900

interface Banner {
  text: string
  /** 新しいターン。ダイスを振る動きを付ける */
  turn: boolean
}

export function Game({ rng = Math.random, opponent }: GameProps) {
  const [level, setLevel] = useState<Level>('normal')
  const [game, setGame] = useState<GameState | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  /** タップで持ち上げたダイス。次にタップした置き場に置く */
  const [held, setHeld] = useState<number | null>(null)
  /** 狭い画面で大きく出しているカード */
  const [focus, setFocus] = useState<CardId | null>(null)
  /** 公開してから、何ミリ秒目までの攻撃が当たったか。当たった分だけ体力を減らして見せる */
  const [landed, setLanded] = useState(Number.POSITIVE_INFINITY)
  /** 決着した公開の動きが終わった。勝敗はそれから出す */
  const [settled, setSettled] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const thinker = useRef(new Thinker())
  const drag = useDiceDrag()
  const narrow = useNarrow()
  /** 降参の確認 */
  const surrenderDialog = useRef<HTMLDialogElement>(null)

  // 公開したら、矢印が当たる時刻に体力を減らし、動きが終わったら自動で次のステップかターンへ進む
  useEffect(() => {
    const last = game?.history[game.history.length - 1]
    if (!game || !revealed || !last) return
    const list = strikes(last.values, last.actions)
    const timers = [...new Set(list.map(landsAt))].map((t) => setTimeout(() => setLanded(t), t))
    timers.push(
      setTimeout(() => {
        setLanded(Number.POSITIVE_INFINITY)
        if (game.winner !== null) {
          setSettled(true)
          return
        }
        const turn = turnOver(game)
        setGame(turn ? nextTurn(game, rng) : game)
        setRevealed(false)
        // 狭い画面で出していたカードは使い終わっているかもしれないので、使える最初のカードに戻す
        setFocus(null)
        setBanner({ text: turn ? `Turn ${game.turn + 1}` : 'Step 2', turn })
      }, revealMs(list)),
    )
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [game, revealed, rng])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), BANNER_MS)
    return () => clearTimeout(t)
  }, [banner])

  const clearHand = () => {
    setPlacement(null)
    setHeld(null)
  }

  const start = () => {
    thinker.current = new Thinker()
    setGame(newGame(rng))
    setRevealed(false)
    setSettled(false)
    setLanded(Number.POSITIVE_INFINITY)
    setBanner({ text: 'Turn 1', turn: true })
    setFocus(null)
    clearHand()
  }

  if (!game) return <Title level={level} setLevel={setLevel} onStart={start} />

  const last = game.history[game.history.length - 1]
  const showReveal = revealed && last !== undefined
  const choosing = !revealed && game.winner === null
  const action = placement ? composeAction(game, 0, placement.card, placement.dice) : null

  const commit = (mine: Action) => {
    const theirs = opponent ? opponent(game, level, rng) : thinker.current.decide(game, 1, level, rng)
    setGame(resolveStep(game, [mine, theirs]))
    setRevealed(true)
    setLanded(0)
    setBanner(null)
    clearHand()
  }

  /** まだ矢印が当たっていないダメージ。公開の途中は、その分だけ体力を多く見せる */
  const pending = (who: PlayerIndex) =>
    showReveal
      ? strikes(last.values, last.actions)
          .filter((x) => x.to === who && landsAt(x) > landed)
          .reduce((sum, x) => sum + x.dealt, 0)
      : 0
  /** 詠唱の結果は、矢印が当たるまで伏せる */
  const quiet = showReveal && landed < IMPACT_MS

  const put = (card: CardId, die: number) => {
    const next = placeDie(game, 0, placement, card, die)
    if (next) {
      setPlacement(next)
      setFocus(card)
    }
    setHeld(null)
  }

  const takeBack = (die: number) => {
    setPlacement(removeDie(placement, die))
    setHeld(null)
  }

  const dragDie = (die: number) =>
    drag.bind(die, {
      start: () => setHeld(die),
      drop: (target) => {
        if (target === 'tray') takeBack(die)
        else if (isCardId(target)) put(target, die)
        else setHeld(null)
      },
    })

  /** 引きずりの直後に届くクリックは、タップとして扱わない */
  const tap = (f: () => void) => () => {
    if (!drag.afterDrop()) f()
  }

  const myShown = showReveal
    ? shownOf(last.actions[0])
    : placement && {
        card: placement.card,
        kind: placedKind(game, 0, placement),
        dice: placement.dice,
        complete: action !== null,
      }
  const cpuShown = showReveal ? shownOf(last.actions[1]) : null

  const playFor = (c: CardId): CardPlay | undefined => {
    if (!choosing) return undefined
    return {
      target: held !== null && placeDie(game, 0, placement, c, held) !== null,
      hint: held === null,
      onSlot: () => held !== null && put(c, held),
      onTakeBack: (die) => tap(() => takeBack(die))(),
      drag: dragDie,
      lifted: drag.view?.die ?? null,
      onConfirm: action && placement?.card === c ? () => commit(action) : undefined,
    }
  }

  const cardsOf = (who: PlayerIndex, shown: (Shown & { card: CardId }) | null) => {
    const p = game.players[who]
    const usable = availableCards(game, who)
    const cardView = (c: CardId) => (
      <Card
        key={c}
        card={c}
        roll={p.roll}
        active={usable.has(c) ? kindsNow(game, who, c) : []}
        used={p.usedCards.includes(c) && !usable.has(c)}
        shown={shown?.card === c ? shown : null}
        play={who === 0 ? playFor(c) : undefined}
      />
    )
    if (!narrow) return <ul className="cards">{CARD_ORDER.map(cardView)}</ul>

    // 狭い画面では名前を並べ、一枚だけ大きく出す。相手は公開したカードだけ出す
    const current =
      who === 0 ? (shown?.card ?? focus ?? CARD_ORDER.find((c) => usable.has(c)) ?? CARD_ORDER[0]) : shown?.card
    const tabs = (
      <CardTabs
        tabs={CARD_ORDER.map((c) => ({
          card: c,
          off: !usable.has(c) && shown?.card !== c,
          current: c === current,
          target: who === 0 && choosing && held !== null && placeDie(game, 0, placement, c, held) !== null,
          hint: who === 0 && choosing && held === null && usable.has(c),
          placed: shown?.card === c,
        }))}
        onPick={who === 0 && choosing ? pick : undefined}
      />
    )
    const one = current && <ul className="cards cards-one">{cardView(current)}</ul>
    return who === 0 ? (
      <>
        {tabs}
        {one}
      </>
    ) : (
      <>
        {one}
        {tabs}
      </>
    )
  }

  /** 狭い画面でカードの名前を押した。持っているダイスを置けるなら置き、そのカードを出す */
  const pick = (c: CardId) => {
    if (held !== null && placeDie(game, 0, placement, c, held)) put(c, held)
    else setFocus(c)
  }

  const trayOf = (who: PlayerIndex, shown: Shown | null, extra?: ReactNode) => {
    const p = game.players[who]
    const free = freeDice(p)
    return (
      <fieldset
        key={game.turn}
        className={banner?.turn ? 'tray is-rolling' : 'tray'}
        aria-label="ダイス"
        data-drop={who === 0 && choosing ? 'tray' : undefined}
      >
        {p.roll.map((v, i) => {
          if (shown?.dice.includes(i)) return <span key={i} className="socket" aria-hidden="true" />
          const used = !free.includes(i)
          if (who === 1 || !choosing || used) return <Die key={i} value={v} used={used} />
          return (
            <Die
              key={i}
              value={v}
              selected={held === i}
              hint={held === null}
              onClick={tap(() => setHeld(held === i ? null : i))}
              drag={dragDie(i)}
              lifted={drag.view?.die === i}
            />
          )
        })}
        {extra}
      </fieldset>
    )
  }

  const pass = (
    <button
      type="button"
      className="pass"
      aria-label="パス"
      title="パス"
      disabled={!choosing}
      onClick={() => commit({ kind: 'pass' })}
    >
      <SkipForward aria-hidden="true" />
    </button>
  )

  return (
    <main className="table">
      <header className="table-head">
        <h1 className="logo">Duelice</h1>
        <p className="turn-label">
          {`Turn ${showReveal ? last.turn : game.turn} - Step ${showReveal ? last.step : game.step}`}
        </p>
        <p className="level-label">相手の強さ：{LEVEL_NAMES[level]}</p>
        <RulesButton />
        {game.winner === null && (
          <button type="button" className="surrender" onClick={() => surrenderDialog.current?.showModal()}>
            <Flag aria-hidden="true" />
            降参
          </button>
        )}
      </header>

      {/* 降参すると対局をやめてタイトルに戻る。誤って押したときのために、最初は続けるを選んでおく */}
      <dialog ref={surrenderDialog} className="confirm-dialog" aria-labelledby="surrender-title">
        <p id="surrender-title" className="dialog-title">
          降参しますか？
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => surrenderDialog.current?.close()}>
            続ける
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              surrenderDialog.current?.close()
              setGame(null)
            }}
          >
            降参する
          </button>
        </div>
      </dialog>

      <Seat
        side="cpu"
        name="相手"
        player={game.players[1]}
        hp={game.players[1].hp + pending(1)}
        maxHp={game.config.maxHp}
        quiet={quiet}
      >
        {cardsOf(1, cpuShown)}
        {trayOf(1, cpuShown)}
      </Seat>

      <section className="arena">
        {showReveal && <Exchange key={game.history.length} report={last} />}
        {showReveal && (
          <ul className="sr-only" aria-live="polite">
            {last.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        {!revealed && <History history={game.history} />}
        {banner && !revealed && (
          <p key={banner.text} className="banner">
            {banner.text}
          </p>
        )}
        {settled && game.winner !== null && (
          <div className="result">
            <p className="result-text">
              {game.winner === 'draw' ? '相打ち。引き分けです' : game.winner === 0 ? 'あなたの勝ち' : '相手の勝ち'}
            </p>
            <div className="result-actions">
              <button type="button" className="btn btn-primary" onClick={start}>
                もう一戦
              </button>
              <button type="button" className="btn" onClick={() => setGame(null)}>
                強さを選び直す
              </button>
            </div>
          </div>
        )}
      </section>

      <Seat
        side="me"
        name="あなた"
        player={game.players[0]}
        hp={game.players[0].hp + pending(0)}
        maxHp={game.config.maxHp}
        quiet={quiet}
      >
        {trayOf(0, myShown, pass)}
        {cardsOf(0, myShown)}
      </Seat>

      {drag.view && (
        <div className="drag-ghost" style={{ left: drag.view.x, top: drag.view.y }} aria-hidden="true">
          <Die value={game.players[0].roll[drag.view.die]} />
        </div>
      )}
    </main>
  )
}

function Title({ level, setLevel, onStart }: { level: Level; setLevel: (l: Level) => void; onStart: () => void }) {
  return (
    <main className="title">
      <div className="title-help">
        <RulesButton />
      </div>
      <h1 className="title-logo">Duelice</h1>
      <p className="title-lead">3個のダイスを振り、見えている目で読み合う魔術師の決闘</p>
      <fieldset className="level-pick">
        <legend>相手の強さ</legend>
        {(Object.keys(LEVEL_NAMES) as Level[]).map((l) => (
          <label key={l} className={l === level ? 'level-option is-on' : 'level-option'}>
            <input type="radio" name="level" value={l} checked={l === level} onChange={() => setLevel(l)} />
            {LEVEL_NAMES[l]}
          </label>
        ))}
      </fieldset>
      <button type="button" className="btn btn-primary btn-large" onClick={onStart}>
        決闘を始める
      </button>
    </main>
  )
}

interface SeatProps {
  side: 'me' | 'cpu'
  name: string
  player: PlayerState
  /** 見せる体力。公開の途中は、まだ当たっていないダメージの分だけ多い */
  hp: number
  maxHp: number
  /** 詠唱の結果を伏せる */
  quiet: boolean
  /** 体力から遠い順に並べる中身。相手は カード、ダイス、自分は ダイス、カード の順に渡す */
  children: ReactNode
}

/** 席。相手と自分で上下が対になるように、体力の帯を卓の中央側に置く */
function Seat({ side, name, player, hp: shown, maxHp, quiet, children }: SeatProps) {
  const hp = Math.max(0, shown)
  const status = (
    <div className="seat-status">
      <h2 className="seat-name">{name}</h2>
      <div className="hp" role="img" aria-label={`体力 ${hp} / ${maxHp}`}>
        <div className="hp-bar">
          <div className="hp-fill" style={{ width: `${(hp / maxHp) * 100}%` }} />
        </div>
        <span className="hp-num">
          {hp}
          <small> / {maxHp}</small>
        </span>
      </div>
      {!quiet && player.chant === 'charged' && <span className="badge badge-chant">詠唱中</span>}
      {!quiet && player.chant === 'broken' && <span className="badge">詠唱は崩れた</span>}
    </div>
  )
  return (
    <section className={`seat seat-${side}`} aria-label={name}>
      {side === 'me' && status}
      {children}
      {side === 'cpu' && status}
    </section>
  )
}
