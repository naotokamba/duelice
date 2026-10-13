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
      // Worker の入口 server.ts と Durable Object の殻 *-object.ts は cloudflare:workers を読み、workerd の中でしか動かない。
      // 中身は room.ts、lobby.ts、api.ts の純粋な関数に寄せて単体テストで確かめ、殻は e2e の二人対戦で通す
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/routeTree.gen.ts',
        'src/router.tsx',
        'src/routes/**',
        'src/server.ts',
        'src/server/*-object.ts',
      ],
      // 下回ると pnpm test:coverage が失敗する。どれも今の値のすぐ下に置いて、テストの抜けにすぐ気づけるようにする
      thresholds: {
        statements: 98,
        branches: 97,
        functions: 99,
        lines: 99,
        'src/game/**': { statements: 99, branches: 98, functions: 99, lines: 99 },
        'src/components/**': { statements: 99, branches: 97, functions: 99, lines: 99 },
      },
    },
  },
})
