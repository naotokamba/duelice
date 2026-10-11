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
const settle = () => advance(4000)

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
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
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
    expect(myCard('火球').getByRole('img', { name: 'Xダメージ' })).toBeTruthy()

    await place(user, 6, '火球')
    // 一個では火球にならないので、まだ決定できない
    expect(screen.queryByRole('button', { name: '決定' })).toBeNull()
    await place(user, 6, '火球')
    expect(myCard('火球').getByRole('img', { name: '6ダメージ' })).toBeTruthy()
    expect(myCard('火球').getAllByRole('button', { name: '6の目を戻す' })).toHaveLength(2)

    await user.click(button('決定'))
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(screen.getByText('あなたの火球 6点')).toBeTruthy()
    // 公開中も、置いたダイスはカードの上に残る
    expect(myCard('火球').getAllByRole('img', { name: '6の目' })).toHaveLength(2)
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
    // 使ったカードには置けず、使ったダイスは手元で薄くなる
    expect(myCard('火球').getByText('使用済み')).toBeTruthy()
    expect(myCard('火球').queryByRole('button', { name: '火球に置く' })).toBeNull()
    expect(mySeat().getAllByRole('img', { name: '6の目、使用済み' })).toHaveLength(2)

    await user.click(button('パス'))
    await advance(2000)
    expect(screen.getByText('Turn 2 - Step 1')).toBeTruthy()
    expect(screen.getByText('Turn 2')).toBeTruthy()
    expect(myCard('火球').getAllByRole('button', { name: '火球に置く' })).toHaveLength(2)

    // 中央には一つ前だけを出し、全ての履歴は履歴の印からモーダルで見る
    await advance(BANNER_MS)
    expect(latest().getAllByRole('img', { name: 'パス' })).toHaveLength(2)
    await user.click(latest().getByRole('button', { name: '戦闘履歴' }))
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
    expect(myCard('障壁').getByRole('img', { name: '受けるダメージを4減らす' })).toBeTruthy()
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
    expect(myCard('雷槍').getByRole('img', { name: '詠唱。5以上のダメージで崩れる' })).toBeTruthy()
    await user.click(button('決定'))
    expect(screen.getByText('あなたの詠唱は保たれた')).toBeTruthy()
    // 詠唱の結果は、矢印が当たる時刻まで席には出さない
    expect(mySeat().queryByText('詠唱中')).toBeNull()
    await settle()
    expect(mySeat().getByText('詠唱中')).toBeTruthy()

    await place(user, 6, '雷槍')
    await place(user, 6, '雷槍')
    expect(myCard('雷槍').getByRole('img', { name: '12ダメージ' })).toBeTruthy()
    await user.click(button('決定'))
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
    await user.click(button('パス'))
    expect(screen.getByText('相手の火球 6点')).toBeTruthy()
    const theirs = cardIn(cpuSeat(), '火球')
    expect(theirs.getAllByRole('img', { name: /^[56]の目$/ })).toHaveLength(2)
    expect(theirs.getByRole('img', { name: '6ダメージ' })).toBeTruthy()
    await settle()
    expect(mySeat().getByLabelText('体力 14 / 20')).toBeTruthy()
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
    await advance(1)
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

  it('ダイスを持って名前を押すと、置けるカードなら置いて出す', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    const four = mySeat().getByRole('button', { name: '4の目' })
    await user.click(four)
    // 置けないカードは出すだけで、ダイスは持ったまま
    await user.click(mySeat().getByRole('button', { name: '反射' }))
    expect(mySeat().getByRole('listitem', { name: '反射' })).toBeTruthy()
    expect(four.getAttribute('aria-pressed')).toBe('true')

    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    expect(myCard('障壁').getByRole('button', { name: '4の目を戻す' })).toBeTruthy()
    expect(button('決定')).toBeTruthy()
  })

  it('次のステップへ進むと、使い終わったカードではなく使える最初のカードを出す', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    await user.click(mySeat().getByRole('button', { name: '4の目' }))
    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    await user.click(button('決定'))
    await settle()
    expect(cardsShown(mySeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['火球'])
    expect(mySeat().getByRole('button', { name: '火球' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('名前へ引きずって置ける', async () => {
    await start({ rng: roll(), opponent: passOpponent })
    dragTo(mySeat().getByRole('button', { name: '5の目' }), mySeat().getByRole('button', { name: '魔弾' }))
    expect(myCard('魔弾').getByRole('button', { name: '5の目を戻す' })).toBeTruthy()
  })

  it('相手が公開したカードは、相手の側に一枚出る', async () => {
    const user = await start({
      rng: roll([6, 5, 4]),
      opponent: scriptedOpponent({ kind: 'fireball', dice: [0, 1] }),
    })
    await user.click(button('パス'))
    expect(cardsShown(cpuSeat()).map((c) => c.getAttribute('aria-label'))).toEqual(['火球'])
    await settle()
    expect(cardsShown(cpuSeat())).toHaveLength(0)
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
  it('タイトルでも対局中でも「?」から開け、対局と同じカードが並ぶ', async () => {
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
    const open = async () => {
      await user.click(button('ルール'))
      const dialog = screen.getByRole('dialog', { name: 'ルール' }) as HTMLDialogElement
      expect(dialog.open).toBe(true)
      const cards = within(dialog).getAllByRole('listitem', { name: /./ })
      expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['火球', '障壁', '魔弾', '雷槍', '反射'])
      // ルールで見せるカードは、どの行も使える色で描く
      expect(dialog.querySelectorAll('.face-row:not(.is-on)')).toHaveLength(0)
      await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
      expect(dialog.open).toBe(false)
    }
    await open()
    await user.click(button('決闘を始める'))
    await open()
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
    await user.click(button('降参'))
    const dialog = screen.getByRole('dialog', { name: '降参しますか？' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: '続ける' }))
    expect(dialog.open).toBe(false)
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()

    await user.click(button('降参'))
    await user.click(within(dialog).getByRole('button', { name: '降参する' }))
    expect(button('決闘を始める')).toBeTruthy()
  })
})

describe('決着', () => {
  /** 火球がまだ使えるか */
  const fireballReady = () => myCard('火球').queryAllByRole('button', { name: '火球に置く' }).length > 0

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
    expect(screen.queryByRole('button', { name: '降参' })).toBeNull()
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
      return { kind: 'bullet', dice: [2] }
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
      await user.click(button('パス'))
      await settle()
    }
    expect(screen.getByText('相手の勝ち')).toBeTruthy()
  }, 30_000)
})
