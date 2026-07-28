# specforge examples

[spec-behavior skill](../.agents/skills/spec-behavior/SKILL.md) の規律に従って書かれた振る舞い仕様
サンプル。 specforge の機能を 段階的にカバーする 6 正常例 + 意図的に問題のある 2 反例 = 計 8 例。
正常例は `deno task verify --bound=N` で TLC に流して deadlock-free check 済み、 反例は specforge /
TLC の検出機能 (V004 警告 / deadlock 検出) を実演する。

## 例の一覧

### 正しく書けた例 (verified ok)

| 例                                                 | 規模   | カバー機能                                                                | 検証結果 (bound=3)            |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------- | ----------------------------- |
| [`traffic-light.mmd`](./traffic-light.mmd)         | 最小   | flat states + ガード (辞書無しで warn 3 件、教育用)                       | (`.mmd` 形式、TLC 用ではない) |
| [`vending-machine.md`](./vending-machine.md)       | 小     | linear pipeline + 1 state var + payload binding                           | 42 / 14 distinct              |
| [`db-connection-pool.md`](./db-connection-pool.md) | 中     | 複数 state var + 複数 payload event + retry / shutdown 分岐               | 218 / 47 distinct             |
| [`producer-consumer.md`](./producer-consumer.md)   | 小〜中 | composite + **直交領域** (Producer / Consumer 並行) + 完了/triggered exit | 211 / 68 (bound=2)            |
| [`order-workflow.md`](./order-workflow.md)         | 大     | composite + 直交領域 + 複数 state var + payload + retry + 多経路          | 2744 / 512 distinct           |
| [`internal-events.md`](./internal-events.md)       | 小     | `internal_xxx` 命名規約 + state var + payload binding                     | 35 / 10 distinct              |

### 意図的に問題のある例 (specforge / TLC の検出機能を実演)

| 例                                               | 何を実演するか                                                                      | 期待される挙動                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`deadlock.md`](./deadlock.md)                   | composite region 内に出口なしの state → V005 で静的検出 + 完了不可で TLC が動的検出 | `cli` で `warn V005: state 'Stuck' has no outbound`、`verify` → `Error: Deadlock reached.` (exit 11) |
| [`unreachable-state.md`](./unreachable-state.md) | 宣言されているが誰からも到達されない state → V004 warning                           | `cli` で `warn V004: state 'Orphan' is unreachable`、`verify` 自体は ok                              |

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
- **internal-events**: `internal_xxx` 命名規約のデモ。 外部 (ユーザ/管理者) からのトリガーと、
  内部状態の検査による自発発火を命名で区別する。 ロックアウト検出を例に使用。 現状 specforge は
  internal 接頭辞を特別扱いしない (CSPm の hiding は Pending)
- **deadlock**: composite region 内に `[*]` への経路がない state を入れて、 region が完了 でき ない
  → 全 region `_done` を要求する完了遷移が永遠に発火不能 → TLC が deadlock 検出。 「forgotten error
  recovery」のアンチパターン
- **unreachable-state**: 宣言だけ存在して誰からも到達されない state を含む。 specforge の validation
  pass (V004) で warn が出る。 TLC は到達不能な state を見ないので verify 自体は通る ことが「TLC
  と静的解析が補完関係にある」ことを示すデモ

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
