// どのカードにも、これから足すカードにも成り立つべき性質。
// 乱数で大量の局面と行動を作って確かめる。カードを足したら何もしなくてもここで検査される。
// 局面は、二人ともスターターのものと、選べるカードから5枚ずつ持ち込んだものの両方から作る。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { deckArb, dieArb, playArb, playRandom, poolStateArb, stateArb, swapSeats } from '../test/helpers'
import { ACTION_DEFS, ACTION_KINDS, type ActionKind, kindsOfCard, UNHURT } from './cards'
import {
  actionDice,
  actionKey,
  burnOf,
  clash,
  ctxOf,
  diceValues,
  isLegal,
  legalActions,
  newGame,
  nextTurn,
  placeableDice,
  resolveStep,
  stepDamage,
  strikes,
  turnOver,
} from './rules'
import { MARK_SLOT, readsMark, requiredSlots, slotsOf } from './slots'
import type { Action, GameState, PlayerIndex } from './types'
import { DEFAULT_CONFIG } from './types'

const seedArb = fc.integer({ min: 1, max: 2 ** 31 - 1 })

/** スターターどうしの局面か、選べるカードから5枚ずつ持ち込んだ局面 */
const anyStateArb: fc.Arbitrary<GameState> = fc.oneof(stateArb, poolStateArb)

/** 局面と、その局面の双方の合法手から一つずつと、振り足すダイスの目 */
const anyPlayArb = playArb(anyStateArb)

/** 双方の様子 */
const ctxs = (s: GameState) => [ctxOf(s, 0), ctxOf(s, 1)] as const

/** 双方が置いた目 */
const valsOf = (s: GameState, acts: [Action, Action]): [number[], number[]] => [
  diceValues(s.players[0], acts[0]),
  diceValues(s.players[1], acts[1]),
]

/** 行動の定義。パスは undefined */
const defOf = (a: Action) => (a.kind === 'pass' ? undefined : ACTION_DEFS[a.kind])

const other = (i: PlayerIndex): PlayerIndex => (i === 0 ? 1 : 0)

/** 行動の種類と、その行動に置ける個数の目 */
const kindWithValsArb = fc
  .constantFrom(...ACTION_KINDS)
  .chain((kind) =>
    fc
      .constantFrom(...ACTION_DEFS[kind].dice)
      .chain((n) => fc.tuple(fc.constant(kind), fc.array(dieArb, { minLength: n, maxLength: n }))),
  )

/**
 * 局面と、行動の種類と、その行の置き場ごとのダイスと、置き場の並べ替え。
 * 空けた置き場、使い終わったダイス、同じダイスの重複も混ぜて、合法でない置き方も作る
 */
const placedArb = anyStateArb.chain((s) =>
  fc.constantFrom(...ACTION_KINDS).chain((kind) => {
    const n = slotsOf(ACTION_DEFS[kind])
    const slots = [...Array(n).keys()]
    const dice = [...Array(Math.max(s.players[0].roll.length, s.players[1].roll.length)).keys()]
    return fc.tuple(
      fc.constant(s),
      fc.constant(kind),
      fc.array(fc.constantFrom(null, ...dice), { minLength: n, maxLength: n }),
      fc.shuffledSubarray(slots, { minLength: n, maxLength: n }),
    )
  }),
)

/** 威力と、障壁が減らす量と、自分が焼ける量 */
const effectOf = (kind: ActionKind, vals: number[]) => [
  ACTION_DEFS[kind].power?.(vals, UNHURT),
  ACTION_DEFS[kind].guard?.(vals),
  ACTION_DEFS[kind].burn?.(vals),
]

