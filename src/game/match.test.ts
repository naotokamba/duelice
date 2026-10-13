// 対局の進行のテスト。サーバがそのまま動かすことを想定して、出す順、隠すもの、決着の後を確かめる。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { deckArb, makeState, seeded } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, UNHURT } from './cards'
import { forfeit, type Match, newMatch, resign, type Submitted, submit, viewFor } from './match'
import { isLegal, keptRow, legalActions, turnOver } from './rules'
import { rowOf, slotsOf } from './slots'
import type { Action, GameState, PlayerIndex } from './types'
import { DEFAULT_CONFIG } from './types'

const pass: Action = { kind: 'pass' }
const fire: Action = { kind: 'flameStrike', dice: [0, 1] }

/** 受け付けられた結果。受け付けられなければテストを落とす */
function accepted(r: Submitted): Extract<Submitted, { ok: true }> {
  if (!r.ok) throw new Error(`受け付けられなかった: ${r.reason}`)
  return r
}

/** 盤から対局を作る */
const matchOf = (state: GameState): Match => ({ state, pending: [null, null] })

/** 双方の行動を、0、1の順に出す */
function both(m: Match, a0: Action, a1: Action, seed = 1) {
  const rng = seeded(seed)
  return accepted(submit(accepted(submit(m, 0, a0, rng)).match, 1, a1, rng))
}

describe('行動を出す', () => {
  const start = matchOf(makeState({ roll: [6, 4, 1] }, { roll: [3, 2, 1] }))

  it('始めた対局は、まだどちらも行動を出していない', () => {
    const m = newMatch(seeded(3))
    expect(m.pending).toEqual([null, null])
    expect([m.state.turn, m.state.step, m.state.winner]).toEqual([1, 1, null])
  })
  it('片方だけが出しても解決しない。出した行動は相手に見せず、出したことだけを伝える', () => {
    const r = accepted(submit(start, 0, fire, seeded(1)))
    expect(r.resolved).toBeNull()
    expect(r.match.state).toBe(start.state)
    expect(viewFor(r.match, 0)).toEqual({ state: start.state, mine: fire, opponentReady: false })
    expect(viewFor(r.match, 1)).toEqual({ state: start.state, mine: null, opponentReady: true })
  })
  it('両方そろうと解決し、出した行動はそのまま記録に残る', () => {
    const r = both(start, fire, pass)
    expect(r.resolved?.report.actions).toEqual([fire, pass])
    // 6 を X の枠に置いた炎撃は 2 を足して 8 を当て、もう一つの 4 だけ自分も焼ける
    expect(r.resolved?.report.damage).toEqual([4, 8])
    expect(r.match.pending).toEqual([null, null])
  })
  it('出す順を入れ替えても、結果は同じ', () => {
    const rng = seeded(1)
    const late = accepted(submit(accepted(submit(start, 1, pass, rng)).match, 0, fire, rng))
    expect(late).toEqual(both(start, fire, pass))
  })
  it('合法でない行動、同じステップに二度出した行動、決着した後の行動は受け付けない', () => {
    expect(submit(start, 0, { kind: 'spearCast', dice: [0, 1] }, seeded(1))).toEqual({ ok: false, reason: 'illegal' })
    const once = accepted(submit(start, 0, pass, seeded(1))).match
    expect(submit(once, 0, fire, seeded(1))).toEqual({ ok: false, reason: 'already' })
    const over = matchOf({ ...start.state, winner: 1 })
    expect(submit(over, 0, pass, seeded(1))).toEqual({ ok: false, reason: 'over' })
  })
})

describe('ステップとターンの進行', () => {
  const start = matchOf(makeState({ roll: [6, 4, 1] }, { roll: [3, 2, 1] }))

  it('1ステップ目を解決すると、同じターンの2ステップ目へ進む。盤は解決した直後のまま', () => {
    const r = both(start, fire, pass)
    expect(r.match.state).toBe(r.resolved?.state)
    expect([r.match.state.turn, r.match.state.step]).toEqual([1, 2])
  })
  it('2ステップ目を解決すると、その場で振り直して次のターンへ進む。公開に使う盤は、振り直す前のまま返す', () => {
    const step2 = both(start, fire, pass).match
    const r = both(step2, pass, pass, 9)
    const before = r.resolved?.state
    expect(before && turnOver(before)).toBe(true)
    expect(before?.players[0].roll).toEqual([6, 4, 1])
    const next = r.match.state
    expect([next.turn, next.step]).toEqual([2, 1])
    for (const p of next.players) {
      expect(p.usedDice).toEqual([])
      expect(p.usedCards).toEqual([])
      expect(p.chant).toBe('none')
    }
    // 振り直しには、渡した乱数を使う
    expect(next.players.map((p) => p.roll)).toEqual(both(step2, pass, pass, 9).match.state.players.map((p) => p.roll))
    expect(next.history).toEqual(before?.history)
  })
  it('決着したら次のターンへ進まず、もう行動を受け付けない', () => {
    const near = matchOf(makeState({ roll: [6, 4, 1] }, { roll: [3, 2, 1], hp: 6 }))
    const r = both(near, fire, pass)
    expect(r.match.state.winner).toBe(0)
    expect(r.match.state).toBe(r.resolved?.state)
    expect(submit(r.match, 1, pass, seeded(1))).toEqual({ ok: false, reason: 'over' })
  })
  it('降参すると相手の勝ちで決着し、出していた行動は捨てる', () => {
    const half = accepted(submit(start, 1, fire, seeded(1))).match
    const r = resign(half, 1)
    expect(r.state.winner).toBe(0)
    expect(r.pending).toEqual([null, null])
    expect(resign(start, 0).state.winner).toBe(1)
    // 決着した後の降参は何も変えない
    expect(resign(r, 0)).toBe(r)
  })
})

