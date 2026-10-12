// @vitest-environment happy-dom
// 画面の操作の流れのテスト。出目は乱数を差し替えて固定し、相手の手も差し替える。

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action, Rng } from '../game/types'
import { seeded } from '../test/helpers'
import { HOLD_MS, IMPACT_MS } from './Exchange'
import { BANNER_MS, Game, type Opponent } from './Game'

// 公開の動きと自動の進行は時間で進むので、偽の時計で進める。
// Testing Library は内部で setTimeout の完了を待つので、偽の時計も実時間に合わせて少しずつ進める
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** 時計を ms だけ進める */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** 公開の動きが終わり、次のステップかターンへ進むまで待つ */
const settle = () => advance(5000)

/** 振る目を順に指定する乱数。一ターンは あなたの3個、相手の3個 の順。尽きたら種つきの乱数 */
function dice(...turns: [number[], number[]][]): Rng {
  const queue = turns.flatMap(([a, b]) => [...a, ...b])
  const rest = seeded(1)
  return () => {
    const v = queue.shift()
    return v === undefined ? rest() : (v - 1) / 6 + 0.01
  }
}

const passOpponent: Opponent = () => ({ kind: 'pass' })
const scriptedOpponent =
  (...acts: Action[]): Opponent =>
  () =>
    acts.shift() ?? { kind: 'pass' }

/** 決着の表示。ルール説明の「引き分け」と区別する */
const RESULT = /^(あなたの勝ち|相手の勝ち|相打ち。引き分けです)$/

const mySeat = () => within(screen.getByRole('region', { name: 'あなた' }))
const cpuSeat = () => within(screen.getByRole('region', { name: '相手' }))
const button = (name: string | RegExp) => screen.getByRole('button', { name })
/** 席の中のカード */
const cardIn = (seat: ReturnType<typeof within>, name: string) => within(seat.getByRole('listitem', { name }))
const myCard = (name: string) => cardIn(mySeat(), name)

type User = ReturnType<typeof userEvent.setup>

/** カードの空いた置き場のボタン。置き場の順に並ぶ */
const emptySlots = (card: string) =>
  myCard(card).queryAllByRole('button', { name: new RegExp(`^${card}の.+枠に置く$`) })

/** 決定のボタン。出ていなければ null */
const confirmButton = () => screen.queryByRole('button', { name: '決定' }) as HTMLButtonElement | null

/** 決定が押せないときに、ボタンの説明として添えた理由。押せるか出ていなければ null */
function blockedReason(): string | null {
  const b = confirmButton()
  if (!b?.disabled) return null
  return document.getElementById(b.getAttribute('aria-describedby') ?? '')?.textContent ?? null
}

/** 手元から value の目のダイスを一つ選び、カードの空いた最初の置き場に置く */
async function place(user: User, value: number, card: string) {
  await user.click(
    within(mySeat().getByRole('group', { name: 'ダイス' })).getAllByRole('button', { name: `${value}の目` })[0],
  )
  await user.click(emptySlots(card)[0])
}

/** パスを押し、確かめる問いにパスすると答える */
/** 対局中のメニューを開いて、項目を選ぶ */
async function fromMenu(user: User, item: string) {
  await user.click(button('メニュー'))
  const menu = screen.getByRole('dialog', { name: 'メニュー' }) as HTMLDialogElement
  await user.click(within(menu).getByRole('button', { name: item }))
  expect(menu.open).toBe(false)
}

async function pass(user: User) {
  await user.click(button('パス'))
  const dialog = screen.getByRole('dialog', { name: 'パスしますか？' })
  await user.click(within(dialog).getByRole('button', { name: 'パスする' }))
}

/** 指で el を target まで引きずって離す */
function dragTo(el: Element, target: Element | null) {
  const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
  fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0, pointerId: 1 })
  // 少しの揺れでは引きずりにならない
  fireEvent.pointerMove(el, { clientX: 2, clientY: 2, pointerId: 1 })
  fireEvent.pointerMove(el, { clientX: 40, clientY: 40, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: 40, clientY: 40, pointerId: 1 })
  spy.mockRestore()
}

async function start(props: Parameters<typeof Game>[0], level?: string) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<Game {...props} />)
  if (level) await user.click(screen.getByRole('radio', { name: level }))
  await user.click(button('決闘を始める'))
  return user
}