describe('合法手の列挙', () => {
  it('列挙された手は全て合法で、何もしないが必ず含まれる', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const acts = legalActions(s, who)
          expect(acts[0]).toEqual({ kind: 'pass' })
          for (const a of acts) expect(isLegal(s, who, a)).toBe(true)
        }
      }),
    )
  })
  it('同じ種類と同じ目の組み合わせは重複しない。印の置き場の目を値にする行動は、印の置き場の目も見て区別する', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const keys = legalActions(s, who).map((a) => actionKey(s.players[who], a))
          expect(new Set(keys).size).toBe(keys.length)
        }
      }),
    )
  })
  it('列挙から漏れた合法手は無い。全ての置き場に、空けるかどのダイスを置くかを全て試して、合法なら同じ手が列挙にある', () => {
    /** n 個の置き場の、空けるか、dice のどれかを置くかの全ての組 */
    const allSlots = (n: number, dice: number[]): (number | null)[][] =>
      n === 0 ? [[]] : allSlots(n - 1, dice).flatMap((rest) => [null, ...dice].map((d) => [d, ...rest]))
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          const listed = new Set(legalActions(s, who).map((a) => actionKey(p, a)))
          for (const kind of ACTION_KINDS) {
            for (const dice of allSlots(slotsOf(ACTION_DEFS[kind]), [...p.roll.keys()])) {
              const a: Action = { kind, dice }
              if (!isLegal(s, who, a)) continue
              expect(listed.has(actionKey(p, a))).toBe(true)
            }
          }
        }
      }),
      { numRuns: 60 },
    )
  })
  it('持ち込んでいないカードの行動は合法でない', () => {
    fc.assert(
      fc.property(placedArb, ([s, kind, dice]) => {
        for (const who of [0, 1] as const) {
          if (!s.players[who].deck.includes(ACTION_DEFS[kind].card)) expect(isLegal(s, who, { kind, dice })).toBe(false)
        }
      }),
    )
  })
  it('凍らされた目のダイスを置いた行動は合法でない', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          expect(placeableDice(p).every((i) => p.roll[i] !== p.frozen && !p.usedDice.includes(i))).toBe(true)
          for (const a of legalActions(s, who)) expect(diceValues(p, a)).not.toContain(p.frozen)
        }
      }),
    )
  })
  it('同じ手とみなした行動は効果も同じ。印の置き場の目を値にする行動は印の目を残して、ほかの行動は目を全て並べ替えても変わらない', () => {
    fc.assert(
      fc.property(kindWithValsArb, ([kind, vals]) => {
        const keep = readsMark(ACTION_DEFS[kind]) ? 1 : 0
        const moved = [...vals.slice(0, keep), ...vals.slice(keep).reverse()]
        expect(effectOf(kind, moved)).toEqual(effectOf(kind, vals))
      }),
    )
  })
  it('行動の長さはその行の置き場の数。合わなければ合法でない', () => {
    fc.assert(
      fc.property(anyStateArb, (s) => {
        for (const who of [0, 1] as const) {
          for (const a of legalActions(s, who)) {
            if (a.kind === 'pass') continue
            expect(a.dice.length).toBe(slotsOf(ACTION_DEFS[a.kind]))
            expect(isLegal(s, who, { kind: a.kind, dice: [...a.dice, null] })).toBe(false)
            expect(isLegal(s, who, { kind: a.kind, dice: a.dice.slice(1) })).toBe(false)
          }
        }
      }),
    )
  })
})

describe('置き場', () => {
  it('空けられない置き場が一つでも空なら合法でない。空けられない置き場は行の前にあり、印の置き場もそこに入る', () => {
    fc.assert(
      fc.property(placedArb, ([s, kind, dice]) => {
        const def = ACTION_DEFS[kind]
        if (readsMark(def)) expect(MARK_SLOT).toBeLessThan(requiredSlots(def))
        fc.pre(dice.slice(0, requiredSlots(def)).includes(null))
        for (const who of [0, 1] as const) expect(isLegal(s, who, { kind, dice })).toBe(false)
      }),
    )
  })
  it('印の置き場を持たない行動は、空けられない置き場を埋めたままダイスを置き場の間で動かせば、合法かどうかも効果も同じ手かどうかも変わらない', () => {
    fc.assert(
      fc.property(placedArb, ([s, kind, dice, order]) => {
        const def = ACTION_DEFS[kind]
        fc.pre(!readsMark(def))
        const a: Action = { kind, dice }
        const b: Action = { kind, dice: order.map((k) => dice[k]) }
        const filled = (xs: (number | null)[]) => xs.slice(0, requiredSlots(def)).every((d) => d !== null)
        fc.pre(filled(a.dice) && filled(b.dice))
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          expect(isLegal(s, who, b)).toBe(isLegal(s, who, a))
          if (!isLegal(s, who, a)) continue
          expect(effectOf(kind, diceValues(p, b))).toEqual(effectOf(kind, diceValues(p, a)))
          expect(actionKey(p, b)).toBe(actionKey(p, a))
        }
      }),
    )
  })
  it('印の置き場を持つ行動は、印の置き場が空なら合法でなく、印の置き場の目を残してほかを動かしても、合法かどうかも効果も変わらない', () => {
    fc.assert(
      fc.property(placedArb, ([s, kind, dice, order]) => {
        fc.pre(readsMark(ACTION_DEFS[kind]))
        const a: Action = { kind, dice }
        // 印の置き場はそのままにして、ほかの置き場の中だけで並べ替える
        const others = order.filter((k) => k !== MARK_SLOT)
        const rest = dice.map((_, k) => k).filter((k) => k !== MARK_SLOT)
        const moved = [...dice]
        rest.forEach((k, i) => {
          moved[k] = dice[others[i]]
        })
        const b: Action = { kind, dice: moved }
        for (const who of [0, 1] as const) if (dice[MARK_SLOT] === null) expect(isLegal(s, who, a)).toBe(false)
        // 点線の枠との間で動かすと、空けられない置き場が空くことがある。それは上の性質で見る
        const filled = (xs: (number | null)[]) => xs.slice(0, requiredSlots(ACTION_DEFS[kind])).every((d) => d !== null)
        fc.pre(filled(a.dice) && filled(b.dice))
        for (const who of [0, 1] as const) {
          const p = s.players[who]
          expect(isLegal(s, who, b)).toBe(isLegal(s, who, a))
          if (!isLegal(s, who, a)) continue
          // 合法なら、置き場の順に並べた目の最初が印の置き場の目になる
          expect(diceValues(p, a)[0]).toBe(p.roll[dice[MARK_SLOT] ?? -1])
          expect(effectOf(kind, diceValues(p, b))).toEqual(effectOf(kind, diceValues(p, a)))
          expect(actionKey(p, b)).toBe(actionKey(p, a))
        }
      }),
    )
  })
})

