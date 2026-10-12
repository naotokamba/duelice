// ブラウザのダイアログの振る舞い。偽の DOM では Esc で閉じず、最初に選ばれるボタンも外の押下も本物と違うので、本物で確かめる。
// 取り消せない操作の確認は、誤って押しても困らない方を最初に選んでおく。Esc でも外を押しても、何もせずに閉じる。

import { expect, type Page, test } from '@playwright/test'
import { start, step } from './fixture'

test.use({ viewport: { width: 1280, height: 900 } })

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name })
const pass = (page: Page) => page.getByRole('button', { name: 'パス' })

/** ダイアログの枠の外、画面の左上の隅を押す */
const clickOutside = (page: Page) => page.mouse.click(4, 4)

test.beforeEach(async ({ page }) => {
  await start(page, {
    turns: [
      [
        [6, 5, 2],
        [1, 2, 3],
      ],
    ],
  })
})

test('パスの確認は、やめるを選んだ状態で開き、Esc でも外を押しても何もせずに閉じる', async ({ page }) => {
  await pass(page).click()
  await expect(dialog(page, 'パスしますか？')).toBeVisible()
  await expect(dialog(page, 'パスしますか？').getByRole('button', { name: 'やめる' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog(page, 'パスしますか？')).toBeHidden()

  await pass(page).click()
  await expect(dialog(page, 'パスしますか？')).toBeVisible()
  await clickOutside(page)
  await expect(dialog(page, 'パスしますか？')).toBeHidden()

  // パスしていないので、まだ選んでいる最中のまま
  await expect(pass(page)).toBeEnabled()
  await expect(step(page, 1, 1)).toBeAttached()
})

test('メニューから降参の確認を開くと、続けるを選んだ状態で開き、閉じても対局が続く', async ({ page }) => {
  await page.getByRole('button', { name: 'メニュー' }).click()
  await expect(dialog(page, 'メニュー')).toBeVisible()
  await clickOutside(page)
  await expect(dialog(page, 'メニュー')).toBeHidden()

  await page.getByRole('button', { name: 'メニュー' }).click()
  await dialog(page, 'メニュー').getByRole('button', { name: '降参' }).click()
  await expect(dialog(page, 'メニュー')).toBeHidden()
  await expect(dialog(page, '降参しますか？')).toBeVisible()
  await expect(dialog(page, '降参しますか？').getByRole('button', { name: '続ける' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog(page, '降参しますか？')).toBeHidden()
  await expect(pass(page)).toBeEnabled()
})

test('ルールはメニューから開き、Esc で閉じる', async ({ page }) => {
  await page.getByRole('button', { name: 'メニュー' }).click()
  await dialog(page, 'メニュー').getByRole('button', { name: 'ルール' }).click()
  await expect(dialog(page, 'ルール')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page, 'ルール')).toBeHidden()
})
