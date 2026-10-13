// @vitest-environment happy-dom
// オンライン対戦の画面。名前、ロビー、部屋を作る、合言葉で入る、相手を待つ、対局、決着、もう一戦、部屋を出る、再読み込みで戻る。
// WebSocket と fetch は偽物にし、サーバの代わりに本物のサーバと同じ部屋の純粋な関数で様子を作って送る。

import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoom, setOnline, tick } from '../server/room'
import { fakeNetwork, fakeRoom, sendRooms, socketTo, startedRoom } from '../test/online'
import { advance, button, mySeat, place, settle } from '../test/screen'
import { Game } from './Game'
import { Online } from './Online'

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    shouldAdvanceTime: true,
  })
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const disabled = (name: string) => (button(name) as HTMLButtonElement).disabled
const remember = (key: string, value: unknown) =>
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
const session = () => JSON.parse(localStorage.getItem('duelice.room') ?? 'null')

/** 名前を覚えた状態で、オンライン対戦の入口を描いてロビーまで進める */
async function toLobby(props: Partial<Parameters<typeof Online>[0]> = {}) {
  remember('duelice.name', 'あか')
  const user = setup()
  render(<Online narrow={false} onExit={vi.fn()} {...props} />)
  await user.click(button('ロビーへ'))
  socketTo('/api/lobby').open()
  return user
}

/** 部屋の席を覚えた状態で描き、部屋の WebSocket をつなぐ。再読み込みしたときと同じ */
function inRoom(token: string) {
  remember('duelice.name', token === 'host' ? 'あお' : 'あか')
  remember('duelice.room', { id: 'room0001', token })
  render(<Online narrow={false} onExit={vi.fn()} />)
  socketTo('/api/rooms/room0001/ws').open()
  return setup()
}

describe('名前', () => {
  it('タイトルからオンライン対戦に入り、名前を入れてロビーへ進む。名前は次の既定になる', async () => {
    fakeNetwork()
    const user = setup()
    render(<Game />)
    await user.click(button('オンライン対戦 β'))
    expect(screen.getByRole('heading', { name: 'オンライン対戦 β' })).toBeTruthy()
    expect(disabled('ロビーへ')).toBe(true)
    // 空白だけの名前と、13文字の名前は入れられない
    await user.type(textbox('名前'), '   ')
    expect(disabled('ロビーへ')).toBe(true)
    await user.clear(textbox('名前'))
    await user.type(textbox('名前'), 'あ'.repeat(13))
    expect(disabled('ロビーへ')).toBe(true)
    await user.clear(textbox('名前'))
    await user.type(textbox('名前'), ' あお ')
    await user.click(button('ロビーへ'))
    expect(localStorage.getItem('duelice.name')).toBe('あお')
    expect(screen.getByRole('heading', { name: 'ロビー β' })).toBeTruthy()

    await user.click(button('戻る'))
    expect(textbox('名前').value).toBe('あお')
    await user.click(button('戻る'))
    expect(button('CPU と対戦')).toBeTruthy()
  })
})

describe('ロビー', () => {
  it('つながるまではそう出し、部屋が無ければ無いと出す', async () => {
    fakeNetwork()
    remember('duelice.name', 'あか')
    const user = setup()
    render(<Online narrow={false} onExit={vi.fn()} />)
    await user.click(button('ロビーへ'))
    expect(screen.getByText('つないでいます')).toBeTruthy()
    socketTo('/api/lobby').open().receive({ type: 'other' })
    expect(screen.getByText('つないでいます')).toBeTruthy()
    sendRooms([])
    expect(screen.getByText('部屋はまだありません')).toBeTruthy()
  })

  it('部屋を作った人の名前と様子を並べ、相手を待っている部屋にだけ入れる', async () => {
    fakeNetwork()
    await toLobby()
    sendRooms([
      { id: 'room0001', host: 'あお', status: 'waiting', createdAt: 2 },
      { id: 'room0002', host: 'きい', status: 'playing', createdAt: 1 },
    ])
    const rows = within(screen.getByRole('region', { name: '部屋の一覧' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['あお待機中入る', 'きい対戦中'])
    expect(button('あおの部屋に入る')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'きいの部屋に入る' })).toBeNull()
  })
})

