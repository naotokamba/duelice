# Duelice の開発メモ

3個のダイスで読み合う対戦ゲームの試作。TanStack Start、React、TypeScript で書き、Cloudflare Workers に載せる想定。パッケージ管理は pnpm。

## 変更したら必ず

```sh
pnpm check
```

型チェック、Biome、全テスト、カバレッジ閾値をまとめて走らせる。通らない変更はコミットしない。

ルールやカードの数値を変えたら `pnpm test:balance` も走らせる。数字の変化が意図どおりなら `-u` で記録を更新し、記録の差分をコミットに含める。

## 構成の約束

- `src/game/` はルール本体。React にも DOM にも依存しない純粋関数で書く。オンライン対戦ではサーバ側でそのまま動かす
- 乱数は必ず引数で受け取る。`Math.random` を直接呼ぶのは画面の既定値だけ
- カードの知識は `src/game/cards.ts` の定義表に集める。`rules.ts` や画面でカード名による分岐を書かない。新しい仕組みが要るときは `ActionDef` に性質を足し、その性質で分岐する
- 画面の操作から行動を作る処理は `compose.ts` に置き、コンポーネントには書かない
- 相手の手は `Game` の `opponent` で差し替えられる。テストとオンライン対戦の入口

カードを足す手順は `docs/adding-a-card.md` にある。

## テストの層

| ファイル | 役割 |
| --- | --- |
| `src/game/cards.test.ts` | カードの仕様表。カード同士のぶつかり方と期待ダメージ |
| `src/game/invariants.test.ts` | どのカードにも成り立つ性質を fast-check で検査 |
| `src/game/rules.test.ts` | ターンの進行の例示 |
| `src/game/compose.test.ts` | 画面の操作から行動を組み立てる処理 |
| `src/game/matrixGame.test.ts` | 行列ゲームの解が均衡になっているか |
| `src/game/cpu.test.ts` | CPU の戦略が均衡で、強さの順序が保たれているか |
| `src/components/Game.test.tsx` | 画面の操作の流れ。乱数と相手の手を差し替えて固定し、公開の動きと自動の進行は偽の時計で進める |
| `src/components/Exchange.test.tsx` | 公開の舞台の描き分け。場面ごとに矢印、構えの印、受けたダメージの星が出るか |
| `src/components/Tip.test.tsx` | 印に添える一行の説明の出し入れ |
| `src/game/balance.slow.test.ts` | バランスの記録。`pnpm test:balance` で別に走らせる |
| `pnpm test:mutation` | 変異テスト。ルール本体にわざと小さなバグを入れ、テストが検出できる割合を測る。85%を下回ると失敗する。数分かかる |

変異テストで生き残る変異の多くは、結果の変わらない等価な変異。並び順の付け方や、正規化で打ち消される計算など。新しく生き残った変異が等価でなければ、テストを足す。

テストで局面を作るときは `src/test/helpers.ts` の `makeState`、乱数は `seeded` を使う。

## 書き方

- Biome の設定に従う。`pnpm format` で整形する
- コメントと画面の文言は日本語。画面の文言は平易に、括弧で補足しない
- 押せるものは 48×48 以上にし、間を 8 以上空ける。Google の Android のアクセシビリティの指針に合わせた値で、styles.css の `--tap` と `--tap-gap` にある
- 設計の判断の記録は Claude Docs の「ダイス対戦ゲーム 確定ルール」にある

## リリース

本番は https://duelice.naotokamba.com 。`v` で始まるタグを push すると、GitHub Actions が `pnpm check` を通したうえで Cloudflare Workers に出す。仕組みは `.github/workflows/release.yml` にある。公開の経路はこれだけで、手元から `wrangler deploy` はしない。

```sh
git tag v0.2.0
git push origin v0.2.0
```

Cloudflare の API トークンはリポジトリの secret `CLOUDFLARE_API_TOKEN` に入っている。
