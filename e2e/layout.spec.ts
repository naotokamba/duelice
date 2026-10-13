// 対戦中の画面が、スクロールせずに全部見えるか。一番高くなる場面で測る。
// 一番高くなるのは、一つ前の結果が中央に出ていて、席に一番長い「詠唱は崩れた」の札が出ていて、
// カードにダイスを置き、決定のボタンが出ている状態。
//
// 測る大きさは、実際に遊ぶ画面で見えている広さから決めた。
// - デスクトップ 1920×940: 縦 1080 のモニタでブラウザを最大化したとき、タブやアドレスバーを引いてページが見えている高さ
// - スマホ 430×737: iPhone Pro Max の Safari。アドレスバーを上に置き、下のツールバーも出ている状態。
//   アドレスバーの下には Safari 自身の余白が約 16 あり、ページからは消せない
// - スマホ 390×664: 6.1 インチの iPhone の Safari。同じくバーを出した状態。余りは数ピクセルしかない
// - スマホ 360×640: 小さめの Android。幅 380 以下では、押せないものの周りの余白を詰めて収める

import { expect, type Page, test } from '@playwright/test'
import { confirm, mySeat, start, step, tapPlace } from './fixture'

interface Size {
  name: string
  width: number
  height: number
  /** カードを1枚ずつ出す、狭い画面 */
  narrow: boolean
}

const SIZES: Size[] = [
  { name: 'デスクトップ', width: 1920, height: 940, narrow: false },
  { name: 'iPhone Pro Max', width: 430, height: 737, narrow: true },
  { name: '6.1 インチの iPhone', width: 390, height: 664, narrow: true },
  { name: '幅 360 の端末', width: 360, height: 640, narrow: true },
]

/**
 * 1ステップ目に雷槍を2で詠唱し、相手の6の火球で崩される。2ステップ目に障壁へダイスを置いて、決定のボタンが出た状態にする。
 * 自分の席には一番長い「詠唱は崩れた」の札が出る
 */
async function tallest(page: Page, narrow: boolean) {
  await start(page, {
    turns: [
      [
        [2, 5, 4],
        [6, 3, 1],
      ],
    ],
    opponent: [{ kind: 'fireball', dice: [0, 1] }],
  })
  if (narrow) await mySeat(page).getByRole('button', { name: '雷槍', exact: true }).click()
  await tapPlace(page, 2, '雷槍のXの枠')
  await confirm(page).click()
  await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
  await expect(page.getByRole('region', { name: '一つ前の結果' })).toBeVisible()
  await expect(mySeat(page).getByText('詠唱は崩れた')).toBeVisible()
  if (narrow) await mySeat(page).getByRole('button', { name: '障壁', exact: true }).click()
  await tapPlace(page, 5, '障壁のXの枠')
  await expect(confirm(page)).toBeEnabled()
}

/**
 * 自分の席と決定のボタンのうち、下に出ている方の下端。ページの一番上からの距離で測る。
 * 押すときにブラウザがページを送ることがあるので、見えている範囲からの位置では測らない
 */
async function bottomOfMine(page: Page) {
  const bottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY
  return Math.max(await mySeat(page).evaluate(bottom), await confirm(page).evaluate(bottom))
}

/** ページが横にはみ出している幅 */
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test(`${size.width}×${size.height} に収まる`, async ({ page }) => {
      await tallest(page, size.narrow)
      if (size.narrow) {
        // スマホは自分の席の下端まで見えればよい。その下の余白はスクロールして見えればよい
        expect(await bottomOfMine(page)).toBeLessThanOrEqual(size.height)
      } else {
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(size.height)
      }
      expect(await overflowX(page)).toBeLessThanOrEqual(0)
    })
  })
}
