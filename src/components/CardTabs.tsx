// 狭い画面で並べるカードの名前。押すとそのカードを出す。名前は置き場ではないので、ダイスを落としても置かない。

import { CARD_DEFS, type CardId } from '../game/cards'
import { dropAttr } from './drop'

export interface Tab {
  card: CardId
  /** 今は使えない */
  off: boolean
  /** 大きく出しているカード */
  current: boolean
  /** 何も持っていないとき、押せば使えるカードを出せることを薄く光らせて知らせる */
  hint: boolean
  /** ダイスが置いてある */
  placed: boolean
  /** このターンに使い終わった。名前の右上に「済」を付ける */
  used: boolean
}

export function CardTabs({ tabs, onPick }: { tabs: Tab[]; onPick?: (c: CardId) => void }) {
  return (
    <ul className="tabs">
      {tabs.map((t) => {
        const cls = [
          'tab',
          `card-${t.card}`,
          t.off && 'is-off',
          t.current && 'is-current',
          t.hint && 'is-hint',
          t.placed && 'is-placed',
          t.used && 'is-used',
        ]
          .filter(Boolean)
          .join(' ')
        const name = CARD_DEFS[t.card].name
        // 使い終わったカードは、置いたダイスが残っていても使用済みを先に伝える
        const note = t.used ? '使用済み' : t.placed ? 'ダイスが置いてある' : undefined
        const badge = t.used && (
          <span className="tab-used" aria-hidden="true">
            済
          </span>
        )
        return (
          <li key={t.card}>
            {onPick ? (
              <button
                type="button"
                className={cls}
                aria-pressed={t.current}
                aria-description={note}
                data-drop={dropAttr({ type: 'tab', card: t.card })}
                onClick={() => onPick(t.card)}
              >
                {name}
                {badge}
              </button>
            ) : (
              <span className={cls} aria-description={note}>
                {name}
                {badge}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
