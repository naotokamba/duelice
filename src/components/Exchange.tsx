// 公開した一ステップで起きたことを、上下の席の間を飛ぶ矢印と印で見せる。
// 上が相手、下が自分。攻撃は矢印、障壁や反射や詠唱は受ける側の端に置く印、受けたダメージは星で描く。
// どの印を出すかは定義表の性質で決めるので、カードを足しても追従する。

import { FlipVertical2, Shield, SkipForward, Zap, ZapOff } from 'lucide-react'
import type { CSSProperties } from 'react'
import { ACTION_DEFS } from '../game/cards'
import { breaksChant, type PlayerIndex, type StepReport, type Strike, strikes } from '../game/rules'
import type { CardId } from '../game/types'

/** 舞台の高さ。styles.css の .stage と合わせる */
const H = 150
/** 矢印が始まり、当たる位置の、端からの距離 */
const EDGE = 10
/** 構えの印の中心の、端からの距離。当たった星と重ならないように端から離す */
const STANCE = 52
/** 構えの印の半径。障壁や反射に当たる矢印はここで止まる */
const STANCE_R = 18

/** 印が出てから矢印を放つまでの間 */
const START_MS = 150
/** 矢印が飛ぶ時間 */
const FLY_MS = 550
/** 矢印が当たる時刻 */
export const IMPACT_MS = START_MS + FLY_MS
/** 反射で返った矢印が当たる時刻 */
export const RETURN_MS = IMPACT_MS + FLY_MS
/** 最後の矢印が当たってから次へ進むまでの間 */
export const HOLD_MS = 1100

/** 攻撃が当たる時刻 */
export function landsAt(s: Strike): number {
  return s.outcome === 'reflected' ? RETURN_MS : IMPACT_MS
}

/** 公開してから次へ進むまでの時間 */
export function revealMs(list: Strike[]): number {
  return Math.max(IMPACT_MS, ...list.map(landsAt)) + HOLD_MS
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

/** 十二の角を持つ星。受けたダメージの印 */
const STAR = Array.from({ length: 24 }, (_, i) => {
  const r = i % 2 === 0 ? 48 : 34
  const t = (Math.PI * i) / 12
  return `${(r * Math.sin(t)).toFixed(1)},${(-r * Math.cos(t)).toFixed(1)}`
}).join(' ')

/** 矢印と重ならないように、横にずらす量 */
const ASIDE = 46
/** 反射で返る矢印を、行きの矢印の横に並べる量 */
const BACK = 26

/** CSS の変数を含む style。dx は横にずらす画素数 */
const at = (x: number, y: number, delay = 0, dx = 0): CSSProperties =>
  ({ left: `calc(${x}% + ${dx}px)`, top: y, '--delay': `${delay}ms` }) as CSSProperties

export function Exchange({ report }: { report: StepReport }) {
  const list = strikes(report.values, report.actions)
  return (
    <div className="stage" aria-hidden="true">
      {([0, 1] as const).map((who) => {
        const incoming = list.find((s) => s.from !== who)
        return (
          <Stance
            key={who}
            who={who}
            report={report}
            x={incoming ? laneX(list, incoming.from) : 50}
            aside={!!incoming}
            pierced={incoming?.outcome === 'pierced'}
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
            spent={s.outcome === 'reflected'}
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
              <svg viewBox="-50 -50 100 100" aria-hidden="true">
                <polygon points={STAR} />
              </svg>
              <span>−{s.dealt}</span>
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
  /** 反射に当たって薄くなる矢印 */
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
      <span className="arrow-value">{value}</span>
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
  /** 障壁をすり抜けられた */
  pierced: boolean
}

function Stance({ who, report, x, aside, pierced }: StanceProps) {
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
    // すり抜けられた障壁は、矢印が通る時に薄くなる
    return (
      <div className={pierced ? `${cls} is-pierced` : cls} style={at(x, y, IMPACT_MS)}>
        <Shield />
        <span className="stance-value">{def.guard(vals)}</span>
      </div>
    )
  }
  if (def.reflects) {
    return (
      <div className={cls} style={at(x, y)}>
        <FlipVertical2 />
      </div>
    )
  }
  if (def.chant) {
    // 詠唱は攻撃を止めないので、矢印の横に置く。崩れるなら、攻撃が当たった時に印が切り替わる
    const broken = breaksChant(vals, report.damage[who])
    return (
      <div className={`${cls}${broken ? ' is-broken' : ''}`} style={at(x, y, IMPACT_MS, aside ? -ASIDE : 0)}>
        <Zap className="chant-on" />
        {broken && <ZapOff className="chant-off" />}
        <span className="stance-value">{vals[0]}</span>
      </div>
    )
  }
  return null
}
