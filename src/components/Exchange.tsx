// 公開した一ステップで起きたことを、卓の上に重ねた幕の中で、上下の間を飛ぶ矢印と印で見せる。
// 上が相手、下が自分。攻撃は矢印、障壁や反射や詠唱は受ける側の端に置く印、受けたダメージは星で描く。
// 幕の上下の端には双方の体力の帯を出し、当たった時に減らす。
// どの印を出すかは定義表の性質で決めるので、カードを足しても追従する。

import { SkipForward } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { ACTION_DEFS } from '../game/cards'
import {
  type Action,
  actionLabel,
  breaksChant,
  type PlayerIndex,
  type StepReport,
  type Strike,
  strikes,
} from '../game/rules'
import type { CardId } from '../game/types'
import { ChantGlyph, PierceStar, ReflectGlyph, ShieldGlyph, Star } from './glyphs'

/** 舞台の高さ。卓の上に重ねるので、席の間に収める必要はない */
const STAGE_H = 300
/** 矢印が始まる位置の、端からの距離 */
const EDGE = 16
/**
 * 矢印が当たり、ダメージの星が出る位置の、端からの距離。
 * 星は幅60で、出る時に1.25倍まで膨らむ。膨らんでも舞台の外の枠や体力の帯にかからないように、半径より内側に置く
 */
const HIT = 38
/** 構えの印の中心の、端からの距離の割合。当たった星と重ならないように端から離す */
const STANCE_SHARE = 0.35
/** 構えの印の半径。障壁や反射に当たる矢印はここで止まる。styles.css の .stance と合わせる */
const STANCE_R = 28

// 公開は三つの拍に分けて、拍ごとに間を取る。
// 一つ目は名乗り。使ったカードが光り、技の名前と値の札が中央に出る。
// 二つ目は構え。札が消え、障壁や反射や詠唱の印が技の名前と一緒に出る。
// 三つ目は攻撃と結果。技の名前を付けた矢印が飛び、当たって体力が減る。
// 札の出入りの時間は styles.css の .plate と合わせる

/** 名乗りの札を出しておく時間 */
export const ANNOUNCE_MS = 800
/** 構えの印が出る時刻 */
const STANCE_AT = 850
/** 矢印を放つ時刻 */
export const START_MS = 1300
/** 矢印が飛ぶ時間 */
const FLY_MS = 550
/** 矢印が当たる時刻 */
export const IMPACT_MS = START_MS + FLY_MS
/** 反射で返った矢印が当たる時刻 */
export const RETURN_MS = IMPACT_MS + FLY_MS
/** 最後の矢印が当たってから次へ進むまでの間。結果を見せる */
export const HOLD_MS = 1500
/** 攻撃が無いときに構えを見せておく時間 */
const CALM_MS = 900
/** 舞台が消えていく時間。次へ進む前に、この時間をかけて薄くなる */
const OUT_MS = 350

/** 攻撃が当たる時刻 */
export function landsAt(s: Strike): number {
  return s.outcome === 'reflected' ? RETURN_MS : IMPACT_MS
}

/** 公開してから次へ進むまでの時間 */
export function revealMs(list: Strike[]): number {
  if (list.length === 0) return START_MS + CALM_MS
  return Math.max(...list.map(landsAt)) + HOLD_MS
}

/** 舞台の上での位置。上が相手、下が自分 */
const H = STAGE_H
const STANCE = Math.round(H * STANCE_SHARE)
/** 端の位置 */
const edge = (who: PlayerIndex) => (who === 1 ? EDGE : H - EDGE)
/** 当たる位置 */
const hit = (who: PlayerIndex) => (who === 1 ? HIT : H - HIT)
const stanceY = (who: PlayerIndex) => (who === 1 ? STANCE : H - STANCE)
/** 構えの印の、攻撃が飛んでくる側の縁 */
const stanceRim = (who: PlayerIndex) => (who === 1 ? STANCE + STANCE_R : H - STANCE - STANCE_R)
const otherOf = (who: PlayerIndex): PlayerIndex => (who === 0 ? 1 : 0)

/** 攻撃の矢印を通す横の位置。撃ち合いなら左右にずらしてすれ違わせる */
function laneX(list: Strike[], from: PlayerIndex): number {
  if (list.length < 2) return 50
  return from === 1 ? 36 : 64
}

