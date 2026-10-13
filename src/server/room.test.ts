// 部屋の中身のテスト。入室と合言葉、席の合言葉での戻り、持ち時間、決着、もう一戦、部屋を消す時を、時刻を外から渡して確かめる。

import { describe, expect, it } from 'vitest'
import type { Match } from '../game/match'
import type { Action, GameState } from '../game/types'
import { EMPTY_GRACE_MS, REVEAL_GRACE_MS, START_GRACE_MS } from '../online/protocol'
import { actionOf, makeState, seeded } from '../test/helpers'
import {
  act,
  again,
  asAction,
  createRoom,
  joinRoom,
  leave,
  lobbyRoom,
  nextAlarm,
  PRESENCE_CHECK_MS,
  type RoomState,
  resignRoom,
  restoreRoom,
  seatOf,
  setOnline,
  snapshot,
  statusOf,
  tick,
} from './room'

const T0 = 1_000_000
const STEP = 60_000
const pass: Action = { kind: 'pass' }
const fire = actionOf('flameStrike')

const created = (now = T0) =>
  createRoom({ id: 'room0001', code: '1234', name: 'あお', token: 'host', now, stepMs: STEP })

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`受け付けられなかった: ${JSON.stringify(r)}`)
  return r as Extract<T, { ok: true }>
}

/** 二人そろって対局が始まった部屋。二人ともつながっている */
function playing(now = T0): RoomState {
  const host = setOnline(created(now), [true, false], now)
  const joined = ok(joinRoom(host, { name: 'あか', code: '1234', token: 'guest', now, rng: seeded(1) })).state
  return setOnline(joined, [true, true], now)
}

/** 局面を差し替えた部屋。ダイスを決めて行動を出したいとき */
const withMatch = (s: RoomState, match: Match): RoomState => ({ ...s, match })
const fixed = (s: RoomState) =>
  withMatch(s, { state: makeState({ roll: [6, 4, 1] }, { roll: [3, 2, 1] }), pending: [null, null] })

describe('部屋を作る、入る', () => {
  it('作った人は席0に座り、相手を待つ。まだつながっていないので、誰もいない時刻を覚える', () => {
    const s = created()
    expect(s.seats).toEqual([{ name: 'あお', token: 'host', online: false }, null])
    expect(statusOf(s)).toBe('waiting')
    expect(s.emptySince).toBe(T0)
    expect(s).toMatchObject({ match: null, matchNo: 0, last: null, deadline: null, end: null, again: [false, false] })
    expect(lobbyRoom(s)).toEqual({ id: 'room0001', host: 'あお', status: 'waiting', createdAt: T0 })
  })
  it('持ち時間と対局の決まりは、指定がなければふだんのもの', () => {
    const s = createRoom({ id: 'r', code: '0000', name: 'a', token: 't', now: T0 })
    expect(s.stepMs).toBe(60_000)
    expect(s.config.maxHp).toBe(20)
  })
  it('合言葉が違えば入れない', () => {
    expect(joinRoom(created(), { name: 'あか', code: '1235', token: 'g', now: T0, rng: seeded(1) })).toEqual({
      ok: false,
      reason: 'code',
    })
  })
  it('合言葉が合えば席1に座り、すぐ対局が始まる。最初のステップの期限は、最初の帯の猶予の後から数える', () => {
    const s = ok(joinRoom(created(), { name: 'あか', code: '1234', token: 'g', now: T0 + 5, rng: seeded(1) })).state
    expect(s.seats[1]).toEqual({ name: 'あか', token: 'g', online: false })
    expect(statusOf(s)).toBe('playing')
    expect(s.matchNo).toBe(1)
    expect(s.deadline).toBe(T0 + 5 + START_GRACE_MS + STEP)
    expect(lobbyRoom(s)?.status).toBe('playing')
  })
  it('二人そろった部屋には、合言葉が合っていても入れない', () => {
    expect(joinRoom(playing(), { name: 'き', code: '1234', token: 'x', now: T0, rng: seeded(1) })).toEqual({
      ok: false,
      reason: 'full',
    })
  })
  it('席の合言葉から席を引く。再読み込みしても同じ席に戻れる', () => {
    const s = playing()
    expect([seatOf(s, 'host'), seatOf(s, 'guest'), seatOf(s, 'other'), seatOf(s, '')]).toEqual([0, 1, null, null])
    // 席0が空いていても引ける
    expect(seatOf({ ...s, seats: [null, s.seats[1]] }, 'guest')).toBe(1)
  })
})

