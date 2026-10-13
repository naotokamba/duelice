// カード面と公開の舞台で共有する印。同じ意味は同じ形で描く。
// ダメージは赤い星、貫通ダメージは矢印が突き抜けた赤い星、守りは盾、守りが攻撃した相手に吹き返すダメージは風の渦、
// 炎で自分も焼けて受けるダメージは炎、詠唱は魔法陣、詠唱を崩す効果はばつを重ねた魔法陣。
// 数を持つ印は、印の中に数を描く。数は SVG の字として描き、字の高さから求めた位置に置いて、印の中心に字の中心を合わせる。

import { type ReactNode, useId } from 'react'
import { type EffectIcon, type EffectPart, GUARD_LABEL } from '../game/cards'
import { Tip } from './Tip'

/**
 * 数字や X の字の高さの半分を、字の大きさに対する割合で表したもの。
 * 字の下端の線を印の中心からこれだけ下げると、字の中心が印の中心に来る。
 * 使っている字体と代わりの字体で、字の高さが字の大きさの 0.73 から 0.75 だったのを測って決めた
 */
const CAP_HALF = 0.37

interface ValueProps {
  cx: number
  cy: number
  size: number
  /** 字の周りを下の面の色で縁取って、割れた線の上でも読めるようにする */
  halo?: boolean
  children: ReactNode
}

/** 印の中心 (cx, cy) に字の中心を合わせて値を描く */
function Value({ cx, cy, size, halo, children }: ValueProps) {
  return (
    <text
      className={halo ? 'glyph-value glyph-halo' : 'glyph-value'}
      x={cx}
      y={cy + size * CAP_HALF}
      fontSize={size}
      textAnchor="middle"
    >
      {children}
    </text>
  )
}

/** 十二の角を持つ星の頂点。谷は半径の 0.71 倍 */
function starPoints(r: number) {
  return Array.from({ length: 24 }, (_, i) => {
    const d = i % 2 === 0 ? r : r * 0.71
    const t = (Math.PI * i) / 12
    return `${(d * Math.sin(t)).toFixed(1)},${(-d * Math.cos(t)).toFixed(1)}`
  }).join(' ')
}

const STAR = starPoints(48)

/** 星に入れる字の大きさ。字数が増えるほど小さくする */
const starText = (value: string) => (value.length === 1 ? 44 : value.length === 2 ? 34 : 28)

/** ダメージの星 */
export function Star({ value }: { value?: string }) {
  return (
    <svg className="glyph-star" viewBox="-50 -50 100 100" aria-hidden="true">
      <polygon points={STAR} />
      {value && (
        <Value cx={0} cy={0} size={starText(value)}>
          {value}
        </Value>
      )}
    </svg>
  )
}

/**
 * 貫通ダメージ。普通のダメージと同じ大きさの星を、矢印が斜めに突き抜けている。
 * 矢印は星の後ろを通り、星の外に柄と穂先が出る。星が印の枠いっぱいなので、矢印は枠の外まではみ出して描く
 */
export function PierceStar({ value }: { value?: string }) {
  return (
    <svg className="glyph-star glyph-pierce" viewBox="-50 -50 100 100" aria-hidden="true">
      <path className="glyph-spear" d="M-60 60 46 -46" />
      <polygon className="glyph-spear-head" points="64,-64 36,-54 54,-36" />
      <polygon points={STAR} />
      {value && (
        <Value cx={0} cy={0} size={starText(value)}>
          {value}
        </Value>
      )}
    </svg>
  )
}

const SHIELD =
  'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'

/** 盾。値があれば盾の中に描く。盾の見た目の中心は、上が広い形なので少し上にある */
export function ShieldGlyph({ value }: { value?: string | number }) {
  return (
    <svg className="glyph-line" viewBox="0 0 24 24" aria-hidden="true">
      <path d={SHIELD} />
      {value !== undefined && (
        <Value cx={12} cy={11.4} size={10}>
          {value}
        </Value>
      )}
    </svg>
  )
}

/** 炎と渦に入れる字の大きさ。星より細いので、字数が増えるほど星より小さくする */
const innerText = (value: string) => (value.length === 1 ? 40 : value.length === 2 ? 30 : 24)

/** 風の渦の腕。中心の丸の縁から、三本が同じ向きに巻きながら外へ吹き出す */
const GUST_ARMS = [0, 1, 2].map((k) => {
  const at = (r: number, deg: number) => {
    const t = ((deg - 90 + 120 * k) * Math.PI) / 180
    return `${(r * Math.cos(t)).toFixed(1)} ${(r * Math.sin(t)).toFixed(1)}`
  }
  return `M${at(24, 0)}Q${at(48, 50)} ${at(42, 110)}`
})

/** 守りが攻撃を受けたときに、攻撃した相手に吹き返すダメージ。風の渦の、中心の丸に数を描く */
export function ThornsGlyph({ value }: { value?: string }) {
  return (
    <svg className="glyph-thorns" viewBox="-50 -50 100 100" aria-hidden="true">
      {GUST_ARMS.map((d) => (
        <path key={d} className="gust-arm" d={d} />
      ))}
      <circle className="gust-core" r={30} />
      {value && (
        <Value cx={0} cy={0} size={innerText(value)}>
          {value}
        </Value>
      )}
    </svg>
  )
}

