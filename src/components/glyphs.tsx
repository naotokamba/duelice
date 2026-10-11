// カード面と公開の舞台で共有する印。同じ意味は同じ形で描く。
// ダメージは赤い星、貫通ダメージは槍が串刺しにした赤い星、障壁は盾、反射は壁で折り返す矢印、詠唱は点線の輪。
// 数を持つ印は、印の中に数を描く。数は SVG の字として描き、字の高さから求めた位置に置いて、印の中心に字の中心を合わせる。

import type { ReactNode } from 'react'
import type { EffectPart } from '../game/cards'
import { Tip } from './Tip'

/**
 * 数字や X の字の高さの半分を、字の大きさに対する割合で表したもの。
 * 字の下端の線を印の中心からこれだけ下げると、字の中心が印の中心に来る。
 * 使っている字体と代わりの字体で、字の高さが字の大きさの 0.73 から 0.75 だったのを測って決めた
 */
const CAP_HALF = 0.37

/** 印の中心 (cx, cy) に字の中心を合わせて値を描く */
function Value({ cx, cy, size, children }: { cx: number; cy: number; size: number; children: ReactNode }) {
  return (
    <text className="glyph-value" x={cx} y={cy + size * CAP_HALF} fontSize={size} textAnchor="middle">
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
/** 槍を通すために一回り小さくした星 */
const PIERCED_STAR = starPoints(38)

/** 星に入れる字の大きさ。字数が増えるほど小さくする */
const starText = (value: string, scale = 1) => (value.length === 1 ? 44 : value.length === 2 ? 34 : 28) * scale

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

/** 貫通ダメージ。槍が星を斜めに串刺しにしている。槍は星の後ろを通り、星の外に柄と穂先だけが見える */
export function PierceStar({ value }: { value?: string }) {
  return (
    <svg className="glyph-star glyph-pierce" viewBox="-50 -50 100 100" aria-hidden="true">
      <path className="glyph-spear" d="M-46 46 34 -34" />
      <polygon className="glyph-spear-head" points="48,-48 24,-40 40,-24" />
      <polygon points={PIERCED_STAR} />
      {value && (
        <Value cx={0} cy={0} size={starText(value, 0.82)}>
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

/** 反射。壁に向かった矢印が、壁で折り返して戻ってくる */
export function ReflectGlyph() {
  return (
    <svg className="glyph-line" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 3v18" strokeWidth={3} />
      <path d="M3 8h11a4 4 0 0 1 0 8H4M7 13l-3 3 3 3" />
    </svg>
  )
}

interface ChantProps {
  value?: string | number
  broken?: boolean
  className?: string
}

/** 詠唱。力を溜めている点線の輪の中に、崩れずに耐えられる数を描く。崩れたときは輪を薄くして斜線を引く */
export function ChantGlyph({ value, broken, className }: ChantProps) {
  return (
    <svg className={`glyph-chant ${className ?? ''}`} viewBox="-50 -50 100 100" aria-hidden="true">
      <g opacity={broken ? 0.4 : 1}>
        <circle className="glyph-chant-ring" r={42} />
        <path className="glyph-fill" d="M33 -50 36.5 -38.5 48 -35 36.5 -31.5 33 -20 29.5 -31.5 18 -35 29.5 -38.5z" />
        {value !== undefined && (
          <Value cx={0} cy={0} size={44}>
            {value}
          </Value>
        )}
      </g>
      {broken && <path className="glyph-chant-slash" d="M-38 -38 38 38" />}
    </svg>
  )
}

/** 効果の印の一行の説明と形 */
function effectIcon(part: EffectPart): { label: string; glyph: ReactNode } {
  const v = part.value
  switch (part.icon) {
    case 'damage':
      return { label: `${v}ダメージを与える`, glyph: <Star value={v} /> }
    case 'pierce':
      return { label: `障壁で減らない${v}ダメージを与える`, glyph: <PierceStar value={v} /> }
    case 'guard':
      return { label: `受けるダメージを${v}減らす`, glyph: <ShieldGlyph value={v} /> }
    case 'reflect':
      return { label: '受けた攻撃をそのまま返す', glyph: <ReflectGlyph /> }
    default:
      return { label: `詠唱。${v}以上のダメージを受けると崩れる`, glyph: <ChantGlyph value={v} /> }
  }
}

/**
 * カード面の効果の部品を一つ描く。印は押すと一行の説明が出る。
 * 説明を横に書いて並べるときは tip を false にして、ただの絵として描く
 */
export function EffectGlyph({ part, tip = true }: { part: EffectPart; tip?: boolean }) {
  if (!part.icon) return <span className="fx-text">{part.text}</span>
  const { label, glyph } = effectIcon(part)
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
