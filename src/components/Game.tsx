import { SkipForward, X } from 'lucide-react'
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
import { closeOnBackdrop } from './dialog'
import { Exchange, IMPACT_MS, landsAt, revealMs } from './Exchange'
import { HistoryButton, Recent } from './History'
import { MatchMenu } from './MatchMenu'
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
export const BANNER_MS = 1100

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
  /** パスの確認 */
  const passDialog = useRef<HTMLDialogElement>(null)
  /** 狭い画面で、名前を押して大きく見ている相手のカード */
  const [peek, setPeek] = useState<CardId | null>(null)
  const peekDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (peek) peekDialog.current?.showModal()
  }, [peek])

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
  /** 決着して、最後の公開の動きも終わった */
  const over = settled && game.winner !== null
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

  /** 席のカードを1枚描く */
  const cardView = (who: PlayerIndex, c: CardId, shown: (Shown & { card: CardId }) | null = null) => {
    const p = game.players[who]
    const usable = availableCards(game, who)
    return (
      <Card
        key={c}
        card={c}
        roll={p.roll}
        active={usable.has(c) ? kindsNow(game, who, c) : []}
        used={p.usedCards.includes(c) && !usable.has(c)}
        shown={shown?.card === c ? shown : null}
        casting={showReveal && shown?.card === c}
        play={who === 0 ? playFor(c) : undefined}
      />
    )
  }

  const cardsOf = (who: PlayerIndex, shown: (Shown & { card: CardId }) | null) => {
    const usable = availableCards(game, who)
    if (!narrow) return <ul className="cards">{CARD_ORDER.map((c) => cardView(who, c, shown))}</ul>

    // 狭い画面では名前を並べ、自分のカードは一枚だけ大きく出す
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
        onPick={who === 0 ? (choosing ? pick : undefined) : setPeek}
      />
    )
    // 相手のカードは名前だけ並べる。公開した技は中央の名乗りの札で分かり、カードは名前を押せばモーダルで見られる
    if (who === 1) return tabs
    return (
      <>
        {tabs}
        {current && <ul className="cards cards-one">{cardView(who, current, shown)}</ul>}
      </>
    )
  }

  /** 狭い画面でカードの名前を押した。持っているダイスを置けるなら置き、そのカードを出す */
  const pick = (c: CardId) => {
    if (held !== null && placeDie(game, 0, placement, c, held)) put(c, held)
    else setFocus(c)
  }

  const trayOf = (who: PlayerIndex, shown: Shown | null) => {
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
      onClick={() => passDialog.current?.showModal()}
    >
      <SkipForward aria-hidden="true" />
    </button>
  )

  return (
    <main className="table">
      {/* 対局中はヘッダーを出さず、卓を広く使う。ルールと降参は中央の段の右端のメニューにしまう */}
      <h1 className="sr-only">Duelice</h1>

      {/* 狭い画面では相手のカードは名前だけなので、名前を押すとカードを大きく出す */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 外を押して閉じるのはマウスと指のため。キーボードでは Esc で閉じる */}
      <dialog
        ref={peekDialog}
        className="peek-dialog"
        aria-labelledby="peek-title"
        onClick={closeOnBackdrop}
        onClose={() => setPeek(null)}
      >
        <div className="rules-head">
          <h2 id="peek-title" className="dialog-title">
            相手のカード
          </h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="閉じる"
            title="閉じる"
            onClick={() => peekDialog.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {peek && <ul className="cards cards-one">{cardView(1, peek)}</ul>}
      </dialog>

      {/* パスは取り消せないので確かめる。誤って押したときのために、最初はやめるを選んでおく */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 外を押して閉じるのはマウスと指のため。キーボードでは Esc で閉じる */}
      <dialog ref={passDialog} className="confirm-dialog" aria-labelledby="pass-title" onClick={closeOnBackdrop}>
        <p id="pass-title" className="dialog-title">
          パスしますか？
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => passDialog.current?.close()}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              passDialog.current?.close()
              commit({ kind: 'pass' })
            }}
          >
            パスする
          </button>
        </div>
      </dialog>

      {/* 降参すると対局をやめてタイトルに戻る。誤って押したときのために、最初は続けるを選んでおく */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 外を押して閉じるのはマウスと指のため。キーボードでは Esc で閉じる */}
      <dialog
        ref={surrenderDialog}
        className="confirm-dialog"
        aria-labelledby="surrender-title"
        onClick={closeOnBackdrop}
      >
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
        tray={trayOf(1, cpuShown)}
        cards={cardsOf(1, cpuShown)}
      />

      {/* 公開の演出は、卓の上に重ねた幕で見せる。決着して動きが終わったら消す */}
      {showReveal && !over && (
        <Exchange
          key={game.history.length}
          report={last}
          top={<ClashSide side="cpu" name="相手" hp={game.players[1].hp + pending(1)} maxHp={game.config.maxHp} />}
          bottom={<ClashSide side="me" name="あなた" hp={game.players[0].hp + pending(0)} maxHp={game.config.maxHp} />}
        />
      )}

      <section className="arena">
        {showReveal && (
          <ul className="sr-only" aria-live="polite">
            {last.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        {/* 左端に今のターンとステップ、中央に一つ前の結果や勝敗、右端にメニューを出す */}
        <div className="arena-row">
          <TurnLabel turn={showReveal ? last.turn : game.turn} step={showReveal ? last.step : game.step} />
          <div className="arena-main">
            {!revealed && <Recent history={game.history} />}
            {over && (
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
            {over && <Recent history={game.history} />}
          </div>
          {/* 右端に履歴の印とメニューを縦に並べる。メニューは下に揃えて、履歴が出ても動かさない */}
          <div className="arena-tools">
            {(!revealed || over) && <HistoryButton history={game.history} />}
            <MatchMenu onSurrender={game.winner === null ? () => surrenderDialog.current?.showModal() : undefined} />
          </div>
        </div>
        {banner && !revealed && (
          <p key={banner.text} className="banner">
            <span>{banner.text}</span>
          </p>
        )}
      </section>

      <Seat
        side="me"
        name="あなた"
        player={game.players[0]}
        hp={game.players[0].hp + pending(0)}
        maxHp={game.config.maxHp}
        quiet={quiet}
        tray={trayOf(0, myShown)}
        extra={pass}
        cards={cardsOf(0, myShown)}
      />

      {drag.view && (
        <div className="drag-ghost" style={{ left: drag.view.x, top: drag.view.y }} aria-hidden="true">
          <Die value={game.players[0].roll[drag.view.die]} />
        </div>
      )}
    </main>
  )
}

/**
 * 今のターンとステップ。上下の席の間の左端に、ターンの下にステップの札を縦に並べる。
 * 終わったステップを埋め、今のステップを枠で強調する。押せるものではないので動かさない
 */
function TurnLabel({ turn, step }: { turn: number; step: 1 | 2 }) {
  return (
    <p className="turn-label">
      <span className="sr-only">{`Turn ${turn} - Step ${step}`}</span>
      <span className="turn-num" aria-hidden="true">
        Turn {turn}
      </span>
      <span className="steps" aria-hidden="true">
        {([1, 2] as const).map((s) => (
          <span key={s} className={`step-pill${s < step ? ' is-done' : s === step ? ' is-now' : ''}`}>
            {s}
          </span>
        ))}
      </span>
    </p>
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

/** 公開の幕の上下の端に出す体力の帯。当たった時に減る */
function ClashSide({ side, name, hp, maxHp }: { side: 'me' | 'cpu'; name: string; hp: number; maxHp: number }) {
  const shown = Math.max(0, hp)
  return (
    <div className={`clash-side side-${side}`}>
      <span className="clash-name">{name}</span>
      <div className="hp-bar">
        <div className="hp-fill" style={{ width: `${(shown / maxHp) * 100}%` }} />
      </div>
      <span className="hp-num">{shown}</span>
    </div>
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
  /** 手元のダイス。体力と同じ段に並べる */
  tray: ReactNode
  /** ダイスと体力の段の右端に置くもの。自分の席のパス */
  extra?: ReactNode
  cards: ReactNode
}

/** 席。相手と自分で上下が対になるように、ダイスと体力の段を卓の中央側に置く */
function Seat({ side, name, player, hp: shown, maxHp, quiet, tray, extra, cards }: SeatProps) {
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
  // 高さを抑えるため、ダイスと体力を一つの段に並べる。段は卓の中央側に置く
  const row = (
    <div className="seat-row">
      {tray}
      {status}
      {extra}
    </div>
  )
  return (
    <section className={`seat seat-${side}`} aria-label={name}>
      {side === 'me' && row}
      {cards}
      {side === 'cpu' && row}
    </section>
  )
}
