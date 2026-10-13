// 公開の幕の見た目。位置と消え方は CSS が決めるので、偽の DOM では確かめられない。
// 画面の時計を止めて幕を出したままにし、CSS の動きが終わってから位置と濃さを測る。
// - 受けたダメージの星と、自分を焼いた炎は、舞台の外の枠や体力の帯にかからない
// - 技の札は矢印の始点、放った側の端にある
// - 風壁で止まった矢印の札は残る
// - 自分を焼いた炎は、飛んでくる攻撃の星や、風壁が返した星と重ならない

import { expect, type Locator, type Page, test } from '@playwright/test'
import { BANNER_MS } from '../src/components/useRevealClock'
import type { Action } from '../src/game/types'
import { confirm, open, step, tapPlace } from './fixture'

test.use({ viewport: { width: 1280, height: 900 } })

/** 相手の手を決めて、X の枠に6、Y の枠に5を置いた炎撃を撃ち、公開の幕を出したままにする。8を当て、5だけ自分も焼ける */
async function burnInto(page: Page, theirs: number[], answer: Action) {
  await page.clock.install()
  await open(page, { turns: [[[6, 5, 2], theirs]], opponent: [answer] })
  await expect(async () => {
    await page.getByRole('button', { name: 'CPU と対戦', exact: true }).click({ timeout: 1000 })
    await expect(step(page, 1, 1)).toBeAttached({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
  // 時計を入れただけでは時が流れ続け、公開の幕は数秒で閉じる。遅い機械では測り終える前に閉じる。
  // ターンの始まりの帯が消えるところまで時計を進めて、そこで止める
  await page.clock.pauseAt(await page.evaluate((ms) => Date.now() + ms, BANNER_MS))
  await tapPlace(page, 6, '炎撃のXの枠')
  await tapPlace(page, 5, '炎撃のYの枠')
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

/** 星と炎が舞台の内側に収まっている */
async function expectStarsInside(page: Page) {
  const stage = await box(page, '.clash .stage')
  const stars = await page.locator('.clash .burst').all()
  expect(stars.length).toBeGreaterThan(0)
  for (const star of stars) {
    // 星と炎は大きさ0から膨らんで出るので、見えるまで待ってから測る
    await expect(star).toBeVisible()
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
  await expect(a).toBeVisible()
  await expect(b).toBeVisible()
  const ba = await a.boundingBox()
  const bb = await b.boundingBox()
  if (!ba || !bb) throw new Error('星か炎が見えていない')
  return ba.x + ba.width <= bb.x || bb.x + bb.width <= ba.x
}

const opacity = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => Number(getComputedStyle(el).opacity))

test('風壁で止まった炎撃。札は放った側の端に残り、通った分の星と、返された星と、焼けた分は舞台の内側', async ({
  page,
}) => {
  // 2の目の風壁は4を減らすので、炎撃の8は4だけ通る。風壁は3を返し、こちらは5だけ自分も焼ける
  await burnInto(page, [2, 3, 1], { kind: 'barrier', dice: [0] })
  // 自分は下の端から上へ撃つ。札は矢印の下半分、放った側にある
  const arrow = await box(page, '.clash .arrow.is-up')
  const pill = await box(page, '.clash .arrow.is-up .arrow-value')
  expect(pill.y + pill.height / 2).toBeGreaterThan(arrow.y + arrow.height / 2)
  expect(await opacity(page, '.clash .arrow.is-up .arrow-value')).toBe(1)
  await expect(page.locator('.clash .burst-burn')).toHaveText('−5')
  await expectStarsInside(page)
  // 風壁が吹き返した風の渦の矢印は、上の相手から下の自分へ飛ぶ
  await expect(page.locator('.clash .arrow.is-down .glyph-thorns')).toHaveText('3')
  // 自分を焼いた炎は、返された星とも、自分の矢印の札とも重ならない
  const stage = await box(page, '.clash .stage')
  const mine = []
  for (const b of await page.locator('.clash .burst').all()) {
    const bb = await b.boundingBox()
    if (bb && bb.y > stage.y + stage.height / 2) mine.push(b)
  }
  expect(mine).toHaveLength(2)
  expect(await apart(mine[0], mine[1])).toBe(true)
  expect(await apart(page.locator('.clash .burst-burn'), page.locator('.clash .arrow.is-up .arrow-value'))).toBe(true)
})

test('撃ち合いで、自分を焼いた炎は、飛んできた攻撃の星と重ならない', async ({ page }) => {
  // 相手は3のゾロ目の魔弾で4を撃つ。こちらは炎撃で8を撃ち、5だけ自分も焼ける
  await burnInto(page, [3, 3, 1], { kind: 'bullet', dice: [0, 1] })
  await expect(page.locator('.clash .burst')).toHaveCount(3)
  await expectStarsInside(page)
  // 下の自分の側には、相手の魔弾の星と、自分を焼く炎が並ぶ
  const stage = await box(page, '.clash .stage')
  const mine = []
  for (const b of await page.locator('.clash .burst').all()) {
    const bb = await b.boundingBox()
    if (bb && bb.y > stage.y + stage.height / 2) mine.push(b)
  }
  expect(mine).toHaveLength(2)
  expect(await apart(mine[0], mine[1])).toBe(true)
})
