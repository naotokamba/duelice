// 決着の画面。中央の勝敗の文は、勝ち、負け、引き分けのどれでも、どの幅でも1行に収まり、枠からはみ出さない。
// 相打ちで決着しても中央は勝ちか負けか引き分けだけで、体力の比べは戦闘履歴に出すので、測る文はこの3つで足りる。

import { expect, test } from '@playwright/test'
import { resultText } from '../src/components/text'
import type { Action } from '../src/game/types'
import { start, step } from './fixture'

const SIZES = [
  { name: 'デスクトップ', width: 1920, height: 940 },
  { name: 'スマホ', width: 430, height: 737 },
  { name: '幅 390 のスマホ', width: 390, height: 664 },
  { name: '幅 360 のスマホ', width: 360, height: 640 },
]

/** 勝ち、負け、引き分けの文 */
const TEXTS = [resultText(0, 0), resultText(1, 0), resultText('draw', 0)]

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('決着の文は、勝ち、負け、引き分けのどれでも1行に収まる', async ({ page }) => {
      // 相手は2ターン続けて、6を詠唱して6と6で12の魔槍を放つ。こちらはパスし続けて、2ターン目の終わりに負ける
      const turn: [number[], number[]] = [
        [1, 2, 3],
        [6, 6, 6],
      ]
      const spear: Action[] = [
        { kind: 'spearChant', dice: [0] },
        { kind: 'spearCast', dice: [1, 2] },
      ]
      await start(page, { turns: [turn, turn], opponent: [...spear, ...spear] })
      for (const next of [step(page, 1, 2), step(page, 2, 1), step(page, 2, 2), null]) {
        await page.getByRole('button', { name: 'パス' }).click()
        await page.getByRole('dialog', { name: 'パスしますか？' }).getByRole('button', { name: 'パスする' }).click()
        if (next) await expect(next).toBeAttached({ timeout: 15_000 })
      }
      const text = page.locator('.result-text')
      await expect(text).toHaveText(resultText(1, 0), { timeout: 15_000 })

      // 文を入れ替えて、一文字だけのときと同じ高さで、中央の欄と画面からはみ出さないかを測る
      const measured = await text.evaluate((el, texts) => {
        // 中央の段の、ターンの箱と右端の印の間の欄
        const box = el.closest('.arena-main') as HTMLElement
        el.textContent = '勝'
        const oneLine = el.getBoundingClientRect().height
        return texts.map((t) => {
          el.textContent = t
          const r = el.getBoundingClientRect()
          const b = box.getBoundingClientRect()
          return {
            text: t,
            oneLine: Math.abs(r.height - oneLine) < 1,
            fits: r.left >= b.left - 1 && r.right <= b.right + 1,
            onScreen: r.left >= 0 && r.right <= window.innerWidth,
          }
        })
      }, TEXTS)
      for (const m of measured) expect(m).toEqual({ text: m.text, oneLine: true, fits: true, onScreen: true })
    })
  })
}
