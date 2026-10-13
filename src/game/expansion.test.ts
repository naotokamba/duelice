// 拡張のカードが持ち込む決まりの例示テスト。持ち込んだ5枚、ダイスの数の変わるターン、先に当たる攻撃、
// 攻撃を返す構え、ダイスが戻る守り、置けない目、ターンの終わりに起きることを、盤を進めて確かめる。
// ステップの中のダメージは cards.test.ts の仕様表で扱う。

import { describe, expect, it } from 'vitest'
import { makeState, type SeatSetup, seeded } from '../test/helpers'
import type { ActionKind, CardId } from './cards'
import {
  actionKey,
  diceValues,
  isLegal,
  keptRow,
  legalActions,
  nextTurn,
  placeableDice,
  resolveStep,
  turnOver,
} from './rules'
import type { Action, GameState, Play } from './types'
import { WILD } from './types'

const pass: Action = { kind: 'pass' }
/** ダイスを置き場の順に置いた行動 */
const act = (kind: ActionKind, ...dice: (number | null)[]): Action => ({ kind, dice })
/** 全ての拡張のカードから5枚 */
const FIRST: CardId[] = ['meteor', 'allOut', 'lastStand', 'freeze', 'darkWall']
const SECOND: CardId[] = ['galeWard', 'thunder', 'wildfire', 'overload', 'twinDragon']
const THIRD: CardId[] = ['meditate', 'flameStrike', 'barrier', 'bullet', 'interrupt']

/** 好きな目のダイスを置いた行動。set は置き場ごとに選んだ目 */
const chosen = (kind: ActionKind, dice: (number | null)[], set: (number | null)[]): Play => ({ kind, dice, set })
/** 行動の回数を増やす行動に、一緒に使う行動を足したもの */
const along = (top: Play, ...more: Play[]): Action => ({ ...top, with: more })
/** カードの行動一つ */
const play = (kind: ActionKind, ...dice: (number | null)[]): Play => ({ kind, dice })

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
  it('双竜は好きな目の4個で使え、3個しか無ければ使えない', () => {
    const s = makeState(seat(SECOND, { roll: [1, 2, 3, 4] }), { roll: [1, 2, 3] })
    expect(isLegal(s, 0, act('twinDragon', 0, 1, 2, 3))).toBe(true)
    expect(isLegal(s, 0, act('twinDragon', 0, 1, 2, null))).toBe(false)
    expect(kinds(makeState(seat(SECOND, { roll: [2, 2, 2] }), { roll: [1, 2, 3] }), 0).has('twinDragon')).toBe(false)
  })
  it('双竜は目に関係なく効果が同じなので、4個の置き方を一つの手にまとめる', () => {
    const s = makeState(seat(SECOND, { roll: [3, 5, 5, 3] }), { roll: [1, 2, 3] })
    expect(legalActions(s, 0).filter((a) => a.kind === 'twinDragon')).toHaveLength(1)
  })
})

describe('過負荷', () => {
  const start = () => makeState(seat(SECOND, { roll: [6, 2, 2] }), { roll: [1, 2, 3] })
  it('一ステップ目だけに使え、置いた目のダイスを2個足して、二ステップ目に使える', () => {
    const s = resolveStep(start(), [act('overload', 1), pass])
    expect(s.players[0].roll).toEqual([6, 2, 2, 2, 2])
    expect(s.history[0].added).toEqual([[2, 2], []])
    // 足した2個と残りの2個で、4個置ける
    expect(isLegal(s, 0, act('twinDragon', 0, 2, 3, 4))).toBe(true)
    expect(isLegal(s, 0, act('overload', 0))).toBe(false)
    const later = makeState(seat(SECOND, { roll: [6, 2, 2] }), { roll: [1, 2, 3] }, 2)
    expect(isLegal(later, 0, act('overload', 0))).toBe(false)
  })
  it('どの目を足すかで、別の手になる', () => {
    const listed = legalActions(start(), 0).filter((a) => a.kind === 'overload')
    expect(listed.map((a) => (a.kind === 'pass' ? [] : diceValues(start().players[0], a)))).toEqual([[6], [2]])
  })
  it('ターンの終わりに、自分も2焼ける', () => {
    let s = resolveStep(start(), [act('overload', 0), pass])
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
    const s = resolveStep(makeState(seat(SECOND, { roll: [6, 2, 2], hp: 1 }), { roll: [3, 3, 1] }), [
      act('overload', 0),
      act('bullet', 0, 1),
    ])
    expect(s.winner).toBe(1)
    expect(s.history[0].endBurn).toEqual([0, 0])
  })
})

