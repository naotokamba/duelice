import { useMemo, useRef, useState } from 'react'
import { Die } from './Die'
import { LEVEL_NAMES, type Level, Thinker } from '../game/cpu'
import {
  type Action,
  type CardId,
  CARD_NAMES,
  type GameState,
  type PlayerState,
  type StepReport,
  actionLabel,
  freeDice,
  isLegal,
  legalActions,
  newGame,
  nextTurn,
  resolveStep,
  turnOver,
} from '../game/rules'

const CARDS: CardId[] = ['fireball', 'barrier', 'bullet', 'spear', 'reflect']

const CARD_TEXT: Record<CardId, string> = {
  fireball: '2個置く。高い方の目のダメージ',
  barrier: '1個置く。このステップに受ける攻撃を、置いた目だけ減らす。魔弾は防げない',
  bullet: '1個で2点、2個で3点。目は問わず、障壁をすり抜ける',
  spear: '一ステップ目に1個で詠唱。置いた目以上のダメージを受けると崩れる。二ステップ目に2個で発動し、合計のダメージ',
  reflect: '同じ目を2個置く。このステップに受ける攻撃を無効化し、相手に返す',
}

/** カードと選んだダイスから行動を組み立てる */
function buildAction(card: CardId, dice: number[], step: 1 | 2): Action | null {
  switch (card) {
    case 'fireball':
      return dice.length === 2 ? { kind: 'fireball', dice: [dice[0], dice[1]] } : null
    case 'barrier':
      return dice.length === 1 ? { kind: 'barrier', dice: [dice[0]] } : null
    case 'bullet':
      if (dice.length === 1) return { kind: 'bullet', dice: [dice[0]] }
      if (dice.length === 2) return { kind: 'bullet', dice: [dice[0], dice[1]] }
      return null
    case 'spear':
      if (step === 1) return dice.length === 1 ? { kind: 'spearChant', dice: [dice[0]] } : null
      return dice.length === 2 ? { kind: 'spearCast', dice: [dice[0], dice[1]] } : null
    case 'reflect':
      return dice.length === 2 ? { kind: 'reflect', dice: [dice[0], dice[1]] } : null
  }
}

function maxDice(card: CardId, step: 1 | 2): number {
  if (card === 'barrier') return 1
  if (card === 'spear') return step === 1 ? 1 : 2
  return 2
}

/** そのプレイヤーが今のステップで使えるカード */
function availableCards(state: GameState, who: 0 | 1): Set<CardId> {
  const set = new Set<CardId>()
  for (const a of legalActions(state, who)) {
    if (a.kind === 'pass') continue
    set.add(a.kind === 'spearChant' || a.kind === 'spearCast' ? 'spear' : a.kind)
  }
  return set
}

export function Game() {
  const [level, setLevel] = useState<Level>('normal')
  const [game, setGame] = useState<GameState | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [card, setCard] = useState<CardId | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const thinker = useRef(new Thinker())

  const start = () => {
    thinker.current = new Thinker()
    setGame(newGame(Math.random))
    setRevealed(false)
    setCard(null)
    setPicked([])
  }

  if (!game) return <Title level={level} setLevel={setLevel} onStart={start} />

  const me = game.players[0]
  const cpu = game.players[1]
  const last = game.history[game.history.length - 1]
  const choosing = !revealed && game.winner === null
  const myCards = availableCards(game, 0)
  const cpuCards = availableCards(game, 1)
  const action = card ? buildAction(card, picked, game.step) : null
  const ready = action !== null && isLegal(game, 0, action)

  const commit = (mine: Action) => {
    const theirs = thinker.current.decide(game, 1, level, Math.random)
    setGame(resolveStep(game, [mine, theirs]))
    setRevealed(true)
    setCard(null)
    setPicked([])
  }

  const proceed = () => {
    if (game.winner !== null) return
    setGame(turnOver(game) ? nextTurn(game, Math.random) : game)
    setRevealed(false)
  }

  const chooseCard = (c: CardId) => {
    setCard(card === c ? null : c)
    setPicked([])
  }

  const toggleDie = (i: number) => {
    if (!card) return
    if (picked.includes(i)) setPicked(picked.filter((x) => x !== i))
    else if (picked.length < maxDice(card, game.step)) setPicked([...picked, i])
  }

  return (
    <main className="table">
      <header className="table-head">
        <h1 className="logo">Duelice</h1>
        <p className="turn-label">
          {`${revealed && last ? last.turn : game.turn}ターン目 ${(revealed && last ? last.step : game.step) === 1 ? '一' : '二'}ステップ目${revealed ? ' 公開' : ''}`}
        </p>
        <p className="level-label">相手の強さ：{LEVEL_NAMES[level]}</p>
      </header>

      <Seat side="cpu" name="相手" player={cpu} maxHp={game.config.maxHp} cards={cpuCards} hideUsed={revealed} />

      <section className="arena" aria-live="polite">
        {revealed && last ? (
          <Reveal report={last} />
        ) : (
          <p className="arena-hint">
            {game.step === 1
              ? 'ダイスは互いに公開されています。カードを選び、置くダイスを選んでください'
              : '一ステップ目の結果を見て、残りのダイスで二ステップ目を選んでください'}
          </p>
        )}
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
          revealed && (
            <button type="button" className="btn btn-primary" onClick={proceed} autoFocus>
              {turnOver(game) ? '次のターンへ' : '二ステップ目へ'}
            </button>
          )
        )}
      </section>

      <Seat
        side="me"
        name="あなた"
        player={me}
        maxHp={game.config.maxHp}
        cards={myCards}
        selectedCard={card}
        onCard={choosing ? chooseCard : undefined}
        picked={picked}
        onDie={choosing && card ? toggleDie : undefined}
        hideUsed={revealed}
      />

      {choosing && (
        <div className="command">
          <p className="command-preview">{card ? previewText(card, picked, me, game.step) : 'カードを選んでください'}</p>
          <div className="command-buttons">
            <button type="button" className="btn" onClick={() => commit({ kind: 'pass' })}>
              何もしない
            </button>
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => action && commit(action)}>
              決定して公開
            </button>
          </div>
        </div>
      )}

      <Log history={game.history} />
      <Rules />
    </main>
  )
}

