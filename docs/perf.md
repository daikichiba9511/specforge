# Performance

specforge のベンチ・プロファイリング手順。CI 連携は無し (ローカル運用)。

## ベンチを走らせる

```bash
deno task bench
```

[Deno.bench](https://docs.deno.com/runtime/manual/tools/benchmarker/) が `bench/*_bench.ts`
を自動検出し、`time/iter (avg)` `p75` `p99` などを表で出す。 fixture は `bench/_fixtures.ts` で合成
(`_` プレフィックスのため自動検出対象外)。

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
deno bench --json bench/ > /tmp/before.json
# ...コード編集...
deno bench --json bench/ > /tmp/after.json
deno task bench:compare /tmp/before.json /tmp/after.json
```

変化率の表が出る。デフォルトでは 1 件でも `+20%` 超で exit 1。閾値は `--threshold=10`
などで上書き可。

ノイズの目安: 同一バイナリを 2 回走らせても `±10%`
程度はぶれる。レギュレッション判定したい場合は計測を複数回回して傾向を見る。

## CPU プロファイルを取る

V8 の inspector + Chrome DevTools / [speedscope](https://speedscope.app/) を使う。

1. inspector 待機モードで bench を起動。

   ```bash
   deno run --inspect-brk --allow-read bench/parser_bench.ts
   ```

2. Chrome で `chrome://inspect` を開き、Target の `inspect` をクリック。
3. **Sources** タブで再生ボタン (Continue) を押す前に、**Profiler** タブで `Start`。
4. Sources で Continue → bench が完走 → Profiler で `Stop` → `Save profile`。
5. `.cpuprofile` を [speedscope](https://speedscope.app/) にドラッグ&ドロップ。Left Heavy / Sandwich
   表示で hot path を確認。

ピンポイントで特定 fixture だけ計測したい場合は、対象 `Deno.bench` のみ残した `*_bench.ts`
を一時的に作るのが手軽。

## メモリプロファイル

Chrome DevTools の **Memory** タブで Heap snapshot。`--inspect-brk` で同様にアタッチ。 parse()
を複数回呼ぶワーカースクリプトを書き、AST が GC で開放されているか (RetainedSize の推移)
を見る用途。

## 着目ポイント

過去計測から、最適化を始める場合に最初に当たる候補:

| 箇所                            | 現状 (10k transitions)          | 候補                                         |
| ------------------------------- | ------------------------------- | -------------------------------------------- |
| `RE_TRANSITION` (regex 実行)    | parse 経路の大半                | 単純な `indexOf("-->")` で分割する fast-path |
| `RE_LABEL`                      | ラベル有無で 2x 差              | 必要な時だけ評価 (現状そうなっている)        |
| `collectTransitions` の flatMap | cspm 経路の大半                 | pre-allocated array + push に変える          |
| `Array.from(map.entries())`     | sort 不在で済むなら直接 forEach | Map 自体の挿入順を信頼する                   |

数字を取った上で意味のある最適化だけ入れる方針 (推測で書き換えない)。

## 参考

- Deno bench: https://docs.deno.com/runtime/manual/tools/benchmarker/
- speedscope: https://github.com/jlfwong/speedscope
- V8 profiler: https://v8.dev/docs/profile
