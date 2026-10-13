// @vitest-environment happy-dom
// カードを選ぶ対戦。タイトルの入口、5枚を選ぶ画面、選んだ5枚を覚えること、選んだ5枚と CPU の5枚で始まる対局、
// 再戦と、対局を抜けたらカードを選ぶ画面へ戻ること。

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_DEFS, type CardId, POOL, STARTER } from '../game/cards'
import { CPU_DECKS } from '../game/decks'
import {
  button,
  cpuSeat,
  dice,
  fromMenu,
  mySeat,
  passOpponent,
  place,
  RESULT,
  settle,
  shownCardNames,
  useFakeClock,
} from '../test/screen'
import { DeckPick } from './DeckPick'
import { loadDeck, saveDeck } from './deckStore'
import { Game } from './Game'

beforeEach(useFakeClock)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const CPU: CardId[] = ['meteor', 'allOut', 'lastStand', 'freeze', 'darkWall']

/** 選んだかどうかの押しボタン */
const toggle = (name: string) => screen.getByRole('button', { name: `${name}を選ぶ` }) as HTMLButtonElement
const picked = () =>
  within(screen.getByRole('list', { name: '選んだカード' }))
    .queryAllByRole('listitem')
    .map((c) => c.textContent)

describe('覚えた5枚', () => {
  it('選んだ5枚を覚え、カードの表の順にして読む', () => {
    expect(loadDeck()).toBeNull()
    saveDeck(['meditate', 'barrier', 'meteor', 'flameStrike', 'darkWall'])
    expect(loadDeck()).toEqual(['flameStrike', 'barrier', 'meteor', 'darkWall', 'meditate'])
  })

  it('持ち込めない5枚や読めない記録は、覚えていないものとする', () => {
    for (const raw of ['{', 'null', '"meteor"', '["meteor"]', '["meteor","meteor","allOut","freeze","darkWall"]']) {
      localStorage.setItem('duelice.deck', raw)
      expect(loadDeck()).toBeNull()
    }
  })

  it('覚えられない画面でも止まらない', () => {
    const denied = () => {
      throw new Error('denied')
    }
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied })
    expect(() => saveDeck(STARTER)).not.toThrow()
    expect(loadDeck()).toBeNull()
  })
})

describe('カードを選ぶ画面', () => {
  function draw() {
    const props = { level: 'normal' as const, setLevel: vi.fn(), onBack: vi.fn(), onStart: vi.fn() }
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<DeckPick {...props} />)
    return { user, ...props }
  }

  it('選べる全てのカードを、カード面で並べる。覚えていなければスターターの5枚を選んだ状態から始まる', () => {
    draw()
    expect(screen.getAllByRole('button', { name: /を選ぶ$/ })).toHaveLength(POOL.length)
    expect(screen.getAllByRole('listitem', { name: /./ }).map((c) => c.getAttribute('aria-label'))).toContain('双竜')
    expect(picked()).toEqual(['炎撃', '風壁', '魔弾', '魔槍', '氷礫'])
    expect(toggle('炎撃').getAttribute('aria-pressed')).toBe('true')
    expect(toggle('隕石').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('5 / 5')).toBeTruthy()
  })

  it('5枚そろうと、選んでいないカードは選べない。外せば選べ、対戦は5枚そろうまで押せない', async () => {
    const { user } = draw()
    expect(toggle('隕石').disabled).toBe(true)
    expect((button('対戦') as HTMLButtonElement).disabled).toBe(false)
    await user.click(toggle('魔弾'))
    expect(picked()).toEqual(['炎撃', '風壁', '魔槍', '氷礫'])
    expect(screen.getByText('4 / 5')).toBeTruthy()
    expect((button('対戦') as HTMLButtonElement).disabled).toBe(true)
    expect(toggle('隕石').disabled).toBe(false)
    await user.click(toggle('瞑想'))
    // 選んだ順によらず、カードの表の順に並ぶ
    expect(picked()).toEqual(['炎撃', '風壁', '魔槍', '氷礫', '瞑想'])
    expect(toggle('瞑想').getAttribute('aria-pressed')).toBe('true')
  })

  it('スターターに戻せる。スターターのままなら押せない', async () => {
    const { user } = draw()
    const reset = button('スターターに戻す') as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    await user.click(toggle('炎撃'))
    await user.click(toggle('双竜'))
    expect(reset.disabled).toBe(false)
    await user.click(reset)
    expect(picked()).toEqual(['炎撃', '風壁', '魔弾', '魔槍', '氷礫'])
  })

  it('対戦を押すと、選んだ5枚をカードの表の順で渡し、次に開いたときのために覚える', async () => {
    const { user, onStart } = draw()
    await user.click(toggle('風壁'))
    await user.click(toggle('闇壁'))
    await user.click(button('対戦'))
    const deck = ['flameStrike', 'bullet', 'spear', 'interrupt', 'darkWall']
    expect(onStart).toHaveBeenCalledWith(deck)
    expect(loadDeck()).toEqual(deck)
    cleanup()
    draw()
    expect(picked()).toEqual(['炎撃', '魔弾', '魔槍', '氷礫', '闇壁'])
  })

  it('戻るでタイトルへ戻り、強さを選べ、ルールを開ける', async () => {
    const { user, onBack, setLevel } = draw()
    await user.click(button('戻る'))
    expect(onBack).toHaveBeenCalled()
    await user.click(screen.getByRole('radio', { name: 'つよい' }))
    expect(setLevel).toHaveBeenCalledWith('hard')
    expect(button('ルール')).toBeTruthy()
  })
})

