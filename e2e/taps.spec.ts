// 押せるものの大きさと間隔。指で押しやすいように、押せるボタンは 48×48 以上にし、ほかの押せるボタンと 8 以上離す。
// Google の Android のアクセシビリティの指針に合わせた値で、styles.css の --tap と --tap-gap と同じ。
// 押せるものが一番多く並ぶ、ダイスを持って置き場が全て押せる場面と、決定が押せる場面で測る。

import { expect, type Page, test } from '@playwright/test'
import { confirm, mySeat, start, step, tapPlace, trayDie } from './fixture'

const TAP = 48
const GAP = 8

interface Target {
  name: string
  left: number
  top: number
  right: number
  bottom: number
}

/** 画面に見えている、今押せるボタン。閉じたダイアログの中は数えない */
function targets(page: Page): Promise<Target[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
      .filter((b) => !b.closest('dialog:not([open])') && b.checkVisibility())
      .map((b) => {
        const r = b.getBoundingClientRect()
        const name = b.getAttribute('aria-label') ?? b.textContent ?? ''
        return { name, left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      }),
  )
}

/** 二つの箱の間の距離。重なっていれば 0 */
function distance(a: Target, b: Target): number {
  const dx = Math.max(0, a.left - b.right, b.left - a.right)
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom)
  return Math.hypot(dx, dy)
}

/** 出てくるときの動きの途中は小さく描かれるので、終わりのある動きが全て終わるのを待つ。光り続ける動きは待たない */
async function settled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY)
          .every((a) => a.playState === 'finished'),
      ),
    )
    .toBe(true)
}

/** 小さすぎるボタンと、近すぎる組を並べる */
async function problems(page: Page): Promise<string[]> {
  await settled(page)
  const list = await targets(page)
  expect(list.length).toBeGreaterThan(5)
  const found: string[] = []
  for (const t of list) {
    const w = t.right - t.left
    const h = t.bottom - t.top
    // 小数の丸めの分だけ見逃す
    if (w < TAP - 0.5 || h < TAP - 0.5) found.push(`小さい: ${t.name} ${w.toFixed(1)}×${h.toFixed(1)}`)
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = distance(list[i], list[j])
      if (d < GAP - 0.5) found.push(`近い: ${list[i].name} と ${list[j].name} ${d.toFixed(1)}`)
    }
  }
  return found
}

/** 1ステップ進めて一つ前の結果と履歴の印を出し、2ステップ目でダイスを持つ */
async function holdDie(page: Page, narrow: boolean) {
  await start(page, {
    turns: [
      [
        [6, 5, 2],
        [1, 2, 3],
      ],
    ],
  })
  // 狭い画面では使える最初のカードの火球が出ている
  await tapPlace(page, 6, '火球のXの枠')
  await tapPlace(page, 5, '火球の2つ目の枠')
  await confirm(page).click()
  await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
  if (narrow) await mySeat(page).getByRole('button', { name: '障壁', exact: true }).click()
  await trayDie(page, 2).click()
}

for (const { name, width, height, narrow } of [
  { name: 'デスクトップ', width: 1920, height: 940, narrow: false },
  { name: 'スマホ', width: 390, height: 664, narrow: true },
  { name: '幅 360 のスマホ', width: 360, height: 640, narrow: true },
]) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })

    test('ダイスを持って置き場が押せる場面と、決定が押せる場面', async ({ page }) => {
      await holdDie(page, narrow)
      expect(await problems(page)).toEqual([])
      await mySeat(page).getByRole('button', { name: '障壁のXの枠に置く' }).click()
      await expect(confirm(page)).toBeEnabled()
      expect(await problems(page)).toEqual([])
    })
  })
}
