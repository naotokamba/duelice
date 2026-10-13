# 開発の手引き

## 確かめる

| コマンド | 内容 |
| --- | --- |
| `pnpm check` | 型、Biome、全テストとカバレッジの下限、バランスの記録。コミットの前に通す |
| `pnpm test:e2e` | 本物のブラウザで画面を通して確かめる。画面の高さや押せるものの大きさもここで測る。開発サーバが動いていればそれを使い、無ければ自分で立てる |
| `pnpm test:mutation` | 対局の中身 `src/game` と、オンライン対戦の部屋の中身 `src/server` の純粋な関数にわざと小さな誤りを入れ、テストが見つけるかを測る。数分かかる。どちらかを変えたときに |
| `pnpm format` | 整形と、直せる指摘の自動修正 |

初めて `pnpm test:e2e` を走らせるときは、`pnpm exec playwright install --with-deps chromium` でブラウザを入れる。

バランスの記録の数字が変わったら、変化が意図どおりか確かめてから `pnpm test:balance -u` で記録を更新し、記録の差分をコミットに含める。

main への push と pull request では、GitHub Actions が `pnpm check` と `pnpm test:e2e` を走らせる。変異テストは毎週と、手で起動したときに走る。

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