/** 矢印と重ならないように、横にずらす量 */
const ASIDE = 64
/** 反射で返る矢印を、行きの矢印の横に並べる量 */
const BACK = 34

/** CSS の変数を含む style。dx は横にずらす画素数 */
const at = (x: number, y: number, delay = 0, dx = 0): CSSProperties =>
  ({ left: `calc(${x}% + ${dx}px)`, top: y, '--delay': `${delay}ms` }) as CSSProperties

/** 行動の印を、実際に出た値で描く。攻撃は威力、障壁は減らす量、詠唱は崩れる境目 */
function actionMark(a: Action, vals: number[]): ReactNode {
  if (a.kind === 'pass') return <SkipForward />
  const def = ACTION_DEFS[a.kind]
  if (def.power) {
    const v = String(def.power(vals))
    return def.piercing ? <PierceStar value={v} /> : <Star value={v} />
  }
  if (def.guard) return <ShieldGlyph value={def.guard(vals)} />
  if (def.reflects) return <ReflectGlyph />
  return <ChantGlyph value={vals[0]} />
}

interface ExchangeProps {
  report: StepReport
  /** 幕の上端に出す相手の体力の帯 */
  top?: ReactNode
  /** 幕の下端に出す自分の体力の帯 */
  bottom?: ReactNode
}

export function Exchange({ report, top, bottom }: ExchangeProps) {
  const list = strikes(report.values, report.actions)
  const out = { '--out-at': `${revealMs(list) - OUT_MS}ms`, '--out': `${OUT_MS}ms` } as CSSProperties
  return (
    <div className="clash" style={out} aria-hidden="true">
      <div className="clash-panel">
        {top}
        <div className="stage" style={{ height: H }}>
          {/* 一つ目の拍。技の名前と値を中央に名乗る */}
          {([1, 0] as const).map((who) => (
            <Plate key={`p${who}`} who={who} report={report} />
          ))}
          {([0, 1] as const).map((who) => {
            const incoming = list.find((s) => s.from !== who)
            return (
              <Stance
                key={who}
                who={who}
                report={report}
                x={incoming ? laneX(list, incoming.from) : 50}
                aside={!!incoming}
                incoming={incoming}
              />
            )
          })}
          {list.map((s) => {
            const x = laneX(list, s.from)
            const other = otherOf(s.from)
            const stops = s.outcome === 'guarded' || s.outcome === 'reflected'
            const a = report.actions[s.from]
            const mark = actionMark(a, report.values[s.from])
            return [
              <Arrow
                key={`a${s.from}`}
                label={actionLabel(a)}
                mark={mark}
                x={x}
                y0={edge(s.from)}
                y1={stops ? stanceRim(other) : hit(other)}
                delay={START_MS}
                card={ACTION_DEFS[s.kind].card}
                spent={stops}
                returned={s.outcome === 'reflected'}
              />,
              s.outcome === 'reflected' && (
                <Arrow
                  key={`r${s.from}`}
                  label={actionLabel(a)}
                  mark={mark}
                  x={x}
                  dx={BACK}
                  y0={stanceRim(other)}
                  y1={hit(s.from)}
                  delay={IMPACT_MS}
                  card={ACTION_DEFS[s.kind].card}
                />
              ),
              s.dealt > 0 && (
                // 障壁に削られて通ったダメージは、障壁の横に出す。反射で返ったダメージは返る矢印の先に出す
                <div
                  key={`b${s.from}`}
                  className="burst"
                  style={at(
                    x,
                    hit(s.to),
                    landsAt(s),
                    s.outcome === 'guarded' ? ASIDE : s.outcome === 'reflected' ? BACK : 0,
                  )}
                >
                  <Star value={`−${s.dealt}`} />
                </div>
              ),
            ]
          })}
        </div>
        {bottom}
      </div>
    </div>
  )
}

/** 名乗りの札。上が相手、下が自分。技の名前と、実際に出た値の印を大きく出し、構えの拍で消える */
function Plate({ who, report }: { who: PlayerIndex; report: StepReport }) {
  const a = report.actions[who]
  const card = a.kind === 'pass' ? undefined : ACTION_DEFS[a.kind].card
  const cls = ['plate', who === 0 ? 'side-me' : 'side-cpu', card && `card-${card}`].filter(Boolean).join(' ')
  return (
    <div className={cls} style={at(50, who === 1 ? H * 0.3 : H * 0.7)}>
      <span className="plate-name">{a.kind === 'pass' ? 'パス' : actionLabel(a)}</span>
      <span className="plate-mark">{actionMark(a, report.values[who])}</span>
    </div>
  )
}

