// 変異テスト。対局の中身と、オンライン対戦の部屋の中身にわざと小さなバグを入れ、テストが見つけられるかを確かめる。
// 結果の変わらない変異は、確かめたうえでソースに Stryker disable の注記を付ける。注記の無い変異が生き残ったら、テストを足すか注記する。
// 行列ゲームの解法 matrixGame.ts は対象にしない。生き残る変異の多くは同点の選び方や誤差の幅を変えるだけで、
// 正しさは matrixGame.test.ts が、解き方によらない均衡の性質で確かめている。
// テストの読み込みそのものが失敗する変異は、この実行環境では見つけたと数えられない。そうなる変異にも注記を付ける。

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.mutation.config.ts' },
  mutate: [
    'src/game/rules.ts',
    'src/game/cards.ts',
    'src/game/slots.ts',
    'src/game/hand.ts',
    'src/game/match.ts',
    'src/game/face.ts',
    'src/game/perspective.ts',
    'src/game/decks.ts',
    'src/server/room.ts',
    'src/server/lobby.ts',
    'src/server/api.ts',
  ],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  coverageAnalysis: 'perTest',
  thresholds: { high: 100, low: 98, break: 95 },
  tempDirName: '.stryker-tmp',
}
