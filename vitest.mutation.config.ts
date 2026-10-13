import { defineConfig } from 'vitest/config'

// 変異テスト用。重いCPUと画面のテストは外し、ルール本体とオンライン対戦の部屋の中身のテストだけで変異を検出できるかを見る
export default defineConfig({
  test: {
    include: ['src/game/**/*.test.ts', 'src/server/**/*.test.ts'],
    exclude: ['**/*.slow.test.ts', 'src/game/cpu.test.ts', '**/node_modules/**'],
  },
})