describe('部屋を作る', () => {
  it('既定の合言葉は乱数の4桁。全角の数字も半角に直して作り、相手を待つ部屋で合言葉を出す', async () => {
    const fetch = fakeNetwork((url) => (url === '/api/rooms' ? { id: 'room0001', token: 'host' } : {}))
    vi.spyOn(Math, 'random').mockReturnValue(0.0421)
    const user = await toLobby({ options: { hp: 3, stepMs: 5000 } })
    await user.click(button('部屋を作る'))
    const dialog = within(screen.getByRole('dialog', { name: '部屋を作る' }))
    expect((dialog.getByRole('textbox', { name: '合言葉' }) as HTMLInputElement).value).toBe('0421')
    await user.clear(dialog.getByRole('textbox', { name: '合言葉' }))
    expect((dialog.getByRole('button', { name: '作る' }) as HTMLButtonElement).disabled).toBe(true)
    await user.type(dialog.getByRole('textbox', { name: '合言葉' }), '１２ab34567')
    expect((dialog.getByRole('textbox', { name: '合言葉' }) as HTMLInputElement).value).toBe('1234')
    await user.click(dialog.getByRole('button', { name: '作る' }))

    expect(fetch).toHaveBeenCalledWith('/api/rooms', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      name: 'あか',
      code: '1234',
      hp: 3,
      stepMs: 5000,
    })
    expect(session()).toEqual({ id: 'room0001', token: 'host' })
    expect(screen.getByText('つないでいます')).toBeTruthy()

    const socket = socketTo('/api/rooms/room0001/ws?token=host').open()
    const room = fakeRoom(
      setOnline(
        createRoom({ id: 'room0001', code: '1234', name: 'あか', token: 'host', now: Date.now() }),
        [true, false],
        Date.now(),
      ),
      'host',
    )
    room.push()
    expect(screen.getByText('1234')).toBeTruthy()
    expect(screen.getByText('相手を待っています')).toBeTruthy()
    expect(screen.queryByText('相手が抜けました')).toBeNull()

    await user.click(button('ロビーへ'))
    expect(socket.messages()).toEqual([{ type: 'leave' }])
    expect(session()).toBeNull()
    expect(screen.getByRole('heading', { name: 'ロビー β' })).toBeTruthy()
  })

  it('窓を閉じれば作らない', async () => {
    const fetch = fakeNetwork()
    const user = await toLobby()
    await user.click(button('部屋を作る'))
    await user.click(within(screen.getByRole('dialog', { name: '部屋を作る' })).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: '部屋を作る' })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('作れなければ理由を出し、部屋には入らない', async () => {
    fakeNetwork(() => ({ error: 'bad' }))
    const user = await toLobby()
    await user.click(button('部屋を作る'))
    const dialog = within(screen.getByRole('dialog', { name: '部屋を作る' }))
    await user.click(dialog.getByRole('button', { name: '作る' }))
    expect(dialog.getByRole('alert').textContent).toBe('名前か合言葉が正しくありません')
    expect(session()).toBeNull()
  })
})

describe('合言葉で入る', () => {
  it('入れなければ理由を出し、合言葉を直せば理由を消す。合えばその部屋の席に着く', async () => {
    const answers: Record<string, unknown> = {
      '1111': { error: 'code' },
      '2222': { error: 'full' },
      '3333': { error: 'gone' },
      '4444': { error: 'bad' },
      '5555': new Error('offline'),
      '6666': { error: 'busy' },
      '1234': { token: 'guest' },
    }
    const fetch = fakeNetwork((_, body) => answers[(body as { code: string }).code])
    const user = await toLobby()
    sendRooms([{ id: 'room0001', host: 'あお', status: 'waiting', createdAt: 1 }])
    await user.click(button('あおの部屋に入る'))
    const dialog = within(screen.getByRole('dialog', { name: 'あおの部屋' }))
    const input = dialog.getByRole('textbox', { name: '合言葉' })
    expect((dialog.getByRole('button', { name: '入る' }) as HTMLButtonElement).disabled).toBe(true)

    const tryCode = async (code: string) => {
      await user.clear(input)
      await user.type(input, code)
      await user.click(dialog.getByRole('button', { name: '入る' }))
      return dialog.queryByRole('alert')?.textContent
    }
    expect(await tryCode('1111')).toBe('合言葉が違います')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await user.type(input, '1')
    expect(dialog.queryByRole('alert')).toBeNull()
    expect(await tryCode('2222')).toBe('もう二人そろっています')
    expect(await tryCode('3333')).toBe('部屋がもうありません')
    expect(await tryCode('4444')).toBe('名前か合言葉が正しくありません')
    expect(await tryCode('5555')).toBe('つながりませんでした')
    expect(await tryCode('6666')).toBe('つながりませんでした')
    await tryCode('1234')

    expect(fetch).toHaveBeenLastCalledWith('/api/rooms/room0001/join', expect.anything())
    expect(session()).toEqual({ id: 'room0001', token: 'guest' })
    expect(socketTo('/api/rooms/room0001/ws?token=guest')).toBeTruthy()
  })
})

