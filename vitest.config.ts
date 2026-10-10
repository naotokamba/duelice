import { defineConfig } from 'vitest/config'

// ゲームロジックとCPUの単体テスト用。Cloudflareのプラグインは読み込まない
// 重いバランス記録は *.slow.test.ts に分け、pnpm test:balance で別に走らせる

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/*.slow.test.ts', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/routeTree.gen.ts', 'src/router.tsx', 'src/routes/**'],
      // 下回ると pnpm test:coverage が失敗する。ルール本体は特に高く保つ
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
        'src/game/**': { statements: 97, branches: 95, functions: 95, lines: 97 },
      },
    },
  },
})