describe('持ち時間の切れた側を負けにする', () => {
  const start = matchOf(makeState({ roll: [6, 4, 1] }, { roll: [3, 2, 1] }))
  const half = accepted(submit(start, 0, fire, seeded(1))).match

  it('片方だけなら、その側の負け。出していた行動は捨てる', () => {
    expect(forfeit(half, [1]).state.winner).toBe(0)
    expect(forfeit(half, [1]).pending).toEqual([null, null])
    expect(forfeit(start, [0]).state.winner).toBe(1)
  })
  it('両方なら引き分け。並べた順や重なりは問わない', () => {
    expect(forfeit(start, [0, 1]).state.winner).toBe('draw')
    expect(forfeit(start, [1, 0]).state.winner).toBe('draw')
    expect(forfeit(start, [1, 1]).state.winner).toBe(0)
  })
  it('誰も負けにしないときと、決着した後は何も変えない', () => {
    expect(forfeit(half, [])).toBe(half)
    const done = forfeit(start, [0])
    expect(forfeit(done, [1])).toBe(done)
  })
  it('盤の決着のほかは変えない', () => {
    const r = forfeit(half, [0])
    expect({ ...r.state, winner: null }).toEqual(half.state)
  })
})

/** 全ての目を6にしたときの値の、行動の中での最大 */
const maxOver = (f: (k: (typeof ACTION_KINDS)[number], sixes: number[]) => number | undefined) =>
  Math.max(...ACTION_KINDS.map((k) => f(k, Array(slotsOf(ACTION_DEFS[k])).fill(6)) ?? 0))

/**
 * 一つのステップで一人が受けうる、一番大きなダメージ。
 * 全ての目を6にした攻撃をそのまま受け、さらに自分も全ての目を6にして一番多く自分も焼けたときの量
 */
const MAX_TAKEN =
  maxOver((k, sixes) => ACTION_DEFS[k].power?.(sixes, UNHURT)) + maxOver((k, sixes) => ACTION_DEFS[k].burn?.(sixes))

