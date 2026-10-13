// @vitest-environment happy-dom
// カード面。置き場ごとのダイス、前のステップから残ったダイス、置き場の印、決定と決定できない理由を、渡した状態どおりに描くか。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTION_DEFS, kindsOfCard } from '../game/cards'
import { diceOn } from '../test/screen'
import { Card, type CardPlay } from './Card'
import { CardTabs, type Tab } from './CardTabs'

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
    // X の枠に1、血を払う Y の枠に6
    const card = draw({
      card: 'bloodBullet',
      shown: { card: 'bloodBullet', kind: 'bloodBullet', slots: [2, 0], complete: true },
      play: play(),
    })
    expect(diceOn(card)).toEqual(['1の目', '6の目'])
    expect(card.getByRole('button', { name: '3ダメージを与える' })).toBeTruthy()
    expect(card.getByRole('button', { name: '血を払う。自分が6ダメージを受ける' })).toBeTruthy()
  })

  it('空いた置き場には印を書き、印か何番目かで呼ぶ。持っているダイスを置ける置き場だけを押せる', () => {
    const card = draw({ card: 'bloodBullet', play: play({ targets: [1] }) })
    const mark = card.getByRole('button', { name: '血弾のXの枠に置く' }) as HTMLButtonElement
    const pay = card.getByRole('button', { name: '血弾のYの枠に置く' }) as HTMLButtonElement
    expect(mark.textContent).toBe('X')
    expect(pay.textContent).toBe('Y')
    expect(mark.disabled).toBe(true)
    expect(pay.disabled).toBe(false)
  })

  it('同じ記号の置き場が並ぶときは、何番目かで呼ぶ', () => {
    // 点線の枠を二つ持つ、仮の妨害。今の表には点線の枠を持つ行動が無い
    const saved = ACTION_DEFS.interrupt
    ACTION_DEFS.interrupt = { ...saved, dice: [1, 2, 3], face: { ...saved.face, extra: '+2' } }
    try {
      const over = draw({ card: 'interrupt', play: play({ targets: [0, 1, 2] }) })
      const names = over.getAllByRole('button', { name: /^妨害の.+枠に置く$/ })
      expect(names.map((b) => b.getAttribute('aria-label'))).toEqual([
        '妨害の1つ目の枠に置く',
        '妨害の2つ目の枠に置く',
        '妨害の3つ目の枠に置く',
      ])
      expect(names.map((b) => b.textContent)).toEqual(['', '+2', '+2'])
    } finally {
      ACTION_DEFS.interrupt = saved
    }
    cleanup()
    // 同じ目を置く魔弾は、目が威力に関わらないので記号を書かず、= でつなぐ
    const pair = draw({ card: 'bullet', play: play({ targets: [0, 1] }) })
    const slots = pair.getAllByRole('button', { name: /^魔弾の.+枠に置く$/ })
    expect(slots.map((b) => b.getAttribute('aria-label'))).toEqual(['魔弾の1つ目の枠に置く', '魔弾の2つ目の枠に置く'])
    expect(slots.map((b) => b.textContent)).toEqual(['', ''])
    expect(pair.getByText('=')).toBeTruthy()
  })

  it('置き場を押すと、何番目の置き場かを渡す', () => {
    const onSlot = vi.fn()
    const card = draw({ card: 'bloodBullet', play: play({ targets: [0, 1], onSlot }) })
    fireEvent.click(card.getByRole('button', { name: '血弾のYの枠に置く' }))
    expect(onSlot).toHaveBeenCalledWith(1)
  })

  it('置いたダイスを押すと、置き場とダイスを渡す。持っているダイスを置けるなら入れ替えと読む', () => {
    const onPlaced = vi.fn()
    const card = draw({
      card: 'bloodBullet',
      shown: { card: 'bloodBullet', kind: 'bloodBullet', slots: [null, 0], complete: false },
      play: play({ targets: [0, 1], onPlaced }),
    })
    fireEvent.click(card.getByRole('button', { name: '6の目と入れ替える' }))
    expect(onPlaced).toHaveBeenCalledWith(1, 0)
  })

  it('前のステップのダイスは、押せない絵として置いた置き場に残る', () => {
    const card = draw({
      card: 'interrupt',
      active: [],
      used: true,
      kept: { card: 'interrupt', kind: 'interrupt', slots: [1] },
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
      card: 'bloodBullet',
      shown: { card: 'bloodBullet', kind: 'bloodBullet', slots: [0, 1], complete: true },
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
      card: 'bloodBullet',
      shown: { card: 'bloodBullet', kind: 'bloodBullet', slots: [0, null], complete: false },
      play: play({ issue: 'あと1個置く' }),
    })
    const confirm = card.getByRole('button', { name: '決定' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(document.getElementById(confirm.getAttribute('aria-describedby') ?? '')?.textContent).toBe('あと1個置く')
  })

  it('置いていなければ決定は出さない', () => {
    const card = draw({ card: 'bloodBullet', play: play() })
    expect(card.queryByRole('button', { name: '決定' })).toBeNull()
  })
})

