# 遷移ラベル `event [guard] / action` の読み方

UML state diagram の遷移ラベル `event [guard] / action` を、 spec-behavior 規律でどう書き、
specforge がどう解釈するかを段階的に整理する。 ラベル 1 つで多くの情報を伝えられる便利な 記法だが、
省略パターンが多く慣れが必要。

> 文法仕様は [`./spec.md`](./spec.md) §4、 背景理論は [`./concepts.md`](./concepts.md) §2 を参照。

---

## 1. ラベルとは

Mermaid stateDiagram-v2 の遷移は `From --> To : <ラベル>` の形を取る:

```
Idle --> Selecting : coin_inserted [balance > 0] / log_coin
```

`:` の右が **ラベル**。 これが「何をきっかけに」「どんな条件で」「何の副作用とともに」遷移するかを
表現する。

UML の慣習で、 ラベルは 3 つの構成要素から成る:

```
event [guard] / action
```

3 つすべて optional。 何個か省略するパターンが多い (後述)。

---

## 2. 3 つの構成要素の役割

### event (トリガ)

「何をきっかけに遷移するか」を表す名前。 外部から飛んでくる signal や、 内部で発火する条件。

```
A --> B : tick
```

「`tick` event が来たら A から B に遷移」。

### guard (ガード条件)

「event が来ても、 この条件が true でないと遷移しない」フィルタ。 `[ ]` で囲む:

```
A --> B : tick [count_done]
```

「`tick` event が来て、 かつ guard `count_done` が成立すれば遷移」。 specforge では guard 名は
`### ガード定義` 表で式に対応付ける ([`./spec.md`](./spec.md) §5.3)。

### action (副作用)

「遷移時に実行する処理」。 `/` の右に書く:

```
A --> B : tick / log_change
```

「tick で遷移、 ついでに `log_change` を発火」。 action は形式的には event prefix と同じ扱い (CSPm
の `act -> Next`、 TLA+ の action 述語の一部)。

複数 action は `,` で並べる (順次実行):

```
A --> B : tick / log, increment, notify
```

---

## 3. 省略パターン一覧

3 要素はそれぞれ optional なので、 組合せで 8 通り (全省略 / event のみ / ... ) 出てくる。
代表的なものをカバーする:

| 形                       | 例                                          | 意味                                           |
| ------------------------ | ------------------------------------------- | ---------------------------------------------- |
| `event`                  | `A --> B : timer`                           | event 受信で副作用なく遷移                     |
| `event [guard]`          | `A --> B : timer [count_done]`              | event + guard 成立で遷移                       |
| `event / action`         | `A --> B : timer / log`                     | event 受信時 action 実行                       |
| `event [guard] / action` | `A --> B : timer [count_done] / log_change` | フルパターン                                   |
| `/ action`               | `A --> B : / notify`                        | 完了遷移 (composite の全 region 終了時 / 自動) |
| `[guard] / action`       | (非推奨)                                    | event 省略 = 内部発火、 specforge は推奨せず   |
| (ラベルなし)             | `[*] --> Idle`                              | 即座に副作用なく遷移 (初期遷移などで使う)      |

### `/ action` の特殊性 — **完了遷移**

event 部分が空なら、 これは event を契機としない遷移。 主に **composite から外への完了遷移** を表す:

```
state Working {
    [*] --> Active
    Active --> [*] : done
}
Working --> Next : / notify_complete
```

`Working --> Next : / notify_complete` は「Working の全 region が `[*]` (終了状態) に到達した時、
自動で `notify_complete` action を発火しつつ Next に遷移」と読む。 spec-behavior 規律の 「composite
完了 → 次段」を表す慣用句。

### ラベルなし

初期遷移 `[*] --> Idle` のように、 event も guard も action も無い場合は「parent state に入った
瞬間に自動で発火」を意味する。

---

## 4. 引数表記 — `name(arg1, arg2)`

event や action が引数を取る場合は関数形式で書く:

```
A --> B : coin_inserted(balance) [balance > 0] / log_change(balance)
```

`coin_inserted(balance)` は「event `coin_inserted` に payload field `balance` が乗ってる」。 guard
内 `balance > 0` は受信した balance を参照。 action `log_change(balance)` も同じ値を使う。

spec-behavior の規律: 引数は event 契約表で payload として宣言された field を参照する
([`./spec.md`](./spec.md) §5.1)。 引数 nameと state var name が一致する場合、 TLA+ では 非決定的に
bind されて `<var>' = new_<var>` の更新が走る (Phase 2 binding)。

引数なしの場合は `()` 省略可: `timer` でも `timer()` でも OK。

### specforge の parser での扱い

直近の parser 拡張で、 specforge は event の name と args を **分解** して AST に格納する:

- 入力: `coin_inserted(balance)`
- AST: `event = "coin_inserted"`、 `eventArgs = ["balance"]`

これにより、 event 契約表で `coin_inserted` (bare) で登録されていても lookup が match する
ようになった。 詳細は tasks/todo.md の「event_name(arg) の bare 名抽出」項。

---

## 5. 実行順序 — ラベルを「読む」ときの時間軸

ラベルを見たとき、 頭の中で起きてる順序:

1. **event が到着**: 外部から (またはタイマーから) trigger event が飛んでくる
2. **guard を評価**: 事前状態と event の payload を使って guard 式が true か判定
3. **遷移発火**: guard が true なら遷移開始
4. **action を実行**: 副作用 (log 出力、 別 event 発火 等) を実行
5. **新状態に到達**: To 側の state に遷移完了

たとえば `Idle --> Selecting : coin_inserted(balance) [balance > 0] / log_coin` だと:

1. `coin_inserted` event 到着 (balance = 5 などの値が乗ってる)
2. guard `balance > 0` を 評価 → 5 > 0 = true
3. 遷移発火
4. action `log_coin` 実行 (log を出力)
5. Selecting 状態に到達

guard が false なら、 そもそも遷移は発火しない (action も実行されない)。 別の遷移が match
すればそちらが発火するし、 どれも match しなければ event は捨てられる (spec-behavior 規律で
「未定義イベントの扱い」を `無視 (self-loop / no-op)` と宣言した場合)。

---

## 6. spec-behavior 規律での追加制約

書く側のディシプリンとしての制約。 specforge は parser ではここまでチェックしないが、 spec-behavior
の review モードで lint する:

### 6.1 event 名は snake_case の動詞

`coin_inserted`、 `parse_done`、 `validate_failed` のような **過去分詞 or 完了感のある動詞**。
「何かが起きた」ことを表す。

NG: `CoinInserted` (camelCase)、 `coin` (名詞単独)

### 6.2 internal_xxx 接頭辞

外部 trigger ではなく、 内部状態の検査や時間経過で発火する event は `internal_xxx` で書く:

```
Awaiting --> Locked : internal_check_lockout [too_many_failures] / lock_account
```

specforge は現状 `internal_*` を特別扱いしない (通常の event と同じ channel として宣言) が、 将来
CSPm 側で `\ {internal_*}` 形式の hiding に対応する案あり (tasks/todo.md 参照)。

### 6.3 guard は **辞書経由**

guard 式を直接ラベルに書くのではなく、 タグ名で参照し `### ガード定義` 表で式を定義する:

```mermaid
A --> B : ev [count_done]  %% タグ参照
```

```markdown
### ガード定義

| ガード ID    | 条件           | 根拠             |
| ------------ | -------------- | ---------------- |
| `count_done` | `count >= 100` | バッチ完了の閾値 |
```

ラベルが短くなり、 guard 式の再利用 / 一覧性が上がる。 specforge は遷移時に辞書を引いて TLA+ / CSPm
に式を展開する。

### 6.4 action は idempotent or accumulative を宣言

`### アクション定義` 表で「冪等」「累積」を明示。 at-least-once 配信の影響を読み手が把握できる
ようにする (spec-behavior 規律)。

---

## 7. ラベル → 形式手法への変換 (要点だけ)

詳細は [`./spec.md`](./spec.md) §7、 ここでは雰囲気だけ:

### TLA+ の場合

```
Idle --> Selecting : coin_inserted(balance) [has_money] / log_coin
```

```tla
Idle_coin_inserted_Selecting ==
    /\ phase = "Idle"
    /\ \E new_balance \in Domain:
         /\ new_balance > 0
         /\ phase' = "Selecting"
         /\ balance' = new_balance
```

guard `[has_money]` (= `balance > 0`) は `new_balance > 0` に rename されて conjunct に。 action は
TLA+ では action 述語自体になるので別表現しない (TLA+ 設計選択、 [`./decisions.md`](./decisions.md)
参照)。

### CSPm の場合

```cspm
Idle(balance) = coin_inserted?balance -> (balance > 0) & log_coin -> Selecting(balance)
```

event は `?` 受信、 guard は `(cond) &` で blocking、 action は prefix `->` で発火。 詳細は
[`./csp-reading.md`](./csp-reading.md) を参照。

---

## 8. よくある誤解

### 「guard で event を発火するか決まる」 vs 「guard で遷移するか決まる」

正: 後者。 event は外から飛んでくるもので、 spec 側は受信するだけ。 guard が false ならその **遷移**
が選ばれないだけで、 別の遷移 (同 event で別 guard) が match すればそちらが発火する。

### 「action は遷移後の処理」 vs 「action は遷移の一部」

正: 遷移の一部。 「遷移発火 → action → 新状態到達」だが、 これは atomic に起きる (= 中間状態は
観測できない)。 action は副作用というより、 遷移そのものに付随する効果。

### 「`/ action` は state 入場時の処理」 vs 「`/ action` は完了遷移」

UML には別途 `entry / action` 記法があり (state に入った時に発火) これは specforge では非対応。
specforge の `/ action` は完了遷移 (event 省略) のラベル省略形を意味する。

### 「複数 action は並列実行」 vs 「順次実行」

正: 順次。 `/ a, b, c` は `a` → `b` → `c` の順で起こる。 atomic ではあるが順序がある。

---

## 9. cheatsheet

| ラベル                 | 読み下し                        |
| ---------------------- | ------------------------------- |
| `: timer`              | timer event 受信で遷移          |
| `: timer [done]`       | timer + guard `done` 成立で遷移 |
| `: timer / log`        | timer 受信、 log 発火、 遷移    |
| `: timer [done] / log` | フルパターン                    |
| `: / notify`           | 自動 / 完了遷移、 notify 発火   |
| `:` なし or なし       | 副作用なし即遷移                |
| `: ev(x)`              | event ev、 payload field x      |
| `: ev(x) [x > 0]`      | x の値で分岐                    |
| `: internal_check`     | 内部 event (規律で命名)         |

ラベル 1 つで多くを伝えるので、 慣れると `event [guard] / action` のリズムで読めるようになる。

---

## 10. もっと知りたいとき

- UML state machine 仕様: OMG UML 2.5、 https://www.omg.org/spec/UML/
- spec-behavior skill: `~/.claude/skills/spec-behavior/SKILL.md` (本リポジトリ外の dotfiles)
- [`./spec.md`](./spec.md) §4 — specforge の正準文法
- [`./csp-reading.md`](./csp-reading.md) — 変換先 (CSPm) の読み方
- [`./concepts.md`](./concepts.md) — 全体の theoretical 背景
