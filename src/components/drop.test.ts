// 引きずったダイスを落とす先の読み書きと、落とした時の手元への操作。

import { describe, expect, it } from 'vitest'
import { type DropTarget, dropAttr, dropEvent, readDrop } from './drop'

describe('落とす先', () => {
  it('書いた行き先は、そのまま読み戻せる', () => {
    const targets: DropTarget[] = [
      { type: 'tray' },
      { type: 'slot', card: 'fireball', slot: 1 },
      { type: 'tab', card: 'spear' },
    ]
    for (const t of targets) expect(readDrop(dropAttr(t))).toEqual(t)
  })

  it('行き先でない値は読まない', () => {
    for (const attr of [
      null,
      '',
      'tray:blood',
      'slot:blood',
      'slot:nothing:0',
      'slot:blood:x',
      'tab:nothing',
      'tab:spear:1',
      'card',
    ])
      expect(readDrop(attr)).toBeNull()
  })

  it('手元に落とせば戻し、置き場に落とせばそこに置き、名前に落とせばそのカードを考えるだけ', () => {
    expect(dropEvent({ type: 'tray' }, 2)).toEqual({ type: 'takeBack', die: 2 })
    expect(dropEvent({ type: 'slot', card: 'overload', slot: 1 }, 2)).toEqual({
      type: 'put',
      card: 'overload',
      slot: 1,
      die: 2,
    })
    expect(dropEvent({ type: 'tab', card: 'overload' }, 2)).toEqual({ type: 'consider', card: 'overload' })
    expect(dropEvent(null, 2)).toEqual({ type: 'release' })
  })
})