describe('カード面', () => {
  it('カード面に X や Y の記号を書かない行動は、目ではなく置いた個数で値が決まる。カードに数で書けるのはこのため', () => {
    fc.assert(
      fc.property(kindWithValsArb, ([kind, vals]) => {
        const { face } = ACTION_DEFS[kind]
        fc.pre(face.mark === undefined && face.sum === undefined)
        expect(effectOf(kind, vals)).toEqual(
          effectOf(
            kind,
            vals.map(() => 1),
          ),
        )
      }),
    )
  })
})

describe('ダメージ', () => {
  it('ダメージは負にならず、何もしない同士では0', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const [d0, d1] = stepDamage(valsOf(s, acts), acts, ctxs(s))
        expect(d0).toBeGreaterThanOrEqual(0)
        expect(d1).toBeGreaterThanOrEqual(0)
        expect(stepDamage([[], []], [{ kind: 'pass' }, { kind: 'pass' }])).toEqual([0, 0])
      }),
    )
  })
  it('攻撃しない側が相手に与えるダメージは、守りが返した分と、構えが返した攻撃だけ。相手が自分で自分が焼けた分は除く', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const vals = valsOf(s, acts)
        const c = clash(vals, acts, ctxs(s))
        for (const i of [0, 1] as const) {
          const def = defOf(acts[i])
          if (def?.power) continue
          const returned = c.strikes.filter((x) => x.from === i).reduce((sum, x) => sum + x.dealt, 0)
          const reflected = c.strikes
            .filter((x) => x.outcome === 'reflected' && x.to === other(i))
            .reduce((sum, x) => sum + x.dealt, 0)
          expect(c.damage[other(i)] - c.burn[other(i)]).toBe(returned + reflected)
          // 返すのは返す性質を持つ守りと、攻撃を返す構えだけ
          if (!def?.thorns) expect(returned).toBe(0)
          if (!def?.reflects) expect(reflected).toBe(0)
        }
      }),
    )
  })
  it('自分も焼けるのは自分も焼ける行動だけで、払う量は置いた目から決まる。焼けた分は受けたダメージに入る', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const vals = valsOf(s, acts)
        const c = clash(vals, acts, ctxs(s))
        for (const i of [0, 1] as const) {
          const pay = c.cancelled[i] ? undefined : defOf(acts[i])?.burn
          expect(c.burn[i]).toBe(pay ? pay(vals[i]) : 0)
          expect(c.damage[i]).toBeGreaterThanOrEqual(c.burn[i])
        }
        // 倒れる前の行動から決まる焼ける分は、起きた行動から決まる焼ける分と同じか多い
        const all = burnOf(vals, acts)
        expect(all[0]).toBeGreaterThanOrEqual(c.burn[0])
        expect(all[1]).toBeGreaterThanOrEqual(c.burn[1])
      }),
    )
  })
  it('攻撃は起きた攻撃の数だけあり、行方は受けた側の構えで決まる。先に当たる攻撃が前に並ぶ', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const vals = valsOf(s, acts)
        const c = clash(vals, acts, ctxs(s))
        const list = c.strikes.filter((x) => x.outcome !== 'returned')
        const attackers = ([0, 1] as const).filter((i) => !!defOf(acts[i])?.power && !c.cancelled[i])
        expect([...list.map((x) => x.from)].sort()).toEqual(attackers)
        // 先に当たる攻撃と、それへの返しが、ほかの攻撃より前に並ぶ
        const phases = c.strikes.map((x) => x.phase)
        expect(phases).toEqual([...phases].sort((a, b) => (a === b ? 0 : a === 'fast' ? -1 : 1)))
        for (const x of list) {
          const def = ACTION_DEFS[x.kind]
          expect(x.phase).toBe(def.fast ? 'fast' : 'main')
          const bdef = defOf(acts[other(x.from)])
          expect(x.power).toBe(def.power?.(vals[x.from], ctxOf(s, x.from)))
          expect(x.dealt).toBeGreaterThanOrEqual(0)
          expect(x.dealt).toBeLessThanOrEqual(x.power)
          if (bdef?.reflects && !def.piercing) {
            // 構えに返された攻撃は、放った側にそのまま当たる
            expect(x).toMatchObject({ outcome: 'reflected', to: x.from, dealt: x.power })
            continue
          }
          const stance = !!bdef?.guard || !!bdef?.reflects
          expect(x.outcome).toBe(stance ? (def.piercing ? 'pierced' : 'guarded') : 'hit')
          expect(x.to).toBe(other(x.from))
          // 障壁に削られなければ威力のまま
          if (x.outcome !== 'guarded') expect(x.dealt).toBe(x.power)
        }
        // 守りが返すのは、守りで減った攻撃を受け、守りが返す性質を持つときだけ。攻撃した側へ、返す量をそのまま与える
        const returns = c.strikes.filter((x) => x.outcome === 'returned')
        const want = list.flatMap((x) => {
          const b = acts[x.to]
          const back = defOf(b)?.thorns
          return x.outcome === 'guarded' && back && b.kind !== 'pass'
            ? [{ from: x.to, kind: b.kind, power: back, outcome: 'returned', to: x.from, dealt: back, phase: x.phase }]
            : []
        })
        expect(returns).toEqual(want)
      }),
    )
  })
  it('倒れて行動が起きないのは、先に当たる攻撃を放たなかった側が、先に当たる攻撃で体力が0以下になったときだけ', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const c = clash(valsOf(s, acts), acts, ctxs(s))
        for (const i of [0, 1] as const) {
          const first = c.strikes.filter((x) => x.phase === 'fast' && x.to === i).reduce((sum, x) => sum + x.dealt, 0)
          expect(c.cancelled[i]).toBe(!defOf(acts[i])?.fast && s.players[i].hp - first <= 0)
        }
      }),
    )
  })
  it('席を入れ替えるとダメージも入れ替わる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const vals = valsOf(s, acts)
        const [c0, c1] = ctxs(s)
        const [d0, d1] = stepDamage(vals, acts, [c0, c1])
        expect(stepDamage([vals[1], vals[0]], [acts[1], acts[0]], [c1, c0])).toEqual([d1, d0])
      }),
    )
  })
  it('様子を渡さなければ、双方とも体力が満タンとみなす', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts }) => {
        const vals = valsOf(s, acts)
        const full = { hp: DEFAULT_CONFIG.maxHp, maxHp: DEFAULT_CONFIG.maxHp }
        expect(strikes(vals, acts)).toEqual(strikes(vals, acts, [full, full]))
      }),
    )
  })
})

