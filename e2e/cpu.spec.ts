// 本物の CPU と遊ぶ。CPU は Worker で考え、画面を止めずに手を返す。
// ほかの e2e は相手の手を固定するので、Worker で考える道はここで通す。

import { expect, test } from '@playwright/test'
import { confirm, start, step, tapPlace } from './fixture'

test('CPU は Worker で考えて手を返し、対局が進む', async ({ page }) => {
  // 作られた Worker を数える
  await page.addInitScript(() => {
    const Real = window.Worker
    const made = { n: 0 }
    ;(window as unknown as { __workers: typeof made }).__workers = made
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        made.n++
      }
    }
  })
  await start(page, {
    turns: [
      [
        [6, 5, 2],
        [3, 3, 6],
      ],
    ],
    opponent: null,
  })
  await tapPlace(page, 6, '風壁のXの枠')
  await confirm(page).click()
  await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
  const made = await page.evaluate(() => (window as unknown as { __workers: { n: number } }).__workers.n)
  expect(made).toBe(1)
})
