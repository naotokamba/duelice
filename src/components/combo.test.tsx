// @vitest-environment happy-dom
// カードを選ぶ対戦で、錬成、二重詠唱、残響を画面から使う流れ。出目と相手の手を固定し、相手はパスし続ける。
// 好きな目のダイスの目を選ぶ窓、二重詠唱で複数のカードに置くこと、残響が何を繰り返すかの表示が、対局につながるかを見る。

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardId } from '../game/cards'
import {
  blockedReason,
  button,
  cpuSeat,
  dice,
  myCard,
  mySeat,
  narrowScreen,
  passOpponent,
  settle,
  trayDie,
  trayOf,
  type User,
  useFakeClock,
} from '../test/screen'
import { saveDeck } from './deckStore'
import { Game } from './Game'

beforeEach(useFakeClock)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

const CPU: CardId[] = ['flameStrike', 'barrier', 'bullet', 'spear', 'interrupt']

/** deck を覚えさせ、mine を振って、カードを選ぶ画面から対戦を始める */
async function begin(deck: CardId[], mine: number[]): Promise<User> {
  saveDeck(deck)
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<Game rng={dice([mine, [5, 3, 1]])} opponent={passOpponent} cpuDeck={() => CPU} />)
  await user.click(button(/^カードを選んで CPU と対戦/))
  await user.click(button('対戦'))
  return user
}

/** 手元のダイスを押して持ち、名前の置き場に置く */
async function put(user: User, die: HTMLElement, slot: string) {
  await user.click(die)
  await user.click(mySeat().getByRole('button', { name: `${slot}に置く` }))
}

const wildDie = () => trayOf(mySeat()).getAllByRole('button', { name: '好きな目' })[0]
const picker = () => screen.queryByRole('dialog', { name: '目を選ぶ' }) as HTMLDialogElement | null

describe('錬成', () => {
  it('好きな目のダイスを置くと目を選ぶ窓が出て、選んだ目で攻撃する。置いたダイスを押せば選び直せ、手元にも戻せる', async () => {
    const user = await begin(['flameStrike', 'bullet', 'barrier', 'interrupt', 'transmute'], [2, 5, 4])
    await put(user, trayDie(2), '錬成の1つ目の枠')
    await user.click(button('決定'))
    await settle()
    expect(trayOf(mySeat()).getAllByRole('button', { name: '好きな目' })).toHaveLength(3)

    await put(user, wildDie(), '炎撃のXの枠')
    expect(picker()?.open).toBe(true)
    await user.click(within(picker() as HTMLElement).getByRole('button', { name: '6の目' }))
    expect(picker()).toBeNull()
    await put(user, wildDie(), '炎撃のYの枠')
    // 窓を閉じれば、目を選ぶまで決定できない
    await user.click(within(picker() as HTMLElement).getByRole('button', { name: '閉じる' }))
    expect(blockedReason()).toBe('好きな目を選ぶ')
    await user.click(myCard('炎撃').getByRole('button', { name: '好きな目のダイス。目を選ぶ' }))
    await user.click(within(picker() as HTMLElement).getByRole('button', { name: '3の目' }))
    // 手元に戻して置き直すと、選んだ目は残っている
    await user.click(myCard('炎撃').getByRole('button', { name: '好きな目のダイス 3。目を選ぶ' }))
    await user.click(within(picker() as HTMLElement).getByRole('button', { name: '手元に戻す' }))
    expect(blockedReason()).toBe('あと1個置く')
    await put(user, trayOf(mySeat()).getAllByRole('button', { name: '好きな目' })[0], '炎撃のYの枠')
    expect(picker()).toBeNull()
    await user.click(myCard('炎撃').getByRole('button', { name: '好きな目のダイス 3。目を選ぶ' }))
    await user.click(within(picker() as HTMLElement).getByRole('button', { name: '1の目' }))
    await user.click(button('決定'))
    await settle()
    // X の 6 に2を足して 8 点。Y の 1 だけ自分も受ける
    expect(cpuSeat().getByLabelText('体力 12 / 20')).toBeTruthy()
    expect(mySeat().getByLabelText('体力 19 / 20')).toBeTruthy()
  })
})

describe('二重詠唱', () => {
  it('狭い画面でも、名前を押して見るカードを替えながら3枚に置き、まとめて決定できる', async () => {
    narrowScreen()
    const user = await begin(['flameStrike', 'barrier', 'interrupt', 'freeze', 'doubleCast'], [2, 5, 4])
    await user.click(mySeat().getByRole('button', { name: '二重詠唱' }))
    await put(user, trayDie(2), '二重詠唱の1つ目の枠')
    expect(blockedReason()).toBe('ほかのカードにも置く')
    await user.click(mySeat().getByRole('button', { name: '氷礫' }))
    await put(user, trayDie(4), '氷礫の1つ目の枠')
    await user.click(mySeat().getByRole('button', { name: '凍結' }))
    await put(user, trayDie(5), '凍結のXの枠')
    // 置いたカードの名前は、どれもダイスが置いてあると伝える
    for (const name of ['二重詠唱', '氷礫', '凍結']) {
      expect(mySeat().getByRole('button', { name }).getAttribute('aria-description')).toBe('ダイスが置いてある')
    }
    // 決定は見ているカードに一つだけ出る。ほかの置いたカードを見ても、そこに出る
    expect(screen.getAllByRole('button', { name: '決定' })).toHaveLength(1)
    await user.click(mySeat().getByRole('button', { name: '二重詠唱' }))
    expect(myCard('二重詠唱').getByRole('button', { name: '決定' })).toBeTruthy()
    await user.click(button('決定'))
    await settle()
    // 氷礫の2点と、相手の手元の5が1個なので凍結の2点
    expect(cpuSeat().getByLabelText('体力 16 / 20')).toBeTruthy()
  })
})

describe('残響', () => {
  it('カードに直前の効果を書き、使うと同じ目でもう一度出す', async () => {
    const user = await begin(['flameStrike', 'barrier', 'bullet', 'interrupt', 'echo'], [6, 1, 3])
    expect(myCard('残響').getByText('繰り返すものが無い')).toBeTruthy()
    await put(user, trayDie(6), '炎撃のXの枠')
    await put(user, trayDie(1), '炎撃のYの枠')
    await user.click(button('決定'))
    await settle()
    expect(myCard('残響').getByText('炎撃 6・1')).toBeTruthy()
    await put(user, trayDie(3), '残響の1つ目の枠')
    await user.click(button('決定'))
    await settle()
    expect(cpuSeat().getByLabelText('体力 4 / 20')).toBeTruthy()
  })
})
