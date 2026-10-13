// オンライン対戦。二つのブラウザで二人の画面を開き、開発のサーバの Durable Object を通して対局する。
// 部屋は開発のときだけ受け付ける短い体力と持ち時間で作り、すぐ決着させる。
// - 名前を入れ、部屋を作り、ロビーの一覧から合言葉で入り、決着まで指す
// - 再読み込みしても同じ席に戻り、出した行動も残っている
// - 二人ともがもう一戦を押せば同じ部屋で次の対局が始まり、一人が抜ければ残った人は次の相手を待つ
// - 持ち時間までに出さず、戻ってこなければ負ける

import { type Browser, expect, type Page, test } from '@playwright/test'
import type { RoomOptions } from '../src/components/onlineApi'
import { mySeat, step } from './fixture'

test.describe.configure({ timeout: 90_000 })

/** 並べて走らせても、ロビーの一覧で自分の部屋を見分けられる名前 */
const unique = (head: string) => `${head}${Math.random().toString(36).slice(2, 7)}`

/** 新しいブラウザで開き、名前を入れてロビーへ進む */
async function enter(browser: Browser, name: string, room?: RoomOptions, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript((r) => {
    window.__duelice = { room: r }
  }, room)
  const page = await context.newPage()
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  // サーバで描いた画面に React がつながる前に押すと何も起きないので、名前の画面が出るまで押し直す
  await expect(async () => {
    await page.getByRole('button', { name: 'オンライン対戦 β' }).click({ timeout: 1000 })
    await expect(page.getByRole('textbox', { name: '名前' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 60_000 })
  await page.getByRole('textbox', { name: '名前' }).fill(name)
  await page.getByRole('button', { name: 'ロビーへ' }).click()
  await expect(page.getByRole('heading', { name: 'ロビー β' })).toBeVisible()
  return page
}

/** 部屋を作り、既定の合言葉を返す */
async function host(page: Page) {
  await page.getByRole('button', { name: '部屋を作る' }).click()
  const code = await page.getByRole('textbox', { name: '合言葉' }).inputValue()
  expect(code).toMatch(/^\d{4}$/)
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByText('相手を待っています')).toBeVisible()
  await expect(page.getByText(code, { exact: true })).toBeVisible()
  return code
}

/** ロビーの一覧から、hostName の部屋に合言葉 code で入る */
async function join(page: Page, hostName: string, code: string) {
  await page.getByRole('button', { name: `${hostName}の部屋に入る` }).click()
  await page.getByRole('textbox', { name: '合言葉' }).fill(code)
  await page.getByRole('button', { name: '入る', exact: true }).click()
}

/** 二人そろえて対局を始める。a が部屋を作り、b が入る */
async function pair(browser: Browser, room: RoomOptions, viewport?: { width: number; height: number }) {
  const names = [unique('あお'), unique('あか')] as const
  const a = await enter(browser, names[0], room, viewport)
  const code = await host(a)
  const b = await enter(browser, names[1], room)
  await join(b, names[0], code)
  for (const p of [a, b]) await expect(step(p, 1, 1)).toBeAttached()
  return { a, b, names }
}

/** 手元の最初のダイスを氷礫に置いて決定する。狭い画面では、先に氷礫のカードを出す */
async function interrupt(page: Page, narrow = false) {
  if (narrow) await mySeat(page).getByRole('button', { name: '氷礫', exact: true }).click()
  await mySeat(page).getByRole('group', { name: 'ダイス' }).getByRole('button').first().click()
  await mySeat(page).getByRole('button', { name: '氷礫の1つ目の枠に置く' }).click()
  await page.getByRole('button', { name: '決定' }).click()
}

async function pass(page: Page) {
  await page.getByRole('button', { name: 'パス' }).click()
  await page.getByRole('dialog', { name: 'パスしますか？' }).getByRole('button', { name: 'パスする' }).click()
}

const result = (page: Page) => page.locator('.result-text')

/** 戦闘履歴のいちばん上、決着の行 */
async function ending(page: Page) {
  await page.getByRole('button', { name: '戦闘履歴' }).click()
  const dialog = page.getByRole('dialog', { name: '戦闘履歴' })
  const text = await dialog.getByRole('listitem').first().textContent()
  await dialog.getByRole('button', { name: '閉じる' }).click()
  return text
}

test('名前を入れ、部屋を作り、一覧から合言葉で入り、決着まで指す', async ({ browser }) => {
  // 部屋を作る側は、一番狭い 360×640 の画面で、相手の長い名前と持ち時間を出したまま収まるかも測る
  const aName = unique('あお')
  const a = await enter(browser, aName, { hp: 2 }, { width: 360, height: 640 })
  const code = await host(a)
  const bName = unique('あかいろの魔術')
  const b = await enter(browser, bName, { hp: 2 })
  await expect(b.getByRole('listitem').filter({ hasText: aName })).toContainText('待機中')

  // 違う合言葉では入れない
  await join(b, aName, code === '0000' ? '1111' : '0000')
  await expect(b.getByRole('alert')).toHaveText('合言葉が違います')
  await b.getByRole('textbox', { name: '合言葉' }).fill(code)
  await b.getByRole('button', { name: '入る', exact: true }).click()

  for (const p of [a, b]) await expect(step(p, 1, 1)).toBeAttached()
  // 相手の席には相手の名前を出す。長い名前は省いて出す
  await expect(a.getByRole('region', { name: bName })).toBeVisible()
  await expect(b.getByRole('region', { name: aName })).toBeVisible()
  await expect(a.getByRole('timer')).toBeVisible()
  await expect(mySeat(a).getByRole('img', { name: '体力 2 / 2' })).toBeVisible()

  await mySeat(a).getByRole('button', { name: '氷礫', exact: true }).click()
  await mySeat(a).getByRole('group', { name: 'ダイス' }).getByRole('button').first().click()
  await mySeat(a).getByRole('button', { name: '氷礫の1つ目の枠に置く' }).click()
  const bottom = await mySeat(a).evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY)
  expect(bottom).toBeLessThanOrEqual(640)
  expect(await a.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  await a.getByRole('button', { name: '決定' }).click()

  // 出したことは相手に伝わるが、何を出したかは公開まで伝わらない
  await expect(b.getByRole('img', { name: '相手は決定した' })).toBeVisible()
  await pass(b)

  await expect(result(a)).toHaveText('勝ち', { timeout: 20_000 })
  await expect(result(b)).toHaveText('負け', { timeout: 20_000 })
  expect(await ending(a)).toBe('決着あなたの勝ち')
  await expect(b.getByRole('button', { name: 'ロビーへ' })).toBeVisible()
  await expect(b.getByRole('timer')).toHaveCount(0)
})

test('再読み込みしても同じ席に戻り、出した行動も残っている', async ({ browser }) => {
  const { a, b, names } = await pair(browser, { hp: 2 })
  await interrupt(a)
  await expect(a.getByRole('button', { name: 'パス' })).toBeDisabled()

  await a.reload({ waitUntil: 'networkidle' })
  await expect(step(a, 1, 1)).toBeAttached({ timeout: 30_000 })
  await expect(a.getByRole('region', { name: names[1] })).toBeVisible()
  // 出した行動は残っていて、選び直せない。持ち時間は数え直さない
  await expect(a.getByRole('button', { name: 'パス' })).toBeDisabled()
  await expect(mySeat(a).getByRole('listitem', { name: '氷礫' }).getByRole('img', { name: /の目/ })).toHaveCount(1)
  await expect(a.getByRole('timer')).toBeVisible()

  await pass(b)
  await expect(result(a)).toHaveText('勝ち', { timeout: 20_000 })
  await expect(result(b)).toHaveText('負け', { timeout: 20_000 })
})

test('二人がもう一戦を押せば同じ部屋で続け、一人が抜ければ残った人は次の相手を待つ', async ({ browser }) => {
  const { a, b, names } = await pair(browser, { hp: 2 })
  await interrupt(a)
  await pass(b)
  await expect(result(a)).toHaveText('勝ち', { timeout: 20_000 })
  await expect(result(b)).toHaveText('負け', { timeout: 20_000 })

  await a.getByRole('button', { name: 'もう一戦' }).click()
  await expect(a.getByRole('button', { name: '相手を待っています' })).toBeDisabled()
  await expect(b.getByRole('img', { name: '相手はもう一戦を押した' })).toBeVisible()
  await b.getByRole('button', { name: 'もう一戦' }).click()
  for (const p of [a, b]) {
    await expect(step(p, 1, 1)).toBeAttached()
    await expect(mySeat(p).getByRole('img', { name: '体力 2 / 2' })).toBeVisible()
    await expect(result(p)).toHaveCount(0)
  }

  // 降参すれば相手の勝ち
  await b.getByRole('button', { name: 'メニュー' }).click()
  await b.getByRole('dialog', { name: 'メニュー' }).getByRole('button', { name: '降参' }).click()
  await b.getByRole('dialog', { name: '降参しますか？' }).getByRole('button', { name: '降参する' }).click()
  await expect(result(a)).toHaveText('勝ち')
  expect(await ending(a)).toBe('決着降参で、あなたの勝ち')

  await b.getByRole('button', { name: 'ロビーへ' }).click()
  await expect(b.getByRole('heading', { name: 'ロビー β' })).toBeVisible()
  await expect(a.getByText('相手が抜けました')).toBeVisible()
  await expect(a.getByText('相手を待っています')).toBeVisible()
  await expect(b.getByRole('button', { name: `${names[0]}の部屋に入る` })).toBeVisible()

  // 残った人も抜ければ、部屋は一覧から消える
  await a.getByRole('button', { name: 'ロビーへ' }).click()
  await expect(b.getByRole('button', { name: `${names[0]}の部屋に入る` })).toHaveCount(0)
})

test('持ち時間までに出さず、戻ってこなければ時間切れで負ける', async ({ browser }) => {
  const { a, b } = await pair(browser, { hp: 2, stepMs: 4000 })
  // 残りが少ないので、時計は最初から色を変えて出す
  await expect(a.locator('.countdown.is-hurry')).toBeVisible()
  await interrupt(a)
  await b.context().close()
  await expect(a.getByRole('img', { name: '相手の接続が切れている' })).toBeVisible()
  await expect(result(a)).toHaveText('勝ち', { timeout: 20_000 })
  expect(await ending(a)).toBe('決着時間切れで、あなたの勝ち')
})
