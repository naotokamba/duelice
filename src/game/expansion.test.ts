// 拡張のカードが持ち込む決まりの例示テスト。持ち込んだ5枚、ダイスの数の変わるターン、先に当たる攻撃、
// 攻撃を返す構え、ダイスが戻る守り、置けない目、ターンの終わりに起きることを、盤を進めて確かめる。
// ステップの中のダメージは cards.test.ts の仕様表で扱う。

import { describe, expect, it } from 'vitest'
import { makeState, type SeatSetup, seeded } from '../test/helpers'
import type { ActionKind, CardId } from './cards'
import { isLegal, isTwoPairs, keptRow, legalActions, nextTurn, placeableDice, resolveStep, turnOver } from './rules'
import type { Action, GameState } from './types'

const pass: Action = { kind: 'pass' }
/** ダイスを置き場の順に置いた行動 */
const act = (kind: ActionKind, ...dice: (number | null)[]): Action => ({ kind, dice })
/** 全ての拡張のカードから5枚 */
const FIRST: CardId[] = ['meteor', 'allOut', 'lastStand', 'freeze', 'darkWall']
const SECOND: CardId[] = ['galeWard', 'thunder', 'wildfire', 'overload', 'twinDragon']
const THIRD: CardId[] = ['meditate', 'flameStrike', 'barrier', 'bullet', 'interrupt']

/** 5枚を持ち込んだ席 */
const seat = (deck: CardId[], setup: SeatSetup): SeatSetup => ({ ...setup, deck })
const kinds = (s: GameState, who: 0 | 1) => new Set(legalActions(s, who).map((a) => a.kind))

describe('持ち込んだ5枚', () => {
  it('選べる行動は、持ち込んだ5枚の行動だけ', () => {
    const s = makeState(seat(FIRST, { roll: [6, 6, 6] }), { roll: [6, 6, 6] })
    expect(kinds(s, 0)).toEqual(new Set(['pass', 'meteor', 'allOut', 'lastStand', 'freeze', 'darkWall']))
    expect(isLegal(s, 0, act('bullet', 0, 1))).toBe(false)
    expect(isLegal(s, 1, act('meteor', 0, 1, 2))).toBe(false)
    expect(kinds(s, 1)).toEqual(new Set(['pass', 'flameStrike', 'barrier', 'bullet', 'spearChant', 'interrupt']))
  })
  it('合法手は、持ち込んだ5枚の並びの順に並ぶ', () => {
    const s = makeState(seat(['interrupt', 'barrier', 'meteor', 'freeze', 'allOut'], { roll: [1, 2, 3] }), {
      roll: [1, 2, 3],
    })
    const order = [...new Set(legalActions(s, 0).map((a) => a.kind))]
    expect(order).toEqual(['pass', 'interrupt', 'barrier', 'meteor', 'freeze', 'allOut'])
  })
})

describe('ダイスの数', () => {
  it('隕石は一ステップ目に3個を全て置くときだけ使える', () => {
    const s = makeState(seat(FIRST, { roll: [6, 5, 4] }), { roll: [1, 2, 3] })
    expect(isLegal(s, 0, act('meteor', 0, 1, 2))).toBe(true)
    expect(isLegal(s, 0, act('meteor', 0, 1, null))).toBe(false)
    const later = makeState(seat(FIRST, { roll: [6, 5, 4, 3] }), { roll: [1, 2, 3] }, 2)
    expect(isLegal(later, 0, act('meteor', 0, 1, 2))).toBe(false)
  })
  it('全開は1個から4個まで置け、4個目は4個以上あるときだけ', () => {
    const three = makeState(seat(FIRST, { roll: [6, 5, 4] }), { roll: [1, 2, 3] })
    const counts = (s: GameState) =>
      legalActions(s, 0)
        .filter((a) => a.kind === 'allOut')
        .map((a) => (a.kind === 'pass' ? 0 : a.dice.filter((d) => d !== null).length))
    expect(new Set(counts(three))).toEqual(new Set([1, 2, 3]))
    const four = makeState(seat(FIRST, { roll: [6, 5, 4, 3] }), { roll: [1, 2, 3] })
    expect(new Set(counts(four))).toEqual(new Set([1, 2, 3, 4]))
    expect(isLegal(four, 0, act('allOut', 0, 1, 2, 3))).toBe(true)
    expect(isLegal(four, 0, act('allOut', null, 1, 2, 3))).toBe(false)
  })
  it('双竜は4個の二組のゾロ目で使え、4個とも同じ目でもよい', () => {
    expect(isTwoPairs([3, 5, 3, 5])).toBe(true)
    expect(isTwoPairs([2, 2, 2, 2])).toBe(true)
    expect(isTwoPairs([2, 2, 2, 5])).toBe(false)
    expect(isTwoPairs([1, 2, 3, 4])).toBe(false)
    expect(isTwoPairs([4, 4, 4])).toBe(false)
    expect(isTwoPairs([1, 1, 2, 2, 3])).toBe(false)
    const s = makeState(seat(SECOND, { roll: [3, 5, 5, 3] }), { roll: [1, 2, 3] })
    expect(isLegal(s, 0, act('twinDragon', 0, 1, 2, 3))).toBe(true)
    const odd = makeState(seat(SECOND, { roll: [3, 5, 5, 4] }), { roll: [1, 2, 3] })
    expect(isLegal(odd, 0, act('twinDragon', 0, 1, 2, 3))).toBe(false)
    // 3個しか無ければ使えない
    expect(kinds(makeState(seat(SECOND, { roll: [2, 2, 2] }), { roll: [1, 2, 3] }), 0).has('twinDragon')).toBe(false)
  })
  it('二組のゾロ目は、組の入れ替えを一つの手にまとめる', () => {
    const s = makeState(seat(SECOND, { roll: [3, 5, 5, 3] }), { roll: [1, 2, 3] })
    expect(legalActions(s, 0).filter((a) => a.kind === 'twinDragon')).toHaveLength(1)
  })
})

