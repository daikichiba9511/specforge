# Performance

specforge のベンチ・プロファイリング手順。CI 連携は無し (ローカル運用)。

## ベンチを走らせる

```bash
bun run bench
```

`bench/run.ts` は Tinybench で各ケースの実行時間とスループットを計測する。
入力データの生成と、CSPm への変換に使う構文木の準備は計測前に行う。

カバーしているケース:

| カテゴリ                          | サイズ                        | 想定                                      |
| --------------------------------- | ----------------------------- | ----------------------------------------- |
| `parse linear 100` / `1k` / `10k` | ラベル無し線形チェーン        | 行数スケーリングの基準線                  |
| `parse labeled 1k`                | event/guard/action 付き 1k 本 | `RE_LABEL` 経路の負荷                     |
| `parse composite 20x50`           | 20 composite × 50 内部遷移    | `parseRegions ↔ parseStmt` 相互再帰       |
| `cspm linear ...`                 | 同上 (parse 済み)             | `collectTransitions` の flatMap + groupBy |
| `cspm composite 20x50`            | 同上                          | composite の再帰平坦化                    |

## before / after を比較する

```bash
bun run bench --json > /tmp/before.json
# ...コード編集...
bun run bench --json > /tmp/after.json
bun run bench:compare /tmp/before.json /tmp/after.json
```

変化率の表が出る。デフォルトでは 1 件でも `+20%` 超で exit 1。閾値は `--threshold=10`
などで上書き可。

性能の比較には、同じマシンと Bun バージョンで取得した結果を使う。
Deno 時代の JSON も読み込めるが、実行エンジンと計測方法が異なるため、移行後の基準値は Bun で取り直す。

## CPU プロファイルを取る

```bash
bun --cpu-prof --cpu-prof-dir=/tmp bench/run.ts
```

生成された `.cpuprofile` を Chrome DevTools の Performance パネルで開くと、各関数に費やした時間を確認できる。

## メモリプロファイル

```bash
bun --heap-prof --heap-prof-dir=/tmp bench/run.ts
```

生成された `.heapprofile` を Chrome DevTools の Memory パネルに読み込むと、メモリを確保した関数を調べられる。

## 着目ポイント

Deno 時代の計測から、最適化を始める場合に最初に当たる候補:

| 箇所                            | 現状 (10k transitions)          | 候補                                         |
| ------------------------------- | ------------------------------- | -------------------------------------------- |
| `RE_TRANSITION` (regex 実行)    | parse 経路の大半                | 単純な `indexOf("-->")` で分割する fast-path |
| `RE_LABEL`                      | ラベル有無で 2x 差              | 必要な時だけ評価 (現状そうなっている)        |
| `collectTransitions` の flatMap | cspm 経路の大半                 | pre-allocated array + push に変える          |
| `Array.from(map.entries())`     | sort 不在で済むなら直接 forEach | Map 自体の挿入順を信頼する                   |

数字を取った上で意味のある最適化だけ入れる方針 (推測で書き換えない)。

## 参考

- [Tinybench](https://github.com/tinylibs/tinybench)
- [Bun のプロファイリング](https://bun.com/docs/project/benchmarking)
