import { SkipForward } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { ACTION_DEFS, CARD_DEFS, CARD_ORDER } from '../game/cards'
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
  actionLabel,
  type CardId,
  freeDice,
  type GameState,
  newGame,
  nextTurn,
  type PlayerIndex,
  type PlayerState,
  type Rng,
  resolveStep,
  type StepReport,
  turnOver,
} from '../game/rules'
import { Card, type CardPlay, type Shown } from './Card'
import { Die } from './Die'
import { useDiceDrag } from './useDiceDrag'

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

export function Game({ rng = Math.random, opponent }: GameProps) {
  const [level, setLevel] = useState<Level>('normal')
  const [game, setGame] = useState<GameState | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  /** タップで持ち上げたダイス。次にタップした置き場に置く */
  const [held, setHeld] = useState<number | null>(null)
  const thinker = useRef(new Thinker())
  const drag = useDiceDrag()

  const clearHand = () => {
    setPlacement(null)
    setHeld(null)
  }

  const start = () => {
    thinker.current = new Thinker()
    setGame(newGame(rng))
    setRevealed(false)
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
    clearHand()
  }

  const proceed = () => {
    if (game.winner !== null) return
    setGame(turnOver(game) ? nextTurn(game, rng) : game)
    setRevealed(false)
  }

  const put = (card: CardId, die: number) => {
    const next = placeDie(game, 0, placement, card, die)
    if (next) setPlacement(next)
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

  const cardsOf = (who: PlayerIndex, shown: (Shown & { card: CardId }) | null, extra?: ReactNode) => {
    const p = game.players[who]
    const usable = availableCards(game, who)
    return (
      <ul className="cards">
        {CARD_ORDER.map((c) => (
          <Card
            key={c}
            card={c}
            roll={p.roll}
            active={usable.has(c) ? kindsNow(game, who, c) : []}
            used={p.usedCards.includes(c) && !usable.has(c)}
            shown={shown?.card === c ? shown : null}
            play={who === 0 ? playFor(c) : undefined}
          />
        ))}
        {extra}
      </ul>
    )
  }

  const trayOf = (who: PlayerIndex, shown: Shown | null) => {
    const p = game.players[who]
    const free = freeDice(p)
    return (
      <fieldset className="tray" aria-label="ダイス" data-drop={who === 0 && choosing ? 'tray' : undefined}>
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
    <li className="pass-slot">
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
    </li>
  )

  return (
    <main className="table">
      <header className="table-head">
        <h1 className="logo">Duelice</h1>
        <p className="turn-label">
          {`${showReveal ? last.turn : game.turn}ターン目 ${(showReveal ? last.step : game.step) === 1 ? '一' : '二'}ステップ目${revealed ? ' 公開' : ''}`}
        </p>
        <p className="level-label">相手の強さ：{LEVEL_NAMES[level]}</p>
      </header>

      <Seat side="cpu" name="相手" player={game.players[1]} maxHp={game.config.maxHp}>
        {cardsOf(1, cpuShown)}
        {trayOf(1, cpuShown)}
      </Seat>

      {(showReveal || game.winner !== null) && (
        <section className="arena" aria-live="polite">
          {showReveal && <Reveal report={last} />}
          {game.winner !== null ? (
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
          ) : (
            // 公開後は Enter だけで先へ進めるように、進むボタンへフォーカスを移す
            // biome-ignore lint/a11y/noAutofocus: 操作の流れに沿ったフォーカス移動で、ページ読み込み時の自動フォーカスではない
            <button type="button" className="btn btn-primary" onClick={proceed} autoFocus>
              {turnOver(game) ? '次のターンへ' : '二ステップ目へ'}
            </button>
          )}
        </section>
      )}

      <Seat side="me" name="あなた" player={game.players[0]} maxHp={game.config.maxHp}>
        {trayOf(0, myShown)}
        {cardsOf(0, myShown, pass)}
      </Seat>

      {drag.view && (
        <div className="drag-ghost" style={{ left: drag.view.x, top: drag.view.y }} aria-hidden="true">
          <Die value={game.players[0].roll[drag.view.die]} />
        </div>
      )}

      <Log history={game.history} />
      <Rules />
    </main>
  )
}

function Title({ level, setLevel, onStart }: { level: Level; setLevel: (l: Level) => void; onStart: () => void }) {
  return (
    <main className="title">
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
      <Rules open />
    </main>
  )
}

interface SeatProps {
  side: 'me' | 'cpu'
  name: string
  player: PlayerState
  maxHp: number
  /** 体力から遠い順に並べる中身。相手は カード、ダイス、自分は ダイス、カード の順に渡す */
  children: ReactNode
}

/** 席。相手と自分で上下が対になるように、体力の帯を卓の中央側に置く */
function Seat({ side, name, player, maxHp, children }: SeatProps) {
  const hp = Math.max(0, player.hp)
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
      {player.chant === 'charged' && <span className="badge badge-chant">詠唱中</span>}
      {player.chant === 'broken' && <span className="badge">詠唱は崩れた</span>}
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

function Reveal({ report }: { report: StepReport }) {
  const side = (i: 0 | 1) => (
    <div className={`reveal-side reveal-${i === 0 ? 'me' : 'cpu'}`}>
      <span className="reveal-who">{i === 0 ? 'あなた' : '相手'}</span>
      <span className="reveal-action">{actionLabel(report.actions[i])}</span>
      <span className="reveal-dice">
        {report.values[i].map((v, k) => (
          <Die key={k} value={v} size="small" />
        ))}
      </span>
      <span className="reveal-damage">{report.damage[i] > 0 ? `${report.damage[i]}点受けた` : '無傷'}</span>
    </div>
  )
  return (
    <div className="reveal">
      <div className="reveal-pair">
        {side(1)}
        {side(0)}
      </div>
      <ul className="reveal-lines">
        {report.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  )
}

function Log({ history }: { history: StepReport[] }) {
  const items = useMemo(() => [...history].reverse(), [history])
  if (items.length === 0) return null
  return (
    <details className="log">
      <summary>これまでの経過</summary>
      <ol className="log-list">
        {items.map((r, i) => (
          <li key={i}>
            <span className="log-when">
              {r.turn}ターン目 {r.step === 1 ? '一' : '二'}ステップ目
            </span>
            {r.lines.join('。')}。あなた {r.damage[0]}点、相手 {r.damage[1]}点
          </li>
        ))}
      </ol>
    </details>
  )
}

function Rules({ open = false }: { open?: boolean }) {
  return (
    <details className="rules" open={open}>
      <summary>ルール</summary>
      <ul className="rules-list">
        <li>毎ターン、互いに3個のダイスを振る。出目は全て公開</li>
        <li>1ターンは二ステップ。各ステップでカードを1枚選んでダイスを置き、同時に公開して解決する</li>
        <li>一ステップ目に使わなかったダイスは二ステップ目に使える。同じカードは1ターンに1回まで</li>
        <li>体力が先に0になった方の負け。同時なら引き分け</li>
        {CARD_ORDER.map((c) => (
          <li key={c}>
            <strong>{CARD_DEFS[c].name}</strong>：{CARD_DEFS[c].text}
          </li>
        ))}
      </ul>
    </details>
  )
}
