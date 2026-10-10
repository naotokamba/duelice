import { defineConfig } from 'vitest/config'

// ゲームロジックとCPUの単体テスト用。Cloudflareのプラグインは読み込まない
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