describe('タイトル', () => {
  it('強さを選んで始められる', async () => {
    await start(
      {
        rng: dice([
          [1, 2, 3],
          [1, 2, 3],
        ]),
        opponent: passOpponent,
      },
      'つよい',
    )
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(mySeat().getByLabelText('体力 20 / 20')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 20 / 20')).toBeTruthy()
  })
})

describe('一ターンの流れ', () => {
  it('ダイスをカードに置いて決定し、二ステップ目、次のターンへ進む', async () => {
    const user = await start({
      rng: dice([
        [6, 6, 2],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
    expect(myCard('火球').getByRole('button', { name: 'Xダメージを与える' })).toBeTruthy()

    await place(user, 6, '火球')
    // 一個では火球にならないので、まだ決定できない。押せない決定に理由が出る
    expect(confirmButton()?.disabled).toBe(true)
    expect(blockedReason()).toBe('あと1個置く')
    expect(myCard('火球').getByText('あと1個置く')).toBeTruthy()
    await place(user, 6, '火球')
    expect(confirmButton()?.disabled).toBe(false)
    expect(blockedReason()).toBeNull()
    expect(myCard('火球').getByRole('button', { name: '6ダメージを与える' })).toBeTruthy()
    expect(myCard('火球').getAllByRole('button', { name: '6の目を戻す' })).toHaveLength(2)

    await user.click(button('決定'))
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(screen.getByText('あなたの火球 6点')).toBeTruthy()
    // 公開中も、置いたダイスはカードの上に残り、使ったカードが光る
    expect(myCard('火球').getAllByRole('img', { name: '6の目' })).toHaveLength(2)
    expect(mySeat().getByRole('listitem', { name: '火球' }).classList.contains('is-casting')).toBe(true)
    // 矢印が当たるまで体力は減らない
    expect(cpuSeat().getByLabelText('体力 20 / 20')).toBeTruthy()
    await advance(IMPACT_MS)
    expect(cpuSeat().getByLabelText('体力 14 / 20')).toBeTruthy()

    // 待てば自動で二ステップ目へ進み、切り替わりを知らせる
    await advance(HOLD_MS + 50)
    expect(screen.getByText('Turn 1 - Step 2')).toBeTruthy()
    expect(screen.getByText('Step 2')).toBeTruthy()
    await advance(BANNER_MS)
    expect(screen.queryByText('Step 2')).toBeNull()
    // 一つ前の結果は中央に出る
    const latest = () => within(screen.getByRole('region', { name: '一つ前の結果' }))
    expect(latest().getByText('火球')).toBeTruthy()
    expect(latest().getByRole('img', { name: '6ダメージ' })).toBeTruthy()
    // 使ったカードには置けない。使ったダイスは盤の上の駒のようにカードの置き場に残り、押せない。手元には跡だけが残る
    expect(myCard('火球').getByText('使用済み')).toBeTruthy()
    expect(emptySlots('火球')).toHaveLength(0)
    expect(myCard('火球').getAllByRole('img', { name: '6の目' })).toHaveLength(2)
    expect(myCard('火球').queryAllByRole('button', { name: /の目/ })).toHaveLength(0)
    const tray = () => within(mySeat().getByRole('group', { name: 'ダイス' }))
    expect(tray().queryAllByRole('button', { name: '6の目' })).toHaveLength(0)
    expect(tray().getByRole('button', { name: '2の目' })).toBeTruthy()

    await pass(user)
    await advance(2400)
    expect(screen.getByText('Turn 2 - Step 1')).toBeTruthy()
    expect(screen.getByText('Turn 2', { selector: '.banner span' })).toBeTruthy()
    // 振り直すと、カードの上のダイスは片付く
    expect(myCard('火球').queryAllByRole('img', { name: /の目$/ })).toHaveLength(0)
    expect(emptySlots('火球').map((b) => b.getAttribute('aria-label'))).toEqual([
      '火球のXの枠に置く',
      '火球の2つ目の枠に置く',
    ])

    // 中央には一つ前だけを出し、全ての履歴は履歴の印からモーダルで見る
    await advance(BANNER_MS)
    // 中央には一つ前の結果だけが出る
    expect(latest().getAllByRole('listitem')).toHaveLength(1)
    expect(latest().getAllByRole('img', { name: 'パス' })).toHaveLength(2)
    await user.click(button('戦闘履歴'))
    const dialog = screen.getByRole('dialog', { name: '戦闘履歴' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    const entries = within(dialog).getAllByRole('listitem')
    expect(entries.map((e) => e.querySelector('.history-when')?.textContent)).toEqual(['1-2', '1-1'])
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(dialog.open).toBe(false)
  })

  it('持ったダイスは置ける場所にだけ置け、置いたダイスは戻せる', async () => {
    const user = await start({
      rng: dice([
        [4, 5, 6],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    // 何も持っていなければ置き場は押せない
    const slot = myCard('障壁').getByRole('button', { name: '障壁のXの枠に置く' }) as HTMLButtonElement
    expect(slot.disabled).toBe(true)
    await user.click(mySeat().getByRole('listitem', { name: '障壁' }))
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()

    const four = mySeat().getByRole('button', { name: '4の目' })
    await user.click(four)
    expect(four.getAttribute('aria-pressed')).toBe('true')
    await user.click(four)
    expect(four.getAttribute('aria-pressed')).toBe('false')

    await place(user, 4, '障壁')
    expect(myCard('障壁').getByRole('button', { name: '受けるダメージを4減らす' })).toBeTruthy()
    expect(button('決定')).toBeTruthy()

    // カードの置き場の外を押しても置かない
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    await user.click(mySeat().getByRole('listitem', { name: '障壁' }))
    await user.click(mySeat().getByRole('listitem', { name: '魔弾' }))
    expect(myCard('魔弾').queryByRole('button', { name: /を戻す$/ })).toBeNull()
    expect(mySeat().getByRole('button', { name: '5の目' })).toBeTruthy()

    // ダイスのある置き場に置くと、あったダイスは手元に戻る
    await user.click(myCard('障壁').getByRole('button', { name: '4の目と入れ替える' }))
    expect(myCard('障壁').getByRole('button', { name: '5の目を戻す' })).toBeTruthy()
    expect(mySeat().getByRole('button', { name: '4の目' })).toBeTruthy()

    // 別のカードに置くと、前のカードのダイスは手元に戻る
    await user.click(mySeat().getByRole('button', { name: '4の目' }))
    await user.click(myCard('魔弾').getByRole('button', { name: '魔弾の1つ目の枠に置く' }))
    expect(myCard('魔弾').getByRole('button', { name: '4の目を戻す' })).toBeTruthy()
    expect(mySeat().getByRole('button', { name: '5の目' })).toBeTruthy()

    await user.click(myCard('魔弾').getByRole('button', { name: '4の目を戻す' }))
    expect(mySeat().getByRole('button', { name: '4の目' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
  })

  it('ダイスは押した置き場に入る。火球は X の枠に置いた目で撃ち、魔弾は点線の枠だけでは撃てない', async () => {
    const user = await start({
      rng: dice(
        [
          [6, 2, 1],
          [1, 2, 3],
        ],
        [
          [6, 2, 1],
          [1, 2, 3],
        ],
      ),
      opponent: passOpponent,
    })
    // 2つ目の枠から先に置いても、そのまま2つ目に入る
    await user.click(mySeat().getByRole('button', { name: '6の目' }))
    await user.click(myCard('火球').getByRole('button', { name: '火球の2つ目の枠に置く' }))
    expect(emptySlots('火球').map((b) => b.getAttribute('aria-label'))).toEqual(['火球のXの枠に置く'])
    // X の枠が空いている間は決定を押せず、X の枠に置くよう伝える
    expect(blockedReason()).toBe('X の枠に置く')
    // X の枠に小さい目を置けば、その目が威力になる
    await place(user, 2, '火球')
    expect(myCard('火球').getByRole('button', { name: '2ダメージを与える' })).toBeTruthy()
    await user.click(button('決定'))
    expect(screen.getByText('あなたの火球 2点')).toBeTruthy()
    await settle()
    expect(cpuSeat().getByLabelText('体力 18 / 20')).toBeTruthy()

    // 魔弾の点線の枠だけに置いても撃てず、左の枠に置くよう伝える
    await user.click(mySeat().getByRole('button', { name: '1の目' }))
    await user.click(myCard('魔弾').getByRole('button', { name: '魔弾の+1の枠に置く' }))
    expect(blockedReason()).toBe('左の枠に置く')
    // 左の枠に置き直せば、1個で撃てる
    await user.click(myCard('魔弾').getByRole('button', { name: '1の目を戻す' }))
    await user.click(mySeat().getByRole('button', { name: '1の目' }))
    await user.click(myCard('魔弾').getByRole('button', { name: '魔弾の1つ目の枠に置く' }))
    await user.click(button('決定'))
    expect(screen.getByText('あなたの魔弾 2点')).toBeTruthy()
  })

  it('魔弾は点線の枠にも置くと3点になり、公開でも次のステップでも置いた枠に残る', async () => {
    const user = await start({
      rng: dice([
        [6, 2, 1],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    /** 魔弾の置き場ごとに、ダイスが載っているか */
    const filled = () =>
      [...mySeat().getByRole('listitem', { name: '魔弾' }).querySelectorAll('.slot')].map((e) =>
        e.classList.contains('is-filled'),
      )
    // 置く前は、左の枠だけの値と、点線の枠にも置いたときの値を説明する
    expect(
      myCard('魔弾').getByRole('button', { name: '障壁で減らない2ダメージを与える。点線の枠にも置くと3' }),
    ).toBeTruthy()
    await user.click(mySeat().getByRole('button', { name: '1の目' }))
    await user.click(myCard('魔弾').getByRole('button', { name: '魔弾の+1の枠に置く' }))
    expect(filled()).toEqual([false, true])
    await user.click(mySeat().getByRole('button', { name: '6の目' }))
    await user.click(myCard('魔弾').getByRole('button', { name: '魔弾の1つ目の枠に置く' }))
    expect(myCard('魔弾').getByRole('button', { name: '障壁で減らない3ダメージを与える' })).toBeTruthy()
    await user.click(button('決定'))
    // 公開の間も、置いた枠のまま
    expect(screen.getByText('あなたの魔弾 3点')).toBeTruthy()
    expect(filled()).toEqual([true, true])
    await settle()
    // 2ステップ目も、置いた枠に残り、押せない
    expect(screen.getByText('Turn 1 - Step 2')).toBeTruthy()
    expect(filled()).toEqual([true, true])
    expect(mySeat().getByRole('listitem', { name: '魔弾' }).querySelectorAll('.slot.is-settled')).toHaveLength(2)
    expect(emptySlots('魔弾')).toHaveLength(0)
    expect(myCard('魔弾').queryAllByRole('button', { name: /目/ })).toHaveLength(0)
  })

  it('ゾロ目が無いと反射には置けない', async () => {
    await start({
      rng: dice([
        [1, 2, 3],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    expect(emptySlots('反射')).toHaveLength(0)
  })

  it('反射には違う目も置けるが、同じ目が揃うまで決定を押せず、理由が出る', async () => {
    const user = await start({
      rng: dice([
        [3, 5, 3],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await place(user, 3, '反射')
    expect(blockedReason()).toBe('同じ目をあと1個置く')
    // 違う目を持っていても、置き場は押せる
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    const rest = myCard('反射').getByRole('button', { name: '反射の2つ目の枠に置く' }) as HTMLButtonElement
    expect(rest.disabled).toBe(false)
    await user.click(rest)
    expect(confirmButton()?.disabled).toBe(true)
    expect(blockedReason()).toBe('同じ目を2個置く')
    // 押せない決定を押しても何も起きない
    await user.click(confirmButton() as HTMLButtonElement)
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(screen.queryByText(/反射を構えた/)).toBeNull()

    // 違う目のある置き場に同じ目を置けば、入れ替わって決定できる
    await user.click(mySeat().getByRole('button', { name: '3の目' }))
    await user.click(myCard('反射').getByRole('button', { name: '5の目と入れ替える' }))
    expect(mySeat().getByRole('button', { name: '5の目' })).toBeTruthy()
    expect(confirmButton()?.disabled).toBe(false)
    expect(blockedReason()).toBeNull()
    await user.click(button('決定'))
    expect(screen.getByText('あなたは 3と3 で反射を構えた')).toBeTruthy()
  })

  it('ダイスを持って埋まった置き場を押すと、目を問わず入れ替わる', async () => {
    const user = await start({
      rng: dice([
        [3, 5, 3],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await place(user, 3, '反射')
    // 何を持っていても、埋まった置き場は入れ替えの的になる
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    await user.click(myCard('反射').getByRole('button', { name: '3の目と入れ替える' }))
    expect(myCard('反射').getByRole('button', { name: '5の目を戻す' })).toBeTruthy()
    expect(
      within(mySeat().getByRole('group', { name: 'ダイス' })).getAllByRole('button', { name: '3の目' }),
    ).toHaveLength(2)
    expect(blockedReason()).toBe('同じ目をあと1個置く')
    // 何も持っていなければ、押したダイスは手元に戻る
    await user.click(myCard('反射').getByRole('button', { name: '5の目を戻す' }))
    expect(confirmButton()).toBeNull()
  })

  it('詠唱が保たれると表示され、二ステップ目に雷槍を発動できる', async () => {
    const user = await start({
      rng: dice([
        [5, 6, 6],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await place(user, 5, '雷槍')
    expect(myCard('雷槍').getByRole('button', { name: '詠唱。5以上のダメージを受けると崩れる' })).toBeTruthy()
    await user.click(button('決定'))
    expect(screen.getByText('あなたの詠唱は保たれた')).toBeTruthy()
    // 詠唱の結果は、矢印が当たる時刻まで席には出さない
    expect(mySeat().queryByText('詠唱中')).toBeNull()
    await settle()
    expect(mySeat().getByText('詠唱中')).toBeTruthy()
    // 詠唱のダイスは雷槍の1段目に残って詠唱したことを示し、押せない。手元には跡だけが残る
    expect(myCard('雷槍').getByRole('img', { name: '5の目' })).toBeTruthy()
    expect(myCard('雷槍').queryByRole('button', { name: /5の目/ })).toBeNull()
    expect(within(mySeat().getByRole('group', { name: 'ダイス' })).queryByRole('button', { name: '5の目' })).toBeNull()
    // 2段目の置き場には置ける
    expect(emptySlots('雷槍').map((b) => b.getAttribute('aria-label'))).toEqual([
      '雷槍の1つ目の枠に置く',
      '雷槍の2つ目の枠に置く',
    ])

    await place(user, 6, '雷槍')
    await place(user, 6, '雷槍')
    expect(myCard('雷槍').getByRole('button', { name: '12ダメージを与える' })).toBeTruthy()
    await user.click(button('決定'))
    // 2ステップ目の公開の間は、詠唱のダイスと発動のダイスが並ぶ
    expect(myCard('雷槍').getAllByRole('img', { name: /^[56]の目$/ })).toHaveLength(3)
    await settle()
    expect(cpuSeat().getByLabelText('体力 8 / 20')).toBeTruthy()
  })

  it('相手の行動と受けたダメージが公開され、相手のダイスもカードに置かれる', async () => {
    const user = await start({
      rng: dice([
        [1, 2, 3],
        [6, 5, 4],
      ]),
      opponent: scriptedOpponent({ kind: 'fireball', dice: [0, 1] }),
    })
    await pass(user)
    expect(screen.getByText('相手の火球 6点')).toBeTruthy()
    const theirs = cardIn(cpuSeat(), '火球')
    expect(theirs.getAllByRole('img', { name: /^[56]の目$/ })).toHaveLength(2)
    expect(theirs.getByRole('button', { name: '6ダメージを与える' })).toBeTruthy()
    await settle()
    expect(mySeat().getByLabelText('体力 14 / 20')).toBeTruthy()
    // 2ステップ目も、相手が使ったダイスは相手のカードに残り、相手の手元には跡だけが残る
    expect(cardIn(cpuSeat(), '火球').getAllByRole('img', { name: /^[56]の目$/ })).toHaveLength(2)
    expect(within(cpuSeat().getByRole('group', { name: 'ダイス' })).getAllByRole('img')).toHaveLength(1)
    const latest = within(screen.getByRole('region', { name: '一つ前の結果' }))
    expect(latest.getByRole('img', { name: 'パス' })).toBeTruthy()
    expect(latest.getByRole('img', { name: '6ダメージ' })).toBeTruthy()
  })
})

describe('引きずって置く', () => {
  const six = () => ({
    rng: dice([
      [6, 6, 2],
      [1, 2, 3],
    ]),
    opponent: passOpponent,
  })

  it('手元のダイスを置き場へ、置き場のダイスを手元へ引きずって動かせる', async () => {
    const user = await start(six())
    const tray = mySeat().getByRole('group', { name: 'ダイス' })
    dragTo(
      within(tray).getByRole('button', { name: '2の目' }),
      myCard('魔弾').getByRole('button', { name: '魔弾の1つ目の枠に置く' }),
    )
    expect(myCard('魔弾').getByRole('button', { name: '2の目を戻す' })).toBeTruthy()
    expect(button('決定')).toBeTruthy()

    // 離した直後に届くクリックはタップとして扱わない
    const placed = myCard('魔弾').getByRole('button', { name: '2の目を戻す' })
    dragTo(placed, tray)
    fireEvent.click(within(tray).getByRole('button', { name: '2の目' }))
    expect(within(tray).getByRole('button', { name: '2の目' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()

    // 少し待てば、またタップで選べる
    await advance(1)
    await user.click(within(tray).getByRole('button', { name: '2の目' }))
    expect(within(tray).getByRole('button', { name: '2の目' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('置き場の外や何も無い所で離すと、ダイスは手元に残る', async () => {
    await start(six())
    const tray = mySeat().getByRole('group', { name: 'ダイス' })
    dragTo(within(tray).getByRole('button', { name: '2の目' }), mySeat().getByRole('listitem', { name: '反射' }))
    dragTo(within(tray).getByRole('button', { name: '2の目' }), mySeat().getByRole('listitem', { name: '魔弾' }))
    dragTo(within(tray).getByRole('button', { name: '2の目' }), null)
    expect(within(tray).getAllByRole('button', { name: /の目$/ })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
  })

  it('置いたダイスを同じカードの別の置き場へ引きずると、入れ替わる', async () => {
    await start({
      rng: dice([
        [6, 2, 1],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    const tray = mySeat().getByRole('group', { name: 'ダイス' })
    dragTo(
      within(tray).getByRole('button', { name: '6の目' }),
      myCard('火球').getByRole('button', { name: '火球のXの枠に置く' }),
    )
    dragTo(
      within(tray).getByRole('button', { name: '2の目' }),
      myCard('火球').getByRole('button', { name: '火球の2つ目の枠に置く' }),
    )
    expect(myCard('火球').getByRole('button', { name: '6ダメージを与える' })).toBeTruthy()
    const six = myCard('火球').getByRole('button', { name: '6の目を戻す' })
    const two = myCard('火球').getByRole('button', { name: '2の目を戻す' })
    dragTo(two, six.closest('[data-drop]'))
    expect(myCard('火球').getByRole('button', { name: '2ダメージを与える' })).toBeTruthy()
    expect(
      myCard('火球')
        .getAllByRole('button', { name: /の目を戻す$/ })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['2の目を戻す', '6の目を戻す'])
  })

  it('引きずっている間はダイスが指についてきて、取り消せば元に戻る', async () => {
    await start(six())
    const die = within(mySeat().getByRole('group', { name: 'ダイス' })).getByRole('button', { name: '2の目' })
    // 右ボタンでは引きずらない
    fireEvent.pointerDown(die, { clientX: 0, clientY: 0, button: 2, pointerId: 1 })
    fireEvent.pointerMove(die, { clientX: 40, clientY: 40, pointerId: 1 })
    expect(document.querySelector('.drag-ghost')).toBeNull()

    fireEvent.pointerDown(die, { clientX: 0, clientY: 0, button: 0, pointerId: 1 })
    fireEvent.pointerMove(die, { clientX: 40, clientY: 40, pointerId: 1 })
    expect(document.querySelector('.drag-ghost')).not.toBeNull()
    fireEvent.pointerCancel(die, { pointerId: 1 })
    expect(document.querySelector('.drag-ghost')).toBeNull()
    // 押しただけで動かさずに離せば、引きずりにならない
    fireEvent.pointerDown(die, { clientX: 0, clientY: 0, button: 0, pointerId: 1 })
    fireEvent.pointerUp(die, { clientX: 0, clientY: 0, pointerId: 1 })
    expect(document.querySelector('.drag-ghost')).toBeNull()
  })
})

describe('狭い画面', () => {
  let matches = true
  /** 画面の幅が変わったことを知らせる。テストから呼ぶ */
  let notify = () => {}
  beforeEach(() => {
    matches = true
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (media) =>
        ({
          get matches() {
            return matches
          },
          media,
          addEventListener: (_: string, f: () => void) => {
            notify = f
          },
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
  })
  afterEach(() => vi.restoreAllMocks())

  const roll = (theirs: number[] = [1, 2, 3]) => dice([[4, 5, 6], theirs])
  /** 席に出ているカード。名前を並べた欄は数えない */
  const cardsShown = (seat: ReturnType<typeof mySeat>): HTMLElement[] => seat.queryAllByRole('listitem', { name: /./ })

  it('カードの名前が並び、押したカードが一枚だけ出る', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    expect(cardsShown(mySeat())).toHaveLength(1)
    expect(mySeat().getByRole('listitem', { name: '火球' })).toBeTruthy()
    // 相手は名前だけ
    expect(cardsShown(cpuSeat())).toHaveLength(0)
    expect(cpuSeat().getByText('火球')).toBeTruthy()

    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    expect(cardsShown(mySeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['障壁'])
    expect(mySeat().getByRole('button', { name: '障壁' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('ダイスを持っていても、名前を押せばそのカードを出す。持っていたダイスは置かずに手元へ戻る', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    const four = mySeat().getByRole('button', { name: '4の目' })
    await user.click(four)
    expect(four.getAttribute('aria-pressed')).toBe('true')
    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    expect(cardsShown(mySeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['障壁'])
    expect(four.getAttribute('aria-pressed')).toBe('false')
    expect(myCard('障壁').queryByRole('button', { name: /を戻す$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()

    // 置き場を押して置く
    await place(user, 4, '障壁')
    expect(myCard('障壁').getByRole('button', { name: '4の目を戻す' })).toBeTruthy()
    expect(button('決定')).toBeTruthy()

    // 見ているカードの名前を押しても、置いたダイスはそのまま
    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    expect(myCard('障壁').getByRole('button', { name: '4の目を戻す' })).toBeTruthy()

    // 別のカードに替えると、置いたダイスも持っていたダイスも手元に戻る
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    await user.click(mySeat().getByRole('button', { name: '火球' }))
    expect(cardsShown(mySeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['火球'])
    expect(mySeat().getByRole('button', { name: '5の目' }).getAttribute('aria-pressed')).toBe('false')
    expect(mySeat().getByRole('button', { name: '4の目' })).toBeTruthy()
    expect(mySeat().getByRole('button', { name: '障壁' }).classList.contains('is-placed')).toBe(false)
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    expect(myCard('障壁').queryByRole('button', { name: '4の目を戻す' })).toBeNull()
  })

  it('2ステップ目も見ていたカードを出し続け、新しいターンには左端のカードに戻る', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    await user.click(mySeat().getByRole('button', { name: '雷槍' }))
    await place(user, 4, '雷槍')
    await user.click(button('決定'))
    await settle()
    // 詠唱した雷槍のまま。詠唱のダイスは1段目に残る
    expect(cardsShown(mySeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['雷槍'])
    expect(mySeat().getByRole('button', { name: '雷槍' }).getAttribute('aria-pressed')).toBe('true')
    expect(myCard('雷槍').getByRole('img', { name: '4の目' })).toBeTruthy()

    // 2段目に置いてから別のカードに替えると、2ステップ目に置いたダイスだけが手元に戻り、詠唱のダイスは残る
    await place(user, 5, '雷槍')
    expect(myCard('雷槍').getByRole('button', { name: '5の目を戻す' })).toBeTruthy()
    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    await user.click(mySeat().getByRole('button', { name: '雷槍' }))
    expect(myCard('雷槍').queryByRole('button', { name: '5の目を戻す' })).toBeNull()
    expect(myCard('雷槍').getByRole('img', { name: '4の目' })).toBeTruthy()
    expect(mySeat().getByRole('button', { name: '5の目' })).toBeTruthy()

    // パスで見ていたカードも残る
    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    await pass(user)
    await advance(IMPACT_MS)
    expect(cardsShown(mySeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['障壁'])
    // 新しいターンには左端のカードに戻り、カードの上のダイスは片付く
    await settle()
    expect(screen.getByText('Turn 2 - Step 1')).toBeTruthy()
    expect(cardsShown(mySeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['火球'])
    await user.click(mySeat().getByRole('button', { name: '雷槍' }))
    expect(myCard('雷槍').queryAllByRole('img', { name: /の目$/ })).toHaveLength(0)
  })

  it('相手の名前を押すと、1ステップ目に使ったダイスの残ったカードを見られる', async () => {
    const user = await start({
      rng: roll([6, 5, 4]),
      opponent: scriptedOpponent({ kind: 'fireball', dice: [0, 1] }),
    })
    await pass(user)
    await settle()
    expect(cpuSeat().getByRole('button', { name: '火球' }).classList.contains('is-placed')).toBe(true)
    await user.click(cpuSeat().getByRole('button', { name: '火球' }))
    const dialog = screen.getByRole('dialog', { name: '相手のカード' })
    expect(within(dialog).getAllByRole('img', { name: /^[56]の目$/ })).toHaveLength(2)
  })

  it('名前へ引きずって離すと、そのカードを出すだけで置かない', async () => {
    await start({ rng: roll(), opponent: passOpponent })
    const five = mySeat().getByRole('button', { name: '5の目' })
    dragTo(five, mySeat().getByRole('button', { name: '魔弾' }))
    expect(cardsShown(mySeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['魔弾'])
    expect(five.getAttribute('aria-pressed')).toBe('false')
    expect(myCard('魔弾').queryByRole('button', { name: '5の目を戻す' })).toBeNull()
  })

  it('相手が公開したカードは席には出さず、名前の札で示す', async () => {
    const user = await start({
      rng: roll([6, 5, 4]),
      opponent: scriptedOpponent({ kind: 'fireball', dice: [0, 1] }),
    })
    await pass(user)
    expect(cardsShown(cpuSeat())).toHaveLength(0)
    expect(cpuSeat().getByRole('button', { name: '火球' }).classList.contains('is-placed')).toBe(true)
    await settle()
    expect(cardsShown(cpuSeat())).toHaveLength(0)
  })

  it('相手のカードの名前を押すと、そのカードを大きく出す', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    await user.click(cpuSeat().getByRole('button', { name: '魔弾' }))
    const dialog = screen.getByRole('dialog', { name: '相手のカード' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(within(dialog).getByRole('listitem', { name: '魔弾' })).toBeTruthy()
    expect(
      within(dialog).getByRole('button', { name: '障壁で減らない2ダメージを与える。点線の枠にも置くと3' }),
    ).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(dialog.open).toBe(false)
  })

  it('画面の幅が変わると、カードを全て並べる表示に切り替わる', async () => {
    await start({ rng: roll(), opponent: passOpponent })
    expect(cardsShown(mySeat())).toHaveLength(1)
    matches = false
    act(() => notify())
    expect(cardsShown(mySeat())).toHaveLength(5)
  })
})

describe('ルール', () => {
  it('タイトルでは「?」から、対局中はメニューから開け、対局と同じカードが並ぶ', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <Game
        rng={dice([
          [1, 2, 3],
          [1, 2, 3],
        ])}
        opponent={passOpponent}
      />,
    )
    const check = async () => {
      const dialog = screen.getByRole('dialog', { name: 'ルール' }) as HTMLDialogElement
      expect(dialog.open).toBe(true)
      const cards = within(dialog).getAllByRole('listitem', { name: /./ })
      expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['火球', '障壁', '魔弾', '雷槍', '反射'])
      // ルールで見せるカードは、どの行も使える色で描く
      expect(dialog.querySelectorAll('.face-row:not(.is-on)')).toHaveLength(0)
      await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
      expect(dialog.open).toBe(false)
    }
    await user.click(button('ルール'))
    await check()
    await user.click(button('決闘を始める'))
    await fromMenu(user, 'ルール')
    await check()
  })
})

describe('モーダル', () => {
  it('外を押すと閉じ、中を押しても閉じない', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <Game
        rng={dice([
          [1, 2, 3],
          [1, 2, 3],
        ])}
        opponent={passOpponent}
      />,
    )
    await user.click(button('ルール'))
    const dialog = screen.getByRole('dialog', { name: 'ルール' }) as HTMLDialogElement
    // 中の文を押しても閉じない
    fireEvent.click(within(dialog).getByText(/毎ターン/))
    expect(dialog.open).toBe(true)
    // モーダルの枠の外を押すと閉じる
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 300,
      top: 100,
      bottom: 300,
    } as DOMRect)
    fireEvent.click(dialog, { clientX: 200, clientY: 200 })
    expect(dialog.open).toBe(true)
    fireEvent.click(dialog, { clientX: 20, clientY: 20 })
    expect(dialog.open).toBe(false)
  })
})

describe('パス', () => {
  it('確かめてからパスし、やめるを選べば何も起きない', async () => {
    const user = await start({
      rng: dice([
        [1, 2, 3],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await user.click(button('パス'))
    const dialog = screen.getByRole('dialog', { name: 'パスしますか？' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'やめる' }))
    expect(dialog.open).toBe(false)
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(screen.queryByText('あなたは何もしなかった')).toBeNull()

    await pass(user)
    expect(dialog.open).toBe(false)
    expect(screen.getByText('あなたは何もしなかった')).toBeTruthy()
  })
})

describe('降参', () => {
  it('確認して降参するとタイトルに戻り、続けるを選べば対局が続く', async () => {
    const user = await start({
      rng: dice([
        [1, 2, 3],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await fromMenu(user, '降参')
    const dialog = screen.getByRole('dialog', { name: '降参しますか？' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: '続ける' }))
    expect(dialog.open).toBe(false)
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()

    await fromMenu(user, '降参')
    await user.click(within(dialog).getByRole('button', { name: '降参する' }))
    expect(button('決闘を始める')).toBeTruthy()
  })
})

describe('決着', () => {
  /** 火球がまだ使えるか */
  const fireballReady = () => emptySlots('火球').length > 0

  /** 毎ターン 6,6,6 を振り、火球と魔弾で攻め続ける */
  async function attackUntilEnd(user: User) {
    for (let k = 0; k < 20 && !screen.queryByText(RESULT); k++) {
      const card = fireballReady() ? '火球' : '魔弾'
      await place(user, 6, card)
      // 二ステップ目の魔弾には、残っている6の目を全て置く
      if (
        within(mySeat().getByRole('group', { name: 'ダイス' })).queryAllByRole('button', { name: '6の目' }).length > 0
      ) {
        await place(user, 6, card)
      }
      await user.click(button('決定'))
      await settle()
    }
  }

  it('相手の体力を0にすると勝ち、もう一戦と強さの選び直しができる', async () => {
    const six: [number[], number[]] = [
      [6, 6, 6],
      [1, 2, 3],
    ]
    const user = await start({ rng: dice(six, six, six, six, six, six, six, six), opponent: passOpponent })
    await attackUntilEnd(user)
    expect(screen.getByText('あなたの勝ち')).toBeTruthy()
    // 決着したら、時間がたっても次へは進まない。降参もできない
    await settle()
    expect(screen.getByText('あなたの勝ち')).toBeTruthy()
    await user.click(button('メニュー'))
    const menu = screen.getByRole('dialog', { name: 'メニュー' }) as HTMLDialogElement
    expect(within(menu).getByRole('button', { name: 'ルール' })).toBeTruthy()
    expect(within(menu).queryByRole('button', { name: '降参' })).toBeNull()
    // 偽の DOM は Esc でモーダルを閉じないので、直接閉じる
    act(() => menu.close())
    expect(cpuSeat().getByLabelText('体力 0 / 20')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
    expect((button('パス') as HTMLButtonElement).disabled).toBe(true)

    await user.click(button('もう一戦'))
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 20 / 20')).toBeTruthy()

    await attackUntilEnd(user)
    await user.click(button('強さを選び直す'))
    expect(button('決闘を始める')).toBeTruthy()
  })

  it('同時に0になると引き分け', async () => {
    const six: [number[], number[]] = [
      [6, 6, 6],
      [6, 6, 6],
    ]
    const mirror: Opponent = (s) => {
      const p = s.players[1]
      if (!p.usedCards.includes('fireball')) return { kind: 'fireball', dice: [0, 1] }
      return { kind: 'bullet', dice: [2, null] }
    }
    const user = await start({ rng: dice(six, six, six, six, six, six, six, six), opponent: mirror })
    // 毎ターン火球 6 と魔弾 2 を撃ち合う。相手と同じ手を指す
    for (let k = 0; k < 20 && !screen.queryByText(RESULT); k++) {
      const fireball = fireballReady()
      await place(user, 6, fireball ? '火球' : '魔弾')
      if (fireball) await place(user, 6, '火球')
      await user.click(button('決定'))
      await settle()
    }
    expect(screen.getByText('相打ち。引き分けです')).toBeTruthy()
  })
})

describe('本物のCPUとの通し', () => {
  it('パスを続けても、CPUの手で最後まで進み決着する', async () => {
    const user = await start({ rng: seeded(42) }, 'つよい')
    for (let k = 0; k < 60 && !screen.queryByText(RESULT); k++) {
      await pass(user)
      await settle()
    }
    expect(screen.getByText('相手の勝ち')).toBeTruthy()
  }, 30_000)
})