describe('過負荷', () => {
  const start = () => makeState(seat(SECOND, { roll: [6, 2, 2] }), { roll: [1, 2, 3] })
  it('一ステップ目だけに使え、ダイスを2個振り足して、二ステップ目に使える', () => {
    const s = resolveStep(start(), [act('overload', 0), pass], [[3, 3], []])
    expect(s.players[0].roll).toEqual([6, 2, 2, 3, 3])
    expect(s.history[0].extra).toEqual([[3, 3], []])
    // 振り足した2個と残りの2個で、二組のゾロ目になる
    expect(isLegal(s, 0, act('twinDragon', 1, 2, 3, 4))).toBe(true)
    expect(isLegal(s, 0, act('overload', 1))).toBe(false)
    const later = makeState(seat(SECOND, { roll: [6, 2, 2] }), { roll: [1, 2, 3] }, 2)
    expect(isLegal(later, 0, act('overload', 0))).toBe(false)
  })
  it('振り足すダイスの数が合わなければ解決しない', () => {
    expect(() => resolveStep(start(), [act('overload', 0), pass])).toThrow('振り足すダイスの数が違う')
    expect(() => resolveStep(start(), [act('overload', 0), pass], [[3], []])).toThrow()
    expect(() => resolveStep(start(), [pass, pass], [[3, 3], []])).toThrow()
  })
  it('ターンの終わりに、振り足した分だけ自分も焼ける', () => {
    let s = resolveStep(start(), [act('overload', 0), pass], [[3, 3], []])
    expect(s.players[0].hp).toBe(20)
    s = resolveStep(s, [act('twinDragon', 1, 2, 3, 4), pass])
    const last = s.history[1]
    expect(last.endBurn).toEqual([2, 0])
    expect(last.damage).toEqual([2, 20])
    expect(s.players[0].hp).toBe(18)
    expect(s.players[0].burned).toBe(2)
    expect(s.winner).toBe(0)
  })
  it('一ステップ目に倒れれば、ターンの終わりは来ない', () => {
    const s = resolveStep(
      makeState(seat(SECOND, { roll: [6, 2, 2], hp: 1 }), { roll: [3, 3, 1] }),
      [act('overload', 0), act('bullet', 0, 1)],
      [[1, 1], []],
    )
    expect(s.winner).toBe(1)
    expect(s.history[0].endBurn).toEqual([0, 0])
  })
})

