// @vitest-environment happy-dom
// 画面の操作の流れのテスト。出目は乱数を差し替えて固定し、相手の手も差し替える。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action, Rng } from '../game/types'
import { seeded } from '../test/helpers'
import { Game, type Opponent } from './Game'

afterEach(cleanup)

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

/** 手元から value の目のダイスを一つ選び、カードの置き場に置く */
async function place(user: User, value: number, card: string) {
  await user.click(
    within(mySeat().getByRole('group', { name: 'ダイス' })).getAllByRole('button', { name: `${value}の目` })[0],
  )
  await user.click(myCard(card).getAllByRole('button', { name: `${card}に置く` })[0])
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
  const user = userEvent.setup()
  render(<Game {...props} />)
  if (level) await user.click(screen.getByRole('radio', { name: level }))
  await user.click(button('決闘を始める'))
  return user
}

describe('タイトル', () => {
  it('強さを選んで始められ、選んだ強さが表示される', async () => {
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
    expect(screen.getByText('相手の強さ：つよい')).toBeTruthy()
    expect(screen.getByText('1ターン目 一ステップ目')).toBeTruthy()
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
    expect(myCard('火球').getByText('Xダメージ')).toBeTruthy()

    await place(user, 6, '火球')
    // 一個では火球にならないので、まだ決定できない
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
    await place(user, 6, '火球')
    expect(myCard('火球').getByText('6ダメージ')).toBeTruthy()
    expect(myCard('火球').getAllByRole('button', { name: '6の目を戻す' })).toHaveLength(2)

    await user.click(button('決定'))
    expect(screen.getByText('1ターン目 一ステップ目 公開')).toBeTruthy()
    expect(screen.getByText('あなたの火球 6点')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 14 / 20')).toBeTruthy()
    // 公開中も、置いたダイスはカードの上に残る
    expect(myCard('火球').getAllByRole('img', { name: '6の目' })).toHaveLength(2)

    await user.click(button('二ステップ目へ'))
    expect(screen.getByText('1ターン目 二ステップ目')).toBeTruthy()
    // 使ったカードには置けず、使ったダイスは手元で薄くなる
    expect(myCard('火球').getByText('使用済み')).toBeTruthy()
    expect(myCard('火球').queryByRole('button', { name: '火球に置く' })).toBeNull()
    expect(mySeat().getAllByRole('img', { name: '6の目、使用済み' })).toHaveLength(2)

    await user.click(button('パス'))
    await user.click(button('次のターンへ'))
    expect(screen.getByText('2ターン目 一ステップ目')).toBeTruthy()
    expect(myCard('火球').getAllByRole('button', { name: '火球に置く' })).toHaveLength(2)
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
    const slot = myCard('障壁').getByRole('button', { name: '障壁に置く' }) as HTMLButtonElement
    expect(slot.disabled).toBe(true)
    await user.click(mySeat().getByRole('listitem', { name: '障壁' }))
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()

    const four = mySeat().getByRole('button', { name: '4の目' })
    await user.click(four)
    expect(four.getAttribute('aria-pressed')).toBe('true')
    await user.click(four)
    expect(four.getAttribute('aria-pressed')).toBe('false')

    await place(user, 4, '障壁')
    expect(myCard('障壁').getByText('受けるダメージを4減らす')).toBeTruthy()
    expect(button('決定')).toBeTruthy()

    // 埋まったカードには置けない。カードを押しても何も起きない
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    expect(myCard('障壁').queryByRole('button', { name: '障壁に置く' })).toBeNull()
    await user.click(mySeat().getByRole('listitem', { name: '障壁' }))
    expect(myCard('障壁').getAllByRole('button', { name: /を戻す$/ })).toHaveLength(1)
    expect(mySeat().getByRole('button', { name: '5の目' })).toBeTruthy()

    // カードの置き場の外を押しても置ける。別のカードに置くと前のダイスは手元に戻る
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    await user.click(mySeat().getByRole('listitem', { name: '魔弾' }))
    expect(myCard('魔弾').getByRole('button', { name: '5の目を戻す' })).toBeTruthy()
    expect(mySeat().getByRole('button', { name: '4の目' })).toBeTruthy()

    await user.click(myCard('魔弾').getByRole('button', { name: '5の目を戻す' }))
    expect(mySeat().getByRole('button', { name: '5の目' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
  })

  it('ゾロ目が無いと反射には置けない', async () => {
    await start({
      rng: dice([
        [1, 2, 3],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    expect(myCard('反射').queryAllByRole('button', { name: '反射に置く' })).toHaveLength(0)
  })

  it('反射には同じ目しか並べられない', async () => {
    const user = await start({
      rng: dice([
        [3, 5, 3],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await place(user, 3, '反射')
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    const rest = myCard('反射').getByRole('button', { name: '反射に置く' }) as HTMLButtonElement
    expect(rest.disabled).toBe(true)
    await place(user, 3, '反射')
    expect(button('決定')).toBeTruthy()
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
    expect(myCard('雷槍').getByText('詠唱。5以上受けると崩れる')).toBeTruthy()
    await user.click(button('決定'))
    expect(screen.getByText('あなたの詠唱は保たれた')).toBeTruthy()
    await user.click(button('二ステップ目へ'))
    expect(mySeat().getByText('詠唱中')).toBeTruthy()

    await place(user, 6, '雷槍')
    await place(user, 6, '雷槍')
    expect(myCard('雷槍').getByText('12ダメージ')).toBeTruthy()
    await user.click(button('決定'))
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
    await user.click(button('パス'))
    expect(screen.getByText('相手の火球 6点')).toBeTruthy()
    expect(screen.getByText('6点受けた')).toBeTruthy()
    expect(mySeat().getByLabelText('体力 14 / 20')).toBeTruthy()
    const theirs = cardIn(cpuSeat(), '火球')
    expect(theirs.getAllByRole('img', { name: /^[56]の目$/ })).toHaveLength(2)
    expect(theirs.getByText('6ダメージ')).toBeTruthy()
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

  it('手元のダイスをカードへ、カードのダイスを手元へ引きずって動かせる', async () => {
    const user = await start(six())
    const tray = mySeat().getByRole('group', { name: 'ダイス' })
    dragTo(within(tray).getByRole('button', { name: '2の目' }), mySeat().getByRole('listitem', { name: '魔弾' }))
    expect(myCard('魔弾').getByRole('button', { name: '2の目を戻す' })).toBeTruthy()
    expect(button('決定')).toBeTruthy()

    // 離した直後に届くクリックはタップとして扱わない
    const placed = myCard('魔弾').getByRole('button', { name: '2の目を戻す' })
    dragTo(placed, tray)
    fireEvent.click(within(tray).getByRole('button', { name: '2の目' }))
    expect(within(tray).getByRole('button', { name: '2の目' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()

    // 少し待てば、またタップで選べる
    await new Promise((r) => setTimeout(r, 0))
    await user.click(within(tray).getByRole('button', { name: '2の目' }))
    expect(within(tray).getByRole('button', { name: '2の目' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('置けない場所や何も無い所で離すと、ダイスは手元に残る', async () => {
    await start(six())
    const tray = mySeat().getByRole('group', { name: 'ダイス' })
    dragTo(within(tray).getByRole('button', { name: '2の目' }), mySeat().getByRole('listitem', { name: '反射' }))
    dragTo(within(tray).getByRole('button', { name: '2の目' }), null)
    expect(within(tray).getAllByRole('button', { name: /の目$/ })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
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

describe('決着', () => {
  /** 火球がまだ使えるか */
  const fireballReady = () => myCard('火球').queryAllByRole('button', { name: '火球に置く' }).length > 0

  /** 毎ターン 6,6,6 を振り、火球と魔弾で攻め続ける */
  async function attackUntilEnd(user: User) {
    for (let k = 0; k < 20 && !screen.queryByText(RESULT); k++) {
      if (screen.queryByRole('button', { name: /ステップ目へ|次のターンへ/ })) {
        await user.click(screen.getByRole('button', { name: /ステップ目へ|次のターンへ/ }))
        continue
      }
      const card = fireballReady() ? '火球' : '魔弾'
      await place(user, 6, card)
      // 二ステップ目の魔弾には、残っている6の目を全て置く
      if (
        within(mySeat().getByRole('group', { name: 'ダイス' })).queryAllByRole('button', { name: '6の目' }).length > 0
      ) {
        await place(user, 6, card)
      }
      await user.click(button('決定'))
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
    expect(cpuSeat().getByLabelText('体力 0 / 20')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
    expect((button('パス') as HTMLButtonElement).disabled).toBe(true)

    await user.click(button('もう一戦'))
    expect(screen.getByText('1ターン目 一ステップ目')).toBeTruthy()
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
      return { kind: 'bullet', dice: [2] }
    }
    const user = await start({ rng: dice(six, six, six, six, six, six, six, six), opponent: mirror })
    // 毎ターン火球 6 と魔弾 2 を撃ち合う。相手と同じ手を指す
    for (let k = 0; k < 20 && !screen.queryByText(RESULT); k++) {
      if (screen.queryByRole('button', { name: /ステップ目へ|次のターンへ/ })) {
        await user.click(screen.getByRole('button', { name: /ステップ目へ|次のターンへ/ }))
        continue
      }
      const fireball = fireballReady()
      await place(user, 6, fireball ? '火球' : '魔弾')
      if (fireball) await place(user, 6, '火球')
      await user.click(button('決定'))
    }
    expect(screen.getByText('相打ち。引き分けです')).toBeTruthy()
  })
})

describe('本物のCPUとの通し', () => {
  it('パスを続けても、CPUの手で最後まで進み決着する', async () => {
    const user = await start({ rng: seeded(42) }, 'つよい')
    for (let k = 0; k < 60 && !screen.queryByText(RESULT); k++) {
      const next = screen.queryByRole('button', { name: /ステップ目へ|次のターンへ/ })
      await user.click(next ?? button('パス'))
    }
    expect(screen.getByText('相手の勝ち')).toBeTruthy()
    expect(screen.getByText('これまでの経過')).toBeTruthy()
  }, 30_000)
})
