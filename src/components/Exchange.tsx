// 公開した一ステップで起きたことを、卓の上に重ねた幕の中で、上下の間を飛ぶ矢印と印で見せる。
// 上が相手、下が自分。攻撃は矢印、守りや詠唱は受ける側の端に置く印、受けたダメージは星で描く。
// 守りが攻撃した相手に吹き返すダメージは、守った側から飛ぶ風の渦の矢印で描く。
// 炎で自分が焼けて受けたダメージは、炎で描く。
// 幕の上下の端には双方の体力の帯を出し、当たった時に減らす。
// どの印を出すかは定義表の性質で決めるので、カードを足しても追従する。

import { SkipForward } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { ACTION_DEFS, type CardId, effectValue } from '../game/cards'
import type { Action, PlayerIndex, StepReport, Strike } from '../game/types'
import { BurnGlyph, ChantGlyph, PierceStar, ShieldGlyph, Star, ThornsGlyph } from './glyphs'
import { HpBar } from './HpBar'
import { actionLabel } from './text'

/** 舞台の高さ。卓の上に重ねるので、席の間に収める必要はない */
export const STAGE_H = 300
/** 矢印が始まる位置の、端からの距離 */
const EDGE = 16
/**
 * 矢印が当たり、ダメージの星が出る位置の、端からの距離。
 * 星は幅60で、出る時に1.25倍まで膨らむ。膨らんでも舞台の外の枠や体力の帯にかからないように、半径より内側に置く
 */
const HIT = 38
/** 構えの印の中心の、端からの距離の割合。当たった星と重ならないように端から離す */
const STANCE_SHARE = 0.35
/** 構えの印の半径。守りに当たる矢印はここで止まる。印の大きさは、この値を CSS の変数で渡して決める */
const STANCE_R = 28

// 公開は三つの拍に分けて、拍ごとに間を取る。
// 一つ目は名乗り。使ったカードが光り、技の名前と値の札が中央に出る。
// 二つ目は構え。札が消え、守りや詠唱の印が技の名前と一緒に出る。
// 三つ目は攻撃と結果。技の名前を付けた矢印が飛び、当たって体力が減る。自分も焼ける攻撃は、放つ時に自分の体力が減る。
// 時間はここで決め、CSS の変数で動きに渡す

/** 名乗りの札を出しておく時間 */
const ANNOUNCE_MS = 800
/** 名乗りの札が出て消えるまでの時間。出しておく時間の後、残りの二割で消える */
const PLATE_MS = ANNOUNCE_MS * 1.25
/** 構えの印が出る時刻 */
const STANCE_AT = 850
/** 矢印を放つ時刻 */
export const START_MS = 1300
/** 矢印が飛ぶ時間 */
const FLY_MS = 550
/** 矢印が当たる時刻 */
export const IMPACT_MS = START_MS + FLY_MS
/** 自分も焼ける時刻。攻撃を放つ時に払う */
export const BURN_MS = START_MS
/** 最後の矢印が当たってから次へ進むまでの間。結果を見せる */
export const HOLD_MS = 1500
/** 攻撃が無いときに構えを見せておく時間 */
const CALM_MS = 900
/** 舞台が消えていく時間。次へ進む前に、この時間をかけて薄くなる */
const OUT_MS = 350

/** 公開の長さを決める、ステップの記録の部分 */
type Landing = Pick<StepReport, 'strikes' | 'burn' | 'endBurn'>

/** ダメージが入る時刻を全て。攻撃が当たる時刻と、自分も焼ける時刻 */
export function landings(report: Landing): number[] {
  const times = report.strikes.map(() => IMPACT_MS)
  if ([...report.burn, ...report.endBurn].some((v) => v > 0)) times.push(BURN_MS)
  return times
}

