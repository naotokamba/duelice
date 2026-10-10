import { defineConfig } from 'vitest/config'

// バランス記録だけを走らせる。数十秒かかることがある
export default defineConfig({
  test: {
    include: ['src/**/*.slow.test.ts'],
    testTimeout: 300_000,
  },
})
