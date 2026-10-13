// ルール。読まなくても遊べることを目指すので、ふだんはしまっておく。
// タイトルでは右上の「?」から、対局中はメニューから開く。
// カードの説明は文で書かず、対戦で使うカードをそのままの大きさで並べる。

import { CircleHelp } from 'lucide-react'
import { type RefObject, useRef } from 'react'
import { CARD_ORDER, kindsOfCard } from '../game/cards'
import { Card } from './Card'
import { Modal } from './Dialog'

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
        <li>カードの印は、押すとその効果が読める</li>
        <li>詠唱は、攻撃を受けても崩れない。崩れるのは、同じステップに相手が詠唱を崩すカードを使ったときだけ</li>
        <li>体力が先に0になった方の負け。同時に0以下になったら、体力の残りが多い方の勝ち。同じなら引き分け</li>
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