describe('延焼', () => {
  it('ターンの終わりに、このターン自分が焼けた分の倍を相手に与える。前のステップに焼けた分も数える', () => {
    const deck: CardId[] = ['wildfire', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    let s = makeState(seat(deck, { roll: [3, 5, 1] }), { roll: [1, 2, 3] })
    // 炎撃の X に3、焼ける枠に5。自分も5焼ける
    s = resolveStep(s, [act('flameStrike', 0, 1), pass])
    expect(s.players[0].burned).toBe(5)
    s = resolveStep(s, [act('wildfire', 2), act('barrier', 0)])
    const last = s.history[1]
    // 相手が守っていても減らない
    expect(last.strikes).toEqual([
      { from: 0, kind: 'wildfire', power: 10, outcome: 'hit', to: 1, dealt: 10, phase: 'end' },
    ])
    expect(s.players[1].hp).toBe(20 - 5 - 10)
  })
  it('一ステップ目に使っても、二ステップ目に焼けた分まで数える', () => {
    const deck: CardId[] = ['wildfire', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    let s = makeState(seat(deck, { roll: [3, 6, 2] }), { roll: [1, 2, 3] })
    s = resolveStep(s, [act('wildfire', 0), pass])
    expect(s.history[0].strikes).toEqual([])
    s = resolveStep(s, [act('flameStrike', 2, 1), pass])
    // 炎撃で6焼けたので、延焼は12
    expect(s.history[1].strikes.at(-1)).toMatchObject({ kind: 'wildfire', dealt: 12, phase: 'end' })
    expect(s.players[1].hp).toBe(20 - 4 - 12)
  })
  it('過負荷で焼ける分も数える', () => {
    const deck: CardId[] = ['wildfire', 'overload', 'barrier', 'bullet', 'interrupt']
    let s = makeState(seat(deck, { roll: [3, 6, 2] }), { roll: [1, 2, 3] })
    s = resolveStep(s, [act('overload', 0), pass])
    s = resolveStep(s, [act('wildfire', 1), pass])
    expect(s.history[1].endBurn).toEqual([2, 0])
    expect(s.history[1].strikes).toEqual([
      { from: 0, kind: 'wildfire', power: 4, outcome: 'hit', to: 1, dealt: 4, phase: 'end' },
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
  it('凍らせる攻撃が守りに防がれても、凍らせる目は残る', () => {
    const s = resolveStep(makeState(seat(FIRST, { roll: [4, 1, 1] }), { roll: [6, 4, 2] }), [
      act('freeze', 0),
      act('barrier', 0),
    ])
    expect(s.history[0].strikes[0]).toMatchObject({ kind: 'freeze', power: 2, outcome: 'guarded', dealt: 0 })
    expect(s.players[1].frozen).toBe(4)
  })
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
  it('相手の手元の、凍らせる目と同じ目のダイス1個につき2の威力。同じ目が無ければ攻撃しない', () => {
    const freeze = (theirs: SeatSetup, x = 0) =>
      resolveStep(makeState(seat(FIRST, { roll: [4, 1, 1] }), theirs, theirs.usedDice ? 2 : 1), [
        act('freeze', x),
        pass,
      ]).history[0]
    expect(freeze({ roll: [4, 4, 2] }).strikes).toEqual([
      { from: 0, kind: 'freeze', power: 4, outcome: 'hit', to: 1, dealt: 4, phase: 'main' },
    ])
    // 数えるのは、相手がまだ使っていないダイスだけ
    expect(freeze({ roll: [4, 4, 2], usedDice: [0] }).strikes[0]).toMatchObject({ power: 2 })
    // 同じ目が無ければ攻撃は放たれず、凍らせる目だけが残る
    const none = freeze({ roll: [6, 5, 2] })
    expect(none.strikes).toEqual([])
    expect(none.damage).toEqual([0, 0])
    // 好きな目のダイスは、目が決まっていないので数えない
    expect(freeze({ roll: [WILD, WILD, 1], usedDice: [] }, 1).strikes).toEqual([
      { from: 0, kind: 'freeze', power: 2, outcome: 'hit', to: 1, dealt: 2, phase: 'main' },
    ])
  })
  it('相手がそのステップに使う同じ目のダイスも、ステップの初めに手元にあれば数える', () => {
    const s = resolveStep(makeState(seat(FIRST, { roll: [4, 1, 1] }), { roll: [4, 4, 2] }), [
      act('freeze', 0),
      act('bullet', 0, 1),
    ])
    expect(s.history[0].strikes.find((x) => x.kind === 'freeze')).toMatchObject({ power: 4, dealt: 4 })
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
  it('一ステップ目だけに使える', () => {
    expect(isLegal(makeState(seat(deck, { roll: [3, 1, 2] }), { roll: [1, 2, 3] }, 2), 0, act('darkWall', 0))).toBe(
      false,
    )
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
    // 返す攻撃が来なかったので、置いた2と2の合計も自分が受け、焼けた分に数える
    expect(s.history[0].burn).toEqual([4, 0])
    expect(s.players[0]).toMatchObject({ hp: 12, burned: 4 })
  })
  it('返す攻撃が一つでも来れば、置いた目の分は受けない', () => {
    const deck: CardId[] = ['galeWard', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    const s = resolveStep(makeState(seat(deck, { roll: [6, 5, 1] }), { roll: [2, 3, 3] }), [
      act('galeWard', 0, 1),
      act('interrupt', 0),
    ])
    expect(s.history[0].burn).toEqual([0, 0])
    expect(s.players.map((p) => p.hp)).toEqual([20, 18])
  })
  it('先に当たる攻撃も返すので、置いた目の分は受けない', () => {
    const deck: CardId[] = ['galeWard', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    const s = resolveStep(
      makeState(seat(deck, { roll: [6, 5, 1], hp: 3 }), seat(['thunder', ...deck.slice(1)], { roll: [6, 4, 1] })),
      [act('galeWard', 0, 1), act('thunder', 0, 1)],
    )
    expect(s.history[0].strikes[0]).toMatchObject({ kind: 'thunder', outcome: 'reflected' })
    expect(s.history[0].burn).toEqual([0, 0])
  })
  it('自分の攻撃が相手の風陣に返されても、自分の風陣に返す攻撃が来なければ、置いた目の分を受ける', () => {
    const mine: CardId[] = ['doubleCast', 'galeWard', 'interrupt', 'barrier', 'flameStrike']
    const theirs: CardId[] = ['galeWard', 'flameStrike', 'barrier', 'bullet', 'interrupt']
    const s = resolveStep(makeState(seat(mine, { roll: [1, 2, 3, 4] }), seat(theirs, { roll: [1, 1, 5] })), [
      along(play('doubleCast', 0), play('galeWard', 1, 2), play('interrupt', 3)),
      act('galeWard', 0, 1),
    ])
    // 氷礫の2は相手の風陣に返され、自分の風陣には何も来ないので2と3の合計を受ける。相手は氷礫を返したので受けない
    expect(s.history[0].burn).toEqual([5, 0])
    expect(s.history[0].damage).toEqual([7, 0])
  })
  it('延焼は、風陣を外して受けた分も焼けた分として数える', () => {
    const deck: CardId[] = ['galeWard', 'wildfire', 'barrier', 'bullet', 'interrupt']
    let s = makeState(seat(deck, { roll: [3, 4, 1] }), { roll: [1, 2, 3] })
    s = resolveStep(s, [act('galeWard', 0, 1), pass])
    s = resolveStep(s, [act('wildfire', 2), pass])
    expect(s.history[1].strikes).toEqual([
      { from: 0, kind: 'wildfire', power: 14, outcome: 'hit', to: 1, dealt: 14, phase: 'end' },
    ])
  })
})

describe('反撃', () => {
  const guard: CardId[] = ['counter', 'barrier', 'galeWard', 'doubleCast', 'interrupt']
  const foe: CardId[] = ['flameStrike', 'bullet', 'thunder', 'doubleCast', 'allOut']
  /** 自分が反撃を X で構え、相手が theirs で攻める */
  const meet = (x: number, theirs: Action, roll = [6, 4, 1, 5]) =>
    resolveStep(makeState(seat(guard, { roll: [x, 2, 3] }), seat(foe, { roll })), [act('counter', 0), theirs])
      .history[0]
  it('威力6以下の攻撃を打ち消し、攻撃した相手に4返す。打ち消した攻撃はどちらにも当たらない', () => {
    // 炎撃は X に4で6。相手は自分も1焼ける
    const r = meet(5, act('flameStrike', 1, 2))
    expect(r.strikes).toEqual([
      { from: 1, kind: 'flameStrike', power: 6, outcome: 'countered', to: 0, dealt: 0, phase: 'main' },
      { from: 0, kind: 'counter', power: 4, outcome: 'returned', to: 1, dealt: 4, phase: 'main' },
    ])
    expect(r.damage).toEqual([0, 5])
    expect(r.burn).toEqual([0, 1])
  })
  it('障壁で減らない攻撃も、先に当たる攻撃も打ち消す', () => {
    expect(meet(5, act('bullet', 0, 1), [3, 3, 1]).strikes.map((x) => x.outcome)).toEqual(['countered', 'returned'])
    const fast = meet(5, act('thunder', 0, 2), [5, 4, 1])
    expect(fast.strikes).toEqual([
      { from: 1, kind: 'thunder', power: 5, outcome: 'countered', to: 0, dealt: 0, phase: 'fast' },
      { from: 0, kind: 'counter', power: 4, outcome: 'returned', to: 1, dealt: 4, phase: 'fast' },
    ])
    expect(fast.cancelled).toEqual([false, false])
  })
  it('6より大きい攻撃は打ち消さずに当たり、一つも打ち消さなければ、構えた目を自分が受ける', () => {
    // 炎撃は X に6で8
    const r = meet(5, act('flameStrike', 0, 2))
    expect(r.strikes).toEqual([
      { from: 1, kind: 'flameStrike', power: 8, outcome: 'hit', to: 0, dealt: 8, phase: 'main' },
    ])
    expect(r.burn).toEqual([5, 1])
    expect(r.damage).toEqual([13, 1])
  })
  it('攻撃が来なければ、構えた目を自分が受ける。威力0の凍結は攻撃に数えない', () => {
    expect(meet(3, pass).damage).toEqual([3, 0])
    const deck: CardId[] = ['freeze', 'bullet', 'thunder', 'doubleCast', 'allOut']
    const r = resolveStep(makeState(seat(guard, { roll: [3, 2, 1] }), seat(deck, { roll: [6, 1, 1] })), [
      act('counter', 0),
      act('freeze', 0),
    ]).history[0]
    expect(r.strikes).toEqual([])
    expect(r.damage).toEqual([3, 0])
  })
  it('二重詠唱の攻撃をいくつ打ち消しても、返すのは一度だけ', () => {
    // 相手は二重詠唱で、全開1個の1と、炎撃の4で攻める
    const r = meet(
      2,
      along(play('doubleCast', 0), play('allOut', 1, null, null, null), play('flameStrike', 2, 3)),
      [6, 4, 2, 1],
    )
    expect(r.strikes).toEqual([
      { from: 1, kind: 'allOut', power: 1, outcome: 'countered', to: 0, dealt: 0, phase: 'main' },
      { from: 1, kind: 'flameStrike', power: 4, outcome: 'countered', to: 0, dealt: 0, phase: 'main' },
      { from: 0, kind: 'counter', power: 4, outcome: 'returned', to: 1, dealt: 4, phase: 'main' },
    ])
    expect(r.damage).toEqual([0, 5])
  })
  it('二重詠唱で守りと重ねれば、打ち消せない攻撃は守りが減らし、反撃は外れる', () => {
    const s = resolveStep(makeState(seat(guard, { roll: [1, 5, 2] }), seat(foe, { roll: [6, 1, 3] })), [
      along(play('doubleCast', 0), play('counter', 2), play('barrier', 1)),
      act('flameStrike', 0, 1),
    ])
    const r = s.history[0]
    // 炎撃 8 は打ち消せず、風壁 10 に防ぎきられて3を返される。反撃は2を自分が受ける
    expect(r.strikes).toEqual([
      { from: 1, kind: 'flameStrike', power: 8, outcome: 'guarded', to: 0, dealt: 0, phase: 'main' },
      { from: 0, kind: 'barrier', power: 3, outcome: 'returned', to: 1, dealt: 3, phase: 'main' },
    ])
    expect(r.damage).toEqual([2, 4])
  })
  it('先に当たる攻撃とほかの攻撃を続けて打ち消しても、返すのは一度だけ', () => {
    const r = meet(
      5,
      along(play('doubleCast', 0), play('thunder', 1, 2), play('allOut', 3, null, null, null)),
      [6, 4, 2, 1],
    )
    expect(r.strikes.map((x) => [x.kind, x.outcome, x.phase])).toEqual([
      ['thunder', 'countered', 'fast'],
      ['counter', 'returned', 'fast'],
      ['allOut', 'countered', 'main'],
    ])
    expect(r.damage).toEqual([0, 4])
  })
  it('打ち消す構えは、相手が打ち消したのでなく、自分が打ち消したときだけ外れない', () => {
    // 二人とも二重詠唱で反撃を構えて攻める。こちらの氷礫2は相手の反撃に打ち消され、相手の炎撃8はこちらの反撃では打ち消せない
    const both: CardId[] = ['counter', 'flameStrike', 'interrupt', 'doubleCast', 'barrier']
    const s = resolveStep(makeState(seat(both, { roll: [1, 2, 3] }), seat(both, { roll: [1, 6, 1, 3] })), [
      along(play('doubleCast', 0), play('counter', 1), play('interrupt', 2)),
      along(play('doubleCast', 0), play('counter', 3), play('flameStrike', 1, 2)),
    ])
    const r = s.history[0]
    // こちらは返された4と、炎撃の8と、外した反撃の2を受ける。相手は炎撃で1焼けるだけで、反撃は外していない
    expect(r.damage).toEqual([14, 1])
  })
  it('風陣は、一緒に構えた反撃が打ち消しても、返す攻撃が来なければ外れる', () => {
    const s = resolveStep(makeState(seat(guard, { roll: [1, 3, 3, 2] }), seat(foe, { roll: [6, 4, 1, 2] })), [
      along(play('doubleCast', 0), play('counter', 3), play('galeWard', 1, 2)),
      along(play('doubleCast', 3), play('allOut', 2, null, null, null)),
    ])
    // 全開の1は打ち消して4返す。風陣に返す攻撃は来ないので、置いた3と3の合計を受ける
    expect(s.history[0].damage).toEqual([6, 4])
  })
  it('風陣と重ねれば、小さい攻撃は打ち消し、大きい攻撃は返す。どちらも外れない', () => {
    const s = resolveStep(makeState(seat(guard, { roll: [1, 3, 3, 2] }), seat(foe, { roll: [6, 4, 1, 2] })), [
      along(play('doubleCast', 0), play('counter', 3), play('galeWard', 1, 2)),
      along(play('doubleCast', 3), play('allOut', 2, null, null, null), play('flameStrike', 0, 1)),
    ])
    const r = s.history[0]
    expect(r.strikes.map((x) => [x.kind, x.outcome, x.to, x.dealt])).toEqual([
      ['allOut', 'countered', 0, 0],
      ['flameStrike', 'reflected', 1, 8],
      ['counter', 'returned', 1, 4],
    ])
    // 相手は炎撃で4焼ける
    expect(r.damage).toEqual([0, 16])
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
    // 16 失って、2 に 8 を足す
    expect(s.history[0].strikes[0]).toMatchObject({ kind: 'lastStand', power: 10 })
    expect(s.players.map((p) => p.hp)).toEqual([0, 10])
  })
})

describe('錬成', () => {
  const deck: CardId[] = ['transmute', 'flameStrike', 'meditate', 'bullet', 'allOut']
  const start = () => makeState(seat(deck, { roll: [6, 2, 2] }), { roll: [1, 2, 3] })
  it('一ステップ目だけに使え、残りのダイスを捨て、二ステップ目に好きな目のダイスを3個使う', () => {
    const s = resolveStep(start(), [act('transmute', 1), pass])
    expect(s.players[0].roll).toEqual([6, 2, 2, WILD, WILD, WILD])
    expect(s.players[0].usedDice).toEqual([0, 1, 2])
    expect(placeableDice(s.players[0])).toEqual([3, 4, 5])
    expect(isLegal(s, 0, act('transmute', 3))).toBe(false)
    const fire = chosen('flameStrike', [3, 4], [6, 1])
    expect(isLegal(s, 0, fire)).toBe(true)
    const done = resolveStep(s, [fire, pass])
    expect(done.history[1].values[0]).toEqual([6, 1])
    expect(done.history[1].damage).toEqual([1, 8])
  })
  it('好きな目のダイスは、目を選ばなければ置けず、選べるのは1から6で、置いた置き場だけに選ぶ', () => {
    const s = resolveStep(start(), [act('transmute', 1), pass])
    expect(isLegal(s, 0, act('flameStrike', 3, 4))).toBe(false)
    expect(isLegal(s, 0, chosen('flameStrike', [3, 4], [7, 1]))).toBe(false)
    expect(isLegal(s, 0, chosen('flameStrike', [3, 4], [0, 1]))).toBe(false)
    expect(isLegal(s, 0, chosen('flameStrike', [3, 4], [6]))).toBe(false)
    expect(isLegal(s, 0, chosen('allOut', [3, null, null, null], [6, 1, null, null]))).toBe(false)
    expect(isLegal(s, 0, chosen('allOut', [3, null, null, null], [6, null, null, null]))).toBe(true)
    // 振ったダイスの置き場には目を選べない
    const later = makeState(seat(deck, { roll: [5, 2, WILD], usedDice: [1] }), { roll: [1, 2, 3] }, 2)
    expect(isLegal(later, 0, chosen('flameStrike', [0, 2], [null, 1]))).toBe(true)
    expect(isLegal(later, 0, chosen('flameStrike', [0, 2], [5, 1]))).toBe(false)
  })
  it('目を選ばずに置いた好きな目のダイスは、目の決まらないダイスのまま読む', () => {
    const s = resolveStep(start(), [act('transmute', 1), pass])
    expect(diceValues(s.players[0], act('flameStrike', 3, 4))).toEqual([WILD, WILD])
  })
  it('凍らされた目は選べない', () => {
    const s = makeState(
      seat(deck, { roll: [6, 2, WILD, WILD, WILD], usedDice: [0, 1], frozen: 6 }),
      { roll: [1, 2, 3] },
      2,
    )
    expect(isLegal(s, 0, chosen('flameStrike', [2, 3], [6, 1]))).toBe(false)
    expect(isLegal(s, 0, chosen('flameStrike', [2, 3], [5, 1]))).toBe(true)
    expect(legalActions(s, 0).every((a) => a.kind === 'pass' || !(a.set ?? []).includes(6))).toBe(true)
  })
  it('合法手は、効果の同じ選び方を一つにまとめる', () => {
    const s = resolveStep(start(), [act('transmute', 1), pass])
    const count = (kind: ActionKind) => legalActions(s, 0).filter((a) => a.kind === kind).length
    // 魔弾は目に関わらず4なので一つ、全開は個数ごとに一つ、炎撃は威力と焼ける量の組ごと、瞑想は持ち越す目ごと
    expect(count('bullet')).toBe(1)
    expect(count('allOut')).toBe(3)
    expect(count('flameStrike')).toBe(36)
    expect(count('meditate')).toBe(6)
    // 風陣は、返す攻撃が来なかったときに受ける目の合計ごと。2から12まで
    const ward: CardId[] = ['transmute', 'galeWard', 'meditate', 'bullet', 'allOut']
    const w = resolveStep(makeState(seat(ward, { roll: [6, 2, 2] }), { roll: [1, 2, 3] }), [act('transmute', 1), pass])
    expect(legalActions(w, 0).filter((a) => a.kind === 'galeWard')).toHaveLength(11)
  })
  it('瞑想で持ち越すなら、選んだ目を持ち越す', () => {
    const s = resolveStep(start(), [act('transmute', 1), pass])
    const done = resolveStep(s, [chosen('meditate', [4], [6]), pass])
    expect(done.players[0].carry).toBe(6)
    expect(nextTurn(done, () => 0).players[0].roll).toEqual([1, 1, 1, 6])
  })
  it('ダイスを足す行動と一緒なら足さず、戻るダイスも含めて、そのステップの後に残ったダイスを全て捨てる', () => {
    const both: CardId[] = ['doubleCast', 'overload', 'transmute', 'darkWall', 'flameStrike']
    const s = makeState(seat(both, { roll: [1, 2, 3, 4] }), { roll: [1, 2, 3] })
    const a = along(play('doubleCast', 0), play('overload', 1), play('transmute', 2))
    const done = resolveStep(s, [a, pass])
    expect(done.history[0].added).toEqual([[], []])
    expect(done.players[0].roll).toEqual([1, 2, 3, 4, WILD, WILD, WILD])
    expect(done.players[0].usedDice).toEqual([0, 1, 2, 3])
  })
})

describe('二重詠唱', () => {
  const deck: CardId[] = ['doubleCast', 'interrupt', 'barrier', 'flameStrike', 'darkWall']
  const start = (mine: number[] = [3, 4, 5]) => makeState(seat(deck, { roll: mine }), { roll: [6, 1, 2] })
  it('一緒に使うカードは1枚から2枚で、同じカードや同じダイスは重ねられない', () => {
    const s = start([3, 4, 5, 6])
    // 表に無い行動や、置き場の形をしていない行動は合法でない。通信で届いた形が壊れていても解決しない
    const broken = (x: unknown) => isLegal(s, 0, x as Action)
    expect(broken({ kind: 'nothing', dice: [0] })).toBe(false)
    expect(broken(along(play('doubleCast', 0), { kind: 'nothing', dice: [1] } as unknown as Play))).toBe(false)
    expect(broken(along(play('doubleCast', 0), { kind: 'interrupt', dice: 1 } as unknown as Play))).toBe(false)
    expect(broken({ ...play('doubleCast', 0), with: 'interrupt' })).toBe(false)
    expect(broken({ ...play('interrupt', 0), set: 'x' })).toBe(false)
    expect(isLegal(s, 0, act('doubleCast', 0))).toBe(false)
    expect(isLegal(s, 0, along(play('doubleCast', 0)))).toBe(false)
    expect(isLegal(s, 0, along(play('doubleCast', 0), play('interrupt', 1)))).toBe(true)
    expect(isLegal(s, 0, along(play('doubleCast', 0), play('interrupt', 1), play('barrier', 2)))).toBe(true)
    expect(isLegal(s, 0, along(play('doubleCast', 0), play('interrupt', 1), play('interrupt', 2)))).toBe(false)
    expect(isLegal(s, 0, along(play('doubleCast', 0), play('interrupt', 0)))).toBe(false)
    expect(isLegal(s, 0, along(play('doubleCast', 0), play('interrupt', 1), play('barrier', 1)))).toBe(false)
    expect(
      isLegal(s, 0, along(play('doubleCast', 0), play('interrupt', 1), play('barrier', 2), play('darkWall', 3))),
    ).toBe(false)
    // 一緒に使う行動は、さらに一緒に使う行動を持てない。行動の回数を増やさないカードは一緒に使う行動を持てない
    expect(isLegal(s, 0, along(play('doubleCast', 0), { ...play('interrupt', 1), with: [] }))).toBe(false)
    expect(isLegal(s, 0, along(play('interrupt', 0), play('barrier', 1)))).toBe(false)
    // 合法手に、それ自身だけの手は無く、一緒に使う手は並ぶ
    const listed = legalActions(s, 0).filter((a) => a.kind === 'doubleCast')
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((a) => a.kind !== 'pass' && (a.with?.length ?? 0) >= 1)).toBe(true)
  })
  it('一緒に使った行動は同時に起き、カードもダイスも全て使ったことになる', () => {
    const s = resolveStep(start(), [
      along(play('doubleCast', 0), play('interrupt', 1), play('barrier', 2)),
      act('flameStrike', 0, 1),
    ])
    // 炎撃 8 は風壁 10 に防ぎきられ、3を返される。氷礫は2当たる。相手は自分も1焼ける
    expect(s.history[0].damage).toEqual([0, 6])
    expect(s.players[0].usedCards).toEqual(['doubleCast', 'interrupt', 'barrier'])
    // 二重詠唱に置いたダイスは戻る
    expect(s.players[0].usedDice).toEqual([1, 2])
  })
  it('二重詠唱に置いたダイスは、使った後に戻り、次のステップで使える。防ぎきって戻ったことにはしない', () => {
    const s = resolveStep(start(), [along(play('doubleCast', 0), play('interrupt', 1), play('barrier', 2)), pass])
    expect(s.history[0].refunded).toEqual([false, false])
    expect(placeableDice(s.players[0])).toEqual([0])
    expect(isLegal(s, 0, act('darkWall', 0))).toBe(false)
    expect(isLegal(s, 0, act('flameStrike', 0, null))).toBe(false)
    // 先に倒れて起きなかったなら、戻らない
    const down = resolveStep(
      makeState(seat(deck, { roll: [3, 4, 5], hp: 1 }), seat(['thunder', ...deck.slice(1)], { roll: [6, 1, 2] })),
      [along(play('doubleCast', 0), play('interrupt', 1)), act('thunder', 0, 1)],
    )
    expect(down.history[0].cancelled).toEqual([true, false])
    expect(down.history[0].refunded).toEqual([false, false])
    expect(down.players[0].usedDice).toEqual([])
    // 席を入れ替えても同じ
    const flipped = resolveStep(
      makeState(seat(['thunder', ...deck.slice(1)], { roll: [6, 1, 2] }), seat(deck, { roll: [3, 4, 5], hp: 1 })),
      [act('thunder', 0, 1), along(play('doubleCast', 0), play('interrupt', 1))],
    )
    expect(flipped.history[0].cancelled).toEqual([false, true])
    expect(flipped.history[0].refunded).toEqual([false, false])
  })
  it('二つの攻撃は、守りの量の残りから置いた順に減らされ、守りは一度だけ返す', () => {
    const s = resolveStep(makeState(seat(deck, { roll: [1, 6, 1, 2] }), { roll: [3, 1, 2] }), [
      along(play('doubleCast', 0), play('flameStrike', 1, 2), play('interrupt', 3)),
      act('barrier', 0),
    ])
    expect(s.history[0].strikes).toEqual([
      { from: 0, kind: 'flameStrike', power: 8, outcome: 'guarded', to: 1, dealt: 2, phase: 'main' },
      { from: 0, kind: 'interrupt', power: 2, outcome: 'guarded', to: 1, dealt: 2, phase: 'main' },
      { from: 1, kind: 'barrier', power: 3, outcome: 'returned', to: 0, dealt: 3, phase: 'main' },
    ])
    expect(s.history[0].damage).toEqual([4, 4])
  })
  it('守りを重ねると合計で減らし、戻る守りは全て防ぎきったときに、そのダイスだけ戻る', () => {
    const s = resolveStep(makeState({ roll: [6, 1, 2] }, seat(deck, { roll: [5, 2, 3] })), [
      act('flameStrike', 0, 1),
      along(play('doubleCast', 0), play('barrier', 1), play('darkWall', 2)),
    ])
    // 炎撃 8 を風壁 4 と闇壁 6 の合計 10 で防ぎきる
    expect(s.history[0].strikes.map((x) => [x.outcome, x.dealt])).toEqual([
      ['guarded', 0],
      ['returned', 3],
    ])
    expect(s.history[0].refunded).toEqual([false, true])
    // 闇壁のダイスは防ぎきって戻り、二重詠唱のダイスはいつも戻る
    expect(s.players[1].usedDice).toEqual([1])
  })
  it('一緒に使う行動の順が違っても同じ手で、合法手には一つだけ並ぶ', () => {
    const s = start()
    const ab = along(play('doubleCast', 0), play('interrupt', 1), play('barrier', 2))
    const ba = along(play('doubleCast', 0), play('barrier', 2), play('interrupt', 1))
    expect(actionKey(s, 0, ab)).toBe(actionKey(s, 0, ba))
    const both = legalActions(s, 0).filter((a) => a.kind === 'doubleCast' && a.with?.length === 2)
    expect(both.filter((a) => actionKey(s, 0, a) === actionKey(s, 0, ab))).toHaveLength(1)
  })
  it('詠唱を一緒に使えば詠唱が保たれ、発動を一緒に使えば詠唱を使い切る', () => {
    const spell: CardId[] = ['doubleCast', 'spear', 'interrupt', 'barrier', 'flameStrike']
    let s = makeState(seat(spell, { roll: [1, 2, 3, 4, 5] }), { roll: [1, 2, 3] })
    s = resolveStep(s, [along(play('doubleCast', 0), play('spearChant', 1), play('interrupt', 2)), pass])
    expect(s.players[0].chant).toBe('charged')
    expect(s.history[0].chants).toEqual(['kept', null])
    const later = makeState(
      seat(spell, { roll: [1, 2, 3, 4, 5], usedDice: [0], usedCards: ['spear'], chant: 'charged' }),
      { roll: [1, 2, 3] },
      2,
    )
    const cast = resolveStep(later, [along(play('doubleCast', 1), play('spearCast', 2, 3), play('interrupt', 4)), pass])
    expect(cast.players[0].chant).toBe('none')
    expect(cast.history[0].damage).toEqual([0, 9])
    // 詠唱で使ったカードを発動で使っても、使ったカードは一度だけ数える
    expect(cast.players[0].usedCards).toEqual(['spear', 'doubleCast', 'interrupt'])
  })
  it('守りが返すのは、先に当たる攻撃とほかの攻撃の両方を受けても一度だけ', () => {
    const fast: CardId[] = ['doubleCast', 'thunder', 'flameStrike', 'interrupt', 'barrier']
    const s = resolveStep(makeState(seat(fast, { roll: [1, 5, 1, 6, 1] }), seat(fast, { roll: [2, 1, 3] })), [
      along(play('doubleCast', 0), play('thunder', 1, 2), play('flameStrike', 3, 4)),
      act('barrier', 0),
    ])
    expect(s.history[0].strikes.map((x) => [x.kind, x.phase, x.outcome, x.dealt])).toEqual([
      ['thunder', 'fast', 'guarded', 1],
      ['barrier', 'fast', 'returned', 3],
      ['flameStrike', 'main', 'guarded', 8],
    ])
  })
  it('先に当たる攻撃で倒れたら、ほかの効果は起きない。先に当たる攻撃と一緒なら、倒した後に残りが当たる', () => {
    const fast: CardId[] = ['doubleCast', 'thunder', 'flameStrike', 'interrupt', 'barrier']
    const down = resolveStep(makeState(seat(fast, { roll: [1, 6, 1, 2], hp: 2 }), seat(fast, { roll: [5, 1, 3] })), [
      along(play('doubleCast', 0), play('flameStrike', 1, 2), play('interrupt', 3)),
      act('thunder', 0, 1),
    ])
    expect(down.history[0].cancelled).toEqual([true, false])
    expect(down.history[0].damage).toEqual([5, 0])
    // 起きなかった側は、ダイスも戻らない
    expect(down.history[0].refunded).toEqual([false, false])
    const win = resolveStep(makeState(seat(fast, { roll: [1, 5, 1, 6, 1] }), seat(fast, { roll: [6, 1, 2], hp: 3 })), [
      along(play('doubleCast', 0), play('thunder', 1, 2), play('flameStrike', 3, 4)),
      act('flameStrike', 0, 1),
    ])
    expect(win.history[0].cancelled).toEqual([false, true])
    expect(win.history[0].strikes.map((x) => [x.kind, x.phase, x.dealt])).toEqual([
      ['thunder', 'fast', 5],
      ['flameStrike', 'main', 8],
    ])
    expect(win.players[0].hp).toBe(19)
    // 先に当たる攻撃と一緒でも、先に倒されれば、先に当たる攻撃のほかは起きない
    const mixed = resolveStep(
      makeState(seat(fast, { roll: [1, 5, 1, 6, 1], hp: 2 }), seat(fast, { roll: [5, 1, 3] })),
      [along(play('doubleCast', 0), play('thunder', 1, 2), play('flameStrike', 3, 4)), act('thunder', 0, 1)],
    )
    expect(mixed.history[0].cancelled).toEqual([true, false])
    expect(mixed.history[0].strikes.map((x) => [x.from, x.kind])).toEqual([
      [0, 'thunder'],
      [1, 'thunder'],
    ])
    // 何もしなかった側も、先に当たる攻撃で倒れれば、起きなかったと記録する
    const idle = resolveStep(makeState(seat(fast, { roll: [1, 5, 1], hp: 2 }), seat(fast, { roll: [5, 1, 3] })), [
      pass,
      act('thunder', 0, 1),
    ])
    expect(idle.history[0].cancelled).toEqual([true, false])
  })
})

describe('同じ手の見分け', () => {
  const deck: CardId[] = ['interrupt', 'transmute', 'doubleCast', 'barrier', 'flameStrike']
  it('一ステップ目は残る目の組で見分け、二ステップ目と錬成の後は残るダイスを数えない', () => {
    const s = makeState(seat(deck, { roll: [1, 3, 6, 6] }), { roll: [1, 2, 3] })
    expect(actionKey(s, 0, act('interrupt', 0))).not.toBe(actionKey(s, 0, act('interrupt', 2)))
    expect(actionKey(s, 0, act('interrupt', 2))).toBe(actionKey(s, 0, act('interrupt', 3)))
    const forged = (d: number) => along(play('doubleCast', 3), play('transmute', d))
    expect(actionKey(s, 0, forged(0))).toBe(actionKey(s, 0, forged(2)))
    const later = { ...s, step: 2 as const }
    expect(actionKey(later, 0, act('interrupt', 0))).toBe(actionKey(later, 0, act('interrupt', 2)))
    expect(legalActions(later, 0).filter((a) => a.kind === 'interrupt')).toHaveLength(1)
  })
})

describe('残響', () => {
  const deck: CardId[] = ['echo', 'flameStrike', 'doubleCast', 'interrupt', 'barrier']
  it('直前のステップに起こした効果を、同じ目でもう一度出す。払うのは残響のダイス1個だけ', () => {
    let s = makeState(seat(deck, { roll: [6, 2, 4] }), { roll: [1, 2, 3] })
    expect(isLegal(s, 0, act('echo', 2))).toBe(false)
    s = resolveStep(s, [act('flameStrike', 0, 1), pass])
    expect(s.players[0].last).toEqual([{ kind: 'flameStrike', vals: [6, 2] }])
    s = resolveStep(s, [act('echo', 2), pass])
    const r = s.history[1]
    expect(r.moves[0]).toEqual([{ kind: 'flameStrike', vals: [6, 2], echoed: true }])
    expect(r.damage).toEqual([2, 8])
    expect(s.players[0].usedCards).toEqual(['flameStrike', 'echo'])
    expect(s.players[0].usedDice).toEqual([0, 1, 2])
    // もう一度出した効果も、直前の効果として残る
    expect(s.players[0].last).toEqual([{ kind: 'flameStrike', vals: [6, 2] }])
  })
  it('一ステップ目なら前のターンの二ステップ目が直前で、使えるステップや詠唱の条件を受けない', () => {
    const cast = makeState(seat(deck, { roll: [1, 2, 3], last: [{ kind: 'spearCast', vals: [6, 5] }] }), {
      roll: [1, 2, 3],
    })
    const s = resolveStep(cast, [act('echo', 0), act('barrier', 2)])
    expect(s.history[0].strikes).toEqual([
      { from: 0, kind: 'spearCast', power: 11, outcome: 'pierced', to: 1, dealt: 11, phase: 'main' },
    ])
    const meteor = makeState(
      seat(deck, {
        roll: [1, 2, 3],
        usedDice: [0],
        usedCards: ['interrupt'],
        last: [{ kind: 'meteor', vals: [6, 6, 5] }],
      }),
      { roll: [1, 2, 3] },
      2,
    )
    expect(resolveStep(meteor, [act('echo', 1), pass]).history[0].damage).toEqual([0, 17])
  })
  it('同じ効果と同じ残りのダイスでも、残響で出すのとカードで出すのは別の手。使ったカードが違うので後の盤が違う', () => {
    // 前のステップの風壁 3 を、残響に 3 を置いて繰り返すのと、風壁に 3 を置くのは、効果も残る 3 と 5 も同じ
    const s = makeState(seat(deck, { roll: [3, 3, 5], last: [{ kind: 'barrier', vals: [3] }] }), { roll: [1, 2, 3] })
    const both = legalActions(s, 0).filter(
      (a) => a.kind !== 'pass' && a.with === undefined && diceValues(s.players[0], a).join() === '3',
    )
    expect(new Set(both.map((a) => a.kind))).toEqual(new Set(['echo', 'barrier', 'interrupt']))
  })
  it('何もしなかったステップの後は、繰り返すものが無いので使えない', () => {
    let s = makeState(seat(deck, { roll: [1, 2, 3], last: [{ kind: 'interrupt', vals: [2] }] }), { roll: [1, 2, 3] })
    expect(isLegal(s, 0, act('echo', 0))).toBe(true)
    s = resolveStep(s, [pass, pass])
    expect(s.players[0].last).toEqual([])
    expect(isLegal(s, 0, act('echo', 0))).toBe(false)
    expect(kinds(s, 0).has('echo')).toBe(false)
  })
  it('二重詠唱で一緒に使った効果を全て繰り返し、二重詠唱そのものは繰り返さない', () => {
    let s = makeState(seat(deck, { roll: [1, 2, 3, 4] }), { roll: [6, 1, 2] })
    s = resolveStep(s, [along(play('doubleCast', 0), play('interrupt', 1), play('barrier', 2)), pass])
    expect(s.players[0].last).toEqual([
      { kind: 'interrupt', vals: [2] },
      { kind: 'barrier', vals: [3] },
    ])
    s = resolveStep(s, [act('echo', 3), act('flameStrike', 0, 1)])
    // 氷礫の2が当たり、風壁 6 が炎撃 8 を 2 まで減らして3を返す
    expect(s.history[1].damage).toEqual([2, 2 + 1 + 3])
  })
  it('威力は今の体力で決め直し、ターンの終わりに起きることも出した分だけ起きる', () => {
    const hurt = makeState(
      seat(['echo', 'lastStand', 'wildfire', 'overload', 'transmute'], {
        roll: [1, 2, 3],
        hp: 8,
        last: [{ kind: 'lastStand', vals: [5, 1] }],
      }),
      { roll: [1, 2, 3] },
    )
    // 12 失って、2 に 6 を足す
    expect(resolveStep(hurt, [act('echo', 0), pass]).history[0].strikes[0]).toMatchObject({ power: 8 })
    const end = makeState(
      seat(['echo', 'lastStand', 'wildfire', 'overload', 'transmute'], {
        roll: [1, 2, 3, 4, 5],
        usedDice: [0],
        usedCards: ['overload'],
        burned: 1,
        last: [
          { kind: 'overload', vals: [1] },
          { kind: 'wildfire', vals: [4] },
        ],
      }),
      { roll: [1, 2, 3] },
      2,
    )
    const s = resolveStep(end, [act('echo', 1), pass])
    const r = s.history[0]
    // 二ステップ目にダイスを足しても次のステップが無いので足さない
    expect(r.added).toEqual([[], []])
    // 過負荷は使った分ともう一度出した分で2回焼け、延焼はこのターンに焼けた分の倍を与える
    expect(r.endBurn).toEqual([4, 0])
    expect(r.strikes.filter((x) => x.phase === 'end')).toEqual([
      { from: 0, kind: 'wildfire', power: 10, outcome: 'hit', to: 1, dealt: 10, phase: 'end' },
    ])
    const twice = makeState(
      seat(['echo', 'lastStand', 'wildfire', 'overload', 'transmute'], {
        roll: [1, 2, 3],
        usedDice: [0],
        usedCards: ['wildfire'],
        burned: 3,
        last: [{ kind: 'wildfire', vals: [1] }],
      }),
      { roll: [1, 2, 3] },
      2,
    )
    const t = resolveStep(twice, [act('echo', 1), pass])
    expect(t.history[0].strikes.filter((x) => x.phase === 'end').map((x) => x.dealt)).toEqual([6, 6])
    expect(t.players[1].hp).toBe(8)
  })
  it('二ステップ目に錬成をもう一度出しても、次のステップが無いので何も起きない', () => {
    const s = makeState(
      seat(['echo', 'transmute', 'flameStrike', 'barrier', 'interrupt'], {
        roll: [1, 2, 3],
        usedDice: [0],
        usedCards: ['transmute'],
        last: [{ kind: 'transmute', vals: [1] }],
      }),
      { roll: [1, 2, 3] },
      2,
    )
    const done = resolveStep(s, [act('echo', 1), pass])
    expect(done.players[0].roll).toEqual([1, 2, 3])
    expect(done.players[0].usedDice).toEqual([0, 1])
  })
  it('詠唱をもう一度出せば詠唱が保たれ、凍結や持ち越しが重なれば大きい目になる', () => {
    const chant = makeState(seat(deck, { roll: [1, 2, 3], last: [{ kind: 'spearChant', vals: [1] }] }), {
      roll: [1, 2, 3],
    })
    const spear: CardId[] = ['echo', 'spear', 'freeze', 'doubleCast', 'meditate']
    const c = resolveStep({ ...chant, players: [{ ...chant.players[0], deck: spear }, chant.players[1]] }, [
      act('echo', 0),
      pass,
    ])
    expect(c.players[0].chant).toBe('charged')
    expect(isLegal(c, 0, act('spearCast', 1, 2))).toBe(true)
    const both = makeState(
      seat(spear, {
        roll: [1, 2, 3, 4],
        last: [
          { kind: 'freeze', vals: [5] },
          { kind: 'meditate', vals: [6] },
        ],
      }),
      { roll: [1, 2, 3] },
    )
    const s = resolveStep(both, [along(play('doubleCast', 0), play('echo', 1), play('freeze', 2)), pass])
    expect(s.players[1].frozen).toBe(5)
    expect(s.players[0].carry).toBe(6)
    const low = resolveStep(both, [along(play('doubleCast', 0), play('echo', 1), play('meditate', 3)), pass])
    expect(low.players[0].carry).toBe(6)
  })
})
