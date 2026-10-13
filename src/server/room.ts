// 部屋の中身。入室、合言葉、席、つながりの有無、持ち時間、決着、もう一戦を、時刻と乱数を外から受け取る純粋な関数で書く。
// Durable Object の殻 room-object.ts は、これを呼んで保存し、つながっている画面に様子を送るだけにする。

import { ACTION_DEFS, type ActionKind, STARTER } from '../game/cards'
import { forfeit, type Match, newMatch, type Resolution, resign, submit, viewFor } from '../game/match'
import { STARTER_DECKS } from '../game/rules'
import type { Action, Config, GameState, Move, PlayerIndex, PlayerState, Rng, StepReport, Strike } from '../game/types'
import { DEFAULT_CONFIG } from '../game/types'
import {
  EMPTY_GRACE_MS,
  type EndReason,
  type LobbyRoom,
  REVEAL_GRACE_MS,
  type RoomSnapshot,
  type RoomStatus,
  START_GRACE_MS,
  STEP_MS,
} from '../online/protocol'

export interface Seat {
  name: string
  /** 席の合言葉。再読み込みしても同じ席に戻るのに使う。本人にだけ渡す */
  token: string
  /** 画面がつながっているか */
  online: boolean
}

export interface RoomState {
  id: string
  /** 入るための合言葉 */
  code: string
  createdAt: number
  /** 席0は部屋を作った人。決着の後に一人が抜けたら、残った人が席0に移る */
  seats: [Seat | null, Seat | null]
  /** 対局。二人目が入るまでは null */
  match: Match | null
  matchNo: number
  /** この対局で一番新しい解決。n はこの対局で何回目の解決か */
  last: { n: number; resolution: Resolution } | null
  /** 今のステップの持ち時間の期限。決着した後と、待っている間は null */
  deadline: number | null
  end: { reason: EndReason } | null
  again: [boolean, boolean]
  /** 誰もつながっていなくなった時刻。誰かつながっていれば null */
  emptySince: number | null
  /** 1ステップの持ち時間。開発のテストだけ短くする */
  stepMs: number
  config: Config
}

export interface CreateArgs {
  id: string
  code: string
  name: string
  token: string
  now: number
  stepMs?: number
  config?: Config
}

/** 部屋を作る。作った人はまだつながっていないので、つながらないまま猶予が過ぎれば消える */
export function createRoom({
  id,
  code,
  name,
  token,
  now,
  stepMs = STEP_MS,
  config = DEFAULT_CONFIG,
}: CreateArgs): RoomState {
  return {
    id,
    code,
    createdAt: now,
    seats: [{ name, token, online: false }, null],
    match: null,
    matchNo: 0,
    last: null,
    deadline: null,
    end: null,
    again: [false, false],
    emptySince: now,
    stepMs,
    config,
  }
}

/** 古い形で保存されていたかもしれない値。後から足した欄は無いことがある */
type Saved<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * 保存されていた席。カードを選べるようになる前の盤には、持ち込んだ5枚やターンをまたぐ効果の欄が無い。
 * 直前の効果とこのターンに起きた効果は、そろえた記録から作る。直前の効果は一番新しい記録の効果で、
 * このターンに起きた効果は、このターンの記録の効果。オンライン対戦はスターターの5枚どうしで、
 * 先に当たる攻撃が無く倒れて起きなかった効果も無いので、記録の効果は全て起きている
 */
function restorePlayer(
  p: Saved<PlayerState, 'deck' | 'frozen' | 'burned' | 'carry' | 'last' | 'acted'>,
  who: PlayerIndex,
  turn: number,
  history: StepReport[],
): PlayerState {
  return {
    ...p,
    deck: p.deck ?? [...STARTER],
    frozen: p.frozen ?? null,
    burned: p.burned ?? 0,
    carry: p.carry ?? null,
    last: p.last ?? history.at(-1)?.moves[who] ?? [],
    acted: p.acted ?? history.filter((r) => r.turn === turn).flatMap((r) => r.moves[who].map((m) => m.kind)),
  }
}

/**
 * 保存されていた記録。先に当たる攻撃やターンの終わりの欄が無ければ、何も起きなかった値を入れる。
 * 効果の欄が無ければ、カードの行動を一つずつ出した記録なので、行動と置いた目から作る
 */
function restoreReport(r: Saved<StepReport, 'endBurn' | 'cancelled' | 'refunded' | 'extra' | 'moves'>): StepReport {
  const moveOf = (i: 0 | 1): Move[] => {
    const a = r.actions[i]
    return a.kind === 'pass' ? [] : [{ kind: a.kind, vals: r.values[i] }]
  }
  return {
    ...r,
    moves: r.moves ?? [moveOf(0), moveOf(1)],
    strikes: r.strikes.map((x: Saved<Strike, 'phase'>) => ({ ...x, phase: x.phase ?? 'main' })),
    endBurn: r.endBurn ?? [0, 0],
    cancelled: r.cancelled ?? [false, false],
    refunded: r.refunded ?? [false, false],
    extra: r.extra ?? [[], []],
  }
}

