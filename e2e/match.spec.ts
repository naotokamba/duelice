// デスクトップで決着まで遊ぶ。押して置くこととマウスで引きずって置くこと、公開、1ステップ目のダイスが盤に残ること、
// 新しいターンで盤が片付くこと、勝敗の表示までを、本物のブラウザで通す。

import { expect, test } from '@playwright/test'
import { confirm, cpuSeat, hp, mouseDrag, myCard, mySeat, slot, start, step, tapPlace, trayDie } from './fixture'

test.use({ viewport: { width: 1920, height: 940 } })

test('双炎、過負荷、雷槍の詠唱と発動で相手を倒す', async ({ page }) => {
  // 相手は何もしない。毎ターン 6 を3個振る
  await start(page, {
    turns: [
      [
        [6, 6, 6],
        [1, 2, 3],
      ],
      [
        [6, 6, 6],
        [1, 2, 3],
      ],
    ],
  })

  // 1ターン目の1ステップ目。双炎に6のゾロ目を、一つは押して、もう一つはマウスで引きずって置く
  await tapPlace(page, 6, '双炎の1つ目の枠')
  await mouseDrag(page, trayDie(page, 6), slot(page, '双炎の2つ目の枠'))
  await expect(myCard(page, '双炎').getByRole('button', { name: '6の目を戻す' })).toHaveCount(2)
  await confirm(page).click()
  await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
  await expect(hp(cpuSeat(page), 12)).toBeVisible()

  // 1ステップ目に使ったダイスは双炎に残り、押せない。手元には残りの1個だけ
  const twin = myCard(page, '双炎')
  await expect(twin.getByRole('img', { name: '6の目' })).toHaveCount(2)
  await expect(twin.getByRole('button', { name: /の目/ })).toHaveCount(0)
  await expect(mySeat(page).getByRole('group', { name: 'ダイス' }).getByRole('button')).toHaveCount(1)

  // 2ステップ目。過負荷に1個置いて2点。自分は1の血を払う
  await tapPlace(page, 6, '過負荷の1つ目の枠')
  await confirm(page).click()
  await expect(step(page, 2, 1)).toBeAttached({ timeout: 15_000 })
  await expect(hp(cpuSeat(page), 10)).toBeVisible()
  await expect(hp(mySeat(page), 19)).toBeVisible()

  // 新しいターンは振り直して、盤が片付く
  await expect(twin.getByRole('img', { name: /の目/ })).toHaveCount(0)

  // 2ターン目。雷槍を詠唱し、詠唱のダイスは1段目に残ったまま、2段目で発動する
  await tapPlace(page, 6, '雷槍のXの枠')
  await confirm(page).click()
  await expect(step(page, 2, 2)).toBeAttached({ timeout: 15_000 })
  await expect(page.getByText('詠唱中')).toBeVisible()
  await expect(myCard(page, '雷槍').getByRole('img', { name: '6の目' })).toHaveCount(1)
  await tapPlace(page, 6, '雷槍の1つ目の枠')
  await tapPlace(page, 6, '雷槍の2つ目の枠')
  await confirm(page).click()

  await expect(page.getByText('あなたの勝ち', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(hp(cpuSeat(page), 0)).toBeVisible()
  await expect(page.getByRole('button', { name: 'もう一戦' })).toBeVisible()
})
