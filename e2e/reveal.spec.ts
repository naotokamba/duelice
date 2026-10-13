// 公開の幕の見た目。位置と消え方は CSS が決めるので、偽の DOM では確かめられない。
// 画面の時計を止めて幕を出したままにし、CSS の動きが終わってから位置と濃さを測る。
// - 受けたダメージの星と、払った血のしずくは、舞台の外の枠や体力の帯にかからない
// - 技の札は矢印の始点、放った側の端にある
// - 障壁で止まった矢印の札は残る
// - 払った血のしずくは、飛んでくる攻撃の星と重ならない

import { expect, type Locator, type Page, test } from '@playwright/test'
import { BANNER_MS } from '../src/components/useRevealClock'
import type { Action } from '../src/game/types'
import { confirm, open, step, tapPlace } from './fixture'

test.use({ viewport: { width: 1280, height: 900 } })

/** 相手の手を決めて、6、5、2 の3個を全部置いた過負荷を撃ち、公開の幕を出したままにする */
async function bloodInto(page: Page, theirs: number[], answer: Action) {
  await page.clock.install()
  await open(page, { turns: [[[6, 5, 2], theirs]], opponent: [answer] })
  await expect(async () => {
    await page.getByRole('button', { name: '決闘を始める' }).click({ timeout: 1000 })
    await expect(step(page, 1, 1)).toBeAttached({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
  // 時計を止めているので、ターンの始まりの帯は時計を進めて消す
  await page.clock.runFor(BANNER_MS)
  await tapPlace(page, 6, '過負荷の1つ目の枠')
  await tapPlace(page, 5, '過負荷の2つ目の枠')
  await tapPlace(page, 2, '過負荷の3つ目の枠')
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

/** 星としずくが舞台の内側に収まっている */
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

/** 二つの箱が横に重ならない */
async function apart(a: Locator, b: Locator) {
  const ba = await a.boundingBox()
  const bb = await b.boundingBox()
  if (!ba || !bb) throw new Error('星かしずくが見えていない')
  return ba.x + ba.width <= bb.x || bb.x + bb.width <= ba.x
}

const opacity = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => Number(getComputedStyle(el).opacity))

test('障壁で止まった過負荷。札は放った側の端に残り、通った分の星と払った血は舞台の内側', async ({ page }) => {
  // 2の目の障壁は2を減らすので、3個置いた過負荷の6は4だけ通る。置いた3個の分、3の血を払う
  await bloodInto(page, [2, 3, 1], { kind: 'barrier', dice: [0] })
  // 自分は下の端から上へ撃つ。札は矢印の下半分、放った側にある
  const arrow = await box(page, '.clash .arrow.is-up')
  const pill = await box(page, '.clash .arrow.is-up .arrow-value')
  expect(pill.y + pill.height / 2).toBeGreaterThan(arrow.y + arrow.height / 2)
  expect(await opacity(page, '.clash .arrow.is-up .arrow-value')).toBe(1)
  await expect(page.locator('.clash .burst-blood')).toHaveText('−3')
  await expectStarsInside(page)
  // 払った血のしずくは、自分の矢印の札と重ならない
  expect(await apart(page.locator('.clash .burst-blood'), page.locator('.clash .arrow.is-up .arrow-value'))).toBe(true)
})

test('撃ち合いで、自分の払った血のしずくは、飛んできた攻撃の星と重ならない', async ({ page }) => {
  // 相手は3のゾロ目の魔弾で4を撃つ。こちらは3個置いた過負荷で6を撃ち、3の血を払う
  await bloodInto(page, [3, 3, 1], { kind: 'bullet', dice: [0, 1] })
  await expect(page.locator('.clash .burst')).toHaveCount(3)
  await expectStarsInside(page)
  // 下の自分の側には、相手の魔弾の星と、自分の血のしずくが並ぶ
  const stage = await box(page, '.clash .stage')
  const mine = []
  for (const b of await page.locator('.clash .burst').all()) {
    const bb = await b.boundingBox()
    if (bb && bb.y > stage.y + stage.height / 2) mine.push(b)
  }
  expect(mine).toHaveLength(2)
  expect(await apart(mine[0], mine[1])).toBe(true)
})