function restoreGame(g: GameState): GameState {
  const history = g.history.map(restoreReport)
  return {
    ...g,
    players: [restorePlayer(g.players[0], 0, g.turn, history), restorePlayer(g.players[1], 1, g.turn, history)],
    history,
  }
}

/**
 * 保存されていた部屋を、今の形にそろえる。カードを選べるようになる前に保存された部屋がデプロイをまたいでも、続きを遊べるようにする。
 * 無い欄には、スターターの5枚と、何も起きていない値を入れる
 */
export function restoreRoom(s: RoomState): RoomState {
  const last = s.last && {
    n: s.last.n,
    resolution: { state: restoreGame(s.last.resolution.state), report: restoreReport(s.last.resolution.report) },
  }
  return { ...s, match: s.match && { ...s.match, state: restoreGame(s.match.state) }, last }
}

/** 部屋の様子 */
export function statusOf(s: RoomState): RoomStatus {
  if (!s.match) return 'waiting'
  return s.end ? 'over' : 'playing'
}

/** 新しい対局を始める。最初のステップの持ち時間は、最初のターンを知らせる帯の後から数える */
function begin(s: RoomState, rng: Rng, now: number): RoomState {
  return {
    ...s,
    // オンライン対戦は、二人ともスターターの5枚で戦う
    match: newMatch(rng, s.config, STARTER_DECKS),
    matchNo: s.matchNo + 1,
    last: null,
    deadline: now + START_GRACE_MS + s.stepMs,
    end: null,
    again: [false, false],
  }
}

export type JoinResult = { ok: true; state: RoomState } | { ok: false; reason: 'code' | 'full' }

/** 二人目が入る。合言葉が合えば席1に座り、すぐ対局を始める */
export function joinRoom(
  s: RoomState,
  { name, code, token, now, rng }: { name: string; code: string; token: string; now: number; rng: Rng },
): JoinResult {
  if (s.seats[1]) return { ok: false, reason: 'full' }
  if (code !== s.code) return { ok: false, reason: 'code' }
  const seated: RoomState = { ...s, seats: [s.seats[0], { name, token, online: false }] }
  return { ok: true, state: begin(seated, rng, now) }
}

/** 席の合言葉から席を引く。どの席でもなければ null */
export function seatOf(s: RoomState, token: string): PlayerIndex | null {
  if (s.seats[0]?.token === token) return 0
  if (s.seats[1]?.token === token) return 1
  return null
}

/** 席ごとに画面がつながっているかを書き換える。誰もつながっていなくなったら、その時刻を覚える */
export function setOnline(s: RoomState, online: [boolean, boolean], now: number): RoomState {
  const seats = s.seats.map((seat, i) => (seat ? { ...seat, online: online[i] } : null)) as RoomState['seats']
  const anyone = seats.some((seat) => seat?.online)
  return { ...s, seats, emptySince: anyone ? null : (s.emptySince ?? now) }
}

/** 対局が続いているか。決着した後は行動を受け付けない */
const playing = (s: RoomState): s is RoomState & { match: Match } => s.match !== null && s.end === null

/** 画面から届いた行動の形を確かめる。表に無い種類や、置き場の形が崩れたものは null。合法かどうかは act が確かめる */
export function asAction(raw: unknown): Action | null {
  const { kind, dice } = Object(raw) as { kind?: unknown; dice?: unknown }
  if (kind === 'pass') return { kind: 'pass' }
  if (typeof kind !== 'string' || !Object.hasOwn(ACTION_DEFS, kind)) return null
  if (!Array.isArray(dice) || !dice.every((d) => d === null || Number.isInteger(d))) return null
  return { kind: kind as ActionKind, dice: dice as (number | null)[] }
}

export type ActResult = { ok: true; state: RoomState } | { ok: false; reason: 'over' | 'already' | 'illegal' }

/**
 * seat の行動を受け付ける。両方そろって解決したら一番新しい解決として覚え、次のステップの期限を、
 * 公開の演出の猶予の後から数え直す。体力で決着したら期限を消す
 */
export function act(s: RoomState, seat: PlayerIndex, action: Action, rng: Rng, now: number): ActResult {
  if (!playing(s)) return { ok: false, reason: 'over' }
  const r = submit(s.match, seat, action, rng)
  if (!r.ok) return r
  if (!r.resolved) return { ok: true, state: { ...s, match: r.match } }
  const last = { n: (s.last?.n ?? 0) + 1, resolution: r.resolved }
  const over = r.match.state.winner !== null
  return {
    ok: true,
    state: {
      ...s,
      match: r.match,
      last,
      deadline: over ? null : now + REVEAL_GRACE_MS + s.stepMs,
      end: over ? { reason: 'hp' } : null,
    },
  }
}

