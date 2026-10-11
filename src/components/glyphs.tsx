// カード面と公開の舞台で共有する印。同じ意味は同じ形で描く。
// ダメージは赤い星、障壁は盾、反射は鏡、詠唱は稲妻、障壁を無視するのは斜線の入った盾。

import { FlipVertical2, Shield, ShieldOff, Zap } from 'lucide-react'
import type { EffectPart } from '../game/cards'

/** 十二の角を持つ星。ダメージの印 */
export const STAR = Array.from({ length: 24 }, (_, i) => {
  const r = i % 2 === 0 ? 48 : 34
  const t = (Math.PI * i) / 12
  return `${(r * Math.sin(t)).toFixed(1)},${(-r * Math.cos(t)).toFixed(1)}`
}).join(' ')

export function Star() {
  return (
    <svg viewBox="-50 -50 100 100" aria-hidden="true">
      <polygon points={STAR} />
    </svg>
  )
}

/** カード面の効果の部品を一つ描く */
export function EffectGlyph({ part }: { part: EffectPart }) {
  const { icon, value, text } = part
  if (!icon) return <span className="fx-text">{text}</span>
  if (icon === 'damage') {
    return (
      <span className="fx fx-damage" role="img" aria-label={`${value}ダメージ`}>
        <Star />
        <span className="fx-value">{value}</span>
      </span>
    )
  }
  if (icon === 'guard') {
    return (
      <span className="fx fx-guard" role="img" aria-label={`受けるダメージを${value}減らす`}>
        <Shield aria-hidden="true" />
        <span className="fx-value">{value}</span>
      </span>
    )
  }
  const [Icon, label] =
    icon === 'reflect'
      ? [FlipVertical2, '受けた攻撃を返す']
      : icon === 'chant'
        ? [Zap, '詠唱']
        : [ShieldOff, '障壁を無視']
  return (
    <span className="fx" role="img" aria-label={label}>
      <Icon aria-hidden="true" />
    </span>
  )
}
