// ルール。読まなくても遊べることを目指すので、ふだんはしまっておく。
// タイトルでは右上の「?」から、対局中はメニューから開く。
// カードの説明は文で書かず、対戦で使うカードをそのままの大きさで並べる。

import { CircleHelp } from 'lucide-react'
import { type RefObject, useRef } from 'react'
import { CARD_ORDER, type EffectIcon, type EffectPart, GUARD_LABEL, kindsOfCard } from '../game/cards'
import { Card } from './Card'
import { Modal } from './Dialog'
import { EffectGlyph } from './glyphs'

/** カードに出てくる印と、その意味。印の種類を足すと、ここに書くまで型が通らない */
const MARK_TEXT: Record<EffectIcon, { value?: string; text: string }> = {
  damage: { value: 'X', text: 'X ダメージを与える' },
  pierce: { value: 'X', text: `${GUARD_LABEL}で減らない X ダメージを与える` },
  guard: { value: 'X', text: 'このステップに受けるダメージを X 減らす' },
  thorns: {
    value: 'X',
    text: `このステップに${GUARD_LABEL}で減る攻撃を受けたら、防ぎきっても超えられても、攻撃した相手に X ダメージを吹き返す`,
  },
  burn: { value: 'X', text: `使うと炎で自分も焼けて X ダメージを受ける。${GUARD_LABEL}では減らない` },
  chant: { text: '詠唱。崩されなければ、次のステップで下の段を使える' },
  disrupt: { text: '相手がこのステップに詠唱していたら、その詠唱を崩す' },
}

const MARKS = Object.entries(MARK_TEXT).map(([icon, { value, text }]): [EffectPart, string] => [
  { icon: icon as EffectIcon, value },
  text,
])

/** タイトルの右上の「?」。押すとルールを開く */
export function RulesButton() {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="ルール"
        title="ルール"
        onClick={() => dialog.current?.showModal()}
      >
        <CircleHelp aria-hidden="true" />
      </button>
      <RulesDialog ref={dialog} />
    </>
  )
}

/** ルールの窓。開くのは呼ぶ側で、ref の showModal を呼ぶ */
export function RulesDialog({ ref: dialog }: { ref: RefObject<HTMLDialogElement | null> }) {
  return (
    <Modal ref={dialog} title="ルール" className="modal-rules">
      <ul className="rules-list">
        <li>毎ターン、互いにダイスを3個振る。出目はお互いに見えている</li>
        <li>1ターンは2ステップ。各ステップでカードを1枚選んでダイスを置き、同時に公開する</li>
        <li>ステップ1で使わなかったダイスは、ステップ2で使える。同じカードは1ターンに1回まで</li>
        <li>
          カードの置き場は、横に並んだ一段がステップ1つぶん。二段あるカードは、ステップ1で上の段、ステップ2で下の段を使う
        </li>
        <li>ダイスは置き場を選んで置く。X や Y と書いた置き場に置いた目が、その記号の値になる</li>
        <li>= でつないだ置き場には、同じ目を置く。3個振ると、同じ目は案外よく出る</li>
        <li>ダイスはマナ。置いたダイスで魔法を使う</li>
        <li>炎は強いが、自分も焼ける。氷は詠唱を凍らせて崩す。風は属性の攻撃を吹き返す。魔は属性の守りを貫く</li>
        <li>詠唱は、攻撃を受けても崩れない。崩れるのは、同じステップに相手が詠唱を崩すカードを使ったときだけ</li>
        <li>体力が先に0になった方の負け。同時に0以下になったら、体力の残りが多い方の勝ち。同じなら引き分け</li>
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
    </Modal>
  )
}
