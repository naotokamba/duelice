// カードを選ぶ対戦を、本物のブラウザで通す。タイトルの入口からカードを選び、選んだ5枚と CPU の5枚で対局し、一手進める。
// 過負荷で振り足し、相手の凍結を受けて、手元にダイスが4個並び、凍ったダイスがある二ステップ目でも、画面に収まるかを測る。

import { expect, type Page, test } from '@playwright/test'
import { confirm, cpuSeat, mySeat, open, step } from './fixture'

/** 選ぶ5枚。スターターから外すカードと、入れるカード */
const DROP = ['風壁', '魔弾', '魔槍', '氷礫']
const ADD = ['全開', '過負荷', '双竜', '瞑想']

/**
 * 出目と CPU の手と5枚を固定して、タイトルからカードを選ぶ画面へ進む。
 * 自分は 2,5,4、CPU は 5,3,1 を振る。自分が過負荷で振り足すのは 5,6。CPU は一ステップ目に 5 を凍らせる
 */
async function toPick(page: Page) {
  await open(page, {
    turns: [
      [
        [2, 5, 4],
        [5, 3, 1],
      ],
      [[5, 6], []],
    ],
    opponent: [{ kind: 'freeze', dice: [0] }],
    cpuDeck: ['barrier', 'interrupt', 'freeze', 'darkWall', 'meditate'],
  })
  // サーバで描いた画面に React がつながる前に押すと何も起きないので、カードを選ぶ画面が出るまで押し直す
  await expect(async () => {
    await page.getByRole('button', { name: /^カードを選んで CPU と対戦/ }).click({ timeout: 1000 })
    await expect(page.getByRole('heading', { name: /カードを選ぶ/ })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
}

const toggle = (page: Page, name: string) => page.getByRole('button', { name: `${name}を選ぶ` })

/** 自分の手元の、押せる value の目のダイス */
const myDie = (page: Page, value: number) =>
  mySeat(page)
    .getByRole('group', { name: 'ダイス' })
    .getByRole('button', { name: `${value}の目`, exact: true })

/** 狭い画面では、名前を押して置くカードを大きく出す */
async function look(page: Page, narrow: boolean, card: string) {
  if (narrow) await mySeat(page).getByRole('button', { name: card, exact: true }).click()
}

/** 5枚を選んで対戦を始め、一ステップ目に過負荷を使って、手元に4個のダイスが並ぶ二ステップ目まで進める */
async function secondStep(page: Page, narrow: boolean) {
  await toPick(page)
  for (const c of DROP) await toggle(page, c).click()
  for (const c of ADD) await toggle(page, c).click()
  await page.getByRole('button', { name: '対戦', exact: true }).click()
  await expect(step(page, 1, 1)).toBeAttached()
  await look(page, narrow, '過負荷')
  await myDie(page, 2).click()
  await mySeat(page).getByRole('button', { name: '過負荷の1つ目の枠に置く' }).click()
  await confirm(page).click()
  await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
  await expect(mySeat(page).getByRole('group', { name: 'ダイス' }).getByRole('img')).toHaveCount(2)
  await expect(myDie(page, 6)).toBeVisible()
}

/** 二ステップ目に全開へ 6 を置いて、決定を押せる状態にする */
async function placeAllOut(page: Page, narrow: boolean) {
  await look(page, narrow, '全開')
  await myDie(page, 6).click()
  await mySeat(page).getByRole('button', { name: '全開の1つ目の枠に置く' }).click()
  await expect(confirm(page)).toBeEnabled()
}

test.describe('カードを選ぶ対戦', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('タイトルからカードを選び、CPU の5枚と対局して、振り足しと凍結を見ながら一手進める', async ({ page }) => {
    await toPick(page)
    // 覚えていなければ、スターターの5枚を選んだ状態から始まる
    await expect(toggle(page, '炎撃')).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle(page, '隕石')).toBeDisabled()
    await secondStep(page, false)
    // 振り足した 6 は、押せるまま振り足したと伝える
    await expect(myDie(page, 6)).toHaveAttribute('aria-description', '振り足した')
    await placeAllOut(page, false)

    await expect(cpuSeat(page).getByRole('listitem', { name: '凍結' })).toBeVisible()
    const tray = mySeat(page).getByRole('group', { name: 'ダイス' })
    // 凍らされた 5 は押せず、凍って置けないと伝える。振り足した 5 も凍っている
    const frozen = tray.getByRole('img', { name: '5の目' })
    await expect(frozen).toHaveCount(2)
    await expect(frozen.first()).toHaveAttribute('aria-description', '凍って置けない')
    await expect(myDie(page, 4)).toBeVisible()

    await confirm(page).click()
    await expect(step(page, 2, 1)).toBeAttached({ timeout: 15_000 })
    await expect(cpuSeat(page).getByRole('img', { name: '体力 19 / 20' })).toBeVisible()
  })

  test('選んだ5枚は、次に開いたときも選んだ状態で残る', async ({ page }) => {
    await toPick(page)
    await toggle(page, '氷礫').click()
    await toggle(page, '延焼').click()
    await page.getByRole('button', { name: '対戦', exact: true }).click()
    await expect(step(page, 1, 1)).toBeAttached()
    await page.reload({ waitUntil: 'networkidle' })
    await expect(async () => {
      await page.getByRole('button', { name: /^カードを選んで CPU と対戦/ }).click({ timeout: 1000 })
      await expect(toggle(page, '延焼')).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
    }).toPass({ timeout: 60_000 })
    await expect(toggle(page, '氷礫')).toHaveAttribute('aria-pressed', 'false')
  })
})

interface Size {
  name: string
  width: number
  height: number
  narrow: boolean
}

const SIZES: Size[] = [
  { name: 'デスクトップ', width: 1920, height: 940, narrow: false },
  { name: 'iPhone Pro Max', width: 430, height: 737, narrow: true },
  { name: '6.1 インチの iPhone', width: 390, height: 664, narrow: true },
  { name: '幅 360 の端末', width: 360, height: 640, narrow: true },
]

/** ページが横にはみ出している幅 */
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test(`カードを選ぶ画面は横にはみ出さず、選んだ5枚と対戦のボタンが画面の下に見えている`, async ({ page }) => {
      await toPick(page)
      expect(await overflowX(page)).toBeLessThanOrEqual(0)
      const start = page.getByRole('button', { name: '対戦', exact: true })
      await expect(start).toBeInViewport()
      const box = await start.boundingBox()
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height)
    })

    test(`手元にダイスが4個並び、凍ったダイスがある二ステップ目も ${size.width}×${size.height} に収まる`, async ({
      page,
    }) => {
      const bottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY
      const fits = async () => {
        if (size.narrow) {
          // スマホは自分の席の下端まで見えればよい
          const seat = await mySeat(page).evaluate(bottom)
          const button = (await confirm(page).count()) > 0 ? await confirm(page).evaluate(bottom) : 0
          expect(Math.max(seat, button)).toBeLessThanOrEqual(size.height)
        } else {
          expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(size.height)
        }
        expect(await overflowX(page)).toBeLessThanOrEqual(0)
      }
      // 手元に4個のダイスが並んだところと、カードに置いて決定のボタンが出たところで測る
      await secondStep(page, size.narrow)
      await fits()
      await placeAllOut(page, size.narrow)
      await fits()
    })
  })
}

