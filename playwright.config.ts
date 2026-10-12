import { defineConfig, devices } from '@playwright/test'

// 本物のブラウザで画面を通して確かめるテスト。偽の DOM では見えない、大きさ、位置、指やマウスの引きずり、ダイアログの振る舞いを見る。
// 開発サーバで動かす。手元で pnpm dev を動かしていれば、それをそのまま使う

const PORT = 3000

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
