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
        ]
          .filter(Boolean)
          .join(' ')
        const name = CARD_DEFS[t.card].name
        return (
          <li key={t.card}>
            {onPick ? (
              <button
                type="button"
                className={cls}
                aria-pressed={t.current}
                aria-description={t.placed ? 'ダイスが置いてある' : undefined}
                data-drop={dropAttr({ type: 'tab', card: t.card })}
                onClick={() => onPick(t.card)}
              >
                {name}
              </button>
            ) : (
              <span className={cls}>{name}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