test.describe('手元のダイスが5個', () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test('瞑想で持ち越し、次のターンに過負荷で振り足して5個並んでも、幅 360 の端末に収まる', async ({ page }) => {
    // 1ターン目は 2 を瞑想で持ち越す。2ターン目は 3,3,6 と持ち越した 2 で始め、2 で過負荷をかけて 4,5 を振り足す
    await open(page, {
      turns: [
        [
          [2, 5, 4],
          [5, 3, 1],
        ],
        [
          [3, 3, 6],
          [1, 1, 1],
        ],
        [[4, 5], []],
      ],
      cpuDeck: ['barrier', 'interrupt', 'freeze', 'darkWall', 'meditate'],
    })
    await expect(async () => {
      await page.getByRole('button', { name: /^カードを選んで CPU と対戦/ }).click({ timeout: 1000 })
      await expect(page.getByRole('heading', { name: /カードを選ぶ/ })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 60_000 })
    for (const c of DROP) await toggle(page, c).click()
    for (const c of ADD) await toggle(page, c).click()
    await page.getByRole('button', { name: '対戦', exact: true }).click()

    await look(page, true, '瞑想')
    await myDie(page, 2).click()
    await mySeat(page).getByRole('button', { name: '瞑想のXの枠に置く' }).click()
    await confirm(page).click()
    await expect(step(page, 1, 2)).toBeAttached({ timeout: 15_000 })
    await page.getByRole('button', { name: 'パス' }).click()
    await page.getByRole('dialog', { name: 'パスしますか？' }).getByRole('button', { name: 'パスする' }).click()
    await expect(step(page, 2, 1)).toBeAttached({ timeout: 15_000 })
    await expect(myDie(page, 2)).toHaveAttribute('aria-description', '前のターンから持ち越した')

    await look(page, true, '過負荷')
    await myDie(page, 2).click()
    await mySeat(page).getByRole('button', { name: '過負荷の1つ目の枠に置く' }).click()
    await confirm(page).click()
    await expect(step(page, 2, 2)).toBeAttached({ timeout: 15_000 })
    await expect(mySeat(page).getByRole('group', { name: 'ダイス' }).getByRole('button')).toHaveCount(5)

    await look(page, true, '炎撃')
    await myDie(page, 6).click()
    await mySeat(page).getByRole('button', { name: '炎撃のXの枠に置く' }).click()
    await myDie(page, 3).first().click()
    await mySeat(page).getByRole('button', { name: '炎撃のYの枠に置く' }).click()
    await expect(confirm(page)).toBeEnabled()
    const bottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY
    expect(Math.max(await mySeat(page).evaluate(bottom), await confirm(page).evaluate(bottom))).toBeLessThanOrEqual(640)
    expect(await overflowX(page)).toBeLessThanOrEqual(0)
  })
})
