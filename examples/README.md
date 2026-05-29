# specforge examples

`spec-behavior` skill の規律に従って書かれた振る舞い仕様サンプル。各ファイルは
`deno task verify --bound=N` で TLC に流して deadlock-free check 済み。 specforge の機能を
段階的にカバーする 4 例 + 既存の最小例。

## 例の一覧

| 例                                                 | 規模   | カバー機能                                                                | 検証結果 (bound=3)            |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------- | ----------------------------- |
| [`traffic-light.mmd`](./traffic-light.mmd)         | 最小   | flat states + ガード (辞書無しで warn 3 件、教育用)                       | (`.mmd` 形式、TLC 用ではない) |
| [`vending-machine.md`](./vending-machine.md)       | 小     | linear pipeline + 1 state var + payload binding                           | 42 / 14 distinct              |
| [`db-connection-pool.md`](./db-connection-pool.md) | 中     | 複数 state var + 複数 payload event + retry / shutdown 分岐               | 218 / 47 distinct             |
| [`producer-consumer.md`](./producer-consumer.md)   | 小〜中 | composite + **直交領域** (Producer / Consumer 並行) + 完了/triggered exit | 211 / 68 (bound=2)            |
| [`order-workflow.md`](./order-workflow.md)         | 大     | composite + 直交領域 + 複数 state var + payload + retry + 多経路          | 2744 / 512 distinct           |

## 各例の使い分け

- **vending-machine**: specforge を初めて使う人がまず見る例。 markdown 表 → 生成 CSPm/TLA+ の
  対応関係が短い spec で追える。`balance > 0` の guard が payload binding で動的に評価される ことを
  TLC 出力で確認できる
- **db-connection-pool**: 複数 state var + ガード境界条件 (`under_limit` / `at_limit` / `empty`)
  を含むリソース管理パターン。 `--bound` を上げると状態空間がどう増えるか実感しやすい
- **producer-consumer**: composite + 直交領域の最小例。 Producer と Consumer が独立に進行し、 両方が
  `[*]` に到達した時点で `Drained` に遷移する **completion** と、いずれかの failure で 即 `Aborted`
  に抜ける **triggered exit** が同居する。 TLA+ 出力の `<comp>_r0` / `<comp>_r1` region
  変数の挙動が観察できる
- **order-workflow**: 全機能を組み合わせたリアルなサンプル。 EC サイトの注文ライフサイクル (Cart →
  Checkout → Confirmed → Shipped → Delivered / Cancelled / Returned) を retry / 並行 処理 /
  異常系も含めて書いた。 spec-behavior skill の review モードで lint するときの 練習対象としても

## 実行例

```bash
# CSPm 出力 (デフォルト)
deno task cli examples/vending-machine.md

# TLA+ 出力
deno task cli --tla examples/vending-machine.md

# AST + metadata を JSON で
deno task cli --json examples/vending-machine.md

# TLC で検証 (Domain = 0..3)
deno task verify --bound=3 examples/vending-machine.md

# validation を strict 化 (warning → failure)
deno task cli --strict examples/order-workflow.md
```

## 検証結果の見方

`deno task verify` の最後に `Model checking completed. No error has been found.` が出れば
deadlock-free 性が `--bound` で指定した値域の範囲で確認できたという意味。`states generated`
(探索した遷移パスの総数) と `distinct states found` (実際の状態数) が `--bound` に応じて増える。

例えば order-workflow を bound 違いで動かすと:

| `--bound` | states generated | distinct |
| --------- | ---------------- | -------- |
| 1         | 数十             | 数十     |
| 3         | 2744             | 512      |
| 5         | 数万             | 数千     |

bound が大きいほど state var が取りうる値の組合せが増え、 retry 経路や境界条件をより網羅的
に試せる。 ただし状態空間爆発に注意。
