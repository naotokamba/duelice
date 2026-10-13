// @vitest-environment happy-dom
// 狭い画面のカードの名前の色。出目のせいで使えないだけなら色を変えず、このステップに置ける行が無いときだけ灰色にする。

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeState } from '../test/helpers'
import { SeatCards } from './SeatCards'
import { seatView } from './seatView'

afterEach(cleanup)

const off = (name: string) => screen.getByText(name).classList.contains('is-off')

describe('カードの名前の色', () => {
  it('出目のせいで使えないカードの名前は灰色にしない。このステップに置ける行が無いカードは灰色にする', () => {
    // ゾロ目が無いので魔弾は使えない。2ステップ目に詠唱していないので、魔槍はどの段も置けない
    const seat = seatView(makeState({ roll: [6, 2, 1] }, { roll: [1, 2, 3] }, 2), 0)
    render(<SeatCards seat={seat} shown={[]} revealing={false} narrow />)
    expect(off('魔弾')).toBe(false)
    expect(off('魔槍')).toBe(true)
    expect(off('風壁')).toBe(false)
  })
})
