// カード面。置き場の数や記号は定義表の face から描くので、カードを足しても追従する。
// 行動1つが1行で、横に並ぶ置き場が1ステップぶん。
// ダイスは置き場を一つずつ選んで置く。カードの置き場の外を押しても、引きずって落としても置かない。

import { Check } from 'lucide-react'
import { Fragment, useId } from 'react'
import { ACTION_DEFS, type ActionKind, CARD_DEFS, type CardId, kindsOfCard } from '../game/cards'
import { effectParts } from '../game/face'
import { filled, MARK_SLOT, type PlacedRow, requiredSlots, slotsOf } from '../game/slots'
import { Die } from './Die'
import { dropAttr } from './drop'
import { EffectGlyph } from './glyphs'
import type { Shown } from './seatView'
import type { DragHandlers } from './useDiceDrag'

/** 自分の席で選んでいる間だけ渡す操作 */
export interface CardPlay {
  /** 持っているダイスを置ける置き場の番号。押せる置き場だけを光らせる */
  targets: number[]
  /** 何も持っていないとき。使えるカードの空いた置き場を、動かさずに薄く色づけて知らせる。押せるのはダイスを持ってから */
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
  /** 1ステップ目に使い、ターンが変わるまで置き場に残るダイス。押せず、引きずれない */
  kept?: PlacedRow | null
  play?: CardPlay
}

export function Card({ card, roll, active, used, shown, casting, kept, play }: Props) {
  const name = CARD_DEFS[card].name
  const issueId = useId()
  // 公開で使っている間は使ったカードとして光らせるので、使用済みの見た目にはしない
  const spent = used && !shown
  const cls = [
    'card',
    `card-${card}`,
    active.length === 0 && !shown && 'is-off',
    spent && 'is-used',
    play?.hint && active.length > 0 && 'is-hint',
    play?.onConfirm && 'is-ready',
    casting && 'is-casting',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <li className={cls} aria-label={name} aria-description={spent ? '使用済み' : undefined}>
      <div className="card-head">
        <span className="card-name">{name}</span>
        {spent && <span className="card-used">使用済み</span>}
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
          kept={kept?.kind === kind ? kept : null}
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

interface RowProps {
  card: CardId
  kind: ActionKind
  name: string
  roll: number[]
  on: boolean
  shown: Shown | null
  /** この行に残っている、前のステップのダイス。今置いているダイスや公開中のダイスがあれば、そちらを描く */
  kept: PlacedRow | null
  play?: CardPlay
}

function Row({ card, kind, name, roll, on, shown, kept, play }: RowProps) {
  const def = ACTION_DEFS[kind]
  const { face } = def
  const needed = requiredSlots(def)
  const fixed = !shown && kept !== null
  const slots = shown?.slots ?? kept?.slots ?? []
  // 効果の値は置き場の順に並べた目から決める。X の枠の目が威力になる
  const vals = shown?.complete || fixed ? filled(slots).map((i) => roll[i]) : undefined
  /**
   * 置き場の中に書く記号。最初の置き場には印、省いてもよい置き場には置くと増える量。
   * 同じ目を置く置き場には、どれにも印の記号を書く
   */
  const markOf = (k: number) => {
    if (k >= needed) return face.extra
    return k === MARK_SLOT || face.join === '=' ? face.mark : undefined
  }
  const marks = Array.from({ length: slotsOf(def) }, (_, k) => markOf(k))
  /** 置き場の呼び名。記号がその行で一つだけならその記号で、ほかは何番目かで呼ぶ */
  const slotName = (k: number) => {
    const mark = marks[k]
    const unique = mark !== undefined && marks.filter((m) => m === mark).length === 1
    return unique ? `${name}の${mark}の枠` : `${name}の${k + 1}つ目の枠`
  }

  const slot = (k: number) => {
    const d = slots[k] ?? null
    const optional = k >= needed ? ' is-optional' : ''
    const active = play && on
    const target = active && play.targets.includes(k) ? ' is-target' : ''
    const drop = active ? dropAttr({ type: 'slot', card, slot: k }) : undefined
    // 前のステップのダイスは、盤の上の駒のようにそのまま残す。押せず、光らせない
    if (d !== null && fixed) {
      return (
        <span className="slot is-filled is-kept">
          <Die value={roll[d]} size="slot" kept />
        </span>
      )
    }
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
    const mark = markOf(k)
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
          {Array.from({ length: slotsOf(def) }, (_, k) => (
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
