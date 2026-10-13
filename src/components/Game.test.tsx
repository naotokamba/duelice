// @vitest-environment happy-dom
// 画面を通した操作の流れ。出目は乱数を差し替えて固定し、相手の手も差し替える。
// 一枚のカードや一つの部品の見た目は、それぞれの部品のテストで確かめる。ここでは操作が対局の流れにつながるかを見る。

import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../game/types'
import { seeded } from '../test/helpers'
import {
  advance,
  blockedReason,
  button,
  cardIn,
  confirmButton,
  cpuSeat,
  dice,
  diceOn,
  dragTo,
  emptySlots,
  fromMenu,
  myCard,
  mySeat,
  narrowScreen,
  pass,
  passOpponent,
  place,
  RESULT,
  scriptedOpponent,
  settle,
  shownCardNames,
  start,
  trayDie,
  trayOf,
  type User,
  useFakeClock,
} from '../test/screen'
import { HOLD_MS, IMPACT_MS, revealMs } from './Exchange'
import type { Opponent } from './Game'
import { BANNER_MS } from './useRevealClock'

/** 攻撃も血も無い公開。構えを見せてから短く進む */
const CALM = { strikes: [], blood: [0, 0] as [number, number] }

beforeEach(useFakeClock)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const lowRoll = () =>
  dice([
    [1, 2, 3],
    [1, 2, 3],
  ])

describe('タイトル', () => {
  it('強さを選んで始められる', async () => {
    await start({ rng: lowRoll(), opponent: passOpponent }, 'つよい')
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(mySeat().getByLabelText('体力 20 / 20')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 20 / 20')).toBeTruthy()
  })

  it('対局中はヘッダーを出さず、ルールと降参はメニューにしまう', async () => {
    await start({ rng: lowRoll(), opponent: passOpponent })
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('button', { name: 'ルール' })).toBeNull()
    expect(button('メニュー')).toBeTruthy()
  })
})

