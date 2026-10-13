// デスクトップで決着まで遊ぶ。押して置くこととマウスで引きずって置くこと、公開、1ステップ目のダイスが盤に残ること、
// 新しいターンで盤が片付くこと、勝敗の表示までを、本物のブラウザで通す。

import { expect, test } from '@playwright/test'
import { confirm, cpuSeat, hp, mouseDrag, myCard, mySeat, slot, start, step, tapPlace, trayDie } from './fixture'

test.use({ viewport: { width: 1920, height: 940 } })

test('魔弾、氷礫、魔槍の詠唱と発動で相手を倒す', async ({ page }) => {
  // 相手は何もしない。毎ターン 6 を3個振る
  const sixes: [number[], number[]] = [
    [6, 6, 6],
    [1, 2, 3],
  ]
  await start(page, { turns: [sixes, sixes, sixes] })

  // 1ターン目の1ステップ目。魔弾に6のゾロ目を、一つは押して、もう一つはマウスで引きずって置く
  await tapPlace(page, 6, '魔弾の1つ目の枠')
  await mouseDrag(page, trayDie(page, 6), slot(page, '魔弾の2つ目の枠'))
  await expect(myCard(page, '魔弾').getByRole('button', { name: '6の目を戻す' })).toHaveCount(2)
  await confirm(page).click()
  await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
  await expect(hp(cpuSeat(page), 16)).toBeVisible()

  // 1ステップ目に使ったダイスは魔弾に残り、押せない。手元には残りの1個だけ
  const bullet = myCard(page, '魔弾')
  await expect(bullet.getByRole('img', { name: '6の目' })).toHaveCount(2)
  await expect(bullet.getByRole('button', { name: /の目/ })).toHaveCount(0)
  await expect(mySeat(page).getByRole('group', { name: 'ダイス' }).getByRole('button')).toHaveCount(1)

  // 2ステップ目。氷礫に1個置いて2点。氷礫は自分は焼けない
  await tapPlace(page, 6, '氷礫の1つ目の枠')
  await confirm(page).click()
  await expect(step(page, 2, 1)).toBeAttached({ timeout: 15_000 })
  await expect(hp(cpuSeat(page), 14)).toBeVisible()
  await expect(hp(mySeat(page), 20)).toBeVisible()

  // 新しいターンは振り直して、盤が片付く
  await expect(bullet.getByRole('img', { name: /の目/ })).toHaveCount(0)

  // 2ターン目。魔槍を詠唱し、詠唱のダイスは1段目に残ったまま、2段目で発動する
  await tapPlace(page, 6, '魔槍の1つ目の枠')
  await confirm(page).click()
  await expect(step(page, 2, 2)).toBeAttached({ timeout: 15_000 })
  await expect(page.getByText('詠唱中')).toBeVisible()
  await expect(myCard(page, '魔槍').getByRole('img', { name: '6の目' })).toHaveCount(1)
  await tapPlace(page, 6, '魔槍の1つ目の枠')
  await tapPlace(page, 6, '魔槍の2つ目の枠')
  await confirm(page).click()
  await expect(step(page, 3, 1)).toBeAttached({ timeout: 15_000 })
  await expect(hp(cpuSeat(page), 2)).toBeVisible()

  // 3ターン目。魔弾で残りを削り切る
  await tapPlace(page, 6, '魔弾の1つ目の枠')
  await tapPlace(page, 6, '魔弾の2つ目の枠')
  await confirm(page).click()

  await expect(page.getByText('勝ち', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(hp(cpuSeat(page), 0)).toBeVisible()
  await expect(page.getByRole('button', { name: 'もう一戦' })).toBeVisible()
})
