// カード面。置き場の数や記号は定義表の face から描くので、カードを足しても追従する。
// 行動1つが1行で、横に並ぶ置き場が1ステップぶん。
// ダイスは置き場を一つずつ選んで置く。カードの置き場の外を押しても、引きずって落としても置かない。

import { Check } from 'lucide-react'
import { Fragment, useId } from 'react'
import { ACTION_DEFS, CARD_DEFS, CARD_ORDER, kindsOfCard } from '../game/cards'
import { effectParts } from '../game/compose'
import type { ActionKind, CardId } from '../game/types'
import { Die } from './Die'
import { EffectGlyph } from './glyphs'
import type { DragHandlers } from './useDiceDrag'

/** カードに置いて見せるダイス */
export interface Shown {
  kind: ActionKind
  /** 置き場ごとのダイス。空いた置き場は null */
  slots: (number | null)[]
  /** 行動として組み上がっている。効果の記号を値に置き換える */
  complete: boolean
}

/** 引きずって落とした先の置き場を、data-drop に書く名前にする */
export function slotDrop(card: CardId, slot: number): string {
  return `${card}:${slot}`
}

/** data-drop に書いた名前から、落とした先の置き場を読む。置き場でなければ null */
export function readSlotDrop(target: string | null): { card: CardId; slot: number } | null {
  const [card, slot] = target?.split(':') ?? []
  if (!CARD_ORDER.includes(card as CardId) || !/^\d+$/.test(slot ?? '')) return null
  return { card: card as CardId, slot: Number(slot) }
}

/** 自分の席で選んでいる間だけ渡す操作 */
export interface CardPlay {
  /** 持っているダイスを置ける置き場の番号。押せる置き場だけを光らせる */
  targets: number[]
  /** 何も持っていないとき。使えるカードの置き場を薄く光らせる */
  hint: boolean
  /** 空いた置き場か、ダイスのある置き場を押した。持っているダイスをそこに置く */
  onSlot: (slot: number) => void
  /** 置き場のダイスを押した。持っているダイスを置けなければ、そのダイスを手元に戻す */
  onPlaced: (slot: number, die: number) => void
  drag: (die: number) => DragHandlers
  /** 引きずっている途中のダイス */
  lifted: number | null
  /** 行動が組み上がったときだけ渡す */
  onConfirm?: () => void
  /** ダイスを置いたが行動にならないとき、決定を押せない理由 */
  issue?: string | null
}

interface Props {
  card: CardId
  roll: number[]
  /** 今使える行動。使えない行は薄く描く */
  active: ActionKind[]
  used: boolean
  shown: Shown | null
  /** 公開で使ったカード。光らせて、中央の技と結びつける */
  casting?: boolean
  play?: CardPlay
}

export function Card({ card, roll, active, used, shown, casting, play }: Props) {
  const name = CARD_DEFS[card].name
  const issueId = useId()
  const cls = [
    'card',
    `card-${card}`,
    active.length === 0 && !shown && 'is-off',
    play?.hint && active.length > 0 && 'is-hint',
    play?.onConfirm && 'is-ready',
    casting && 'is-casting',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <li className={cls} aria-label={name}>
      <div className="card-head">
        <span className="card-name">{name}</span>
        {used && !shown && <span className="card-used">使用済み</span>}
      </div>
      {kindsOfCard(card).map((kind) => (
        <Row
          key={kind}
          card={card}
          kind={kind}
          name={name}
          roll={roll}
          on={active.includes(kind) || shown?.kind === kind}
          shown={shown?.kind === kind ? shown : null}
          play={play}
        />
      ))}
      {/* 置き場、効果と読んだ流れの先に、カードの下端に重ねて出す */}
      {play?.onConfirm ? (
        <button type="button" className="confirm" aria-label="決定" title="決定" onClick={play.onConfirm}>
          <Check aria-hidden="true" strokeWidth={3} />
        </button>
      ) : (
        // 行動にならない間は、同じ場所に押せない決定を出し、足りないことを短く書く。組み上がれば押せる決定に変わる
        play?.issue && (
          <button type="button" className="confirm is-blocked" aria-label="決定" aria-describedby={issueId} disabled>
            <Check aria-hidden="true" strokeWidth={3} />
            <span id={issueId} className="confirm-issue">
              {play.issue}
            </span>
          </button>
        )
      )}
    </li>
  )
}

/** 狭い画面で並べるカードの名前。押すとそのカードを出す。名前は置き場ではないので、ダイスは置けない */
export interface Tab {
  card: CardId
  /** 今は使えない */
  off: boolean
  /** 大きく出しているカード */
  current: boolean
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
  card: CardId
  kind: ActionKind
  name: string
  roll: number[]
  on: boolean
  shown: Shown | null
  play?: CardPlay
}

function Row({ card, kind, name, roll, on, shown, play }: RowProps) {
  const def = ACTION_DEFS[kind]
  const { face } = def
  const needed = Math.min(...def.dice)
  const slots = shown?.slots ?? []
  // 効果の値は置き場の順に並べた目から決める。火球なら X の枠の目が威力になる
  const vals = shown?.complete ? slots.filter((d): d is number => d !== null).map((i) => roll[i]) : undefined
  /** 置き場の呼び名。記号を書いた置き場はその記号で、ほかは何番目かで呼ぶ */
  const slotName = (k: number) => (k === 0 && face.mark ? `${name}の${face.mark}の枠` : `${name}の${k + 1}つ目の枠`)

  const slot = (k: number) => {
    const d = slots[k] ?? null
    const optional = k >= needed ? ' is-optional' : ''
    const active = play && on
    const target = active && play.targets.includes(k) ? ' is-target' : ''
    const drop = active ? slotDrop(card, k) : undefined
    if (d !== null) {
      return (
        <span className={`slot is-filled${target}`} data-drop={drop}>
          {play ? (
            <Die
              value={roll[d]}
              size="slot"
              label={target ? `${roll[d]}の目と入れ替える` : `${roll[d]}の目を戻す`}
              onClick={() => play.onPlaced(k, d)}
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
    if (active) {
      return (
        <button
          type="button"
          className={`slot${optional}${target}`}
          aria-label={`${slotName(k)}に置く`}
          data-drop={drop}
          disabled={!target}
          onClick={() => play.onSlot(k)}
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
        {/* 「Y =」は置き場の並びの外に出し、置き場の並びをカードの真ん中に置く */}
        {face.sum && <span className="sym slots-sum">{face.sum} =</span>}
        <span className="slot-group">
          {Array.from({ length: Math.max(...def.dice) }, (_, k) => (
            <Fragment key={k}>
              {k > 0 && face.join && <span className="sym">{face.join}</span>}
              {slot(k)}
            </Fragment>
          ))}
        </span>
      </div>
      <p className="effect">
        {effectParts(kind, vals).map((part, i) => (
          <EffectGlyph key={i} part={part} />
        ))}
      </p>
    </div>
  )
}