describe('一ターンの流れ', () => {
  const sixes = () => ({
    rng: dice([
      [6, 6, 2],
      [1, 2, 3],
    ]),
    opponent: passOpponent,
  })

  /** 魔弾に6を二つ置いて決定する */
  async function fireSixes(user: User) {
    await place(user, 6, '魔弾')
    await place(user, 6, '魔弾')
    await user.click(button('決定'))
  }

  it('決定すると公開し、矢印が当たる時刻に体力を減らす', async () => {
    const user = await start(sixes())
    expect(confirmButton()).toBeNull()
    await fireSixes(user)
    expect(screen.getByText('あなたの魔弾 4点')).toBeTruthy()
    // 公開の間も、置いたダイスはカードの上に残る
    expect(diceOn(myCard('魔弾'))).toEqual(['6の目', '6の目'])
    expect(cpuSeat().getByLabelText('体力 20 / 20')).toBeTruthy()
    await advance(IMPACT_MS)
    expect(cpuSeat().getByLabelText('体力 16 / 20')).toBeTruthy()
  })

  it('公開が終わると二ステップ目に進んで知らせ、中央に一つ前の結果を出す', async () => {
    const user = await start(sixes())
    await fireSixes(user)
    await advance(IMPACT_MS + HOLD_MS + 50)
    expect(screen.getByText('Turn 1 - Step 2')).toBeTruthy()
    expect(screen.getByText('Step 2', { selector: '.banner span' })).toBeTruthy()
    await advance(BANNER_MS)
    expect(screen.queryByText('Step 2', { selector: '.banner span' })).toBeNull()
    const latest = within(screen.getByRole('region', { name: '一つ前の結果' }))
    expect(latest.getByText('魔弾')).toBeTruthy()
    expect(latest.getByRole('img', { name: '4ダメージ' })).toBeTruthy()
  })

  it('二ステップ目には、一ステップ目のダイスが押せない駒としてカードに残り、手元には跡だけが残る', async () => {
    const user = await start(sixes())
    await fireSixes(user)
    await settle()
    expect(myCard('魔弾').getByText('使用済み')).toBeTruthy()
    expect(emptySlots('魔弾')).toHaveLength(0)
    expect(myCard('魔弾').getAllByRole('img', { name: '6の目' })).toHaveLength(2)
    expect(myCard('魔弾').queryAllByRole('button', { name: /の目/ })).toHaveLength(0)
    expect(trayOf(mySeat()).queryAllByRole('button', { name: '6の目' })).toHaveLength(0)
    expect(trayDie(2)).toBeTruthy()
  })

  it('ターンが終わると振り直して知らせ、カードの上のダイスは片付く', async () => {
    const user = await start(sixes())
    await fireSixes(user)
    await settle()
    await pass(user)
    await advance(revealMs(CALM))
    expect(screen.getByText('Turn 2 - Step 1')).toBeTruthy()
    expect(screen.getByText('Turn 2', { selector: '.banner span' })).toBeTruthy()
    expect(diceOn(myCard('魔弾'))).toEqual([])
    expect(emptySlots('魔弾').map((b) => b.getAttribute('aria-label'))).toEqual([
      '魔弾の1つ目の枠に置く',
      '魔弾の2つ目の枠に置く',
    ])
  })

  it('戦闘履歴は印から開き、新しい順に並ぶ', async () => {
    const user = await start(sixes())
    await fireSixes(user)
    await settle()
    await pass(user)
    await advance(revealMs(CALM) + BANNER_MS)
    // 中央には一つ前の結果だけを出す
    const latest = within(screen.getByRole('region', { name: '一つ前の結果' }))
    expect(latest.getAllByRole('listitem')).toHaveLength(1)
    expect(latest.getAllByRole('img', { name: 'パス' })).toHaveLength(2)
    await user.click(button('戦闘履歴'))
    const dialog = screen.getByRole('dialog', { name: '戦闘履歴' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    const entries = within(dialog).getAllByRole('listitem')
    expect(entries.map((e) => within(e).getByText(/^\d-\d$/).textContent)).toEqual(['1-2', '1-1'])
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(dialog.open).toBe(false)
  })
})

describe('置く', () => {
  const roll = (mine: number[]) => ({ rng: dice([mine, [1, 2, 3]]), opponent: passOpponent })

  it('何も持っていなければ置き場は押せず、カードの置き場の外を押しても置かない', async () => {
    const user = await start(roll([4, 5, 6]))
    const slot = myCard('炎壁').getByRole('button', { name: '炎壁のXの枠に置く' }) as HTMLButtonElement
    expect(slot.disabled).toBe(true)
    await user.click(trayDie(5))
    expect(trayDie(5).getAttribute('aria-pressed')).toBe('true')
    await user.click(mySeat().getByRole('listitem', { name: '炎壁' }))
    expect(diceOn(myCard('炎壁'))).toEqual([])
    expect(confirmButton()).toBeNull()
    // もう一度押せば下ろす
    await user.click(trayDie(5))
    expect(trayDie(5).getAttribute('aria-pressed')).toBe('false')
  })

  it('ダイスは押した置き場に入り、置いた場所は公開でも次のステップでも変わらない', async () => {
    const user = await start(roll([6, 2, 1]))
    await user.click(trayDie(6))
    await user.click(myCard('血弾').getByRole('button', { name: '血弾のYの枠に置く' }))
    await user.click(trayDie(1))
    await user.click(myCard('血弾').getByRole('button', { name: '血弾のXの枠に置く' }))
    expect(diceOn(myCard('血弾'))).toEqual(['1の目', '6の目'])
    await user.click(button('決定'))
    expect(diceOn(myCard('血弾'))).toEqual(['1の目', '6の目'])
    await settle()
    expect(diceOn(myCard('血弾'))).toEqual(['1の目', '6の目'])
  })

  it('埋まった置き場に置くと、あったダイスは手元に戻る。置いたダイスを押せば手元に戻る', async () => {
    const user = await start(roll([4, 5, 6]))
    await place(user, 4, '炎壁')
    await user.click(trayDie(5))
    await user.click(myCard('炎壁').getByRole('button', { name: '4の目と入れ替える' }))
    expect(diceOn(myCard('炎壁'))).toEqual(['5の目'])
    expect(trayDie(4)).toBeTruthy()
    await user.click(myCard('炎壁').getByRole('button', { name: '5の目を戻す' }))
    expect(diceOn(myCard('炎壁'))).toEqual([])
    expect(confirmButton()).toBeNull()
  })

  it('別のカードに置くと、前のカードのダイスは手元に戻る', async () => {
    const user = await start(roll([4, 5, 6]))
    await place(user, 4, '炎壁')
    await place(user, 5, '妨害')
    expect(diceOn(myCard('炎壁'))).toEqual([])
    expect(diceOn(myCard('妨害'))).toEqual(['5の目'])
    expect(trayDie(4)).toBeTruthy()
  })

  it('血弾は X の枠に置いた目に2を足して撃ち、Y の枠の目の血を払う。X の枠が空なら決定を押せず理由が出る', async () => {
    const user = await start(roll([6, 2, 1]))
    await user.click(trayDie(6))
    await user.click(myCard('血弾').getByRole('button', { name: '血弾のYの枠に置く' }))
    expect(blockedReason()).toBe('X の枠に置く')
    await place(user, 2, '血弾')
    expect(blockedReason()).toBeNull()
    await user.click(button('決定'))
    expect(screen.getByText('あなたの血弾 4点')).toBeTruthy()
    expect(screen.getByText('あなたは血弾で 6点の血を払った')).toBeTruthy()
    await settle()
    expect(cpuSeat().getByLabelText('体力 16 / 20')).toBeTruthy()
    expect(mySeat().getByLabelText('体力 14 / 20')).toBeTruthy()
  })

  it('妨害はダイス1個で撃ち、目に関係なく2点', async () => {
    const user = await start(roll([6, 2, 1]))
    await place(user, 6, '妨害')
    expect(blockedReason()).toBeNull()
    await user.click(button('決定'))
    expect(screen.getByText('あなたの妨害 2点')).toBeTruthy()
    await settle()
    expect(cpuSeat().getByLabelText('体力 18 / 20')).toBeTruthy()
  })

  it('魔弾は同じ目を2個置けば撃て、目が違えば決定を押せず理由が出る', async () => {
    const user = await start(roll([3, 5, 3]))
    await place(user, 3, '魔弾')
    expect(blockedReason()).toBe('同じ目をあと1個置く')
    await place(user, 5, '魔弾')
    expect(blockedReason()).toBe('同じ目を2個置く')
    await user.click(trayDie(3))
    await user.click(myCard('魔弾').getByRole('button', { name: '5の目と入れ替える' }))
    expect(blockedReason()).toBeNull()
    await user.click(button('決定'))
    expect(screen.getByText('あなたの魔弾 4点')).toBeTruthy()
  })

  it('相手が払った血は、相手の体力から減る', async () => {
    const user = await start({
      rng: dice([
        [1, 2, 3],
        [5, 4, 1],
      ]),
      opponent: scriptedOpponent({ kind: 'bloodBullet', dice: [0, 1] }),
    })
    await pass(user)
    // X の枠の 5 に2を足して7、Y の枠の 4 の血を払う
    expect(screen.getByText('相手の血弾 7点')).toBeTruthy()
    expect(screen.getByText('相手は血弾で 4点の血を払った')).toBeTruthy()
    await settle()
    expect(mySeat().getByLabelText('体力 13 / 20')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 16 / 20')).toBeTruthy()
  })

  it('決定できない理由は読み上げでも伝える', async () => {
    const user = await start(roll([6, 2, 1]))
    expect(screen.getByRole('status').textContent).toBe('')
    await place(user, 6, '血弾')
    expect(screen.getByRole('status').textContent).toBe('あと1個置く')
  })
})

describe('雷槍の詠唱', () => {
  it('詠唱が保たれると、二ステップ目に1段目の詠唱のダイスを残したまま発動できる', async () => {
    const user = await start({
      rng: dice([
        [5, 6, 6],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await place(user, 5, '雷槍')
    await user.click(button('決定'))
    expect(screen.getByText('あなたの詠唱は保たれた')).toBeTruthy()
    // 詠唱の結果は、矢印が当たる時刻まで席には出さない
    expect(mySeat().queryByText('詠唱中')).toBeNull()
    await settle()
    expect(mySeat().getByText('詠唱中')).toBeTruthy()
    expect(myCard('雷槍').getByRole('img', { name: '5の目' })).toBeTruthy()
    expect(emptySlots('雷槍').map((b) => b.getAttribute('aria-label'))).toEqual([
      '雷槍の1つ目の枠に置く',
      '雷槍の2つ目の枠に置く',
    ])
    await place(user, 6, '雷槍')
    await place(user, 6, '雷槍')
    expect(myCard('雷槍').getByRole('button', { name: '炎壁で減らない12ダメージを与える' })).toBeTruthy()
    await user.click(button('決定'))
    // 2ステップ目の公開の間は、詠唱のダイスと発動のダイスが並ぶ
    expect(diceOn(myCard('雷槍'))).toEqual(['5の目', '6の目', '6の目'])
    await settle()
    expect(cpuSeat().getByLabelText('体力 8 / 20')).toBeTruthy()
  })

  it('攻撃を受けても詠唱は崩れない', async () => {
    const user = await start({
      rng: dice([
        [2, 5, 5],
        [6, 4, 1],
      ]),
      opponent: scriptedOpponent({ kind: 'bloodBullet', dice: [0, 1] }),
    })
    await place(user, 2, '雷槍')
    await user.click(button('決定'))
    expect(screen.getByText('あなたの詠唱は保たれた')).toBeTruthy()
    await settle()
    expect(mySeat().getByText('詠唱中')).toBeTruthy()
    expect(mySeat().getByLabelText('体力 12 / 20')).toBeTruthy()
  })

  it('妨害を受けた詠唱は崩れ、当たった時刻に崩れたと出し、二段目は使えない', async () => {
    const user = await start({
      rng: dice([
        [2, 5, 5],
        [6, 4, 1],
      ]),
      opponent: scriptedOpponent({ kind: 'interrupt', dice: [0] }),
    })
    await place(user, 2, '雷槍')
    await user.click(button('決定'))
    expect(mySeat().queryByText('詠唱は崩れた')).toBeNull()
    await advance(IMPACT_MS)
    expect(mySeat().getByText('詠唱は崩れた')).toBeTruthy()
    await settle()
    expect(mySeat().getByText('詠唱は崩れた')).toBeTruthy()
    expect(emptySlots('雷槍')).toHaveLength(0)
  })
})

describe('相手', () => {
  it('相手の行動が公開され、相手のダイスは置いた置き場どおりにカードに残る', async () => {
    const user = await start({
      rng: dice([
        [1, 2, 3],
        [6, 5, 4],
      ]),
      // X の枠に5、Y の枠に6を置く
      opponent: scriptedOpponent({ kind: 'bloodBullet', dice: [1, 0] }),
    })
    await pass(user)
    expect(screen.getByText('相手の血弾 7点')).toBeTruthy()
    expect(diceOn(cardIn(cpuSeat(), '血弾'))).toEqual(['5の目', '6の目'])
    await settle()
    expect(mySeat().getByLabelText('体力 13 / 20')).toBeTruthy()
    expect(diceOn(cardIn(cpuSeat(), '血弾'))).toEqual(['5の目', '6の目'])
    // 相手の手元には、使っていないダイスだけが残る
    expect(trayOf(cpuSeat()).getAllByRole('img')).toHaveLength(1)
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
    dragTo(trayDie(2), myCard('妨害').getByRole('button', { name: '妨害の1つ目の枠に置く' }))
    expect(diceOn(myCard('妨害'))).toEqual(['2の目'])

    // 離した直後に届くクリックはタップとして扱わない
    dragTo(myCard('妨害').getByRole('button', { name: '2の目を戻す' }), tray)
    fireEvent.click(trayDie(2))
    expect(trayDie(2).getAttribute('aria-pressed')).toBe('false')
    expect(confirmButton()).toBeNull()

    // 少し待てば、またタップで選べる
    await advance(1)
    await user.click(trayDie(2))
    expect(trayDie(2).getAttribute('aria-pressed')).toBe('true')
  })

  it('置き場の外や何も無い所で離すと、ダイスは手元に残る', async () => {
    await start(six())
    dragTo(trayDie(2), mySeat().getByRole('listitem', { name: '魔弾' }))
    dragTo(trayDie(2), null)
    expect(trayOf(mySeat()).getAllByRole('button', { name: /の目$/ })).toHaveLength(3)
    expect(confirmButton()).toBeNull()
  })

  it('置いたダイスを同じカードの別の置き場へ引きずると、入れ替わる', async () => {
    await start({
      rng: dice([
        [6, 2, 1],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    dragTo(trayDie(6), myCard('血弾').getByRole('button', { name: '血弾のXの枠に置く' }))
    dragTo(trayDie(2), myCard('血弾').getByRole('button', { name: '血弾のYの枠に置く' }))
    expect(diceOn(myCard('血弾'))).toEqual(['6の目', '2の目'])
    const two = myCard('血弾').getByRole('button', { name: '2の目を戻す' })
    dragTo(two, myCard('血弾').getByRole('button', { name: '6の目を戻す' }))
    expect(diceOn(myCard('血弾'))).toEqual(['2の目', '6の目'])
    expect(myCard('血弾').getByRole('button', { name: '4ダメージを与える' })).toBeTruthy()
  })

  it('引きずっている間はダイスが指についてきて、取り消せば元に戻る', async () => {
    await start(six())
    const die = trayDie(2)
    const ghost = () => document.querySelector('.drag-ghost')
    // 右ボタンでは引きずらない
    fireEvent.pointerDown(die, { clientX: 0, clientY: 0, button: 2, pointerId: 1 })
    fireEvent.pointerMove(die, { clientX: 40, clientY: 40, pointerId: 1 })
    expect(ghost()).toBeNull()

    fireEvent.pointerDown(die, { clientX: 0, clientY: 0, button: 0, pointerId: 1 })
    fireEvent.pointerMove(die, { clientX: 40, clientY: 40, pointerId: 1 })
    expect(ghost()).not.toBeNull()
    fireEvent.pointerCancel(die, { pointerId: 1 })
    expect(ghost()).toBeNull()
    // 押しただけで動かさずに離せば、引きずりにならない
    fireEvent.pointerDown(die, { clientX: 0, clientY: 0, button: 0, pointerId: 1 })
    fireEvent.pointerUp(die, { clientX: 0, clientY: 0, pointerId: 1 })
    expect(ghost()).toBeNull()
  })
})

describe('狭い画面', () => {
  let media: ReturnType<typeof narrowScreen>
  beforeEach(() => {
    media = narrowScreen()
  })
  const roll = (theirs: number[] = [1, 2, 3]) => dice([[4, 5, 6], theirs])
  const tab = (seat: typeof mySeat, name: string) => seat().getByRole('button', { name })

  it('カードの名前が並び、使える最初のカードが出る。押したカードが一枚だけ出る。相手は名前だけ', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    // 4,5,6 では左端の血弾が使える
    expect(shownCardNames(mySeat())).toEqual(['血弾'])
    expect(shownCardNames(cpuSeat())).toEqual([])
    await user.click(tab(mySeat, '妨害'))
    expect(shownCardNames(mySeat())).toEqual(['妨害'])
    expect(tab(mySeat, '妨害').getAttribute('aria-pressed')).toBe('true')
  })

  it('ダイスを持っていても、名前を押せばそのカードを出し、持っていたダイスは置かない', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    await user.click(trayDie(4))
    await user.click(tab(mySeat, '炎壁'))
    expect(shownCardNames(mySeat())).toEqual(['炎壁'])
    expect(trayDie(4).getAttribute('aria-pressed')).toBe('false')
    expect(diceOn(myCard('炎壁'))).toEqual([])
  })

  it('見ているカードの名前を押しても置いたダイスは残り、別のカードに替えると手元に戻る', async () => {
    const user = await start({ rng: roll(), opponent: passOpponent })
    await user.click(tab(mySeat, '炎壁'))
    await place(user, 4, '炎壁')
    expect(tab(mySeat, '炎壁').getAttribute('aria-description')).toBe('ダイスが置いてある')
    await user.click(tab(mySeat, '炎壁'))
    expect(diceOn(myCard('炎壁'))).toEqual(['4の目'])

    await user.click(tab(mySeat, '妨害'))
    expect(shownCardNames(mySeat())).toEqual(['妨害'])
    expect(trayDie(4)).toBeTruthy()
    expect(tab(mySeat, '炎壁').getAttribute('aria-description')).toBeNull()
    expect(confirmButton()).toBeNull()
  })

  it('2ステップ目も見ていたカードを出し続け、新しいターンには使える最初のカードに戻る', async () => {
    // 2ターン目は、使える最初のカードの血弾に戻る
    const rng = dice(
      [
        [4, 5, 6],
        [1, 2, 3],
      ],
      [
        [2, 2, 5],
        [1, 2, 3],
      ],
    )
    const user = await start({ rng, opponent: passOpponent })
    await user.click(tab(mySeat, '雷槍'))
    await place(user, 4, '雷槍')
    await user.click(button('決定'))
    await settle()
    expect(shownCardNames(mySeat())).toEqual(['雷槍'])
    expect(myCard('雷槍').getByRole('img', { name: '4の目' })).toBeTruthy()

    // 2段目に置いてから別のカードに替えると、2ステップ目に置いたダイスだけが手元に戻り、詠唱のダイスは残る
    await place(user, 5, '雷槍')
    await user.click(tab(mySeat, '炎壁'))
    await user.click(tab(mySeat, '雷槍'))
    expect(diceOn(myCard('雷槍'))).toEqual(['4の目'])
    expect(trayDie(5)).toBeTruthy()

    await user.click(tab(mySeat, '炎壁'))
    await pass(user)
    await advance(IMPACT_MS)
    expect(shownCardNames(mySeat())).toEqual(['炎壁'])
    await settle()
    expect(screen.getByText('Turn 2 - Step 1')).toBeTruthy()
    expect(shownCardNames(mySeat())).toEqual(['血弾'])
  })

  it('名前へ引きずって離すと、そのカードを出すだけで置かない', async () => {
    await start({ rng: roll(), opponent: passOpponent })
    dragTo(trayDie(5), tab(mySeat, '妨害'))
    expect(shownCardNames(mySeat())).toEqual(['妨害'])
    expect(trayDie(5).getAttribute('aria-pressed')).toBe('false')
    expect(diceOn(myCard('妨害'))).toEqual([])
  })

  it('相手のカードの名前を押すと窓で大きく出し、置いた場所どおりのダイスも見える', async () => {
    const user = await start({
      rng: roll([6, 5, 4]),
      opponent: scriptedOpponent({ kind: 'bloodBullet', dice: [1, 0] }),
    })
    await pass(user)
    expect(shownCardNames(cpuSeat())).toEqual([])
    await settle()
    await user.click(tab(cpuSeat, '血弾'))
    const dialog = screen.getByRole('dialog', { name: '相手のカード' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(diceOn(within(dialog))).toEqual(['5の目', '6の目'])
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(dialog.open).toBe(false)
  })

  it('画面の幅が変わると、カードを全て並べる表示に切り替わる', async () => {
    await start({ rng: roll(), opponent: passOpponent })
    expect(shownCardNames(mySeat())).toHaveLength(1)
    media.narrow = false
    act(() => media.notify())
    expect(shownCardNames(mySeat())).toHaveLength(5)
  })
})

describe('メニュー', () => {
  it('ルールはメニューから開け、対局と同じカードが並ぶ', async () => {
    const user = await start({ rng: lowRoll(), opponent: passOpponent })
    await fromMenu(user, 'ルール')
    const dialog = screen.getByRole('dialog', { name: 'ルール' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    const cards = within(dialog).getAllByRole('listitem', { name: /./ })
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['血弾', '炎壁', '魔弾', '雷槍', '妨害'])
  })

  it('降参は確かめてからタイトルに戻り、続けるを選べば対局が続く', async () => {
    const user = await start({ rng: lowRoll(), opponent: passOpponent })
    await fromMenu(user, '降参')
    const dialog = screen.getByRole('dialog', { name: '降参しますか？' }) as HTMLDialogElement
    await user.click(within(dialog).getByRole('button', { name: '続ける' }))
    expect(dialog.open).toBe(false)
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()

    await fromMenu(user, '降参')
    await user.click(within(dialog).getByRole('button', { name: '降参する' }))
    expect(button('決闘を始める')).toBeTruthy()
  })
})

describe('パス', () => {
  it('確かめてからパスし、やめるを選べば何も起きない', async () => {
    const user = await start({ rng: lowRoll(), opponent: passOpponent })
    await user.click(button('パス'))
    const dialog = screen.getByRole('dialog', { name: 'パスしますか？' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'やめる' }))
    expect(dialog.open).toBe(false)
    expect(screen.queryByText('あなたは何もしなかった')).toBeNull()

    await pass(user)
    expect(screen.getByText('あなたは何もしなかった')).toBeTruthy()
  })
})

describe('決着', () => {
  /** 魔弾がまだ使えるか */
  const bulletReady = () => emptySlots('魔弾').length > 0

  /** 毎ターン 6,6,6 を振り、魔弾と妨害で攻め続ける */
  async function attackUntilEnd(user: User) {
    for (let k = 0; k < 20 && !screen.queryByText(RESULT); k++) {
      const card = bulletReady() ? '魔弾' : '妨害'
      await place(user, 6, card)
      // 魔弾には6をもう一つ置く。二ステップ目の妨害には、残った6を1個だけ置く
      if (card === '魔弾') await place(user, 6, card)
      await user.click(button('決定'))
      await settle()
    }
  }

  const six: [number[], number[]] = [
    [6, 6, 6],
    [1, 2, 3],
  ]

  it('相手の体力を0にすると勝ち、それからは進まず、降参もできない', async () => {
    const user = await start({ rng: dice(six, six, six, six), opponent: passOpponent })
    await attackUntilEnd(user)
    expect(screen.getByText('あなたの勝ち')).toBeTruthy()
    await settle()
    expect(screen.getByText('あなたの勝ち')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 0 / 20')).toBeTruthy()
    // 魔弾も妨害も血を払わない
    expect(mySeat().getByLabelText('体力 20 / 20')).toBeTruthy()
    expect(confirmButton()).toBeNull()
    expect((button('パス') as HTMLButtonElement).disabled).toBe(true)
    await user.click(button('メニュー'))
    const menu = screen.getByRole('dialog', { name: 'メニュー' })
    expect(within(menu).getByRole('button', { name: 'ルール' })).toBeTruthy()
    expect(within(menu).queryByRole('button', { name: '降参' })).toBeNull()
  })

  it('もう一戦で初めからやり直し、強さを選び直すとタイトルに戻る', async () => {
    const user = await start({ rng: dice(six, six, six, six, six, six, six, six), opponent: passOpponent })
    await attackUntilEnd(user)
    await user.click(button('もう一戦'))
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 20 / 20')).toBeTruthy()
    expect(screen.getByText('Turn 1', { selector: '.banner span' })).toBeTruthy()

    await attackUntilEnd(user)
    await user.click(button('強さを選び直す'))
    expect(button('決闘を始める')).toBeTruthy()
  })

  const both: [number[], number[]] = [
    [6, 6, 6],
    [6, 6, 6],
  ]
  /** 相手は毎ターン魔弾 4 と、妨害 2 を撃つ。skip を満たすステップだけは何もしない */
  const mirror =
    (skip: (s: GameState) => boolean = () => false): Opponent =>
    (s) =>
      skip(s)
        ? { kind: 'pass' }
        : s.players[1].usedCards.includes('bullet')
          ? { kind: 'interrupt', dice: [2] }
          : { kind: 'bullet', dice: [0, 1] }

  it('同時に0以下になり、体力の残りも同じなら引き分け', async () => {
    const user = await start({ rng: dice(both, both, both, both, both, both), opponent: mirror() })
    await attackUntilEnd(user)
    expect(screen.getByText('相打ち。引き分けです')).toBeTruthy()
  })

  it('同時に0以下になっても、体力の残りが多い方の勝ち', async () => {
    // 1ターン目の2ステップ目だけ相手が何もしないので、4ターン目の1ステップ目に 0 対 −2 で同時に倒れる
    const user = await start({
      rng: dice(both, both, both, both, both, both),
      opponent: mirror((s) => s.turn === 1 && s.step === 2),
    })
    await attackUntilEnd(user)
    expect(screen.getByText('相打ち。0 対 −2 で、あなたの勝ち')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 0 / 20')).toBeTruthy()
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