describe('対局全体の性質', () => {
  const seedArb = fc.integer({ min: 1, max: 2 ** 31 - 1 })

  /** 乱数で選んだ合法でない行動。置き場の数や、空いていないダイスや、同じダイスの重なりを混ぜる */
  function junk(rng: () => number): Action {
    const kind = ACTION_KINDS[Math.floor(rng() * ACTION_KINDS.length)]
    const n = slotsOf(ACTION_DEFS[kind]) + Math.floor(rng() * 3) - 1
    return { kind, dice: Array.from({ length: Math.max(0, n) }, () => [null, 0, 1, 2, 3][Math.floor(rng() * 5)]) }
  }

  it('乱数の手と、ときどき混ぜた合法でない手で最後まで進めても、規則が壊れない', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const rng = seeded(seed)
        let m = newMatch(rng)
        for (let i = 0; i < 80 && m.state.winner === null; i++) {
          const before = m.state
          const pick = (who: PlayerIndex) => {
            const acts = legalActions(before, who)
            return acts[Math.floor(rng() * acts.length)]
          }
          const pair: [Action, Action] = [pick(0), pick(1)]
          const order: PlayerIndex[] = rng() < 0.5 ? [0, 1] : [1, 0]

          // 合法でない手は受け付けられず、対局は変わらない
          const bad = junk(rng)
          if (!isLegal(before, order[0], bad))
            expect(submit(m, order[0], bad, rng)).toEqual({ ok: false, reason: 'illegal' })

          const first = accepted(submit(m, order[0], pair[order[0]], rng))
          expect(first.resolved).toBeNull()
          // まだ公開していない行動は、相手から見えない。何を出していても、相手に見える様子は同じ
          const other = order[1]
          const alt: Match = { ...first.match, pending: [null, null] }
          alt.pending[order[0]] = { kind: 'pass' }
          expect(viewFor(first.match, other)).toEqual(viewFor(alt, other))

          const done = accepted(submit(first.match, order[1], pair[order[1]], rng))
          const res = done.resolved
          if (!res) throw new Error('解決しなかった')
          // 出した行動が、置いた置き場のまま記録に残る
          expect(res.report.actions).toEqual(pair)
          expect([res.report.turn, res.report.step]).toEqual([before.turn, before.step])
          for (const who of [0, 1] as const) {
            const p0 = before.players[who]
            const p1 = res.state.players[who]
            // 体力は増えず、一つのステップで受けるダメージには上限がある
            expect(p1.hp).toBe(p0.hp - res.report.damage[who])
            expect(p1.hp).toBeLessThanOrEqual(p0.hp)
            expect(p1.hp).toBeGreaterThanOrEqual(1 - MAX_TAKEN)
            // 使ったダイスとカードは、このターンに出した行動と一致する
            const turnActs = res.state.history.filter((r) => r.turn === before.turn).map((r) => r.actions[who])
            expect([...p1.usedDice].sort()).toEqual(
              turnActs.flatMap((a) => (a.kind === 'pass' ? [] : a.dice.filter((d) => d !== null))).sort(),
            )
            expect(new Set(p1.usedCards)).toEqual(
              new Set(turnActs.flatMap((a) => (a.kind === 'pass' ? [] : [ACTION_DEFS[a.kind].card]))),
            )
            // 2ステップ目の盤には、1ステップ目のダイスが置いた置き場のまま残る
            const firstAct = res.state.history.find((r) => r.turn === before.turn)?.actions[who]
            expect(keptRow(res.state, who)).toEqual(firstAct ? rowOf(firstAct) : null)
          }

          // 出す順を入れ替えても、結果は同じ
          const rng2 = seeded(seed + i)
          const rng3 = seeded(seed + i)
          const ab = accepted(submit(accepted(submit(m, 0, pair[0], rng2)).match, 1, pair[1], rng2))
          const ba = accepted(submit(accepted(submit(m, 1, pair[1], rng3)).match, 0, pair[0], rng3))
          expect(ab).toEqual(ba)

          // 進み方。決着していれば止まり、1ステップ目の後は2ステップ目、2ステップ目の後は次のターン
          const next = done.match.state
          if (res.state.winner !== null) {
            expect(next).toBe(res.state)
            for (const who of [0, 1] as const)
              expect(submit(done.match, who, pass, rng)).toEqual({ ok: false, reason: 'over' })
          } else if (before.step === 1) {
            expect([next.turn, next.step]).toEqual([before.turn, 2])
          } else {
            expect([next.turn, next.step]).toEqual([before.turn + 1, 1])
            for (const p of next.players) {
              expect(p.roll).toHaveLength(next.config.diceCount)
              expect(p.usedDice).toEqual([])
              expect(p.usedCards).toEqual([])
              expect(p.chant).toBe('none')
            }
          }
          expect(done.match.pending).toEqual([null, null])
          m = done.match
        }
      }),
      { numRuns: 60 },
    )
  })
  it('持ち込んだ5枚の対局も、出す順によらず同じに進み、振り足すダイスは解決するときに振る', () => {
    fc.assert(
      fc.property(seedArb, deckArb, deckArb, (seed, d0, d1) => {
        const rng = seeded(seed)
        let m = newMatch(rng, DEFAULT_CONFIG, [d0, d1])
        expect(m.state.players.map((p) => p.deck)).toEqual([d0, d1])
        for (let i = 0; i < 60 && m.state.winner === null; i++) {
          const before = m.state
          const pick = (who: PlayerIndex) => {
            const acts = legalActions(before, who)
            return acts[Math.floor(rng() * acts.length)]
          }
          const pair: [Action, Action] = [pick(0), pick(1)]
          const rng2 = seeded(seed + i)
          const rng3 = seeded(seed + i)
          const ab = accepted(submit(accepted(submit(m, 0, pair[0], rng2)).match, 1, pair[1], rng2))
          const ba = accepted(submit(accepted(submit(m, 1, pair[1], rng3)).match, 0, pair[0], rng3))
          expect(ab).toEqual(ba)
          const res = ab.resolved
          if (!res) throw new Error('解決しなかった')
          for (const who of [0, 1] as const) {
            const a = pair[who]
            const n = a.kind === 'pass' || res.report.cancelled[who] ? 0 : (ACTION_DEFS[a.kind].extraDice ?? 0)
            expect(res.report.extra[who]).toHaveLength(a.kind === 'pass' ? 0 : (ACTION_DEFS[a.kind].extraDice ?? 0))
            expect(res.state.players[who].roll).toHaveLength(before.players[who].roll.length + n)
          }
          m = ab.match
        }
      }),
      { numRuns: 40 },
    )
  })
  it('同じ乱数の種と同じ手なら、同じ対局になる', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const play = () => {
          const rng = seeded(seed)
          let m = newMatch(rng)
          for (let i = 0; i < 20 && m.state.winner === null; i++) {
            const a0 = legalActions(m.state, 0).at(-1) ?? pass
            const a1 = legalActions(m.state, 1).at(-1) ?? pass
            m = accepted(submit(accepted(submit(m, 0, a0, rng)).match, 1, a1, rng)).match
          }
          return m
        }
        expect(play()).toEqual(play())
      }),
      { numRuns: 20 },
    )
  })
})
