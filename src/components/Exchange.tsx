// 公開した一ステップで起きたことを、上下の席の間を飛ぶ矢印と印で見せる。
// 上が相手、下が自分。攻撃は矢印、障壁や反射や詠唱は受ける側の端に置く印、受けたダメージは星で描く。
// どの印を出すかは定義表の性質で決めるので、カードを足しても追従する。

import { SkipForward } from 'lucide-react'
import type { CSSProperties } from 'react'
import { ACTION_DEFS } from '../game/cards'
import { breaksChant, type PlayerIndex, type StepReport, type Strike, strikes } from '../game/rules'
import type { CardId } from '../game/types'
import { ChantGlyph, NumberBadge, PierceGlyph, ReflectGlyph, ShieldGlyph, Star } from './glyphs'

/** 舞台の高さ。styles.css の .stage と合わせる */
const H = 190
/** 矢印が始まり、当たる位置の、端からの距離 */
const EDGE = 14
/** 構えの印の中心の、端からの距離。当たった星と重ならないように端から離す */
const STANCE = 72
/** 構えの印の半径。障壁や反射に当たる矢印はここで止まる。styles.css の .stance と合わせる */
const STANCE_R = 28

// 公開は三つの場面に分けて、場面ごとに間を取る。
// 一つ目は構え。互いが何を構えたかを見せる。二つ目は攻撃。矢印が飛ぶ。三つ目は結果。当たって体力が減る

/** 構えを見せてから矢印を放つまでの間 */
export const START_MS = 800
/** 矢印が飛ぶ時間 */
const FLY_MS = 600
/** 矢印が当たる時刻 */
export const IMPACT_MS = START_MS + FLY_MS
/** 反射で返った矢印が当たる時刻 */
export const RETURN_MS = IMPACT_MS + FLY_MS
/** 最後の矢印が当たってから次へ進むまでの間。結果を見せる */
export const HOLD_MS = 1600
/** 攻撃が無いときに構えを見せておく時間 */
const CALM_MS = 1000
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

/** 端の位置。上が相手、下が自分 */
const edge = (who: PlayerIndex) => (who === 1 ? EDGE : H - EDGE)
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

export function Exchange({ report }: { report: StepReport }) {
  const list = strikes(report.values, report.actions)
  const out = { '--out-at': `${revealMs(list) - OUT_MS}ms`, '--out': `${OUT_MS}ms` } as CSSProperties
  return (
    <div className="stage" style={out} aria-hidden="true">
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
        const card = ACTION_DEFS[s.kind].card
        const stops = s.outcome === 'guarded' || s.outcome === 'reflected'
        return [
          <Arrow
            key={`a${s.from}`}
            x={x}
            y0={edge(s.from)}
            y1={stops ? stanceRim(other) : edge(other)}
            delay={START_MS}
            card={card}
            value={s.power}
            spent={stops}
          />,
          s.outcome === 'reflected' && (
            <Arrow
              key={`r${s.from}`}
              x={x}
              dx={BACK}
              y0={stanceRim(other)}
              y1={edge(s.from)}
              delay={IMPACT_MS}
              card={card}
              value={s.dealt}
            />
          ),
          s.dealt > 0 && (
            // 障壁に削られて通ったダメージは、障壁の横に出す。反射で返ったダメージは返る矢印の先に出す
            <div
              key={`b${s.from}`}
              className="burst"
              style={at(
                x,
                edge(s.to),
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
  )
}

interface ArrowProps {
  x: number
  dx?: number
  y0: number
  y1: number
  delay: number
  card: CardId
  value: number
  /** 障壁や反射に当たって止まり、薄くなる矢印 */
  spent?: boolean
}

function Arrow({ x, dx = 0, y0, y1, delay, card, value, spent }: ArrowProps) {
  const style = {
    ...at(x, Math.min(y0, y1), delay, dx),
    height: Math.abs(y1 - y0),
    '--fly': `${FLY_MS}ms`,
    '--gone': `${IMPACT_MS}ms`,
  } as CSSProperties
  const cls = ['arrow', y1 < y0 ? 'is-up' : 'is-down', `card-${card}`, spent && 'is-spent'].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      <span className="arrow-value">
        <NumberBadge value={value} />
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
  const share = Math.abs(edge(s.from) - stanceY(to)) / Math.abs(edge(s.from) - edge(to))
  return START_MS + Math.round(FLY_MS * share)
}

function Stance({ who, report, x, aside, incoming }: StanceProps) {
  const a = report.actions[who]
  const y = stanceY(who)
  if (a.kind === 'pass') {
    return (
      <div className="stance stance-pass" style={at(12, y)}>
        <SkipForward />
      </div>
    )
  }
  const def = ACTION_DEFS[a.kind]
  const vals = report.values[who]
  const cls = `stance card-${def.card}`
  if (def.guard) {
    // 止めた障壁は当たった時に揺れる。すり抜けられた障壁は、矢印が通る時に斜線の入った盾に変わって薄くなる
    const pierced = incoming?.outcome === 'pierced'
    const state = pierced ? ' is-pierced' : incoming ? ' is-blocking' : ''
    return (
      <div className={cls + state} style={at(x, y, pierced && incoming ? reachesStance(incoming) : IMPACT_MS)}>
        <span className="guard-on">
          <ShieldGlyph value={def.guard(vals)} />
        </span>
        {pierced && <PierceGlyph className="guard-off" />}
      </div>
    )
  }
  if (def.reflects) {
    return (
      <div className={cls} style={at(x, y)}>
        <ReflectGlyph />
      </div>
    )
  }
  if (def.chant) {
    // 詠唱は攻撃を止めないので、矢印の横に置く。崩れるなら、攻撃が当たった時に印が切り替わる
    const broken = breaksChant(vals, report.damage[who])
    return (
      <div className={`${cls}${broken ? ' is-broken' : ''}`} style={at(x, y, IMPACT_MS, aside ? -ASIDE : 0)}>
        <ChantGlyph className="chant-on" />
        {broken && <ChantGlyph broken className="chant-off" />}
        <span className="stance-value">
          <Star value={`${vals[0]}+`} />
        </span>
      </div>
    )
  }
  return null
}