describe('状態の更新', () => {
  it('解決すると、HPはダメージ分だけ減り、起きた行動の使ったダイスとカードが記録される', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const report = next.history[next.history.length - 1]
        for (const i of [0, 1] as const) {
          const before = s.players[i]
          const after = next.players[i]
          expect(after.hp).toBe(before.hp - report.damage[i])
          expect(new Set(after.usedDice).size).toBe(after.usedDice.length)
          expect(new Set(after.usedCards).size).toBe(after.usedCards.length)
          const a = acts[i]
          const happened = a.kind !== 'pass' && !report.cancelled[i]
          if (happened) {
            // 防ぎきって戻ったダイスは使っていないことになる
            if (report.refunded[i]) expect(after.usedDice).toEqual(before.usedDice)
            else expect(after.usedDice).toEqual([...before.usedDice, ...actionDice(a)])
            expect(after.usedCards).toContain(ACTION_DEFS[a.kind].card)
          } else {
            expect(after.usedDice).toEqual(before.usedDice)
            expect(after.usedCards).toEqual(before.usedCards)
          }
          // 振り足したダイスは、起きた行動のものだけ後ろに加わる
          expect(after.roll).toEqual(happened ? [...before.roll, ...extra[i]] : before.roll)
          // 焼けた分は、ステップとターンの終わりの分を足していく
          expect(after.burned).toBe(before.burned + report.burn[i] + report.endBurn[i])
          // 凍らされるのは、相手が凍らせる行動をしたときだけで、その目は相手の印の置き場の目
          const by = report.cancelled[other(i)] ? undefined : defOf(acts[other(i)])
          expect(after.frozen).toBe(by?.freezes ? report.values[other(i)][0] : null)
          // 持ち越すのは、持ち越す行動をしたときだけ
          const mine = happened ? defOf(a) : undefined
          expect(after.carry).toBe(mine?.carries ? report.values[i][0] : before.carry)
          // ダイスが戻るのは、戻る守りで防ぎきったときだけ
          if (report.refunded[i]) expect(mine?.refund).toBe(true)
        }
        expect(next.step).toBe(2)
        // 記録の攻撃とダメージは、行動から決まるものと一致する
        const c = clash(report.values, acts, ctxs(s))
        expect(report.strikes.filter((x) => x.phase !== 'end')).toEqual(c.strikes)
        expect(report.burn).toEqual(c.burn)
        expect(report.cancelled).toEqual(c.cancelled)
        const late = report.strikes.filter((x) => x.phase === 'end')
        for (const i of [0, 1] as const) {
          const taken = late.filter((x) => x.to === i).reduce((sum, x) => sum + x.dealt, 0)
          expect(report.damage[i]).toBe(c.damage[i] + report.endBurn[i] + taken)
        }
        expect(report.extra).toEqual(extra)
      }),
    )
  })
  it('ターンの終わりに起きることは、二ステップ目にだけ起き、そのターンに使ったカードから決まる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const report = next.history[next.history.length - 1]
        const late = report.strikes.filter((x) => x.phase === 'end')
        if (s.step === 1) {
          expect(report.endBurn).toEqual([0, 0])
          expect(late).toEqual([])
          return
        }
        for (const i of [0, 1] as const) {
          const defs = next.players[i].usedCards.flatMap(kindsOfCard).map((k) => ACTION_DEFS[k])
          expect(report.endBurn[i]).toBe(defs.reduce((sum, d) => sum + (d.endBurn ?? 0), 0))
          const mine = late.filter((x) => x.from === i)
          if (!defs.some((d) => d.ignite)) {
            expect(mine).toEqual([])
            continue
          }
          // 延焼の性質は、このターンに焼けた分の全てを、減らされずに与える
          expect(mine).toHaveLength(1)
          expect(mine[0]).toMatchObject({ outcome: 'hit', to: other(i), dealt: next.players[i].burned })
        }
      }),
    )
  })
  it('勝敗はHPと一致する。同時に0以下なら体力の残りが多い方が勝ち、同じなら引き分け', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const [a, b] = next.players.map((p) => p.hp)
        const dead = [a <= 0, b <= 0]
        const both = a === b ? 'draw' : a > b ? 0 : 1
        const expected = dead[0] && dead[1] ? both : dead[0] ? 1 : dead[1] ? 0 : null
        expect(next.winner).toBe(expected)
      }),
    )
  })
  it('席を入れ替えて解決すると、結果も入れ替わる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const a = resolveStep(s, acts, extra)
        const b = resolveStep(swapSeats(s), [acts[1], acts[0]], [extra[1], extra[0]])
        expect(swapSeats(b).players).toEqual(a.players)
        expect(swapSeats(b).winner).toEqual(a.winner)
      }),
    )
  })
  it('詠唱は、相手が詠唱を崩す行動をしたときだけ崩れる', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const { cancelled } = next.history[next.history.length - 1]
        for (const i of [0, 1] as const) {
          if (!defOf(acts[i])?.chant || cancelled[i]) continue
          const disrupted = !cancelled[other(i)] && !!defOf(acts[other(i)])?.disrupts
          expect(next.players[i].chant).toBe(disrupted ? 'broken' : 'charged')
        }
      }),
    )
  })
  it('詠唱の状態は、起きた詠唱と発動の行動でしか変わらない', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const { cancelled } = next.history[next.history.length - 1]
        for (const i of [0, 1] as const) {
          const def = cancelled[i] ? undefined : defOf(acts[i])
          if (def?.chant) expect(['charged', 'broken']).toContain(next.players[i].chant)
          else if (def?.needsCharge) expect(next.players[i].chant).toBe('none')
          else expect(next.players[i].chant).toBe(s.players[i].chant)
        }
      }),
    )
  })
  it('詠唱の結果は、詠唱が起きた側だけに記録され、詠唱の状態と一致する', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const next = resolveStep(s, acts, extra)
        const report = next.history[next.history.length - 1]
        for (const i of [0, 1] as const) {
          const chanted = !!defOf(acts[i])?.chant && !report.cancelled[i]
          const want = chanted ? (next.players[i].chant === 'broken' ? 'broken' : 'kept') : null
          expect(report.chants[i]).toBe(want)
        }
      }),
    )
  })
  it('元の状態を書き換えない', () => {
    fc.assert(
      fc.property(anyPlayArb, ({ s, acts, extra }) => {
        const snapshot = structuredClone(s)
        resolveStep(s, acts, extra)
        expect(s).toEqual(snapshot)
      }),
    )
  })
})

