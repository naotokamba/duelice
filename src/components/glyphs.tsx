// カード面と公開の舞台で共有する印。同じ意味は同じ形で描く。
// ダメージは赤い星、障壁は盾、貫通は盾を突き抜ける矢印、反射は壁で折り返す矢印、詠唱は魔法陣。
// 値は SVG の中に字として描き、字の高さから求めた位置に置いて、印の中心に字の中心を合わせる。

import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EffectPart } from '../game/cards'

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

/** 十二の角を持つ星。ダメージの印 */
const STAR = Array.from({ length: 24 }, (_, i) => {
  const r = i % 2 === 0 ? 48 : 34
  const t = (Math.PI * i) / 12
  return `${(r * Math.sin(t)).toFixed(1)},${(-r * Math.cos(t)).toFixed(1)}`
}).join(' ')

/** ダメージの星。値の字数が増えるほど字を小さくして星に収める */
export function Star({ value }: { value?: string }) {
  const size = !value ? 0 : value.length === 1 ? 44 : value.length === 2 ? 34 : 28
  return (
    <svg className="glyph-star" viewBox="-50 -50 100 100" aria-hidden="true">
      <polygon points={STAR} />
      {value && (
        <Value cx={0} cy={0} size={size}>
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

/** 貫通。盾をまっすぐ突き抜ける矢印 */
export function PierceGlyph({ className }: { className?: string }) {
  return (
    <svg className={`glyph-line ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={SHIELD} transform="translate(12 13) scale(0.72) translate(-12 -12)" />
      {/* 矢印の下に背景の色で太い線を引き、盾の線を断ち切って、穴が開いたように見せる */}
      <path className="glyph-cut" d="M12 22V4" />
      <path d="M12 23V2M7 7l5-5 5 5" strokeWidth={2.4} />
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

/** 詠唱。力を溜めている途中の、点線の輪と光。崩れたときは斜線を引く */
export function ChantGlyph({ broken, className }: { broken?: boolean; className?: string }) {
  return (
    <svg className={`glyph-line ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <g opacity={broken ? 0.45 : 1}>
        <circle cx={12} cy={12} r={10} strokeDasharray="3.2 2.6" />
        <path className="glyph-fill" d="M12 5.2 13.7 10.3 18.8 12 13.7 13.7 12 18.8 10.3 13.7 5.2 12 10.3 10.3z" />
      </g>
      {broken && <path d="M3.5 3.5l17 17" strokeWidth={2.6} />}
    </svg>
  )
}

/** 丸い札に値を描く。矢印の威力や構えの値に使う */
export function NumberBadge({ value }: { value: number | string }) {
  return (
    <svg className="glyph-badge" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx={16} cy={16} r={15} />
      <Value cx={16} cy={16} size={String(value).length > 1 ? 14 : 17}>
        {value}
      </Value>
    </svg>
  )
}

/** ダメージの読み上げ。「5+」は「5以上の」と読む */
function damageLabel(value = '') {
  return value.endsWith('+') ? `${value.slice(0, -1)}以上のダメージ` : `${value}ダメージ`
}

/** 効果の印の読み上げと形 */
function effectIcon(part: EffectPart): { label: string; glyph: ReactNode } {
  switch (part.icon) {
    case 'damage':
      return { label: damageLabel(part.value), glyph: <Star value={part.value} /> }
    case 'guard':
      return { label: `受けるダメージを${part.value}減らす`, glyph: <ShieldGlyph value={part.value} /> }
    case 'pierce':
      return { label: '障壁を貫通する', glyph: <PierceGlyph /> }
    case 'reflect':
      return { label: '受けた攻撃を返す', glyph: <ReflectGlyph /> }
    case 'chant':
      return { label: '詠唱', glyph: <ChantGlyph /> }
    case 'chantBroken':
      return { label: '詠唱が崩れる', glyph: <ChantGlyph broken /> }
    default:
      return { label: '受けると', glyph: <ArrowRight aria-hidden="true" /> }
  }
}

/** カード面の効果の部品を一つ描く */
export function EffectGlyph({ part }: { part: EffectPart }) {
  if (!part.icon) return <span className="fx-text">{part.text}</span>
  const { label, glyph } = effectIcon(part)
  return (
    <span className={`fx fx-${part.icon}`} role="img" aria-label={label}>
      {glyph}
    </span>
  )
}