describe('カードを選ぶ対戦', () => {
  const six: [number[], number[]] = [
    [6, 6, 6],
    [1, 2, 3],
  ]

  /** タイトルからカードを選ぶ画面へ進み、スターターから 魔槍 を外して 隕石 を入れて対戦を始める */
  async function begin(cpuDeck = vi.fn(() => CPU)) {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Game rng={dice(six, six, six, six, six, six, six, six)} opponent={passOpponent} cpuDeck={cpuDeck} />)
    await user.click(button(/^カードを選んで CPU と対戦/))
    await user.click(toggle('魔槍'))
    await user.click(toggle('隕石'))
    await user.click(button('対戦'))
    return { user, cpuDeck }
  }

  /** 毎ターン 6,6,6 を振り、魔弾と氷礫で攻め続ける */
  async function attackUntilEnd(user: ReturnType<typeof userEvent.setup>) {
    for (let k = 0; k < 20 && !screen.queryByText(RESULT); k++) {
      const card = mySeat().queryAllByRole('button', { name: /^魔弾の.+枠に置く$/ }).length > 0 ? '魔弾' : '氷礫'
      await place(user, 6, card)
      if (card === '魔弾') await place(user, 6, card)
      await user.click(button('決定'))
      await settle()
    }
  }

  it('タイトルの入口からカードを選び、選んだ5枚と CPU の5枚で対局が始まる', async () => {
    const { cpuDeck } = await begin()
    expect(cpuDeck).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(shownCardNames(mySeat())).toEqual(['炎撃', '風壁', '魔弾', '氷礫', '隕石'])
    expect(shownCardNames(cpuSeat())).toEqual(['隕石', '全開', '背水', '凍結', '闇壁'])
  })

  it('降参するとカードを選ぶ画面へ戻り、選んだ5枚が残っている。戻るでタイトルへ', async () => {
    const { user } = await begin()
    await fromMenu(user, '降参')
    await user.click(
      within(screen.getByRole('dialog', { name: '降参しますか？' })).getByRole('button', { name: '降参する' }),
    )
    expect(picked()).toEqual(['炎撃', '風壁', '魔弾', '氷礫', '隕石'])
    await user.click(button('戻る'))
    expect(button('CPU と対戦')).toBeTruthy()
    // タイトルからの対戦は、二人ともスターター
    await user.click(button('CPU と対戦'))
    expect(shownCardNames(mySeat())).toEqual(['炎撃', '風壁', '魔弾', '魔槍', '氷礫'])
    expect(shownCardNames(cpuSeat())).toEqual(['炎撃', '風壁', '魔弾', '魔槍', '氷礫'])
  })

  // 二局を最後まで画面から進めるので、CI の遅い端末では既定の5秒を超えることがある
  it('もう一戦は同じ5枚どうしで戦い、カードを選び直すとカードを選ぶ画面へ戻る', async () => {
    const { user, cpuDeck } = await begin()
    await attackUntilEnd(user)
    await user.click(button('もう一戦'))
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
    expect(cpuDeck).toHaveBeenCalledTimes(1)
    expect(shownCardNames(cpuSeat())).toEqual(['隕石', '全開', '背水', '凍結', '闇壁'])
    await attackUntilEnd(user)
    await user.click(button('カードを選び直す'))
    expect(picked()).toEqual(['炎撃', '風壁', '魔弾', '氷礫', '隕石'])
  }, 30_000)

  it('CPU の5枚は、既定では評価で強かったデッキから選ぶ', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<Game rng={dice(six)} opponent={passOpponent} />)
    await user.click(button(/^カードを選んで CPU と対戦/))
    await user.click(button('対戦'))
    expect(shownCardNames(cpuSeat())).toEqual(CPU_DECKS[0].map((c) => CARD_DEFS[c].name))
  })
})
