// @vitest-environment happy-dom
// カード面。置き場ごとのダイス、前のステップから残ったダイス、置き場の印、決定と決定できない理由を、渡した状態どおりに描くか。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { kindsOfCard } from '../game/cards'
import { diceOn } from '../test/screen'
import { Card, type CardPlay } from './Card'

afterEach(cleanup)

const ROLL = [6, 2, 1]

/** 選んでいる間の操作。何も押されない */
function play(over: Partial<CardPlay> = {}): CardPlay {
  return {
    targets: [],
    hint: false,
    onSlot: vi.fn(),
    onPlaced: vi.fn(),
    drag: () => ({ onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn(), onPointerCancel: vi.fn() }),
    lifted: null,
    ...over,
  }
}

function draw(props: Partial<Parameters<typeof Card>[0]> & Pick<Parameters<typeof Card>[0], 'card'>) {
  render(
    <ul>
      <Card roll={ROLL} active={kindsOfCard(props.card)} used={false} shown={null} {...props} />
    </ul>,
  )
  return within(screen.getByRole('listitem'))
}

describe('カード面', () => {
  it('ダイスは置いた置き場に描き、置いた順や目の大きさで並べ替えない', () => {
    // X の枠に1、もう一つの枠に6
    const card = draw({
      card: 'fireball',
      shown: { card: 'fireball', kind: 'fireball', slots: [2, 0], complete: true },
      play: play(),
    })
    expect(diceOn(card)).toEqual(['1の目', '6の目'])
    expect(card.getByRole('button', { name: '1ダメージを与える' })).toBeTruthy()
  })

  it('空いた置き場には印を書き、印か何番目かで呼ぶ。持っているダイスを置ける置き場だけを押せる', () => {
    const card = draw({ card: 'bullet', play: play({ targets: [1] }) })
    const first = card.getByRole('button', { name: '魔弾の1つ目の枠に置く' }) as HTMLButtonElement
    const extra = card.getByRole('button', { name: '魔弾の+1の枠に置く' }) as HTMLButtonElement
    expect(extra.textContent).toBe('+1')
    expect(first.disabled).toBe(true)
    expect(extra.disabled).toBe(false)
  })

  it('置き場を押すと、何番目の置き場かを渡す', () => {
    const onSlot = vi.fn()
    const card = draw({ card: 'fireball', play: play({ targets: [0, 1], onSlot }) })
    fireEvent.click(card.getByRole('button', { name: '火球の2つ目の枠に置く' }))
    expect(onSlot).toHaveBeenCalledWith(1)
  })

  it('置いたダイスを押すと、置き場とダイスを渡す。持っているダイスを置けるなら入れ替えと読む', () => {
    const onPlaced = vi.fn()
    const card = draw({
      card: 'fireball',
      shown: { card: 'fireball', kind: 'fireball', slots: [null, 0], complete: false },
      play: play({ targets: [0, 1], onPlaced }),
    })
    fireEvent.click(card.getByRole('button', { name: '6の目と入れ替える' }))
    expect(onPlaced).toHaveBeenCalledWith(1, 0)
  })

  it('前のステップのダイスは、押せない絵として置いた置き場に残る', () => {
    const card = draw({
      card: 'bullet',
      active: [],
      used: true,
      kept: { card: 'bullet', kind: 'bullet', slots: [1, null] },
    })
    expect(diceOn(card)).toEqual(['2の目'])
    expect(card.queryAllByRole('button', { name: /の目/ })).toEqual([])
    expect(card.getByText('使用済み')).toBeTruthy()
  })

  it('二段のカードは、前のステップの段にダイスを残したまま、今の段に置ける', () => {
    const card = draw({
      card: 'spear',
      active: ['spearCast'],
      kept: { card: 'spear', kind: 'spearChant', slots: [0] },
      play: play({ targets: [0, 1] }),
    })
    expect(diceOn(card)).toEqual(['6の目'])
    expect(
      card.getAllByRole('button', { name: /^雷槍の.+枠に置く$/ }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['雷槍の1つ目の枠に置く', '雷槍の2つ目の枠に置く'])
  })

  it('行動が組み上がれば決定を押せる', () => {
    const onConfirm = vi.fn()
    const card = draw({
      card: 'fireball',
      shown: { card: 'fireball', kind: 'fireball', slots: [0, 1], complete: true },
      play: play({ onConfirm }),
    })
    const confirm = card.getByRole('button', { name: '決定' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    expect(confirm.getAttribute('aria-describedby')).toBeNull()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalled()
  })

  it('行動にならない間は、押せない決定に理由を添える', () => {
    const card = draw({
      card: 'fireball',
      shown: { card: 'fireball', kind: 'fireball', slots: [0, null], complete: false },
      play: play({ issue: 'あと1個置く' }),
    })
    const confirm = card.getByRole('button', { name: '決定' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(document.getElementById(confirm.getAttribute('aria-describedby') ?? '')?.textContent).toBe('あと1個置く')
  })

  it('置いていなければ決定は出さない', () => {
    const card = draw({ card: 'fireball', play: play() })
    expect(card.queryByRole('button', { name: '決定' })).toBeNull()
  })
})
