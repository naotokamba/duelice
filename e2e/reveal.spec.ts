// 公開の幕の見た目。位置と消え方は CSS が決めるので、偽の DOM では確かめられない。
// 画面の時計を止めて幕を出したままにし、CSS の動きが終わってから位置と濃さを測る。
// - 受けたダメージの星は、舞台の外の枠や体力の帯にかからない
// - 技の札は矢印の始点、放った側の端にある
// - 障壁で止まった矢印の札は残り、反撃に打ち消された矢印の札は、返す矢印が出たら消える
// - 反撃が外れて自分で受けた分の星も、舞台の内側に出る

import { expect, type Page, test } from '@playwright/test'
import { BANNER_MS } from '../src/components/useRevealClock'
import type { Action } from '../src/game/types'
import { confirm, open, step, tapPlace } from './fixture'

test.use({ viewport: { width: 1280, height: 900 } })

/** 相手の手を決めて、火球を X に x、もう一つの枠に残りの 6 か 5 で撃ち、公開の幕を出したままにする */
async function fireInto(page: Page, theirs: number[], answer: Action, x: 6 | 5 = 6) {
  await page.clock.install()
  await open(page, { turns: [[[6, 5, 2], theirs]], opponent: [answer] })
  await expect(async () => {
    await page.getByRole('button', { name: '決闘を始める' }).click({ timeout: 1000 })
    await expect(step(page, 1, 1)).toBeAttached({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
  // 時計を止めているので、ターンの始まりの帯は時計を進めて消す
  await page.clock.runFor(BANNER_MS)
  await tapPlace(page, x, '火球のXの枠')
  await tapPlace(page, x === 6 ? 5 : 6, '火球の2つ目の枠')
  await confirm(page).click()
  const stage = page.locator('.clash .stage')
  await expect(stage).toBeVisible()
  // 時計が止まっているので幕は出たまま。CSS の動きが全て終わるのを待つ
  await expect
    .poll(() => stage.evaluate((el) => el.getAnimations({ subtree: true }).every((a) => a.playState === 'finished')))
    .toBe(true)
  return stage
}

/** 要素の箱。見えていなければ失敗させる */
async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox()
  if (!b) throw new Error(`${selector} が見えていない`)
  return b
}

/** 星が舞台の内側に収まっている */
async function expectStarsInside(page: Page) {
  const stage = await box(page, '.clash .stage')
  const stars = await page.locator('.clash .burst').all()
  expect(stars.length).toBeGreaterThan(0)
  for (const star of stars) {
    const b = await star.boundingBox()
    if (!b) throw new Error('星が見えていない')
    expect(b.y).toBeGreaterThanOrEqual(stage.y)
    expect(b.y + b.height).toBeLessThanOrEqual(stage.y + stage.height)
    expect(b.x).toBeGreaterThanOrEqual(stage.x)
    expect(b.x + b.width).toBeLessThanOrEqual(stage.x + stage.width)
  }
}

const opacity = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => Number(getComputedStyle(el).opacity))

test('障壁で止まった火球。札は放った側の端に残り、通った分の星は舞台の内側', async ({ page }) => {
  // 2の目の障壁は4を減らすので、6の火球は2だけ通る
  await fireInto(page, [2, 3, 1], { kind: 'barrier', dice: [0] })
  // 自分は下の端から上へ撃つ。札は矢印の下半分、放った側にある
  const arrow = await box(page, '.clash .arrow.is-up')
  const pill = await box(page, '.clash .arrow.is-up .arrow-value')
  expect(pill.y + pill.height / 2).toBeGreaterThan(arrow.y + arrow.height / 2)
  expect(await opacity(page, '.clash .arrow.is-up .arrow-value')).toBe(1)
  await expectStarsInside(page)
})

test('反撃に打ち消された火球。打ち消された矢印の札は消え、反撃が返す矢印の札が出る', async ({ page }) => {
  await fireInto(page, [3, 2, 1], { kind: 'counter', dice: [0] }, 5)
  expect(await opacity(page, '.clash .arrow.is-returned .arrow-value')).toBe(0)
  expect(await opacity(page, '.clash .arrow.is-down .arrow-value')).toBe(1)
  // 返す矢印は相手の側から下へ戻る。札はその始点、上の端の側にある
  const back = await box(page, '.clash .arrow.is-down')
  const pill = await box(page, '.clash .arrow.is-down .arrow-value')
  expect(pill.y + pill.height / 2).toBeLessThan(back.y + back.height / 2)
  await expectStarsInside(page)
})

test('反撃の上限を超えた火球は通り、外れた反撃の自傷の星も舞台の内側に並ぶ', async ({ page }) => {
  await fireInto(page, [3, 2, 1], { kind: 'counter', dice: [0] })
  await expect(page.locator('.clash .burst')).toHaveCount(2)
  await expect(page.locator('.clash .burst-backfire')).toHaveText('−6')
  // 外れた反撃は薄くなる
  expect(await opacity(page, '.clash .stance.is-missed')).toBeLessThan(1)
  await expectStarsInside(page)
  // 通った星と自傷の星は重ならない
  const [a, b] = await page.locator('.clash .burst').all()
  const ba = await a.boundingBox()
  const bb = await b.boundingBox()
  if (!ba || !bb) throw new Error('星が見えていない')
  expect(ba.x + ba.width <= bb.x || bb.x + bb.width <= ba.x).toBe(true)
})