/** 公開してから次へ進むまでの時間 */
export function revealMs(report: Landing): number {
  const times = landings(report)
  if (times.length === 0) return START_MS + CALM_MS
  return Math.max(...times) + HOLD_MS
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
/** 自分の放った矢印の札と重ならないように、自分を焼く炎を横にずらす量。札の幅の半分と、膨らんだ炎の半分を足した分 */
const PILL_ASIDE = 96

/** CSS の変数を含む style。dx は横にずらす画素数 */
const at = (x: number, y: number, delay = 0, dx = 0): CSSProperties =>
  ({ left: `calc(${x}% + ${dx}px)`, top: y, '--delay': `${delay}ms` }) as CSSProperties

/** 行動の印を、実際に出た値で描く。攻撃は威力、守りは減らす量。詠唱は値を持たない */
function actionMark(a: Action, vals: number[]): ReactNode {
  if (a.kind === 'pass') return <SkipForward />
  const def = ACTION_DEFS[a.kind]
  const v = effectValue(def, vals)
  if (def.power) return def.piercing ? <PierceStar value={String(v)} /> : <Star value={String(v)} />
  if (def.guard) return <ShieldGlyph value={v} />
  return <ChantGlyph />
}

/** 矢印に付ける印。守りが吹き返したダメージは風の渦で、ほかは放った行動の印で描く */
function strikeMark(s: Strike, report: StepReport): ReactNode {
  if (s.outcome === 'returned') return <ThornsGlyph value={String(s.power)} />
  return actionMark(report.actions[s.from], report.values[s.from])
}

interface ExchangeProps {
  report: StepReport
  /** 幕の上端に出す相手の体力の帯 */
  top?: ReactNode
  /** 幕の下端に出す自分の体力の帯 */
  bottom?: ReactNode
}

export function Exchange({ report, top, bottom }: ExchangeProps) {
  const list = report.strikes
  const vars = {
    '--out-at': `${revealMs(report) - OUT_MS}ms`,
    '--out': `${OUT_MS}ms`,
    '--plate': `${PLATE_MS}ms`,
    '--stance-d': `${STANCE_R * 2}px`,
  } as CSSProperties
  return (
    <div className="clash" style={vars} aria-hidden="true">
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
          {list.map((s, i) => {
            const x = laneX(list, s.from)
            const other = otherOf(s.from)
            // 構えに返された攻撃も、構えの縁で止まり、放った側に星が出る
            const stops = s.outcome === 'guarded' || s.outcome === 'reflected'
            const a = report.actions[s.from]
            return [
              <Arrow
                key={`a${i}`}
                label={actionLabel(a)}
                mark={strikeMark(s, report)}
                x={x}
                y0={edge(s.from)}
                y1={stops ? stanceRim(other) : hit(other)}
                delay={START_MS}
                card={ACTION_DEFS[s.kind].card}
                spent={stops}
              />,
              s.dealt > 0 && (
                // 守りに削られて通ったダメージは、守りの印の横に出す
                <div key={`b${i}`} className="burst" style={at(x, hit(s.to), IMPACT_MS, stops ? ASIDE : 0)}>
                  <Star value={`−${s.dealt}`} />
                </div>
              ),
            ]
          })}
          {([0, 1] as const).map((who) => {
            if (report.burn[who] === 0) return null
            // 自分が焼けたダメージ。飛んでくる攻撃があればその星の横に、無ければ自分の放った矢印の札の横に出す
            const incoming = list.find((s) => s.to === who)
            const style = incoming
              ? at(laneX(list, incoming.from), hit(who), BURN_MS, -ASIDE)
              : at(laneX(list, who), hit(who), BURN_MS, -PILL_ASIDE)
            return (
              <div key={`m${who}`} className="burst burst-burn" style={style}>
                <BurnGlyph value={`−${report.burn[who]}`} />
              </div>
            )
          })}
        </div>
        {bottom}
      </div>
    </div>
  )
}

/** 公開の幕の上下の端に出す体力の帯。当たった時に減る */
export function ClashSide({ side, name, hp, maxHp }: { side: 'me' | 'cpu'; name: string; hp: number; maxHp: number }) {
  return (
    <div className={`clash-side side-${side}`}>
      <span className="clash-name">{name}</span>
      <HpBar hp={hp} maxHp={maxHp} />
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
  y0: number
  y1: number
  delay: number
  card: CardId
  /** 守りに当たって止まり、薄くなる矢印 */
  spent?: boolean
}

function Arrow({ label, mark, x, y0, y1, delay, card, spent }: ArrowProps) {
  const style = {
    ...at(x, Math.min(y0, y1), delay),
    height: Math.abs(y1 - y0),
    '--fly': `${FLY_MS}ms`,
    '--gone': `${IMPACT_MS}ms`,
  } as CSSProperties
  const cls = ['arrow', y1 < y0 ? 'is-up' : 'is-down', `card-${card}`, spent && 'is-spent'].filter(Boolean).join(' ')
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

/** 受ける側の構え。守り、詠唱、パスを印で出す。攻撃した側は何も出さない */
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
    // 止めた守りは当たった時に揺れる。貫通された守りは、矢印が通る時に薄くなる
    const pierced = incoming?.outcome === 'pierced'
    const state = pierced ? ' is-pierced' : incoming ? ' is-blocking' : ''
    return (
      <div className={cls + state} style={stanceAt(x, y, pierced && incoming ? reachesStance(incoming) : IMPACT_MS)}>
        <ShieldGlyph value={def.guard(vals)} />
        {name}
      </div>
    )
  }
  if (def.chant) {
    // 詠唱は攻撃を止めないので、矢印の横に置く。崩されたなら、相手の攻撃が当たった時に印が切り替わる
    const broken = report.chants[who] === 'broken'
    return (
      <div
        className={`${cls} stance-chant${broken ? ' is-broken' : ''}`}
        style={stanceAt(x, y, IMPACT_MS, aside ? -ASIDE : 0)}
      >
        <ChantGlyph className="chant-on" />
        {broken && <ChantGlyph broken className="chant-off" />}
        {name}
      </div>
    )
  }
  return null
}