describe('使用済みのカード', () => {
  it('このターンに使い終わったカードは、使用済みと書き、カードの説明でも伝える', () => {
    const card = draw({ card: 'bloodBullet', active: [], used: true })
    expect(card.getByText('使用済み')).toBeTruthy()
    expect(screen.getByRole('listitem').getAttribute('aria-description')).toBe('使用済み')
  })

  it('使えるカードと、今は使えないだけのカードは、使用済みにしない', () => {
    const usable = draw({ card: 'bloodBullet' })
    expect(usable.queryByText('使用済み')).toBeNull()
    expect(screen.getByRole('listitem').getAttribute('aria-description')).toBeNull()
    cleanup()
    // 雷槍の発動は、詠唱していなければ今は使えないが、使い終わってはいない
    const off = draw({ card: 'spear', active: [] })
    expect(off.queryByText('使用済み')).toBeNull()
    expect(screen.getByRole('listitem').getAttribute('aria-description')).toBeNull()
  })

  it('公開で使っている間は、使ったカードとして描き、使用済みにしない', () => {
    const card = draw({
      card: 'bloodBullet',
      active: [],
      used: true,
      shown: { card: 'bloodBullet', kind: 'bloodBullet', slots: [0, 1], complete: true },
    })
    expect(card.queryByText('使用済み')).toBeNull()
  })
})

describe('カードの名前', () => {
  const tab = (over: Partial<Tab> & Pick<Tab, 'card'>): Tab => ({
    off: false,
    current: false,
    hint: false,
    placed: false,
    used: false,
    ...over,
  })

  it('使い終わったカードの名前は、使用済みと伝え、印を付ける。ほかの名前には付けない', () => {
    render(
      <CardTabs
        tabs={[
          tab({ card: 'bullet', off: true, used: true, placed: true }),
          tab({ card: 'barrier', placed: true }),
          tab({ card: 'interrupt' }),
        ]}
        onPick={vi.fn()}
      />,
    )
    const used = screen.getByRole('button', { name: '魔弾' })
    expect(used.getAttribute('aria-description')).toBe('使用済み')
    expect(used.textContent).toBe('魔弾済')
    expect(screen.getByRole('button', { name: '炎壁' }).getAttribute('aria-description')).toBe('ダイスが置いてある')
    const over = screen.getByRole('button', { name: '妨害' })
    expect(over.getAttribute('aria-description')).toBeNull()
    expect(over.textContent).toBe('妨害')
  })

  it('押せない名前でも、使い終わったことを伝える', () => {
    render(<CardTabs tabs={[tab({ card: 'bloodBullet', used: true })]} />)
    expect(screen.getByText('血弾').closest('[aria-description]')?.getAttribute('aria-description')).toBe('使用済み')
  })
})