interface ArrowProps {
  /** 技の名前。矢印の札に印と並べる */
  label: string
  mark: ReactNode
  x: number
  dx?: number
  y0: number
  y1: number
  delay: number
  card: CardId
  /** 障壁や反射に当たって止まり、薄くなる矢印 */
  spent?: boolean
  /** 反射で返された矢印。返る矢印と入れ替わりに札を消す */
  returned?: boolean
}

function Arrow({ label, mark, x, dx = 0, y0, y1, delay, card, spent, returned }: ArrowProps) {
  const style = {
    ...at(x, Math.min(y0, y1), delay, dx),
    height: Math.abs(y1 - y0),
    '--fly': `${FLY_MS}ms`,
    '--gone': `${IMPACT_MS}ms`,
  } as CSSProperties
  const cls = ['arrow', y1 < y0 ? 'is-up' : 'is-down', `card-${card}`, spent && 'is-spent', returned && 'is-returned']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={style}>
      {/* 矢印には、技の名前と、放ったカードと同じ印を付ける */}
      <span className="arrow-value">
        <span className="arrow-name">{label}</span>
        {mark}
      </span>
    </div>
  )
}

/** 受ける側の構え。障壁、反射、詠唱、パスを印で出す。攻撃した側は何も出さない */
interface StanceProps {
  who: PlayerIndex
  report: StepReport
  /** 飛んでくる矢印の横の位置 */
  x: number
  /** 矢印が飛んでくる */
  aside: boolean
  /** 飛んでくる攻撃 */
  incoming?: Strike
}

/** 矢印の先が構えの印に届く時刻 */
function reachesStance(s: Strike): number {
  const to = otherOf(s.from)
  const share = Math.abs(edge(s.from) - stanceY(to)) / Math.abs(edge(s.from) - hit(to))
  return START_MS + Math.round(FLY_MS * share)
}

/** 構えの印の位置と、現れる時刻 */
const stanceAt = (x: number, y: number, delay: number, dx = 0) =>
  ({ ...at(x, y, delay, dx), '--appear': `${STANCE_AT}ms` }) as CSSProperties

function Stance({ who, report, x, aside, incoming }: StanceProps) {
  const a = report.actions[who]
  const y = stanceY(who)
  if (a.kind === 'pass') {
    return (
      <div className="stance stance-pass" style={stanceAt(12, y, 0)}>
        <SkipForward />
      </div>
    )
  }
  const def = ACTION_DEFS[a.kind]
  const vals = report.values[who]
  const cls = `stance card-${def.card}`
  // 印の横に技の名前を添える
  const name = <span className="stance-name">{def.label}</span>
  if (def.guard) {
    // 止めた障壁は当たった時に揺れる。貫通された障壁は、矢印が通る時に薄くなる
    const pierced = incoming?.outcome === 'pierced'
    const state = pierced ? ' is-pierced' : incoming ? ' is-blocking' : ''
    return (
      <div className={cls + state} style={stanceAt(x, y, pierced && incoming ? reachesStance(incoming) : IMPACT_MS)}>
        <ShieldGlyph value={def.guard(vals)} />
        {name}
      </div>
    )
  }
  if (def.reflects) {
    return (
      <div className={cls} style={stanceAt(x, y, 0)}>
        <ReflectGlyph />
        {name}
      </div>
    )
  }
  if (def.chant) {
    // 詠唱は攻撃を止めないので、矢印の横に置く。崩れるなら、攻撃が当たった時に印が切り替わる
    const broken = breaksChant(vals, report.damage[who])
    return (
      <div
        className={`${cls} stance-chant${broken ? ' is-broken' : ''}`}
        style={stanceAt(x, y, IMPACT_MS, aside ? -ASIDE : 0)}
      >
        <ChantGlyph value={vals[0]} className="chant-on" />
        {broken && <ChantGlyph value={vals[0]} broken className="chant-off" />}
        {name}
      </div>
    )
  }
  return null
}
