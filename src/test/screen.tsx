// 画面のテストの道具。出目と相手の手を差し替えて対局を始め、席やカードを読み上げの名前で探す。
// 公開の動きと自動の進行は時間で進むので、偽の時計を使う。時間は Exchange.tsx と useRevealClock.ts の定数から決める。

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import { HOLD_MS, RETURN_MS } from '../components/Exchange'
import { Game, type Opponent } from '../components/Game'
import { NARROW_QUERY } from '../components/useNarrow'
import type { Action, Rng } from '../game/types'
import { seeded } from './helpers'

export type User = ReturnType<typeof userEvent.setup>

/**
 * 偽の時計を使う。Testing Library は内部で setTimeout の完了を待つので、偽の時計も実時間に合わせて少しずつ進める。
 * beforeEach で呼び、afterEach で vi.useRealTimers を呼ぶ
 */
export function useFakeClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
}

/** 時計を ms だけ進める */
export async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** 一番長い公開、反射で返った矢印が当たって結果を見せ終わるまでの時間 */
export const LONGEST_REVEAL_MS = RETURN_MS + HOLD_MS

/** 公開の動きが終わり、次のステップかターンへ進むまで待つ */
export const settle = () => advance(LONGEST_REVEAL_MS)

/** 振る目を順に指定する乱数。一ターンは あなたの3個、相手の3個 の順。尽きたら種つきの乱数 */
export function dice(...turns: [number[], number[]][]): Rng {
  const queue = turns.flatMap(([a, b]) => [...a, ...b])
  const rest = seeded(1)
  return () => {
    const v = queue.shift()
    return v === undefined ? rest() : (v - 1) / 6 + 0.01
  }
}

export const passOpponent: Opponent = () => ({ kind: 'pass' })

/** 決めた手を順に指す相手。尽きたらパス */
export const scriptedOpponent =
  (...acts: Action[]): Opponent =>
  () =>
    acts.shift() ?? { kind: 'pass' }

/** 決着の表示。ルール説明の「引き分け」と区別する */
export const RESULT = /^(あなたの勝ち|相手の勝ち|相打ち。引き分けです)$/

/** 対局を描いて始める。level を渡せば強さを選んでから始める */
export async function start(props: Parameters<typeof Game>[0], level?: string): Promise<User> {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<Game {...props} />)
  if (level) await user.click(screen.getByRole('radio', { name: level }))
  await user.click(button('決闘を始める'))
  return user
}

export const mySeat = () => within(screen.getByRole('region', { name: 'あなた' }))
export const cpuSeat = () => within(screen.getByRole('region', { name: '相手' }))
export const button = (name: string | RegExp) => screen.getByRole('button', { name })

/** 席の中のカード */
export const cardIn = (seat: ReturnType<typeof within>, name: string) => within(seat.getByRole('listitem', { name }))
export const myCard = (name: string) => cardIn(mySeat(), name)

/** 席の手元のダイス */
export const trayOf = (seat: ReturnType<typeof within>) => within(seat.getByRole('group', { name: 'ダイス' }))
/** 自分の手元の、value の目のダイス */
export const trayDie = (value: number) => trayOf(mySeat()).getAllByRole('button', { name: `${value}の目` })[0]

/** 席に大きく出ているカードの名前。狭い画面で名前を並べた欄は数えない */
export const shownCardNames = (seat: ReturnType<typeof within>) =>
  seat.queryAllByRole('listitem', { name: /./ }).map((c: HTMLElement) => c.getAttribute('aria-label'))

/** カードの空いた置き場のボタン。置き場の順に並ぶ */
export const emptySlots = (card: string) =>
  myCard(card).queryAllByRole('button', { name: new RegExp(`^${card}の.+枠に置く$`) })

/** カードの上のダイスを、置き場の順に読み上げの名前で並べる。押せるダイスも押せないダイスも数える */
export function diceOn(card: ReturnType<typeof within>): string[] {
  const name = /^\d+の目/
  const all: HTMLElement[] = [...card.queryAllByRole('button', { name }), ...card.queryAllByRole('img', { name })]
  all.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return all.map((e) => (e.getAttribute('aria-label') ?? '').replace(/(を戻す|と入れ替える)$/, ''))
}

/** 決定のボタン。出ていなければ null */
export const confirmButton = () => screen.queryByRole('button', { name: '決定' }) as HTMLButtonElement | null

/** 決定が押せないときに、ボタンの説明として添えた理由。押せるか出ていなければ null */
export function blockedReason(): string | null {
  const b = confirmButton()
  if (!b?.disabled) return null
  return document.getElementById(b.getAttribute('aria-describedby') ?? '')?.textContent ?? null
}

/** 手元から value の目のダイスを一つ選び、カードの空いた最初の置き場に置く */
export async function place(user: User, value: number, card: string) {
  await user.click(trayDie(value))
  await user.click(emptySlots(card)[0])
}

/** パスを押し、確かめる問いにパスすると答える */
export async function pass(user: User) {
  await user.click(button('パス'))
  const dialog = screen.getByRole('dialog', { name: 'パスしますか？' })
  await user.click(within(dialog).getByRole('button', { name: 'パスする' }))
}

/** 対局中のメニューを開いて、項目を選ぶ */
export async function fromMenu(user: User, item: string) {
  await user.click(button('メニュー'))
  const menu = screen.getByRole('dialog', { name: 'メニュー' }) as HTMLDialogElement
  await user.click(within(menu).getByRole('button', { name: item }))
  expect(menu.open).toBe(false)
}

/** 指で el を target まで引きずって離す。指の下の要素は target として答える */
export function dragTo(el: Element, target: Element | null) {
  const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
  fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0, pointerId: 1 })
  // 少しの揺れでは引きずりにならない
  fireEvent.pointerMove(el, { clientX: 2, clientY: 2, pointerId: 1 })
  fireEvent.pointerMove(el, { clientX: 40, clientY: 40, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: 40, clientY: 40, pointerId: 1 })
  spy.mockRestore()
}

/**
 * 狭い画面として描く。狭い画面の境目の問い合わせにだけ当てはまると答え、ほかの問い合わせには当てはまらないと答える。
 * narrow を変えて notify を呼ぶと、画面の幅が変わったことを知らせる
 */
export function narrowScreen() {
  const media = { narrow: true, notify: () => {} }
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        get matches() {
          return query === NARROW_QUERY && media.narrow
        },
        media: query,
        addEventListener: (_: string, f: () => void) => {
          media.notify = f
        },
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
  return media
}

/** モーダルの外、暗くした背景を押す。モーダルの枠をこの位置に置いたことにして、その外を押す */
export function clickBackdrop(dialog: HTMLElement) {
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 300,
    top: 100,
    bottom: 300,
  } as DOMRect)
  fireEvent.click(dialog, { clientX: 20, clientY: 20 })
}
