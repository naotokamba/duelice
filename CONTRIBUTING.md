# 開発の手引き

## 確かめる

| コマンド | 内容 |
| --- | --- |
| `pnpm check` | 型、Biome、全テストとカバレッジの下限、バランスの記録。コミットの前に通す |
| `pnpm test:e2e` | 本物のブラウザで画面を通して確かめる。画面の高さや押せるものの大きさもここで測る。開発サーバが動いていればそれを使い、無ければ自分で立てる |
| `pnpm test:mutation` | 対局の中身 `src/game` と、オンライン対戦の部屋の中身 `src/server` の純粋な関数にわざと小さな誤りを入れ、テストが見つけるかを測る。数分かかる。どちらかを変えたときに |
| `pnpm eval:pool` | カードの強さの評価。つよい CPU どうしで数万局を戦わせ、`reports/eval/latest.md` に表を書く。十数分かかる。カードや CPU を変えたときに |
| `pnpm format` | 整形と、直せる指摘の自動修正 |

初めて `pnpm test:e2e` を走らせるときは、`pnpm exec playwright install --with-deps chromium` でブラウザを入れる。別の作業ツリーの開発サーバが 3000 番を使っているときは、`E2E_PORT=3200 pnpm test:e2e` のように別の番号で立てて確かめる。

バランスの記録の数字が変わったら、変化が意図どおりか確かめてから `pnpm test:balance -u` で記録を更新し、記録の差分をコミットに含める。

main への push と pull request では、GitHub Actions が `pnpm check` と `pnpm test:e2e` を走らせる。変異テストは毎週と、手で起動したときに走る。

## カードの強さの評価

`pnpm eval:pool` は `src/eval` の道具で、次を順に測る。引数で局数や段を変えられる。使い方は `src/eval/pool.ts` の頭に書いてある。

- 差し替え: スターターの1枚を拡張のカードに替えた 11×5 のデッキを、スターター相手と、互いの総当たりで戦わせる。勝率と 95% の区間、Bradley–Terry の強さを出す
- 無作為: 重なりの無い5枚のデッキを無作為に選んで戦わせ、デッキの強さと、カードごとの寄与と使用率を出す
- 上位: 強さの上位どうしの相性表と、全てに勝ち越すデッキがあるか。一択率、賭け金、ターン数、引き分けの割合を面白さの目安として出す
- 互換の疑い: 局面で、あるカードの行動が別のカードの行動に常に弱く支配されるか。差し替えで、ある1枚を別の1枚に替えるとどの相手にも勝率が下がらないか

カードを選ぶ対戦で CPU が持ち込むデッキは `src/game/decks.ts` の表から選ぶ。カードを調整したら、評価の全体の強さの上位から選び直す。

対戦の結果は二つのデッキ、カードの定義の指紋、対局の中身と CPU の指紋、種ごとに `reports/eval/cache` に覚え、同じ組は測り直さない。カードを変えると、そのカードを含む組だけを測り直す。明らかに弱いデッキは理由を添えて `reports/eval/skip.json` に記録し、カードが変わるまで無作為の評価から外す。接戦の組には局数を足す。GitHub Actions の `eval` を手で起動しても走り、結果の表が残る。

## CPU の作り

- CPU は `src/game/cpu.ts`。二ステップの同時手番を行列ゲームとして解く。一ステップ目の要素一つごとに二ステップ目を解くので、行列が大きいときは `src/game/doubleOracle.ts` の double oracle で、均衡に要る要素だけを求める。全ての要素を解いたときと同じ価値の均衡になることを、`cpu.test.ts` が乱数の局面で確かめる
- 画面の CPU は `src/components/cpuBrain.ts` から Worker `cpu.worker.ts` で考え、画面を止めない。Worker の無いテストの偽の DOM では、その場で考える。考えるのに長くかかると、相手の名前に考え中の印を出す
- 一手の考える時間は、重いデッキでも、手元の node で 0.5 秒以下を目安にする

## オンライン対戦の作り

- サーバは Cloudflare の Durable Object。ロビーに一つ、部屋ごとに一つ置く。入口は `src/server.ts` で、`/api` だけを受け、ほかは TanStack Start に任せる
- 部屋とロビーの中身は `src/server/room.ts`、`lobby.ts`、`api.ts` の純粋な関数で、時刻と乱数を外から受け取る。Durable Object の殻 `*-object.ts` は保存、WebSocket、アラーム、ロビーへの知らせだけをする。殻は workerd の中でしか動かないので、単体テストの網羅からは外し、`e2e/online.spec.ts` の二人対戦で通す
- 画面とサーバのやりとりの形は `src/online/protocol.ts` に置く。サーバは席0と席1のまま送り、画面は自分を席0とした向きに直して、CPU 戦と同じ卓 `Table` に渡す
- 開発サーバでは、部屋を作るときに持ち時間 `stepMs` と体力 `hp` を短くできる。e2e が速く決着させるためで、本番のサーバは無視する
- Durable Object のクラスを足す、名前を変える、消すときは、`wrangler.jsonc` の `migrations` に新しい `tag` の段を足す。出した段は書き換えない

## 本番に出す

`v` で始まるタグを push すると、GitHub Actions が同じ確認を通してから Cloudflare Workers に出す。本番は https://duelice.naotokamba.com 。出す経路はこれだけで、手元から `wrangler deploy` はしない。Cloudflare の API トークンはリポジトリの secret `CLOUDFLARE_API_TOKEN` に入っている。

```sh
git describe --tags --abbrev=0   # 今の版を見る
git tag v0.6.0
git push origin v0.6.0
```

## 決めたことと、決まっていないこと

決めたことは、コードとテストがそのまま記録になっている。まだ決まっていないことや直したいことは GitHub の issue に置く。

## 書き方

書き方は今のコードを手本にする。守らないと困る決まりはテストにしてあり、破ると `pnpm check` か `pnpm test:e2e` が落ちる。