describe('様子を送る', () => {
  it('相手がまだ公開していない行動は送らず、出したことだけを伝える', () => {
    const s = ok(act(fixed(playing()), 0, fire, seeded(1), T0 + 10)).state
    const toGuest = snapshot(s, 1, T0 + 10)
    expect(toGuest.view?.mine).toBeNull()
    expect(toGuest.view?.opponentReady).toBe(true)
    // 持ち込んだ5枚は見えてよいが、出した行動は見えない
    expect(JSON.stringify(toGuest)).not.toContain('"kind":"flameStrike"')
    expect(snapshot(s, 0, T0 + 10).view?.mine).toEqual(fire)
  })
  it('席、名前、つながり、合言葉、期限、送った時刻を送る', () => {
    const s = setOnline(playing(), [true, false], T0)
    expect(snapshot(s, 1, T0 + 3)).toMatchObject({
      type: 'room',
      id: 'room0001',
      code: '1234',
      seat: 1,
      names: ['あお', 'あか'],
      online: [true, false],
      status: 'playing',
      matchNo: 1,
      last: null,
      deadline: T0 + START_GRACE_MS + STEP,
      stepMs: STEP,
      now: T0 + 3,
      end: null,
      again: [false, false],
    })
  })
  it('席が空いていれば、名前もつながりも無いと送る', () => {
    expect(snapshot({ ...created(), seats: [null, null] }, 0, T0)).toMatchObject({
      names: [null, null],
      online: [false, false],
    })
  })
  it('相手を待っている間は、対局の様子を送らない', () => {
    expect(snapshot(created(), 0, T0)).toMatchObject({ view: null, names: ['あお', null], online: [false, false] })
  })
})

describe('行動を出す', () => {
  it('期限の前に両方そろえば解決し、次のステップの期限を公開の猶予の後から数え直す', () => {
    const s = fixed(playing())
    const one = ok(act(s, 1, pass, seeded(1), T0 + 100)).state
    expect(one.last).toBeNull()
    expect(tick(one, T0 + START_GRACE_MS + STEP - 1).state).toBe(one)
    const two = ok(act(one, 0, fire, seeded(1), T0 + 200)).state
    expect(two.last?.n).toBe(1)
    expect(two.last?.resolution.report.actions).toEqual([fire, pass])
    expect(two.deadline).toBe(T0 + 200 + REVEAL_GRACE_MS + STEP)
    expect(two.end).toBeNull()
    expect(two.match?.pending).toEqual([null, null])
    const three = ok(act(ok(act(two, 0, pass, seeded(1), T0 + 300)).state, 1, pass, seeded(1), T0 + 400)).state
    expect(three.last?.n).toBe(2)
  })
  it('体力で決着したら期限を消し、理由を体力にする', () => {
    const s = withMatch(playing(), {
      state: makeState({ roll: [6, 4, 1] }, { roll: [3, 2, 1], hp: 1 }),
      pending: [null, null],
    })
    const r = ok(act(ok(act(s, 0, fire, seeded(1), T0)).state, 1, pass, seeded(1), T0)).state
    expect(r.match?.state.winner).toBe(0)
    expect(r.end).toEqual({ reason: 'hp' })
    expect(r.deadline).toBeNull()
    expect(statusOf(r)).toBe('over')
    expect(nextAlarm(r, T0)).toBe(T0 + PRESENCE_CHECK_MS)
  })
  it('同じステップに二度出す、合法でない、決着した後、相手を待っている間の行動は受け付けない', () => {
    const s = fixed(playing())
    expect(act(ok(act(s, 0, pass, seeded(1), T0)).state, 0, fire, seeded(1), T0)).toEqual({
      ok: false,
      reason: 'already',
    })
    expect(act(s, 0, { kind: 'spearCast', dice: [0, 1] }, seeded(1), T0)).toEqual({ ok: false, reason: 'illegal' })
    expect(act(resignRoom(s, 1), 0, pass, seeded(1), T0)).toEqual({ ok: false, reason: 'over' })
    expect(act(created(), 0, pass, seeded(1), T0)).toEqual({ ok: false, reason: 'over' })
  })
})

