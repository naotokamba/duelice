// ルール。読まなくても遊べることを目指すので、ふだんはヘッダーの「?」にしまっておく。
// カードの説明は文で書かず、対戦で使うカードをそのままの大きさで並べる。

import { CircleHelp, X } from 'lucide-react'
import { useRef } from 'react'
import { CARD_ORDER, type EffectPart, kindsOfCard } from '../game/cards'
import { Card } from './Card'
import { closeOnBackdrop } from './dialog'
import { EffectGlyph } from './glyphs'

/** カードに出てくる印と、その意味 */
const MARKS: [EffectPart, string][] = [
  [{ icon: 'damage', value: 'X' }, 'X ダメージを与える'],
  [{ icon: 'pierce', value: 'X' }, '障壁で減らない X ダメージを与える'],
  [{ icon: 'guard', value: 'X' }, 'このステップに受けるダメージを X 減らす'],
  [{ icon: 'reflect' }, 'このステップに受けた攻撃を、そのまま相手に返す'],
  [
    { icon: 'chant', value: 'X' },
    '詠唱。このステップに X 以上のダメージを受けると崩れる。崩れなければ、次のステップで下の段を使える',
  ],
]

export function RulesButton() {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button
        type="button"
        className="help"
        aria-label="ルール"
        title="ルール"
        onClick={() => dialog.current?.showModal()}
      >
        <CircleHelp aria-hidden="true" />
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 外を押して閉じるのはマウスと指のため。キーボードでは Esc で閉じる */}
      <dialog ref={dialog} className="rules-dialog" aria-labelledby="rules-title" onClick={closeOnBackdrop}>
        <div className="rules-head">
          <h2 id="rules-title" className="dialog-title">
            ルール
          </h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="閉じる"
            title="閉じる"
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <ul className="rules-list">
          <li>毎ターン、互いにダイスを3個振る。出目はお互いに見えている</li>
          <li>1ターンは2ステップ。各ステップでカードを1枚選んでダイスを置き、同時に公開する</li>
          <li>ステップ1で使わなかったダイスは、ステップ2で使える。同じカードは1ターンに1回まで</li>
          <li>
            カードの置き場は、横に並んだ一段がステップ1つぶん。二段あるカードは、ステップ1で上の段、ステップ2で下の段を使う
          </li>
          <li>体力が先に0になった方の負け。同時なら引き分け</li>
        </ul>
        <h3 className="rules-cards-title">印</h3>
        <ul className="rules-marks">
          {MARKS.map(([part, text]) => (
            <li key={part.icon}>
              <EffectGlyph part={part} tip={false} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <h3 className="rules-cards-title">カード</h3>
        <ul className="cards rules-cards">
          {CARD_ORDER.map((c) => (
            <Card key={c} card={c} roll={[]} active={kindsOfCard(c)} used={false} shown={null} />
          ))}
        </ul>
      </dialog>
    </>
  )
}