describe('対局全体', () => {
  it('乱数の手で最後まで進めても、規則が壊れない', () => {
    fc.assert(
      fc.property(seedArb, fc.option(fc.tuple(deckArb, deckArb), { nil: undefined }), (seed, decks) => {
        const { states } = playRandom(seed, 60, decks)
        for (const s of states) {
          for (const p of s.players) {
            // 振り足すと2個、持ち越すと1個増える
            expect(p.roll.length).toBeGreaterThanOrEqual(s.config.diceCount)
            expect(p.roll.length).toBeLessThanOrEqual(s.config.diceCount + 3)
            if (!decks) expect(p.roll).toHaveLength(s.config.diceCount)
            expect(p.roll.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true)
            expect(p.usedDice.every((i) => i >= 0 && i < p.roll.length)).toBe(true)
            expect(p.hp).toBeLessThanOrEqual(s.config.maxHp)
          }
          // ターンとステップの記録は時系列順
          s.history.forEach((r, i) => {
            if (i === 0) return
            const prev = s.history[i - 1]
            expect(r.turn * 2 + r.step).toBeGreaterThan(prev.turn * 2 + prev.step)
          })
        }
      }),
      { numRuns: 50 },
    )
  })
  it('同じ乱数の種なら同じ対局になる', () => {
    fc.assert(
      fc.property(seedArb, fc.option(fc.tuple(deckArb, deckArb), { nil: undefined }), (seed, decks) => {
        expect(playRandom(seed, 60, decks)).toEqual(playRandom(seed, 60, decks))
      }),
      { numRuns: 20 },
    )
  })
  it('二ステップで一ターンが終わり、次のターンに進む', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        let rng = seed
        const r = () => {
          rng = (rng * 16807) % 2147483647
          return rng / 2147483647
        }
        let s = newGame(r)
        expect(turnOver(s)).toBe(false)
        s = resolveStep(s, [{ kind: 'pass' }, { kind: 'pass' }])
        expect(turnOver(s)).toBe(false)
        s = resolveStep(s, [{ kind: 'pass' }, { kind: 'pass' }])
        expect(turnOver(s)).toBe(true)
        s = nextTurn(s, r)
        expect([s.turn, s.step]).toEqual([2, 1])
      }),
      { numRuns: 20 },
    )
  })
  it('次のターンには、持ち越した目が振ったダイスの後ろに加わり、焼けた分と持ち越しは消え、凍結は残る', () => {
    fc.assert(
      fc.property(poolStateArb, seedArb, (s, seed) => {
        const next = nextTurn(s, () => (seed % 1000) / 1000)
        for (const i of [0, 1] as const) {
          const before = s.players[i]
          const after = next.players[i]
          const carried = before.carry === null ? [] : [before.carry]
          expect(after.roll.slice(DEFAULT_CONFIG.diceCount)).toEqual(carried)
          expect(after.roll).toHaveLength(DEFAULT_CONFIG.diceCount + carried.length)
          expect([after.usedDice, after.usedCards, after.burned, after.carry]).toEqual([[], [], 0, null])
          expect(after.frozen).toBe(before.frozen)
          expect(after.deck).toEqual(before.deck)
        }
      }),
    )
  })
})