describe('持ち時間', () => {
  const deadline = T0 + START_GRACE_MS + STEP

  it('期限までに出していない側の負け。出していた側の勝ち', () => {
    const s = ok(act(playing(), 0, pass, seeded(1), T0)).state
    expect(tick(s, deadline - 1).state).toBe(s)
    const r = tick(s, deadline)
    expect(r.deleted).toBe(false)
    expect(r.state.match?.state.winner).toBe(0)
    expect(r.state.end).toEqual({ reason: 'timeout' })
    expect(r.state.deadline).toBeNull()
    expect(r.state.match?.pending).toEqual([null, null])
  })
  it('席1だけが出していれば、席0の負け', () => {
    const s = ok(act(playing(), 1, pass, seeded(1), T0)).state
    expect(tick(s, deadline).state.match?.state.winner).toBe(1)
  })
  it('二人とも出していなければ引き分け', () => {
    const r = tick(playing(), deadline + 5)
    expect(r.state.match?.state.winner).toBe('draw')
    expect(r.state.end).toEqual({ reason: 'timeout' })
  })
  it('つながりが切れたまま戻らなければ、期限で負けになる。つながりが切れても期限は変わらない', () => {
    const s = ok(act(playing(), 0, pass, seeded(1), T0)).state
    const away = setOnline(s, [true, false], T0 + 1000)
    expect(away.deadline).toBe(deadline)
    expect(nextAlarm(away, T0 + 1000)).toBe(deadline)
    expect(tick(away, deadline).state.match?.state.winner).toBe(0)
  })
  it('つながりが切れても、期限の前に戻って出せば続く', () => {
    const s = fixed(playing())
    const away = setOnline(s, [true, false], T0 + 1000)
    expect(tick(away, deadline - 1).state).toBe(away)
    // 再読み込みした画面は、覚えていた席の合言葉で同じ席に戻る
    expect(seatOf(away, 'guest')).toBe(1)
    const back = setOnline(away, [true, true], T0 + 30_000)
    expect(back.emptySince).toBeNull()
    const r = ok(act(ok(act(back, 1, pass, seeded(1), T0 + 31_000)).state, 0, fire, seeded(1), T0 + 32_000)).state
    expect(r.last?.n).toBe(1)
    expect(r.end).toBeNull()
    expect(tick(r, deadline).state).toBe(r)
  })
  it('対局中は二人とも切れていても部屋を消さず、期限で決着させる。決着の後は猶予が過ぎていれば消す', () => {
    const gone = setOnline(playing(), [false, false], T0 + 1000)
    expect(gone.emptySince).toBe(T0 + 1000)
    expect(nextAlarm(gone, T0 + 1000)).toBe(deadline)
    const r = tick(gone, deadline)
    expect(r.deleted).toBe(true)
    expect(r.state.end).toEqual({ reason: 'timeout' })
  })
  it('決着した後と、相手を待っている間は持ち時間の時計を止め、つながりを数え直す時刻だけを決める', () => {
    const over = resignRoom(playing(), 0)
    expect(over.deadline).toBeNull()
    expect(nextAlarm(over, T0 + 5)).toBe(T0 + 5 + PRESENCE_CHECK_MS)
    expect(tick(over, T0 + 10 * STEP).state).toBe(over)
    const waiting = setOnline(created(), [true, false], T0)
    expect(nextAlarm(waiting, T0 + 7)).toBe(T0 + 7 + PRESENCE_CHECK_MS)
  })
})

describe('降参', () => {
  it('降参した側の負け。期限を消し、理由を降参にする', () => {
    const r = resignRoom(playing(), 1)
    expect(r.match?.state.winner).toBe(0)
    expect(r.end).toEqual({ reason: 'resign' })
    expect(r.deadline).toBeNull()
  })
  it('決着した後と、相手を待っている間は何も変えない', () => {
    const over = resignRoom(playing(), 1)
    expect(resignRoom(over, 0)).toBe(over)
    const waiting = created()
    expect(resignRoom(waiting, 0)).toBe(waiting)
  })
})

describe('もう一戦', () => {
  const over = () => resignRoom(playing(), 1)

  it('片方だけが押しても始まらない。押したことは相手にも伝わる', () => {
    const r = again(over(), 1, seeded(2), T0 + 50)
    expect(r.again).toEqual([false, true])
    expect(r.matchNo).toBe(1)
    expect(snapshot(r, 0, T0 + 50).again).toEqual([false, true])
  })
  it('二人とも押したら、同じ部屋で新しい対局を始める', () => {
    const r = again(again(over(), 1, seeded(2), T0 + 50), 0, seeded(2), T0 + 60)
    expect(r.matchNo).toBe(2)
    expect(r.end).toBeNull()
    expect(r.last).toBeNull()
    expect(r.again).toEqual([false, false])
    expect(r.deadline).toBe(T0 + 60 + START_GRACE_MS + STEP)
    expect(r.match?.state).toMatchObject({ turn: 1, step: 1, winner: null })
    expect(statusOf(r)).toBe('playing')
  })
  it('対局中、相手を待っている間、相手が抜けた後は受け付けない', () => {
    const p = playing()
    expect(again(p, 0, seeded(1), T0)).toBe(p)
    const w = created()
    expect(again(w, 0, seeded(1), T0)).toBe(w)
  })
})

