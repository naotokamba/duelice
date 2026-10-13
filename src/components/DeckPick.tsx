// カードを選ぶ画面。選べる全てのカードを対局と同じカード面で並べ、持ち込む5枚を選ぶ。
// 選んだ5枚と対戦のボタンは画面の下に留め、カードの一覧だけをスクロールする。
// 前に選んだ5枚を覚えておき、次に開いたらその5枚を選んだ状態から始める。覚えていなければスターターの5枚から始める。

import { ArrowLeft, Check } from 'lucide-react'
import { useState } from 'react'
import { CARD_DEFS, type CardId, DECK_SIZE, kindsOfCard, POOL, STARTER } from '../game/cards'
import type { Level } from '../game/cpu'
import { inPoolOrder } from '../game/decks'
import { Card } from './Card'
import { loadDeck, saveDeck } from './deckStore'
import { RulesButton } from './RulesButton'
import { Beta, LevelPick } from './Title'

interface Props {
  level: Level
  setLevel: (l: Level) => void
  /** タイトルへ戻る */
  onBack: () => void
  /** 選んだ5枚で対戦を始める。5枚はカードの表の順 */
  onStart: (deck: CardId[]) => void
}

const sameCards = (a: readonly CardId[], b: readonly CardId[]) => a.length === b.length && a.every((c) => b.includes(c))

export function DeckPick({ level, setLevel, onBack, onStart }: Props) {
  const [picked, setPicked] = useState<CardId[]>(() => loadDeck() ?? [...STARTER])
  const full = picked.length === DECK_SIZE

  /** 選んだカードなら外し、選んでいなければ足す。5枚そろうと、選んでいないカードは押せない */
  const toggle = (c: CardId) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : inPoolOrder([...p, c])))

  const go = () => {
    saveDeck(picked)
    onStart(picked)
  }

  return (
    <main className="pick">
      <div className="pick-head">
        <button type="button" className="icon-button" aria-label="戻る" title="戻る" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </button>
        <h1 className="online-title">
          カードを選ぶ <Beta />
        </h1>
        <div className="pick-help">
          <RulesButton />
        </div>
      </div>
      <LevelPick level={level} setLevel={setLevel} />
      <p className="pick-lead">持ち込む5枚を選んで、CPU と対戦する。CPU も5枚を持ち込む</p>
      <ul className="pick-list">
        {POOL.map((c) => {
          const on = picked.includes(c)
          return (
            <li key={c} className={on ? 'pick-item is-on' : 'pick-item'}>
              <button
                type="button"
                className="pick-toggle"
                aria-label={`${CARD_DEFS[c].name}を選ぶ`}
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => toggle(c)}
              >
                <span className="pick-box" aria-hidden="true">
                  {on && <Check strokeWidth={3} />}
                </span>
                選ぶ
              </button>
              <ul className="cards cards-one">
                <Card card={c} roll={[]} active={kindsOfCard(c)} used={false} shown={null} />
              </ul>
            </li>
          )
        })}
      </ul>
      <div className="pick-bar">
        <div className="pick-summary">
          <p className="pick-count">
            {picked.length} / {DECK_SIZE}
          </p>
          <ul className="pick-chips" aria-label="選んだカード">
            {picked.map((c) => (
              <li key={c} className={`pick-chip card-${c}`}>
                {CARD_DEFS[c].name}
              </li>
            ))}
          </ul>
        </div>
        <div className="pick-actions">
          <button
            type="button"
            className="btn"
            disabled={sameCards(picked, STARTER)}
            onClick={() => setPicked([...STARTER])}
          >
            スターターに戻す
          </button>
          <button type="button" className="btn btn-primary" disabled={!full} onClick={go}>
            対戦
          </button>
        </div>
      </div>
    </main>
  )
}