describe('対局', () => {
  it('相手の名前と持ち時間を出し、行動を送り、解決が届いたら公開し、決着させる。席1でも自分を下に出す', async () => {
    fakeNetwork()
    const user = inRoom('guest')
    expect(screen.getByText('つないでいます')).toBeTruthy()
    const room = fakeRoom(startedRoom({ hp: 4 }), 'guest')
    room.push()
    expect(screen.getByRole('region', { name: 'あお' })).toBeTruthy()
    expect(screen.getByRole('timer', { name: '残り 60 秒' })).toBeTruthy()
    // 席1の手元は 5,5,2
    expect(within(mySeat().getByRole('group', { name: 'ダイス' })).getAllByRole('button').length).toBe(3)

    room.other({ type: 'act', action: { kind: 'pass' } })
    expect(screen.getByRole('img', { name: '相手は決定した' })).toBeTruthy()

    await place(user, 5, '魔弾')
    await place(user, 5, '魔弾')
    await user.click(button('決定'))
    const socket = socketTo('/api/rooms/')
    expect(socket.messages()).toEqual([{ type: 'act', action: { kind: 'bullet', dice: [0, 1] } }])
    // 届くまでも、出した行動を見せて選び直させない
    expect(disabled('パス')).toBe(true)

    room.pump()
    expect(screen.getByRole('region', { name: 'あお' })).toBeTruthy()
    await settle()
    await advance(2000)
    expect(screen.getByText('勝ち', { selector: '.result-text' })).toBeTruthy()
    expect(screen.queryByRole('timer')).toBeNull()
    await user.click(button('戦闘履歴'))
    const history = within(screen.getByRole('dialog', { name: '戦闘履歴' }))
    expect(history.getAllByRole('listitem')[0].textContent).toBe('決着あなたの勝ち')
  })

  it('二人がもう一戦を押せば次の対局を始める。押した側は相手を待ち、相手が押したら印を出す', async () => {
    fakeNetwork()
    const user = inRoom('host')
    const room = fakeRoom(startedRoom(), 'host')
    room.push()
    room.other({ type: 'resign' })
    expect(screen.getByText('勝ち', { selector: '.result-text' })).toBeTruthy()

    room.other({ type: 'again' })
    expect(screen.getByRole('img', { name: '相手はもう一戦を押した' })).toBeTruthy()
    room.set({ ...room.state, again: [false, false] })
    await user.click(button('もう一戦'))
    room.pump()
    expect(disabled('相手を待っています')).toBe(true)

    room.other({ type: 'again' })
    expect(room.state.matchNo).toBe(2)
    expect(screen.queryByText('勝ち', { selector: '.result-text' })).toBeNull()
    expect(screen.getByText('Turn 1 - Step 1')).toBeTruthy()
  })

  it('相手が部屋を抜けたら、相手を待つ部屋に戻り、抜けたことを伝える', async () => {
    fakeNetwork()
    inRoom('guest')
    const room = fakeRoom(startedRoom(), 'guest')
    room.push()
    room.other({ type: 'resign' })
    room.other({ type: 'leave' })
    expect(screen.getByText('相手が抜けました')).toBeTruthy()
    expect(screen.getByText('相手を待っています')).toBeTruthy()
  })

  it('時間切れで決着したら、戦闘履歴にその理由を書く。相手のつながりが切れたら印を出す', async () => {
    fakeNetwork()
    const user = inRoom('host')
    const room = fakeRoom(startedRoom(), 'host')
    room.push()
    room.set(setOnline(room.state, [true, false], Date.now()))
    expect(screen.getByRole('img', { name: '相手の接続が切れている' })).toBeTruthy()
    room.set(tick(room.state, room.state.deadline ?? 0).state)
    expect(screen.getByText('引き分け', { selector: '.result-text' })).toBeTruthy()
    await user.click(button('戦闘履歴'))
    const history = within(screen.getByRole('dialog', { name: '戦闘履歴' }))
    expect(history.getAllByRole('listitem').map((i) => i.textContent)).toEqual(['決着時間切れで、引き分け'])
  })

  it('降参はサーバに知らせる', async () => {
    fakeNetwork()
    const user = inRoom('host')
    const room = fakeRoom(startedRoom(), 'host')
    room.push()
    await user.click(button('メニュー'))
    await user.click(within(screen.getByRole('dialog', { name: 'メニュー' })).getByRole('button', { name: '降参' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '降参しますか？' })).getByRole('button', { name: '降参する' }),
    )
    room.pump()
    expect(screen.getByText('負け', { selector: '.result-text' })).toBeTruthy()
  })

  it('受け付けられなかったら、選び直せる', async () => {
    fakeNetwork()
    const user = inRoom('host')
    const room = fakeRoom(startedRoom(), 'host')
    room.push()
    await user.click(button('パス'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'パスしますか？' })).getByRole('button', { name: 'パスする' }),
    )
    expect(disabled('パス')).toBe(true)
    socketTo('/api/rooms/').receive({ type: 'rejected', reason: 'illegal' })
    expect(disabled('パス')).toBe(false)
  })

  it('つながっていない間に押した行動は送らず、選んだままにする', async () => {
    fakeNetwork()
    const user = inRoom('host')
    const room = fakeRoom(startedRoom(), 'host')
    room.push()
    socketTo('/api/rooms/').readyState = 0
    await user.click(button('パス'))
    await user.click(
      within(screen.getByRole('dialog', { name: 'パスしますか？' })).getByRole('button', { name: 'パスする' }),
    )
    expect(socketTo('/api/rooms/').messages()).toEqual([])
    expect(disabled('パス')).toBe(false)
  })
})