describe('部屋を出る', () => {
  it('相手を待っている部屋を作った人が出たら、部屋は消える', () => {
    expect(leave(created(), 0, T0).deleted).toBe(true)
  })
  it('決着の後に席1が出たら、席0は残って次の相手を待つ', () => {
    const r = leave(again(resignRoom(playing(), 1), 0, seeded(1), T0), 1, T0)
    expect(r.deleted).toBe(false)
    expect(r.state.seats).toEqual([{ name: 'あお', token: 'host', online: true }, null])
    expect(statusOf(r.state)).toBe('waiting')
    expect(r.state).toMatchObject({ match: null, last: null, deadline: null, end: null, again: [false, false] })
    expect(lobbyRoom(r.state)?.status).toBe('waiting')
  })
  it('席0が出たら、残った人が席0に移り、ロビーにもその名前で出る', () => {
    const r = leave(resignRoom(playing(), 1), 0, T0)
    expect(r.state.seats[0]?.token).toBe('guest')
    expect(seatOf(r.state, 'guest')).toBe(0)
    expect(seatOf(r.state, 'host')).toBeNull()
    expect(lobbyRoom(r.state)?.host).toBe('あか')
  })
  it('残った人がつながっていなければ、出た時刻から誰もいない部屋として猶予を数える', () => {
    const away = setOnline(resignRoom(playing(), 1), [true, false], T0 + 5)
    expect(leave(away, 0, T0 + 9).state.emptySince).toBe(T0 + 9)
    const both = setOnline(away, [false, false], T0 + 7)
    expect(leave(both, 0, T0 + 9).state.emptySince).toBe(T0 + 7)
  })
  it('対局中に出たら、その対局は記録せずに終え、残った人は次の相手を待つ', () => {
    const r = leave(playing(), 1, T0)
    expect(r.state).toMatchObject({ match: null, deadline: null, seats: [{ token: 'host' }, null] })
    expect(nextAlarm(r.state, T0)).toBe(T0 + PRESENCE_CHECK_MS)
  })
  it('部屋を作った人がいなければ、ロビーには出さない', () => {
    expect(lobbyRoom({ ...created(), seats: [null, null] })).toBeNull()
  })
})

describe('誰もいない部屋', () => {
  it('つながりの知らせが届かないまま切れていても、数え直せば誰もいない部屋として猶予を数え、過ぎたら消す', () => {
    // デプロイで WebSocket が切れると、閉じた知らせは届かず、覚えている様子は二人ともつながったまま
    const stale = resignRoom(playing(), 1)
    expect(stale.seats.map((x) => x?.online)).toEqual([true, true])
    const at = nextAlarm(stale, T0)
    const counted = setOnline(stale, [false, false], at)
    expect(tick(counted, at).deleted).toBe(false)
    expect(nextAlarm(counted, at)).toBe(at + EMPTY_GRACE_MS)
    expect(tick(counted, at + EMPTY_GRACE_MS).deleted).toBe(true)
  })

  it('作った人がつながらないまま猶予が過ぎたら消す', () => {
    const s = created()
    expect(nextAlarm(s, T0)).toBe(T0 + EMPTY_GRACE_MS)
    expect(tick(s, T0 + EMPTY_GRACE_MS - 1).deleted).toBe(false)
    expect(tick(s, T0 + EMPTY_GRACE_MS).deleted).toBe(true)
  })
  it('相手を待っている人のつながりが切れたら時刻を覚え、猶予の間に戻れば消さない', () => {
    const on = setOnline(created(), [true, false], T0)
    expect(on.emptySince).toBeNull()
    const off = setOnline(on, [false, false], T0 + 100)
    expect(off.emptySince).toBe(T0 + 100)
    // 切れたままの知らせがもう一度来ても、最初に切れた時刻のまま
    expect(setOnline(off, [false, false], T0 + 200).emptySince).toBe(T0 + 100)
    const back = setOnline(off, [true, false], T0 + 2000)
    expect(back.emptySince).toBeNull()
    expect(tick(back, T0 + 100 + EMPTY_GRACE_MS).deleted).toBe(false)
    expect(tick(off, T0 + 100 + EMPTY_GRACE_MS).deleted).toBe(true)
  })
  it('決着の後に二人とも切れたら、猶予の後に消す', () => {
    const over = setOnline(resignRoom(playing(), 1), [false, false], T0 + 10)
    expect(nextAlarm(over, T0 + 10)).toBe(T0 + 10 + EMPTY_GRACE_MS)
    expect(tick(over, T0 + 10 + EMPTY_GRACE_MS).deleted).toBe(true)
  })
})

