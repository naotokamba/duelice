// 錬成、二重詠唱、残響を、本物のブラウザで人の手で使う。カードを選ぶ対戦で、出目と CPU の手と5枚を固定する。
// 錬成の後は好きな目のダイスを置いて目を選び、二重詠唱では3枚に置いてまとめて決定し、残響では直前の効果を繰り返す。
// 幅 360 の端末でも、置いて決定するところまで画面に収まるかを測る。

import { expect, type Page, test } from '@playwright/test'
import type { CardId } from '../src/game/cards'
import { confirm, cpuSeat, hp, mySeat, open, step } from './fixture'

/** CPU の5枚。CPU はパスし続けるので、何を持っていても結果は同じ */
const CPU_DECK: CardId[] = ['flameStrike', 'barrier', 'bullet', 'spear', 'interrupt']

/** 自分の5枚を覚えさせ、出目を固定して、カードを選ぶ画面から対戦を始める。自分は mine を、CPU は 5,3,1 を振る */
async function begin(page: Page, deck: CardId[], mine: number[]) {
  await page.addInitScript((d) => localStorage.setItem('duelice.deck', JSON.stringify(d)), deck)
  await open(page, { turns: [[mine, [5, 3, 1]]], cpuDeck: CPU_DECK })
  // サーバで描いた画面に React がつながる前に押すと何も起きないので、カードを選ぶ画面が出るまで押し直す
  await expect(async () => {
    await page.getByRole('button', { name: /^カードを選んで CPU と対戦/ }).click({ timeout: 1000 })
    await expect(page.getByRole('heading', { name: /カードを選ぶ/ })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
  await page.getByRole('button', { name: '対戦', exact: true }).click()
  await expect(step(page, 1, 1)).toBeAttached()
}

const tray = (page: Page) => mySeat(page).getByRole('group', { name: 'ダイス' })

/** 手元の、押せる value の目のダイス。好きな目のダイスは '好きな目' */
const die = (page: Page, name: string) => tray(page).getByRole('button', { name, exact: true }).first()

/** 狭い画面では、名前を押して置くカードを大きく出す */
async function look(page: Page, narrow: boolean, card: string) {
  if (narrow) await mySeat(page).getByRole('button', { name: card, exact: true }).click()
}

/** 手元のダイスを押して持ち、置き場を押して置く */
async function put(page: Page, dieName: string, slotName: string) {
  await die(page, dieName).click()
  await mySeat(page)
    .getByRole('button', { name: `${slotName}に置く` })
    .click()
}

const picker = (page: Page) => page.getByRole('dialog', { name: '目を選ぶ' })

/** 錬成の後の二ステップ目に、好きな目のダイスを炎撃の X に 6、Y に 1 で置く */
async function forgeAndPlace(page: Page, narrow: boolean) {
  await begin(page, ['flameStrike', 'bullet', 'barrier', 'interrupt', 'transmute'], [2, 5, 4])
  await look(page, narrow, '錬成')
  await put(page, '2の目', '錬成の1つ目の枠')
  await confirm(page).click()
  await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
  // 残りのダイスは捨てられ、好きな目のダイスが3個並ぶ
  await expect(tray(page).getByRole('button', { name: '好きな目', exact: true })).toHaveCount(3)

  await look(page, narrow, '炎撃')
  await put(page, '好きな目', '炎撃のXの枠')
  // 置くと目を選ぶ窓が出る
  await expect(picker(page)).toBeVisible()
  await picker(page).getByRole('button', { name: '6の目' }).click()
  await expect(picker(page)).toBeHidden()
  await put(page, '好きな目', '炎撃のYの枠')
  await picker(page).getByRole('button', { name: '1の目' }).click()
  await expect(confirm(page)).toBeEnabled()
}

/** 二重詠唱に 2、氷礫に 5、凍結に 4 を置く */
async function castThree(page: Page, narrow: boolean) {
  await begin(page, ['flameStrike', 'barrier', 'interrupt', 'freeze', 'doubleCast'], [2, 5, 4])
  await look(page, narrow, '二重詠唱')
  await put(page, '2の目', '二重詠唱の1つ目の枠')
  // 二重詠唱だけでは決定できない
  await expect(confirm(page)).toHaveAccessibleDescription('ほかのカードにも置く')
  await look(page, narrow, '氷礫')
  await put(page, '5の目', '氷礫の1つ目の枠')
  await look(page, narrow, '凍結')
  await put(page, '4の目', '凍結のXの枠')
  await expect(confirm(page)).toBeEnabled()
}

test.describe('錬成・二重詠唱・残響', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('錬成の後は、好きな目のダイスを置いて目を選び、選んだ目で攻撃する', async ({ page }) => {
    await forgeAndPlace(page, false)
    // 置いたダイスを押せば、目を選び直せる
    await mySeat(page).getByRole('button', { name: '好きな目のダイス 1。目を選ぶ' }).click()
    await expect(picker(page).getByRole('button', { name: '1の目' })).toHaveAttribute('aria-pressed', 'true')
    await picker(page).getByRole('button', { name: '2の目' }).click()
    await expect(mySeat(page).getByRole('button', { name: '好きな目のダイス 2。目を選ぶ' })).toBeVisible()
    await confirm(page).click()
    // X の 6 に2を足して 8 点。Y の 2 だけ自分も受ける
    await expect(step(page, 2, 1)).toBeAttached({ timeout: 15_000 })
    await expect(hp(cpuSeat(page), 12)).toBeVisible()
    await expect(hp(mySeat(page), 18)).toBeVisible()
  })

  test('二重詠唱に置けば、ほかの2枚にも置いてまとめて決定でき、どれも起きる', async ({ page }) => {
    await castThree(page, false)
    await confirm(page).click()
    // 氷礫の2点と、凍結の2点
    await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
    await expect(hp(cpuSeat(page), 16)).toBeVisible()
    // 一つ前の結果に、一緒に使ったカードが並ぶ
    await expect(page.getByRole('region', { name: '一つ前の結果' })).toContainText('二重詠唱・氷礫・凍結')
    // 一ステップ目に置いたダイスは、どのカードにも残る
    for (const [card, v] of [
      ['二重詠唱', 2],
      ['氷礫', 5],
      ['凍結', 4],
    ] as const) {
      await expect(
        mySeat(page)
          .getByRole('listitem', { name: card })
          .getByRole('img', { name: `${v}の目` }),
      ).toBeVisible()
    }
  })

  test('残響は直前の効果をカードに書き、同じ目でもう一度出す', async ({ page }) => {
    await begin(page, ['flameStrike', 'barrier', 'bullet', 'interrupt', 'echo'], [6, 1, 3])
    const echo = mySeat(page).getByRole('listitem', { name: '残響' })
    await expect(echo).toContainText('繰り返すものが無い')
    await put(page, '6の目', '炎撃のXの枠')
    await put(page, '1の目', '炎撃のYの枠')
    await confirm(page).click()
    await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
    await expect(hp(cpuSeat(page), 12)).toBeVisible()
    await expect(echo).toContainText('炎撃 6・1')
    await put(page, '3の目', '残響の1つ目の枠')
    await confirm(page).click()
    // もう一度、8 点と、自分も 1 点
    await expect(step(page, 2, 1)).toBeAttached({ timeout: 15_000 })
    await expect(hp(cpuSeat(page), 4)).toBeVisible()
    await expect(hp(mySeat(page), 18)).toBeVisible()
    await expect(page.getByRole('region', { name: '一つ前の結果' })).toContainText('残響→炎撃')
  })
})

test.describe('幅 360 の端末', () => {
  test.use({ viewport: { width: 360, height: 640 } })

  const bottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY
  const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

  test('錬成の目を選ぶ窓は画面に収まり、選んで決定できる', async ({ page }) => {
    await forgeAndPlace(page, true)
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
    expect(Math.max(await mySeat(page).evaluate(bottom), await confirm(page).evaluate(bottom))).toBeLessThanOrEqual(640)
  })

  test('二重詠唱で3枚に置いても画面に収まり、名前を押して置いたカードを見られる', async ({ page }) => {
    await castThree(page, true)
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
    expect(Math.max(await mySeat(page).evaluate(bottom), await confirm(page).evaluate(bottom))).toBeLessThanOrEqual(640)
    // 置いたカードの名前は、どれもダイスが置いてあると伝える
    for (const card of ['二重詠唱', '氷礫', '凍結']) {
      await expect(mySeat(page).getByRole('button', { name: card, exact: true })).toHaveAttribute(
        'aria-description',
        'ダイスが置いてある',
      )
    }
    await confirm(page).click()
    await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
    await expect(hp(cpuSeat(page), 16)).toBeVisible()
  })
})