function previewText(card: CardId, picked: number[], me: PlayerState, step: 1 | 2): string {
  const need = card === 'bullet' ? '1個か2個' : `${maxDice(card, step)}個`
  if (picked.length === 0) return `${CARD_NAMES[card]}：ダイスを${need}選んでください`
  const vals = picked.map((i) => me.roll[i])
  const v = vals.join('と')
  switch (card) {
    case 'fireball':
      return picked.length === 2 ? `火球：${v}、${Math.max(...vals)}点` : `火球：あと1個選んでください`
    case 'barrier':
      return `障壁：${v}、受ける攻撃を${vals[0]}減らす`
    case 'bullet':
      return `魔弾：${picked.length === 1 ? '2点' : '3点'}、障壁をすり抜ける`
    case 'spear':
      if (step === 1) return `雷槍の詠唱：${v}。${vals[0]}以上のダメージを受けると崩れる`
      return picked.length === 2 ? `雷槍の発動：${v}、${vals[0] + vals[1]}点` : '雷槍の発動：あと1個選んでください'
    case 'reflect':
      if (picked.length < 2) return '反射：同じ目をもう1個選んでください'
      return vals[0] === vals[1] ? `反射：${v}、受ける攻撃を返す` : '反射：同じ目を2個選んでください'
  }
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
  cards: Set<CardId>
  selectedCard?: CardId | null
  onCard?: (c: CardId) => void
  picked?: number[]
  onDie?: (i: number) => void
  hideUsed: boolean
}

function Seat({ side, name, player, maxHp, cards, selectedCard, onCard, picked = [], onDie, hideUsed }: SeatProps) {
  const free = freeDice(player)
  const hp = Math.max(0, player.hp)
  return (
    <section className={`seat seat-${side}`} aria-label={name}>
      <div className="seat-top">
        <h2 className="seat-name">{name}</h2>
        <div className="hp" aria-label={`体力 ${hp} / ${maxHp}`}>
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
      <div className="dice-row">
        {player.roll.map((v, i) => (
          <Die
            key={i}
            value={v}
            used={!free.includes(i)}
            selected={picked.includes(i)}
            onClick={onDie ? () => onDie(i) : undefined}
            disabled={!free.includes(i)}
          />
        ))}
      </div>
      <ul className="cards">
        {CARDS.map((c) => {
          const used = player.usedCards.includes(c) && !(c === 'spear' && player.chant === 'charged')
          const usable = cards.has(c)
          const cls = ['card', `card-${c}`, selectedCard === c && 'is-selected', used && 'is-used', !usable && 'is-off']
            .filter(Boolean)
            .join(' ')
          const label = `${CARD_NAMES[c]}${used ? '、このターンは使用済み' : usable ? '' : '、今は使えない'}`
          return (
            <li key={c}>
              {onCard ? (
                <button type="button" className={cls} disabled={!usable} onClick={() => onCard(c)} aria-pressed={selectedCard === c} aria-label={label}>
                  <CardFace c={c} used={used} />
                </button>
              ) : (
                <div className={cls} aria-label={label} title={side === 'cpu' && usable && !hideUsed ? '今の出目で使える' : undefined}>
                  <CardFace c={c} used={used} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CardFace({ c, used }: { c: CardId; used: boolean }) {
  return (
    <>
      <span className="card-name">
        {CARD_NAMES[c]}
        {used && <span className="card-used">使用済み</span>}
      </span>
      <span className="card-text">{CARD_TEXT[c]}</span>
    </>
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
        {CARDS.map((c) => (
          <li key={c}>
            <strong>{CARD_NAMES[c]}</strong>：{CARD_TEXT[c]}
          </li>
        ))}
      </ul>
    </details>
  )
}
