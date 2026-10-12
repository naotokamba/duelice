// スマホで指を使って置く。カードの名前で出すカードを替え、押して置き、指で引きずって置き、
// 別のカードに替えると置いたダイスが手元に戻ることを、本物のブラウザの指の入力で確かめる。

import { expect, test } from '@playwright/test'
import { confirm, myCard, mySeat, slot, start, touchDrag, trayDie } from './fixture'

test.use({ viewport: { width: 430, height: 737 }, hasTouch: true, isMobile: true })

test('指で置き、別のカードに替えると置いたダイスが戻る', async ({ page }) => {
  await start(page, {
    turns: [
      [
        [6, 5, 2],
        [1, 2, 3],
      ],
    ],
  })
  const tab = (name: string) => mySeat(page).getByRole('button', { name, exact: true })
  const tray = mySeat(page).getByRole('group', { name: 'ダイス' })

  // 最初は左端の火球が出ている
  await expect(tab('火球')).toHaveAttribute('aria-pressed', 'true')

  // 押して持ち、押して置く
  await trayDie(page, 6).tap()
  await slot(page, '火球のXの枠').tap()
  // 指で引きずって、もう一つの枠に置く
  await touchDrag(page, trayDie(page, 5), slot(page, '火球の2つ目の枠'))
  const fireball = myCard(page, '火球')
  await expect(fireball.getByRole('button', { name: '6の目を戻す' })).toBeVisible()
  await expect(fireball.getByRole('button', { name: '5の目を戻す' })).toBeVisible()
  await expect(confirm(page)).toBeEnabled()
  await expect(tray.getByRole('button')).toHaveCount(1)

  // 別のカードに替えると、そのカードが出て、置いたダイスは手元に戻る
  await tab('障壁').tap()
  await expect(tab('障壁')).toHaveAttribute('aria-pressed', 'true')
  await expect(myCard(page, '障壁')).toBeVisible()
  await expect(tray.getByRole('button')).toHaveCount(3)
  await expect(confirm(page)).toHaveCount(0)
  await tab('火球').tap()
  await expect(fireball.getByRole('button', { name: /の目を戻す$/ })).toHaveCount(0)
})