describe('画面から届いた行動の形', () => {
  it('パスと、表にある種類で置き場の形が正しい行動は通す', () => {
    expect(asAction({ kind: 'pass', dice: [1] })).toEqual({ kind: 'pass' })
    expect(asAction({ kind: 'flameStrike', dice: [0, null], extra: 1 })).toEqual({
      kind: 'flameStrike',
      dice: [0, null],
    })
  })
  it('形の崩れたものは通さない', () => {
    for (const raw of [
      null,
      'pass',
      3,
      {},
      { kind: 'nope', dice: [0] },
      { kind: 'toString', dice: [0] },
      { kind: 'flameStrike' },
      { kind: 'flameStrike', dice: '01' },
      { kind: 'flameStrike', dice: [0.5, 1] },
      { kind: 'flameStrike', dice: ['0'] },
      { kind: 3, dice: [0] },
      // 配列は表の名前と同じ文字に読めてしまうので、文字であることも確かめる
      { kind: ['flameStrike'], dice: [0, 1] },
    ]) {
      expect(asAction(raw)).toBeNull()
    }
  })
})

describe('保存されていた部屋', () => {
  /** カードを選べるようになる前の形に戻した部屋。席と記録から、後で足した欄を消す */
  function legacy(s: RoomState): RoomState {
    const strip = (o: object, keys: string[]) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
    const game = (g: GameState) =>
      ({
        ...g,
        players: g.players.map((p) => strip(p, ['deck', 'frozen', 'burned', 'carry', 'last', 'acted'])),
        history: g.history.map((r) => ({
          ...strip(r, ['endBurn', 'cancelled', 'refunded', 'extra', 'moves']),
          strikes: r.strikes.map((x) => strip(x, ['phase'])),
        })),
      }) as unknown as GameState
    if (!s.match || !s.last) throw new Error('対局と解決が要る')
    const report = game({ ...s.last.resolution.state, history: [s.last.resolution.report] }).history[0]
    return {
      ...s,
      match: { ...s.match, state: game(s.match.state) },
      last: { n: s.last.n, resolution: { state: game(s.last.resolution.state), report } },
    }
  }

  it('後で足した欄の無い部屋は、スターターの5枚と、何も起きていない値でそろえる', () => {
    // 焼けた分は古い形に無いので、焼けない行動で比べる
    const s0 = ok(act(fixed(playing()), 0, { kind: 'interrupt', dice: [0] }, seeded(1), T0 + 10)).state
    const s = ok(act(s0, 1, { kind: 'barrier', dice: [0] }, seeded(1), T0 + 20)).state
    expect(s.last).not.toBeNull()
    const restored = restoreRoom(legacy(s))
    expect(restored).toEqual(s)
    // 今の形の部屋はそのまま
    expect(restoreRoom(s)).toEqual(s)
  })
  it('後で足した欄の無い部屋は、ターンをまたいでも、直前の効果とこのターンに起きた効果を記録から作る', () => {
    let s = fixed(playing())
    const step = (a0: Action, a1: Action, t: number) => {
      s = ok(act(s, 0, a0, seeded(1), T0 + t)).state
      s = ok(act(s, 1, a1, seeded(1), T0 + t + 1)).state
    }
    step({ kind: 'interrupt', dice: [0] }, { kind: 'pass' }, 10)
    step({ kind: 'pass' }, { kind: 'barrier', dice: [1] }, 20)
    step({ kind: 'barrier', dice: [0] }, { kind: 'pass' }, 30)
    expect(s.match?.state.turn).toBe(2)
    expect(restoreRoom(legacy(s))).toEqual(s)
  })
  it('対局の無い部屋もそのまま', () => {
    const s = created()
    expect(restoreRoom(s)).toEqual(s)
  })
})
