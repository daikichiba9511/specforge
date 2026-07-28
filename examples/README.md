# specforgeのサンプル

このディレクトリには、[spec-behavior skill](../.agents/skills/spec-behavior/SKILL.md)の規則に従った振る舞い仕様を収録している。
正しく書けた7例と、意図的に問題を残した3例があり、構文解析、静的検査、TLCによるモデル検査を段階的に試せる。

表中の「生成状態数」はTLCが遷移中に生成した状態の総数、「異なる状態数」は重複を除いた状態数である。

## 正しく書けた例

| 例                                                               | 規模   | 主に確認できる機能                                   | TLCの結果                |
| ---------------------------------------------------------------- | ------ | ---------------------------------------------------- | ------------------------ |
| [traffic-light.mmd](./traffic-light.mmd)                         | 最小   | 単純な状態とガード。補助表のない`.mmd`入力           | TLC検査用ではない        |
| [vending-machine.md](./vending-machine.md)                       | 小     | 一つの状態変数とイベントのペイロード                 | 42生成、14種類           |
| [db-connection-pool.md](./db-connection-pool.md)                 | 中     | 複数の状態変数、境界条件、再試行、停止分岐           | 218生成、47種類          |
| [producer-consumer.md](./producer-consumer.md)                   | 小〜中 | 生産側と消費側の直交領域、完了遷移、途中退出         | 211生成、68種類（上限2） |
| [order-workflow.md](./order-workflow.md)                         | 大     | 階層状態、直交領域、状態変数、再試行、複数の終了経路 | 2744生成、512種類        |
| [internal-events.md](./internal-events.md)                       | 小     | `internal_`命名規則と状態変数                        | 35生成、10種類           |
| [parallel-order-retry-fixed.md](./parallel-order-retry-fixed.md) | 中     | 決済と在庫確保の並行処理、有限回の再試行、進行性     | 31生成、16種類           |

## 意図的に問題を残した例

| 例                                                   | 問題                                           | 期待する検出結果                                        |
| ---------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| [parallel-order-retry.md](./parallel-order-retry.md) | 決済を無制限に再試行でき、処理が終了しない     | 静的検査は成功し、TLCの進行性検査は失敗する             |
| [deadlock.md](./deadlock.md)                         | 複合状態の内部に出口がなく、全体が完了できない | 静的検査が出口不足を指摘し、TLCもデッドロックを検出する |
| [unreachable-state.md](./unreachable-state.md)       | 宣言した状態へ入る遷移がない                   | 静的検査が未到達状態を指摘し、TLCの検査自体は成功する   |

## 最初に読む例

初めて使う場合は、[vending-machine.md](./vending-machine.md)から始める。
短い状態機械の中で、イベントと一緒に受け取った残高がガードで評価され、次の状態へ引き継がれる様子を確認できる。

次に、[parallel-order-retry.md](./parallel-order-retry.md)と[parallel-order-retry-fixed.md](./parallel-order-retry-fixed.md)を比較するとよい。
前者では決済中と再試行中を無制限に往復できるため、処理が動き続けても終了しない。
後者では再試行回数を有限にし、二回目のタイムアウト後に失敗として終了する。
この比較によって、静的検査だけでは見つからない進行性違反をTLCが検出する役割を確認できる。

並行処理の最小例は[producer-consumer.md](./producer-consumer.md)、複数の機能を組み合わせた例は[order-workflow.md](./order-workflow.md)である。
内部イベントの命名規則は[internal-events.md](./internal-events.md)で確認できる。

## 実行する

リポジトリ内でDenoタスクを使う場合は、次のコマンドを実行する。

```bash
# CSPmを生成する
deno task cli examples/vending-machine.md

# TLA+を生成する
deno task cli --tla examples/vending-machine.md

# 抽象構文木と補助情報をJSONで表示する
deno task cli --json examples/vending-machine.md

# 静的検査の警告を失敗として扱う
deno task cli --json --strict examples/vending-machine.md

# 状態変数の値域を0..3としてTLCで検査する
deno task verify --strict --bound=3 examples/vending-machine.md
```

ビルド済みの`bin/specforge`をパスへ追加している場合は、`deno task cli`を`specforge`に、`deno task verify`を`specforge verify`に置き換える。

## 検査結果を読む

成功時は、次のような要約が出る。

```text
verified ok

42 states generated, 14 distinct states found, 0 states left on queue.
```

これは、指定した有限の値域と公平性の仮定の下で、生成したモデルに宣言済みの性質への反例が見つからなかったことを表す。
実装が仕様に適合することや、アクション内部の副作用は検査していない。

`--bound`を大きくすると状態変数が取り得る値の組合せが増える。
ガードの境界値へ到達できる最小値から始め、探索状態数と検査時間を見ながら広げる。