/** seat が降参する */
export function resignRoom(s: RoomState, seat: PlayerIndex): RoomState {
  if (!playing(s)) return s
  return { ...s, match: resign(s.match, seat), deadline: null, end: { reason: 'resign' } }
}

/** 決着した後に seat がもう一戦を押す。二人とも押したら新しい対局を始める */
export function again(s: RoomState, seat: PlayerIndex, rng: Rng, now: number): RoomState {
  if (!s.end || !s.seats[0] || !s.seats[1]) return s
  const votes: [boolean, boolean] = [...s.again]
  votes[seat] = true
  if (!votes[0] || !votes[1]) return { ...s, again: votes }
  return begin(s, rng, now)
}

/**
 * seat が部屋を出る。残った人がいれば席0に移り、次の相手を待つ部屋に戻る。対局中なら、その対局は記録せずに終える。
 * 残った人がつながっていなければ、誰もいない部屋として猶予を数える。誰も残らなければ部屋は消える
 */
export function leave(s: RoomState, seat: PlayerIndex, now: number): { state: RoomState; deleted: boolean } {
  const rest = s.seats[seat === 0 ? 1 : 0]
  if (!rest) return { state: s, deleted: true }
  return {
    state: {
      ...s,
      seats: [rest, null],
      match: null,
      last: null,
      deadline: null,
      end: null,
      again: [false, false],
      emptySince: rest.online ? null : (s.emptySince ?? now),
    },
    deleted: false,
  }
}

/**
 * 時刻を進める。持ち時間の期限を過ぎたら、まだ行動を出していない側の負けで決着させる。両方なら引き分け。
 * 対局していない部屋は、誰もつながっていないまま猶予を過ぎたら消す。対局中は持ち時間が決着をつけるので消さない
 */
export function tick(s: RoomState, now: number): { state: RoomState; deleted: boolean } {
  // Stryker disable next-line ConditionalExpression,LogicalOperator: 期限は対局中にだけあり、対局中はいつもある。どちらを確かめても同じ
  const state = playing(s) && s.deadline !== null && now >= s.deadline ? timeout(s) : s
  const empty = !playing(state) && state.emptySince !== null && now - state.emptySince >= EMPTY_GRACE_MS
  return { state, deleted: empty }
}

function timeout(s: RoomState & { match: Match }): RoomState {
  const late = ([0, 1] as const).filter((i) => s.match.pending[i] === null)
  return { ...s, match: forfeit(s.match, late), deadline: null, end: { reason: 'timeout' } }
}

/**
 * 誰かつながっている部屋でも、この間ごとに起きて、本当につながっているかを数え直す。
 * デプロイで Durable Object が作り直されると、WebSocket は閉じた知らせを残さずに切れる。数え直さないと、誰もいない部屋がいつまでも残る
 */
export const PRESENCE_CHECK_MS = 60_000

/**
 * 次に時刻を進めるべき時刻。対局中は持ち時間の期限、誰もいなければ部屋を消す時刻、ほかはつながりを数え直す時刻。
 * 部屋がある間は、いつも次の時刻を決めておく
 */
export function nextAlarm(s: RoomState, now: number): number {
  // Stryker disable next-line ConditionalExpression,LogicalOperator: 期限は対局中にだけあり、対局中はいつもある。どちらを確かめても同じ
  if (playing(s) && s.deadline !== null) return s.deadline
  if (s.emptySince !== null) return s.emptySince + EMPTY_GRACE_MS
  return now + PRESENCE_CHECK_MS
}

/** ロビーの一覧に出す一行。二人そろっていれば対戦中。部屋を作った人がいなければ出さない */
export function lobbyRoom(s: RoomState): LobbyRoom | null {
  const host = s.seats[0]
  if (!host) return null
  return { id: s.id, host: host.name, status: s.seats[1] ? 'playing' : 'waiting', createdAt: s.createdAt }
}

/** seat に送る様子。相手がまだ公開していない行動は viewFor が隠す */
export function snapshot(s: RoomState, seat: PlayerIndex, now: number): RoomSnapshot {
  return {
    type: 'room',
    id: s.id,
    code: s.code,
    seat,
    names: [s.seats[0]?.name ?? null, s.seats[1]?.name ?? null],
    online: [!!s.seats[0]?.online, !!s.seats[1]?.online],
    status: statusOf(s),
    matchNo: s.matchNo,
    view: s.match ? viewFor(s.match, seat) : null,
    last: s.last,
    deadline: s.deadline,
    stepMs: s.stepMs,
    now,
    end: s.end,
    again: s.again,
  }
}