describe('部屋がもう無い', () => {
  it('ロビーへ戻り、覚えていた席を忘れる', () => {
    fakeNetwork()
    inRoom('host')
    socketTo('/api/rooms/').receive({ type: 'gone' })
    expect(session()).toBeNull()
    expect(screen.getByRole('heading', { name: 'ロビー β' })).toBeTruthy()
  })

  it('名前を覚えていなければ、名前の画面へ戻る', () => {
    fakeNetwork()
    remember('duelice.room', { id: 'room0001', token: 'host' })
    render(<Online narrow={false} onExit={vi.fn()} />)
    socketTo('/api/rooms/').open().receive({ type: 'gone' })
    expect(screen.getByRole('textbox', { name: '名前' })).toBeTruthy()
  })
})

describe('再読み込み', () => {
  it('覚えている部屋があれば、タイトルを飛ばしてその部屋の同じ席に戻る', () => {
    fakeNetwork()
    remember('duelice.room', { id: 'room0001', token: 'guest' })
    render(<Game />)
    expect(socketTo('/api/rooms/room0001/ws?token=guest')).toBeTruthy()
    expect(screen.getByText('つないでいます')).toBeTruthy()
  })

  it('覚えていた席が読めなければ、タイトルから始める', () => {
    fakeNetwork()
    remember('duelice.room', '{"id":1}')
    render(<Game />)
    expect(button('CPU と対戦')).toBeTruthy()
  })
})

describe('つながり', () => {
  it('切れたら少し待ってつなぎ直し、部屋が無いと閉じられたらつなぎ直さない', async () => {
    fakeNetwork()
    inRoom('host')
    const first = socketTo('/api/rooms/')
    first.drop(1006)
    await advance(1000)
    const second = socketTo('/api/rooms/')
    expect(second).not.toBe(first)
    second.open().drop(4404)
    await advance(5000)
    expect(socketTo('/api/rooms/')).toBe(second)
  })

  it('つながっている間は ping を送り、読めない知らせは捨てる', async () => {
    fakeNetwork()
    inRoom('host')
    const socket = socketTo('/api/rooms/')
    socket.receive('pong')
    await advance(20_000)
    expect(socket.sent).toContain('ping')
    expect(screen.getByText('つないでいます')).toBeTruthy()
  })

  it('画面を閉じたら、つながってから閉じる', () => {
    fakeNetwork()
    remember('duelice.room', { id: 'room0001', token: 'host' })
    const { unmount } = render(<Online narrow={false} onExit={vi.fn()} />)
    const socket = socketTo('/api/rooms/')
    unmount()
    expect(socket.closedWith).toBeNull()
    socket.open()
    expect(socket.closedWith).toBe(1000)
  })

  it('つながった後に画面を閉じたら、すぐ閉じる', () => {
    fakeNetwork()
    remember('duelice.room', { id: 'room0001', token: 'host' })
    const { unmount } = render(<Online narrow={false} onExit={vi.fn()} />)
    const socket = socketTo('/api/rooms/').open()
    act(() => unmount())
    expect(socket.closedWith).toBe(1000)
  })
})