describe('延焼', () => {
  it('ターンの終わりに、このターン自分が焼けた分を相手に与える。前のステップに焼けた分も数える', () => {
    const deck: CardId[] = ['wildfire', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    let s = makeState(seat(deck, { roll: [3, 5, 1] }), { roll: [1, 2, 3] })
    // 炎撃の X に3、焼ける枠に5。自分も5焼ける
    s = resolveStep(s, [act('flameStrike', 0, 1), pass])
    expect(s.players[0].burned).toBe(5)
    s = resolveStep(s, [act('wildfire', 2), act('barrier', 0)])
    const last = s.history[1]
    // 相手が守っていても減らない
    expect(last.strikes).toEqual([
      { from: 0, kind: 'wildfire', power: 5, outcome: 'hit', to: 1, dealt: 5, phase: 'end' },
    ])
    expect(s.players[1].hp).toBe(20 - 5 - 5)
  })
  it('一ステップ目に使っても、二ステップ目に焼けた分まで数える', () => {
    const deck: CardId[] = ['wildfire', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    let s = makeState(seat(deck, { roll: [3, 6, 2] }), { roll: [1, 2, 3] })
    s = resolveStep(s, [act('wildfire', 0), pass])
    expect(s.history[0].strikes).toEqual([])
    s = resolveStep(s, [act('flameStrike', 2, 1), pass])
    // 炎撃で6焼けたので、延焼は6
    expect(s.history[1].strikes.at(-1)).toMatchObject({ kind: 'wildfire', dealt: 6, phase: 'end' })
    expect(s.players[1].hp).toBe(20 - 4 - 6)
  })
  it('過負荷で焼ける分も数える', () => {
    const deck: CardId[] = ['wildfire', 'overload', 'barrier', 'bullet', 'interrupt']
    let s = makeState(seat(deck, { roll: [3, 6, 2] }), { roll: [1, 2, 3] })
    s = resolveStep(s, [act('overload', 0), pass], [[4, 4], []])
    s = resolveStep(s, [act('wildfire', 1), pass])
    expect(s.history[1].endBurn).toEqual([2, 0])
    expect(s.history[1].strikes).toEqual([
      { from: 0, kind: 'wildfire', power: 2, outcome: 'hit', to: 1, dealt: 2, phase: 'end' },
    ])
  })
  it('焼けていなければ0を与え、次のターンには焼けた分を数え直す', () => {
    const deck: CardId[] = ['wildfire', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    let s = makeState(seat(deck, { roll: [3, 6, 2], burned: 0 }), { roll: [1, 2, 3] })
    s = resolveStep(s, [act('wildfire', 0), pass])
    s = resolveStep(s, [pass, pass])
    expect(s.history[1].strikes).toEqual([
      { from: 0, kind: 'wildfire', power: 0, outcome: 'hit', to: 1, dealt: 0, phase: 'end' },
    ])
    const burnt = makeState(seat(deck, { roll: [3, 6, 2], burned: 7 }), { roll: [1, 2, 3] }, 2)
    expect(nextTurn(resolveStep(burnt, [pass, pass]), seeded(1)).players[0].burned).toBe(0)
  })
  it('使っていなければ、焼けていてもターンの終わりに何も起きない', () => {
    const s = resolveStep(makeState({ roll: [3, 6, 2], burned: 4 }, { roll: [1, 2, 3] }, 2), [pass, pass])
    expect(s.history[0].strikes).toEqual([])
    expect(s.history[0].damage).toEqual([0, 0])
  })
})

describe('凍結', () => {
  it('一ステップ目に凍らせた目は、相手が二ステップ目に置けない', () => {
    let s = makeState(seat(FIRST, { roll: [4, 1, 1] }), { roll: [4, 4, 2] })
    s = resolveStep(s, [act('freeze', 0), pass])
    expect(s.players[1].frozen).toBe(4)
    expect(placeableDice(s.players[1])).toEqual([2])
    expect(isLegal(s, 1, act('bullet', 0, 1))).toBe(false)
    expect(isLegal(s, 1, act('interrupt', 2))).toBe(true)
    // 凍らせた側は置ける
    expect(s.players[0].frozen).toBeNull()
    // 二ステップ目を解決すると、凍結は解ける
    s = resolveStep(s, [pass, act('interrupt', 2)])
    expect(s.players[1].frozen).toBeNull()
  })
  it('二ステップ目に凍らせた目は、次のターンの一ステップ目に置けない。そのステップが終われば解ける', () => {
    let s = makeState(seat(FIRST, { roll: [6, 1, 3] }), { roll: [5, 5, 5] }, 2)
    s = resolveStep(s, [act('freeze', 0), pass])
    s = nextTurn(s, () => 0.99)
    expect(s.players[1].roll).toEqual([6, 6, 6])
    expect(s.players[1].frozen).toBe(6)
    expect(legalActions(s, 1)).toEqual([pass])
    s = resolveStep(s, [pass, pass])
    expect(s.players[1].frozen).toBeNull()
    expect(legalActions(s, 1).length).toBeGreaterThan(1)
  })
  it('凍らせた目は印の置き場の目', () => {
    const s = resolveStep(makeState(seat(FIRST, { roll: [2, 5, 3] }), { roll: [1, 2, 3] }), [act('freeze', 1), pass])
    expect(s.players[1].frozen).toBe(5)
  })
  it('凍らされた目のダイスは、まだ使っていなくても置き場の候補にならない', () => {
    const s = makeState({ roll: [3, 3, 3], frozen: 3 }, { roll: [1, 2, 3] })
    expect(placeableDice(s.players[0])).toEqual([])
    expect(legalActions(s, 0)).toEqual([pass])
  })
})

describe('闇壁', () => {
  const deck: CardId[] = ['darkWall', 'flameStrike', 'barrier', 'bullet', 'interrupt']
  it('障壁で減る攻撃を防ぎきったら、置いたダイスが戻り、次のステップで使える', () => {
    let s = makeState(seat(deck, { roll: [3, 1, 2] }), { roll: [3, 1, 2] })
    s = resolveStep(s, [act('darkWall', 0), act('flameStrike', 0, 1)])
    expect(s.history[0].refunded).toEqual([true, false])
    expect(s.players[0].usedDice).toEqual([])
    expect(s.players[0].usedCards).toEqual(['darkWall'])
    expect(s.players[0].hp).toBe(20)
    // 戻ったダイスはカードに残らない
    expect(keptRow(s, 0)).toBeNull()
    expect(keptRow(s, 1)).not.toBeNull()
    expect(isLegal(s, 0, act('flameStrike', 0, 1))).toBe(true)
    expect(isLegal(s, 0, act('darkWall', 0))).toBe(false)
  })
  it('超えられたら戻らない', () => {
    const s = resolveStep(makeState(seat(deck, { roll: [1, 1, 2] }), { roll: [6, 1, 2] }), [
      act('darkWall', 0),
      act('flameStrike', 0, 1),
    ])
    expect(s.history[0].refunded).toEqual([false, false])
    expect(s.players[0].usedDice).toEqual([0])
    expect(keptRow(s, 0)).toMatchObject({ kind: 'darkWall', slots: [0] })
  })
  it('攻撃が来なかったときも、すり抜けられたときも戻らない', () => {
    const start = makeState(seat(deck, { roll: [6, 1, 2] }), { roll: [4, 4, 2] })
    for (const theirs of [pass, act('bullet', 0, 1), act('barrier', 0)]) {
      const s = resolveStep(start, [act('darkWall', 0), theirs])
      expect(s.history[0].refunded[0]).toBe(false)
      expect(s.players[0].usedDice).toEqual([0])
    }
  })
})

describe('風陣', () => {
  it('受けた攻撃は、攻撃した側に当たったと記録する', () => {
    const deck: CardId[] = ['galeWard', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    const s = resolveStep(makeState(seat(deck, { roll: [2, 2, 1] }), { roll: [6, 1, 3] }), [
      act('galeWard', 0, 1),
      act('flameStrike', 0, 1),
    ])
    expect(s.history[0].strikes).toEqual([
      { from: 1, kind: 'flameStrike', power: 8, outcome: 'reflected', to: 1, dealt: 8, phase: 'main' },
    ])
    expect(s.players.map((p) => p.hp)).toEqual([20, 11])
  })
  it('障壁で減らない攻撃は返さず、構えをすり抜けたと記録する', () => {
    const deck: CardId[] = ['galeWard', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    const s = resolveStep(makeState(seat(deck, { roll: [2, 2, 1] }), { roll: [6, 6, 3] }), [
      act('galeWard', 0, 1),
      act('bullet', 0, 1),
    ])
    expect(s.history[0].strikes).toEqual([
      { from: 1, kind: 'bullet', power: 4, outcome: 'pierced', to: 0, dealt: 4, phase: 'main' },
    ])
  })
})

describe('迅雷', () => {
  const deck: CardId[] = ['thunder', 'flameStrike', 'barrier', 'bullet', 'interrupt']
  it('先に当たって倒せば、相手の行動は起きない。詠唱も記録されない', () => {
    const s = resolveStep(makeState(seat(deck, { roll: [6, 1, 3] }), { roll: [4, 1, 2], hp: 6 }), [
      act('thunder', 0, 1),
      { kind: 'spearChant', dice: [0] },
    ])
    expect(s.history[0].cancelled).toEqual([false, true])
    expect(s.history[0].chants).toEqual([null, null])
    expect(s.players[1].usedCards).toEqual([])
    expect(s.players[1].chant).toBe('none')
    expect(s.winner).toBe(0)
  })
  it('先に当たる攻撃は、ほかの攻撃より前に記録する', () => {
    const s = resolveStep(makeState(seat(deck, { roll: [3, 1, 3] }), seat(deck, { roll: [6, 1, 2] })), [
      act('flameStrike', 0, 1),
      act('thunder', 0, 1),
    ])
    expect(s.history[0].strikes.map((x) => [x.from, x.phase])).toEqual([
      [1, 'fast'],
      [0, 'main'],
    ])
    expect(s.history[0].cancelled).toEqual([false, false])
  })
  it('守りに削られても倒しきれば、相手の守りが返した分は受ける', () => {
    const s = resolveStep(makeState(seat(deck, { roll: [6, 1, 3], hp: 3 }), { roll: [1, 2, 3], hp: 1 }), [
      act('thunder', 0, 1),
      act('barrier', 0),
    ])
    // 6 を風壁の2が減らして4。相手は倒れるが、構えは先に当たる攻撃にも効いて3を返す
    expect(s.history[0].strikes.map((x) => x.outcome)).toEqual(['guarded', 'returned'])
    expect(s.players.map((p) => p.hp)).toEqual([0, -3])
    expect(s.winner).toBe(0)
  })
  it('互いに迅雷なら同時に当たり、どちらの行動も起きる', () => {
    const s = resolveStep(makeState(seat(deck, { roll: [6, 1, 3], hp: 4 }), seat(deck, { roll: [5, 1, 2], hp: 4 })), [
      act('thunder', 0, 1),
      act('thunder', 0, 1),
    ])
    expect(s.history[0].cancelled).toEqual([false, false])
    expect(s.players.map((p) => p.hp)).toEqual([-1, -2])
    expect(s.winner).toBe(0)
  })
  it('風陣に返された迅雷で倒れても、迅雷を放った行動は起きている', () => {
    const s = resolveStep(
      makeState(seat(deck, { roll: [6, 1, 3], hp: 6 }), seat(['galeWard', ...deck.slice(1)], { roll: [2, 2, 1] })),
      [act('thunder', 0, 1), act('galeWard', 0, 1)],
    )
    expect(s.history[0].cancelled).toEqual([false, false])
    expect(s.players[0].usedCards).toEqual(['thunder'])
    expect(s.winner).toBe(1)
  })
})

describe('瞑想', () => {
  it('置いたダイスを目ごと次のターンへ持ち越し、次のターンは振った3個の後ろに加わる', () => {
    let s = makeState(seat(THIRD, { roll: [6, 1, 3] }), { roll: [1, 2, 3] })
    s = resolveStep(s, [pass, pass])
    s = resolveStep(s, [act('meditate', 0), pass])
    expect(s.players[0].carry).toBe(6)
    expect(turnOver(s)).toBe(true)
    s = nextTurn(s, () => 0)
    expect(s.players[0].roll).toEqual([1, 1, 1, 6])
    expect(s.players[1].roll).toEqual([1, 1, 1])
    expect(s.players[0].carry).toBeNull()
    // 持ち越したダイスも使える
    expect(isLegal(s, 0, act('flameStrike', 3, 0))).toBe(true)
  })
  it('一ステップ目に瞑想しても、持ち越すのは次のターン', () => {
    let s = makeState(seat(THIRD, { roll: [5, 1, 3] }), { roll: [1, 2, 3] })
    s = resolveStep(s, [act('meditate', 0), pass])
    expect(s.players[0].roll).toEqual([5, 1, 3])
    expect(s.players[0].usedDice).toEqual([0])
    s = nextTurn(resolveStep(s, [pass, pass]), () => 0)
    expect(s.players[0].roll).toEqual([1, 1, 1, 5])
  })
})

describe('背水', () => {
  it('解決する前の体力から威力を決める', () => {
    const deck: CardId[] = ['lastStand', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    const s = resolveStep(makeState(seat(deck, { roll: [3, 1, 2], hp: 4 }), { roll: [6, 6, 1] }), [
      act('lastStand', 0, 1),
      act('bullet', 0, 1),
    ])
    // 16 失って 4 増える
    expect(s.history[0].strikes[0]).toMatchObject({ kind: 'lastStand', power: 7 })
    expect(s.players.map((p) => p.hp)).toEqual([0, 13])
  })
})