/** 炎の形。下の丸い部分の中心は (0, 12) で、左上に小さな火の舌が分かれる */
const FLAME =
  'M0 -50C10 -32 34 -22 34 10C34 32 18 46 0 46C-18 46 -34 32 -34 10C-34 -8 -22 -20 -16 -34C-12 -22 -8 -18 -3 -15C-1 -27 -3 -39 0 -50Z'

/** 炎で自分も焼けて受けるダメージ。炎の、丸い部分に数を描く */
export function BurnGlyph({ value }: { value?: string }) {
  return (
    <svg className="glyph-burn" viewBox="-50 -50 100 100" aria-hidden="true">
      <path d={FLAME} />
      {value && (
        <Value cx={0} cy={12} size={innerText(value)}>
          {value}
        </Value>
      )}
    </svg>
  )
}

interface ChantProps {
  value?: string | number
  broken?: boolean
  className?: string
}

/** 魔法陣の輪の間に並べる12の点 */
const CHANT_DOTS = Array.from({ length: 12 }, (_, i) => {
  const t = (Math.PI * 2 * i) / 12
  return [Number((40 * Math.sin(t)).toFixed(1)), Number((-40 * Math.cos(t)).toFixed(1))]
})

/** 崩れた魔法陣を割るひびの線。上から下へジグザグに走る */
const CRACK = '-4,-60 6,-26 -5,-6 7,16 -3,60'

/** 魔法陣の形。字は含まない */
function ChantShape() {
  return (
    <>
      <circle className="chant-outer" r={45} />
      <circle className="chant-inner" r={34} />
      {CHANT_DOTS.map(([x, y]) => (
        <circle key={`${x},${y}`} className="glyph-fill" cx={x} cy={y} r={2.6} />
      ))}
    </>
  )
}

/**
 * 詠唱。実線の二重の輪に小さな点を並べた魔法陣の中に、崩れずに耐えられる数を描く。
 * 崩れたときは、輪をひびに沿って左右に割ってずらし、薄くする。数は割らずにその上に重ねる
 */
export function ChantGlyph({ value, broken, className }: ChantProps) {
  // 同じ画面に何枚あっても切り抜きが混ざらないように、印ごとに名前を変える
  const id = `chant${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <svg className={`glyph-chant ${className ?? ''}`} viewBox="-50 -50 100 100" aria-hidden="true">
      {broken ? (
        <>
          <defs>
            <clipPath id={`${id}l`}>
              <polygon points={`-70,-70 ${CRACK} -70,70`} />
            </clipPath>
            <clipPath id={`${id}r`}>
              <polygon points={`${CRACK} 70,70 70,-70`} />
            </clipPath>
          </defs>
          <g opacity={0.5}>
            <g transform="translate(-5 2) rotate(-7)">
              <g clipPath={`url(#${id}l)`}>
                <ChantShape />
              </g>
            </g>
            <g transform="translate(5 -2) rotate(7)">
              <g clipPath={`url(#${id}r)`}>
                <ChantShape />
              </g>
            </g>
          </g>
        </>
      ) : (
        <ChantShape />
      )}
      {value !== undefined && (
        <Value cx={0} cy={0} size={44} halo={broken}>
          {value}
        </Value>
      )}
    </svg>
  )
}

/** 詠唱を崩す効果。魔法陣に、ばつを重ねる */
export function DisruptGlyph() {
  return (
    <svg className="glyph-chant glyph-disrupt" viewBox="-50 -50 100 100" aria-hidden="true">
      <ChantShape />
      <path className="disrupt-cross" d="M-30 -30 30 30M30 -30 -30 30" />
    </svg>
  )
}

/** 効果の印の一行の説明と形。印の種類を足すと、ここに書くまで型が通らない */
function effectIcon(icon: EffectIcon, v: string | undefined): { label: string; glyph: ReactNode } {
  switch (icon) {
    case 'damage':
      return { label: `${v}ダメージを与える`, glyph: <Star value={v} /> }
    case 'pierce':
      return { label: `${GUARD_LABEL}で減らない${v}ダメージを与える`, glyph: <PierceStar value={v} /> }
    case 'guard':
      return { label: `受けるダメージを${v}減らす`, glyph: <ShieldGlyph value={v} /> }
    case 'thorns':
      return { label: `減らせる攻撃を受けたら、相手に${v}ダメージを返す`, glyph: <ThornsGlyph value={v} /> }
    case 'burn':
      return { label: `自分も${v}ダメージを受ける`, glyph: <BurnGlyph value={v} /> }
    case 'chant':
      return { label: '詠唱。崩されなければ、次のステップで下の段を使える', glyph: <ChantGlyph /> }
    case 'disrupt':
      return { label: '相手が詠唱していたら崩す', glyph: <DisruptGlyph /> }
  }
}

/**
 * カード面の効果の部品を一つ描く。印は押すと一行の説明が出る。
 * 説明を横に書いて並べるときは tip を false にして、ただの絵として描く
 */
export function EffectGlyph({ part, tip = true }: { part: EffectPart; tip?: boolean }) {
  if (!part.icon) return <span className="fx-text">{part.text}</span>
  const icon = effectIcon(part.icon, part.value)
  const { glyph } = icon
  // 点線の枠にも置くと値が増えるなら、その値も説明に添える
  const label = part.full ? `${icon.label}。点線の枠にも置くと${part.full}` : icon.label
  const cls = `fx fx-${part.icon}`
  if (tip) {
    return (
      <Tip text={label} className={cls}>
        {glyph}
      </Tip>
    )
  }
  return (
    <span className={cls} role="img" aria-label={label}>
      {glyph}
    </span>
  )
}
