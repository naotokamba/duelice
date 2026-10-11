// カード面。置き場の数や記号は定義表の face から描くので、カードを足しても追従する。
// 行動1つが1行で、横に並ぶ置き場が1ステップぶん。

import { Check } from 'lucide-react'
import { Fragment, type MouseEvent } from 'react'
import { ACTION_DEFS, CARD_DEFS, kindsOfCard } from '../game/cards'
import { effectText, slotOrder } from '../game/compose'
import type { ActionKind, CardId } from '../game/types'
import { Die } from './Die'
import type { DragHandlers } from './useDiceDrag'

/** カードに置いて見せるダイス */
export interface Shown {
  kind: ActionKind
  dice: number[]
  /** 行動として組み上がっている。効果の記号を値に置き換える */
  complete: boolean
}

/** 自分の席で選んでいる間だけ渡す操作 */
export interface CardPlay {
  /** 持っているダイスをこのカードに置ける */
  target: boolean
  /** 何も持っていないとき。使えるカードの置き場を薄く光らせる */
  hint: boolean
  onSlot: () => void
  onTakeBack: (die: number) => void
  drag: (die: number) => DragHandlers
  /** 引きずっている途中のダイス */
  lifted: number | null
  /** 行動が組み上がったときだけ渡す */
  onConfirm?: () => void
}

interface Props {
  card: CardId
  roll: number[]
  /** 今使える行動。使えない行は薄く描く */
  active: ActionKind[]
  used: boolean
  shown: Shown | null
  play?: CardPlay
}

export function Card({ card, roll, active, used, shown, play }: Props) {
  const name = CARD_DEFS[card].name
  const cls = [
    'card',
    `card-${card}`,
    active.length === 0 && !shown && 'is-off',
    play?.target && 'is-target',
    play?.hint && active.length > 0 && 'is-hint',
    play?.onConfirm && 'is-ready',
  ]
    .filter(Boolean)
    .join(' ')
  // 指で狙いやすいように、置き場の外でもカードを押せば持っているダイスを置く。
  // キーボードでは置き場のボタンで同じ操作ができる
  const onCardClick = (e: MouseEvent<HTMLLIElement>) => {
    if (play && !(e.target as Element).closest('button')) play.onSlot()
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでは中の置き場のボタンで操作する
    <li className={cls} data-drop={play ? card : undefined} aria-label={name} onClick={onCardClick}>
      <div className="card-head">
        <span className="card-name">{name}</span>
        {used && !shown && <span className="card-used">使用済み</span>}
      </div>
      {kindsOfCard(card).map((kind) => (
        <Row
          key={kind}
          kind={kind}
          name={name}
          roll={roll}
          on={active.includes(kind) || shown?.kind === kind}
          shown={shown?.kind === kind ? shown : null}
          play={play}
        />
      ))}
      {/* 置き場、効果と読んだ流れの先に、カードの下端に重ねて出す */}
      {play?.onConfirm && (
        <button type="button" className="confirm" aria-label="決定" title="決定" onClick={play.onConfirm}>
          <Check aria-hidden="true" strokeWidth={3} />
        </button>
      )}
    </li>
  )
}

/** 狭い画面で並べるカードの名前 */
export interface Tab {
  card: CardId
  /** 今は使えない */
  off: boolean
  /** 大きく出しているカード */
  current: boolean
  /** 持っているダイスを置ける */
  target: boolean
  /** 何も持っていないとき、使えることを薄く光らせて知らせる */
  hint: boolean
  /** ダイスが置いてある */
  placed: boolean
}

export function CardTabs({ tabs, onPick }: { tabs: Tab[]; onPick?: (c: CardId) => void }) {
  return (
    <ul className="tabs">
      {tabs.map((t) => {
        const cls = [
          'tab',
          `card-${t.card}`,
          t.off && 'is-off',
          t.current && 'is-current',
          t.target && 'is-target',
          t.hint && 'is-hint',
          t.placed && 'is-placed',
        ]
          .filter(Boolean)
          .join(' ')
        const name = CARD_DEFS[t.card].name
        return (
          <li key={t.card}>
            {onPick ? (
              <button
                type="button"
                className={cls}
                aria-pressed={t.current}
                data-drop={t.card}
                onClick={() => onPick(t.card)}
              >
                {name}
              </button>
            ) : (
              <span className={cls}>{name}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

interface RowProps {
  kind: ActionKind
  name: string
  roll: number[]
  on: boolean
  shown: Shown | null
  play?: CardPlay
}

function Row({ kind, name, roll, on, shown, play }: RowProps) {
  const def = ACTION_DEFS[kind]
  const { face } = def
  const needed = Math.min(...def.dice)
  const dice = shown ? slotOrder(roll, shown.dice) : []
  const vals = shown?.complete ? dice.map((i) => roll[i]) : undefined

  const slot = (k: number) => {
    const d = dice[k]
    const optional = k >= needed ? ' is-optional' : ''
    if (d !== undefined) {
      return (
        <span className="slot is-filled">
          {play ? (
            <Die
              value={roll[d]}
              size="slot"
              label={`${roll[d]}の目を戻す`}
              onClick={() => play.onTakeBack(d)}
              drag={play.drag(d)}
              lifted={play.lifted === d}
            />
          ) : (
            <Die value={roll[d]} size="slot" />
          )}
        </span>
      )
    }
    const mark = k === 0 ? face.mark : undefined
    if (play && on) {
      return (
        <button
          type="button"
          className={`slot${optional}`}
          aria-label={`${name}に置く`}
          disabled={!play.target}
          onClick={play.onSlot}
        >
          {mark}
        </button>
      )
    }
    return (
      <span className={`slot${optional}`} aria-hidden="true">
        {mark}
      </span>
    )
  }

  return (
    <div className={on ? 'face-row is-on' : 'face-row'}>
      <div className="slots">
        {face.sum && <span className="sym">{face.sum} =</span>}
        <span className="slot-group">
          {Array.from({ length: Math.max(...def.dice) }, (_, k) => (
            <Fragment key={k}>
              {k > 0 && face.join && <span className="sym">{face.join}</span>}
              {slot(k)}
            </Fragment>
          ))}
        </span>
      </div>
      <p className="effect">{effectText(kind, vals)}</p>
    </div>
  )
}
