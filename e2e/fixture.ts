// 本物のブラウザで対局を始めるための道具。出目と相手の手を読み込む前に固定し、席や置き場を読み上げの名前で探す。

import { expect, type Locator, type Page } from '@playwright/test'
import type { Action } from '../src/game/types'

export interface Setup {
  /** 振る目。一ターンごとに [あなたの3個, 相手の3個]。尽きたら種つきの乱数 */
  turns: [number[], number[]][]
  /** 相手が順に指す手。尽きたらパス */
  opponent?: Action[]
}

/** 出目と相手の手を固定して、タイトルを開く */
export async function open(page: Page, { turns, opponent = [] }: Setup) {
  await page.addInitScript(
    ({ queue, acts }) => {
      // 尽きた後に使う、種つきの乱数 mulberry32
      let seed = 1
      const rest = () => {
        seed = (seed + 0x6d2b79f5) >>> 0
        let t = seed
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      window.__duelice = {
        rng: () => {
          const v = queue.shift()
          return v === undefined ? rest() : (v - 1) / 6 + 0.01
        },
        opponent: () => acts.shift() ?? { kind: 'pass' },
      }
    },
    { queue: turns.flatMap(([mine, theirs]) => [...mine, ...theirs]), acts: opponent },
  )
  await page.goto('/', { waitUntil: 'networkidle' })
  // 字の大きさで高さが変わるので、字体を読み終えてから測る
  await page.evaluate(() => document.fonts.ready)
}

/**
 * 出目と相手の手を固定して、対局を始める。
 * サーバで描いた画面に React がつながる前に押すと何も起きないので、対局の画面が出るまで押し直す
 */
export async function start(page: Page, setup: Setup) {
  await open(page, setup)
  await expect(async () => {
    await page.getByRole('button', { name: '決闘を始める' }).click({ timeout: 1000 })
    await expect(step(page, 1, 1)).toBeAttached({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
}

export const mySeat = (page: Page) => page.getByRole('region', { name: 'あなた' })
export const cpuSeat = (page: Page) => page.getByRole('region', { name: '相手' })

/** 自分の手元の value の目のダイス */
export const trayDie = (page: Page, value: number) =>
  mySeat(page)
    .getByRole('group', { name: 'ダイス' })
    .getByRole('button', { name: `${value}の目`, exact: true })
    .first()

/** 自分のカードの置き場。name は「火球のXの枠」のような呼び名 */
export const slot = (page: Page, name: string) => mySeat(page).getByRole('button', { name: `${name}に置く` })

/** 自分の席に大きく出ているカード */
export const myCard = (page: Page, name: string) => mySeat(page).getByRole('listitem', { name })

export const confirm = (page: Page) => page.getByRole('button', { name: '決定' })

/** 読み上げ用の今のターンとステップ。公開が終わり、次のステップへ進むと変わる */
export const step = (page: Page, turn: number, s: 1 | 2) => page.getByText(`Turn ${turn} - Step ${s}`, { exact: true })

/** 体力の表示 */
export const hp = (seat: Locator, value: number) => seat.getByRole('img', { name: `体力 ${value} / 20` })

/** 手元のダイスを押して持ち、置き場を押して置く */
export async function tapPlace(page: Page, value: number, slotName: string) {
  await trayDie(page, value).click()
  await slot(page, slotName).click()
}

/** 要素の真ん中の座標 */
export async function center(el: Locator) {
  const box = await el.boundingBox()
  if (!box) throw new Error('要素が見えていない')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** マウスで from を押したまま to まで動かして離す */
export async function mouseDrag(page: Page, from: Locator, to: Locator) {
  const a = await center(from)
  const b = await center(to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 12 })
  await page.mouse.up()
}

/** 指で from に触れたまま to まで動かして離す。指の動きはブラウザの入力として送る */
export async function touchDrag(page: Page, from: Locator, to: Locator) {
  const a = await center(from)
  const b = await center(to)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] })
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] })
  }
  // 人は行き先で指を止めてから離す。止めずに離すと払う動きになり、ブラウザが次の一押しを払う動きの停止に使ってしまう
  await page.waitForTimeout(150)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [b] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
