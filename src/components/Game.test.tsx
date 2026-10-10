// @vitest-environment happy-dom
// 画面の操作の流れのテスト。出目は乱数を差し替えて固定し、相手の手も差し替える。

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { Action, Rng } from '../game/types'
import { seeded } from '../test/helpers'
import { Game, type Opponent } from './Game'

afterEach(cleanup)

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

async function start(props: Parameters<typeof Game>[0], level?: string) {
  const user = userEvent.setup()
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
    expect(screen.getByText('1ターン目 一ステップ目')).toBeTruthy()
    expect(mySeat().getByLabelText('体力 20 / 20')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 20 / 20')).toBeTruthy()
  })
})

describe('一ターンの流れ', () => {
  it('カードとダイスを選んで公開し、二ステップ目、次のターンへ進む', async () => {
    const user = await start({
      rng: dice([
        [6, 6, 2],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    const decide = button('決定して公開')
    expect(screen.getByText('カードを選んでください')).toBeTruthy()
    expect((decide as HTMLButtonElement).disabled).toBe(true)

    await user.click(mySeat().getByRole('button', { name: '火球' }))
    expect(screen.getByText('火球：ダイスを2個選んでください')).toBeTruthy()
    const [d0, d1] = mySeat().getAllByRole('button', { name: '6の目' })
    await user.click(d0)
    await user.click(d1)
    expect(screen.getByText('火球：6と6、6点')).toBeTruthy()
    expect((decide as HTMLButtonElement).disabled).toBe(false)

    await user.click(decide)
    expect(screen.getByText('1ターン目 一ステップ目 公開')).toBeTruthy()
    expect(screen.getByText('あなたの火球 6点')).toBeTruthy()
    expect(cpuSeat().getByLabelText('体力 14 / 20')).toBeTruthy()

    await user.click(button('二ステップ目へ'))
    expect(screen.getByText('1ターン目 二ステップ目')).toBeTruthy()
    // 使ったカードとダイスは選べない
    const used = mySeat().getByRole('button', { name: '火球、このターンは使用済み' }) as HTMLButtonElement
    expect(used.disabled).toBe(true)
    expect(mySeat().getAllByRole('img', { name: '6の目、使用済み' })).toHaveLength(2)
    await user.click(mySeat().getByRole('button', { name: '魔弾' }))
    const usedDice = mySeat().getAllByRole('button', { name: '6の目、使用済み' }) as HTMLButtonElement[]
    expect(usedDice.map((d) => d.disabled)).toEqual([true, true])
    await user.click(mySeat().getByRole('button', { name: '魔弾' }))

    await user.click(button('何もしない'))
    await user.click(button('次のターンへ'))
    expect(screen.getByText('2ターン目 一ステップ目')).toBeTruthy()
    expect(mySeat().getByRole('button', { name: '火球' })).toBeTruthy()
  })

  it('置けるダイスの数を超えて選べず、カードを選び直すと選択が消える', async () => {
    const user = await start({
      rng: dice([
        [4, 5, 6],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await user.click(mySeat().getByRole('button', { name: '障壁' }))
    await user.click(mySeat().getByRole('button', { name: '4の目' }))
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    expect(screen.getByText('障壁：4、受ける攻撃を4減らす')).toBeTruthy()

    await user.click(mySeat().getByRole('button', { name: '4の目' }))
    expect(screen.getByText('障壁：ダイスを1個選んでください')).toBeTruthy()

    await user.click(mySeat().getByRole('button', { name: '6の目' }))
    await user.click(mySeat().getByRole('button', { name: '魔弾' }))
    expect(screen.getByText('魔弾：ダイスを1個か2個選んでください')).toBeTruthy()
    await user.click(mySeat().getByRole('button', { name: '魔弾' }))
    expect(screen.getByText('カードを選んでください')).toBeTruthy()
  })

  it('ゾロ目が無いと反射は選べない', async () => {
    await start({
      rng: dice([
        [1, 2, 3],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    const reflect = mySeat().getByRole('button', { name: '反射、今は使えない' }) as HTMLButtonElement
    expect(reflect.disabled).toBe(true)
  })

  it('詠唱が保たれると表示され、二ステップ目に雷槍を発動できる', async () => {
    const user = await start({
      rng: dice([
        [5, 6, 6],
        [1, 2, 3],
      ]),
      opponent: passOpponent,
    })
    await user.click(mySeat().getByRole('button', { name: '雷槍' }))
    await user.click(mySeat().getByRole('button', { name: '5の目' }))
    expect(screen.getByText('雷槍の詠唱：5。5以上のダメージを受けると崩れる')).toBeTruthy()
    await user.click(button('決定して公開'))
    expect(screen.getByText('あなたの詠唱は保たれた')).toBeTruthy()
    await user.click(button('二ステップ目へ'))
    expect(mySeat().getByText('詠唱中')).toBeTruthy()

    await user.click(mySeat().getByRole('button', { name: '雷槍' }))
    for (const d of mySeat().getAllByRole('button', { name: '6の目' })) await user.click(d)
    expect(screen.getByText('雷槍の発動：6と6、12点')).toBeTruthy()
    await user.click(button('決定して公開'))
    expect(cpuSeat().getByLabelText('体力 8 / 20')).toBeTruthy()
  })

  it('相手の行動と受けたダメージが公開される', async () => {
    const user = await start({
      rng: dice([
        [1, 2, 3],
        [6, 5, 4],
      ]),
      opponent: scriptedOpponent({ kind: 'fireball', dice: [0, 1] }),
    })
    await user.click(button('何もしない'))
    expect(screen.getByText('相手の火球 6点')).toBeTruthy()
    expect(screen.getByText('6点受けた')).toBeTruthy()
    expect(mySeat().getByLabelText('体力 14 / 20')).toBeTruthy()
  })
})

describe('決着', () => {
  /** 毎ターン 6,6,6 を振り、火球と魔弾で攻め続ける */
  async function attackUntilEnd(user: ReturnType<typeof userEvent.setup>) {
    for (let k = 0; k < 20 && !screen.queryByText(RESULT); k++) {
      if (screen.queryByRole('button', { name: /ステップ目へ|次のターンへ/ })) {
        await user.click(screen.getByRole('button', { name: /ステップ目へ|次のターンへ/ }))
        continue
      }
      const card = mySeat().queryByRole('button', { name: '火球' }) ? '火球' : '魔弾'
      await user.click(mySeat().getByRole('button', { name: card }))
      const free = mySeat().getAllByRole('button', { name: '6の目' })
      for (const d of free.slice(0, 2)) await user.click(d)
      await user.click(button('決定して公開'))
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
    expect(cpuSeat().getByLabelText('体力 0 / 20')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '決定して公開' })).toBeNull()

    await user.click(button('もう一戦'))
    expect(screen.getByText('1ターン目 一ステップ目')).toBeTruthy()
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
      if (screen.queryByRole('button', { name: /ステップ目へ|次のターンへ/ })) {
        await user.click(screen.getByRole('button', { name: /ステップ目へ|次のターンへ/ }))
        continue
      }
      const fireball = mySeat().queryByRole('button', { name: '火球' })
      await user.click(fireball ?? mySeat().getByRole('button', { name: '魔弾' }))
      const free = mySeat().getAllByRole('button', { name: '6の目' })
      for (const d of free.slice(0, fireball ? 2 : 1)) await user.click(d)
      await user.click(button('決定して公開'))
    }
    expect(screen.getByText('相打ち。引き分けです')).toBeTruthy()
  })
})

describe('本物のCPUとの通し', () => {
  it('何もしないを続けても、CPUの手で最後まで進み決着する', async () => {
    const user = await start({ rng: seeded(42) }, 'つよい')
    for (let k = 0; k < 60 && !screen.queryByText(RESULT); k++) {
      const next = screen.queryByRole('button', { name: /ステップ目へ|次のターンへ/ })
      await user.click(next ?? button('何もしない'))
    }
    expect(screen.getByText('相手の勝ち')).toBeTruthy()
    expect(screen.getByText('これまでの経過')).toBeTruthy()
  }, 30_000)
})
