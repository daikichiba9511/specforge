# specforge: 基本概念と背景

specforge を使う上で前提となる理論的な知識と、 ツールが何を繋いでいて、 何が検証できるのかを
段階的に整理する。 新規ユーザがツールを使い始める前に読むことを想定。 詳細仕様は
[`./spec.md`](./spec.md)、 採用判断は [`./decisions.md`](./decisions.md) を参照。

---

## 1. このツールが解決する問題

ソフトウェアの **振る舞いに関する仕様** (状態とイベントと遷移の組合せ) は、 手で書いたテキストで
管理されがちで、 「この仕様で本当に deadlock しないか」「特定の状態に必ず到達するか」を
人手で網羅検証するのは現実的でない。

形式検証 (Formal Verification) のツール — FDR4 や TLC — はこの問題を機械的に解く。 が、 入力言語
(CSPm や TLA+) は学習コストが高く、 仕様を直接書くのは敷居が高い。

specforge は **Mermaid stateDiagram-v2 で書かれた振る舞い仕様** を、 機械検証のための仕様 (TLA+ /
CSPm) に変換することで、 「人が書きやすい層」と「機械が検証できる層」を繋ぐ。

```
人が書く層: Mermaid + markdown 表 (spec-behavior 規律)
   ↓ specforge
機械が検証する層: TLA+ + TLC (primary) / CSPm + FDR4 (secondary)
```

---

## 2. 入力側: 振る舞い仕様としての拡張状態機械

### 2.1 状態機械 (State Machine) とは

有限個の **状態** と、 状態間の **遷移** で振る舞いを表すモデル。 「今どの状態か」が振る舞いを
完全に決定する (= memoryless)。 遷移は **トリガ (event)** によって発火する。

```
[*] → Idle → coin_inserted → Selecting → choose_item → Dispensing → done → [*]
```

これだけだと「コイン投入回数」「残高」のような連続値は表現できない。

### 2.2 拡張状態機械 (Extended State Machine)

状態に加えて **状態変数** (state variable) を持つ。 同じ state でも変数の値で遷移先 / 発火可否が
変わる。 遷移の **ガード (guard)** が変数を参照して条件分岐する。

例: `Selecting` 状態で `coin_inserted` event を受けたとき、

- `balance > 0` (= まだ残高あり) なら `Selecting` に留まる
- そうでなければ別の遷移 (例: `Idle` に戻る) を発火する

この「state + state vars」の組合せが本ツールが扱うモデル。 UML の state diagram に近い。

### 2.3 spec-behavior の規律

`~/.claude/skills/spec-behavior/SKILL.md` の規律で書かれた spec は、 形式検証に変換しやすい
形をしている:

| 要素              | 規律                                           | 機械検証への寄与                                  |
| ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| 遷移ラベル        | `event [guard] / action` (UML 慣習)            | event / guard / action を構造化 parse 可能        |
| 引数表記          | `name(arg1, arg2)` の関数形式                  | payload 列との対応が取れる                        |
| イベント契約表    | event ごとに発生元 / 通信特性 / payload を明示 | TLA+ の `\E new_<var>` で payload を非決定 bind   |
| 共有状態表        | 状態変数を型・書き手付きで宣言                 | TLA+ VARIABLES に直接マッピング                   |
| ガード定義表      | ガードタグ → 式の辞書                          | 遷移ラベルが短くなり再利用しやすい                |
| 設計メモ          | 「未定義イベントの扱い」「冪等性」 等          | 検証時の仮定を明示化                              |
| 直交領域 (`--`)   | 並行に進む region                              | TLA+ region phase 変数 / CSPm `\|\|\|` 並列に変換 |
| `### Liveness` 表 | 時相プロパティを宣言                           | TLA+ `PROPERTY` + `WF_vars(Next)` 公平性 emit     |

つまり spec-behavior は **「形式検証可能な拡張状態機械の書き方を人間にやさしい形で規律化したもの」**
と言える。 specforge はその規律を機械的にチェッカ入力へ落とす変換器。

> 遷移ラベル `event [guard] / action` の読み下し方や省略パターンの詳細は
> [`./label-reading.md`](./label-reading.md) を参照。

---

## 3. 形式手法とは何が嬉しいのか

「テストは特定 input でしか動かないが、 形式検証は状態空間を網羅探索する」のが core idea。

| 観点     | テスト                   | 形式検証                                 |
| -------- | ------------------------ | ---------------------------------------- |
| 探索範囲 | テストケースの具体値のみ | 仕様で許される全状態                     |
| 失敗時   | 1 つの input で再現      | 反例 (counterexample) trace を機械が生成 |
| 抽象度   | 実装レベル               | 仕様レベル (実装バグは見つけない)        |
| 完全性   | 不完全 (bug は残る)      | 仕様内では完全 (bounded 内で)            |

形式検証で見つけられるのは **仕様の論理的な穴** で、 実装のコーディングミスではない。
「仕様の段階で間違ってないか」を確認するためのツール。

---

## 4. 形式手法のバックエンド

specforge は 2 つの形式手法に変換できる。 役割は別。

### 4.1 CSP (Communicating Sequential Processes)

C.A.R. Hoare が提案した **プロセス代数** (1978 paper / 1985 book)。 プロセスが channel
で同期通信する モデルを、 数式的な代数演算で組み立てる。

主要演算子:

| 演算子           | 意味                                              |
| ---------------- | ------------------------------------------------- |
| `a -> P`         | 「event a を受けて P になる」 (prefix)            |
| `P [] Q`         | 「P か Q を非決定的に選ぶ」 (external choice)     |
| `P \|\|\| Q`     | 「P と Q を並行実行 (同期せず)」 (interleaving)   |
| `P [\| ev \|] Q` | 「ev でのみ同期して並行」 (synchronized parallel) |
| `P ; Q`          | 「P が SKIP したら Q」 (sequential)               |
| `P \ X`          | 「event 集合 X を P から隠す」 (hiding)           |
| `P /\ Q`         | 「P 実行中に Q で割り込み」 (interrupt)           |

CSPm は CSP の機械可読方言で、 **FDR4** が検証器。 主に確認できるのは:

- **deadlock-free**: どこかで進めない状態にならない
- **refinement**: 抽象 spec ⊑ 詳細 spec (trace 包含)
- **divergence-free**: 内部 event が無限ループしない

specforge は CSPm 出力を持つが、 FDR4 の入手性が悪いので **secondary backend** 扱い。

> 演算子の意味、 合成 / 同期の読み分け、 specforge 生成 CSPm の読み方は
> [`./csp-reading.md`](./csp-reading.md) を参照。

### 4.2 TLA+ (Temporal Logic of Actions)

Leslie Lamport が提案した **時相論理 + アクション** (2002 book "Specifying Systems")。 状態を
変数の組として扱い、 状態遷移をアクション述語 (`x' = x + 1` のような prime 記法) で書く。

canonical な spec の形:

```
VARIABLES x, y
Init == x = 0 /\ y = 0
Next == (x' = x + 1 /\ y' = y) \/ (y' = y + 1 /\ x' = x)
Spec == Init /\ [][Next]_vars
```

- `Init` で初期状態
- `Next` で全遷移の論理和
- `[][Next]_vars` で「任意の step で Next または stutter (UNCHANGED vars)」
- 時相演算子: `[]P` (always)、 `<>P` (eventually)、 `P ~> Q` (P leads to Q)

TLA+ の検証器は **TLC**。 有限状態化 (state var を有限値域に限定) して BFS で状態空間を網羅し:

- **deadlock-free** (default)
- **INVARIANT P** (任意の reachable state で P が成立)
- **PROPERTY F** (時相論理式 F が成立、 liveness 検証)
- **counterexample trace** (失敗時に到達経路を出す)

を確認する。 specforge は TLA+ + TLC を **primary backend** とする。

### 4.3 CSP と TLA+ の使い分け

|                    | CSP / FDR4                    | TLA+ / TLC                         |
| ------------------ | ----------------------------- | ---------------------------------- |
| 強み               | プロセス並行性の代数的記述    | 状態 + 時相論理、 数値演算自然     |
| 弱み               | 数値演算が弱い、 ツール入手性 | 並行性は手書き感、 学習コスト高    |
| specforge での扱い | secondary                     | primary                            |
| 主な検証           | refinement, deadlock-free     | invariant, deadlock-free, liveness |

CSP は「プロセスが綺麗に組み合わさるか」を見たいときに強く、 TLA+ は「変数を伴う複雑な状態 遷移」を
verify したいときに強い。 spec-behavior の状態機械は後者寄り。

---

## 5. specforge が繋いでいる pipeline

### 5.1 全体図

```
人が書く層
   spec-behavior 規律 (.md)
     ├─ Mermaid stateDiagram-v2 block
     ├─ 状態 / イベント / アクション / ガード 表
     ├─ 共有状態 / イベント契約 表
     └─ 設計メモ + 任意で `### Liveness` 表
       │
       ▼ specforge
変換層
   typed AST + side artifacts
     ├─ AST (Diagram with regions + transitions)
     ├─ guards: Map<tag, formula>
     ├─ stateVars: string[]
     ├─ eventPayloads: Map<event, field[]>
     └─ liveness: LivenessProp[]
       │
       ▼ specforge codegen
機械が読む層
   TLA+ MODULE Spec + Spec.cfg          (primary, deno task verify)
     │     OR
   CSPm process definitions              (secondary, FDR4 環境ある場合)
       │
       ▼ model checker
検証層
   TLC が状態空間を BFS で網羅
     ├─ deadlock-free check
     ├─ INVARIANT check (もしあれば)
     └─ PROPERTY (liveness) check (もしあれば)
       │
       ▼
   verified ok  /  counterexample trace
```

### 5.2 各段の責務

| 段           | モジュール        | 責務                                                                               |
| ------------ | ----------------- | ---------------------------------------------------------------------------------- |
| parse        | `src/parser.ts`   | Mermaid syntax → AST。 サブセット外は ParseError で拒絶                            |
| 表抽出       | `src/spec_doc.ts` | markdown 表からガード辞書 / state var / event payload / liveness を抽出            |
| validate     | `src/validate.ts` | V001〜V007 で意味的な穴を warning。 `--strict` で error 昇格                       |
| TLA+ codegen | `src/tla.ts`      | AST + side artifacts → TLA+ MODULE。 composite / 直交領域 / payload binding を反映 |
| CSPm codegen | `src/cspm.ts`     | 同上、 CSPm 出力 (FDR4 向け)                                                       |
| verify       | `src/verify.ts`   | TLA+ を一時 file に書き、 `java -cp tla2tools.jar tlc2.TLC` を subprocess 実行     |

### 5.3 状態機械 → TLA+ への変換セマンティクス

具体的なマッピング (詳細は [`./spec.md`](./spec.md) §7):

| 状態機械の要素                  | TLA+ の表現                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| 状態 (`Idle`, `Selecting` 等)   | `phase \in {"Idle", "Selecting", ...}`                                                |
| 状態変数 (`balance` 等)         | `VARIABLES balance` (Init で 0)                                                       |
| 遷移 `A --> B : ev [g] / act`   | アクション述語 `A_ev_B == phase = "A" /\ g /\ phase' = "B"`                           |
| guard                           | アクション述語内の conjunct                                                           |
| payload binding                 | `\E new_<var> \in Domain: ... /\ <var>' = new_<var>`                                  |
| composite + 直交領域            | 各 region に `<comp>_r<N>` 変数を追加、 `_inactive` / 入口 / `_done` 3 値で進行 track |
| terminal state                  | `TerminalStates` 集合と `Terminated` 述語、 Stutter action                            |
| 完了遷移 (composite から外への) | 全 region `_done` を precondition にしたアクション                                    |

---

## 6. 何が検証できるか

### 6.1 Safety: 「悪いことは起きない」

**例: deadlock-free**

任意の reachable state から、 enabled な action (Next の disjunct) が必ずある。 TLC のデフォルト
check。 `examples/deadlock.md` は composite region に出口無しの state を含むので reachable な
deadlock 状態に到達し、 TLC が `Error: Deadlock reached.` を返す。

**例: invariant**

「全 reachable state で P が成立」を確認する。 `INVARIANT P` 形式で `.cfg` に書く。 例えば
`INVARIANT balance >= 0` で「残高が決して負にならない」を保証。 specforge は invariant 用 markdown
表を現状未提供 (生 TLA+ を手で編集する必要あり、 将来追加候補)。

### 6.2 Liveness: 「良いことは必ず起きる」

**例: termination**

「全 behavior が最終的に terminal state に到達する」を `<>Terminated` で書く (eventually
Terminated)。 specforge は `### Liveness` 表があると `Terminated == phase \in TerminalStates`
を自動定義し、 PROPERTY として TLC に検証させる。

**例: progress**

「特定 event がいつかは応答される」 / 「retry が無限ループしない」のような進行性。 TLA+ では
`<>(condition)` や `P ~> Q` (P が起きたら eventually Q) で表現。

### 6.3 Fairness 仮定の必要性

Liveness を素朴に検証すると、 TLC は病的な実行を許してしまう:

```
behavior 1: Reading → Reading → Reading → ... (永遠に stutter)
```

これは `[][Next]_vars` の `_vars` (UNCHANGED 許可) によって正当な動作とみなされる。 結果、
`<>Terminated` は false (= 終端到達しない behavior が存在する) になる。

**Fairness assumption** を加えるとこの病的実行を排除できる:

- **WF (Weak Fairness)**: 「enable され続けるなら必ず実行される」
- **SF (Strong Fairness)**: 「無限に何度も enable されるなら必ず実行される」 (より強い)

specforge は `### Liveness` 表がある spec に対し **`Fairness == WF_vars(Next)`** を自動付加する (WF
on Next 全体)。 多くの spec ではこれで十分。 細かい action 別の WF/SF 指定は将来課題。

### 6.4 何が検証できないか

- **パフォーマンス特性**: latency、 throughput、 メモリ使用量
- **実装バグ**: 検証は仕様レベル。 実装が仕様と乖離していたら本検証は無意味
- **仕様の妥当性**: 「この仕様が要求を満たすか」 (= 仕様自体が正しい想定で動く)
- **無限状態**: state var を `0..N` で bound して有限化しているので、 「絶対値域」では検証してない

---

## 7. 状態空間と bound

形式検証は状態空間を網羅探索する。 state var が無限値域 (任意の整数 等) なら検証不可。 specforge は
`--bound=N` で `Domain == 0..N` に限定し、 有限化する。

bound と state space の関係 (実測):

| 例                          | bound=1        | bound=3              | bound=5            |
| --------------------------- | -------------- | -------------------- | ------------------ |
| docs/behavior.md            | 10/6 distinct  | (state var の影響小) | (同上)             |
| examples/vending-machine.md | 42/14 distinct | —                    | —                  |
| examples/order-workflow.md  | 数十           | 2744/512             | 数万               |
| hitl spec                   | 67/27 distinct | 1607/669 distinct    | 9275/3943 distinct |

**塩梅のコツ**:

- 境界条件 (`x >= 5` の `x = 4/5/6`) を網羅したいなら bound >= 境界値 + 1 程度
- bound を上げすぎると state space 爆発 (5sec で済む検証が 1 分超になることも)
- 「同型な大きい bound より、 小さい bound で多様な scenario をカバー」する設計が good

---

## 8. 実用上の典型シナリオ

### シナリオ 1: 終端到達を保証したい

spec に terminal state (`X --> [*]`) を入れ、 `### Liveness` 表に `Termination | <>Terminated` を
書く。 `deno task verify <spec>` で safety + liveness 両方が check される。

### シナリオ 2: 不正状態に陥らないことを保証したい

spec に状態変数を入れ、 状態変数の不変条件 (例: `balance >= 0`) を確認したい。 現状 specforge は
INVARIANT 表を提供してないので、 生成された TLA+ output を手で取り出し、 `.cfg` を作って
`INVARIANT BalanceNonneg` を追加する形になる。 将来課題。

### シナリオ 3: 並行処理のレース条件を検出したい

composite + 直交領域で並行 region を書き、 共有状態変数で競合点を表現する。 TLC が全 interleaving
を探索して deadlock / invariant 違反 / liveness 失敗を検出。 `examples
/producer-consumer.md` や
`examples/order-workflow.md` を参照。

### シナリオ 4: spec が間違っていないか早期に発見したい

実装に入る前に specforge で verify。 V001〜V007 で静的な穴を warning、 TLC で動的な穴 (deadlock、
liveness 失敗) を検出。 仕様レベルの矛盾を実装前に潰せる。

---

## 9. specforge を使うことのトレードオフ

### Pros

- spec-behavior の規律で書けば、 verify までボタン一発
- TLA+ / CSP の構文を知らなくても検証可能
- 仕様 review プロセスに verify を組み込める

### Cons

- specforge が生成する TLA+ は固定パターン (専門家が手書きする洗練度には及ばない)
- 高度な時相プロパティ (Fairness の細かい指定、 複雑な refinement) は手書きが必要
- state var の Domain が単一型 (`0..bound`、 spec.md §1.2 非目的 + decisions.md 参照)

specforge は「形式検証への入り口」を低くするツールで、 形式検証の専門家が書く高度な spec の
完全な代替ではない。 が、 spec-behavior 規律で書ける範囲なら十分実用的。

---

## 10. 参考文献 / リンク

### CSP

- C.A.R. Hoare, "Communicating Sequential Processes" (1978 paper) — オリジナル論文
- C.A.R. Hoare, "Communicating Sequential Processes" (1985, Prentice Hall) — book
- FDR4 公式: https://www.cs.ox.ac.uk/projects/fdr/

### TLA+

- Leslie Lamport, "Specifying Systems" (2002) — 公式 textbook (無料 PDF 公開)
  https://lamport.azurewebsites.net/tla/book.html
- TLA+ Home: https://lamport.azurewebsites.net/tla/tla.html
- learntla.com — Hillel Wayne による現代的なチュートリアル

### 周辺

- TLA+ Toolbox (IDE): https://lamport.azurewebsites.net/tla/toolbox.html
- TLA+ Examples: https://github.com/tlaplus/Examples
- Lamport の TLA+ lecture videos: https://lamport.azurewebsites.net/video/videos.html

### 本リポジトリ内の関連 doc

- [`./label-reading.md`](./label-reading.md) — `event [guard] / action` ラベルの読み方 (UML 慣習、
  省略パターン、 実行順序)
- [`./csp-reading.md`](./csp-reading.md) — CSP / CSPm の読み方 (演算子、 合成、 同期、 specforge
  生成 CSPm の読み下し)
- [`./spec.md`](./spec.md) — specforge 入力言語契約 (Mermaid サブセット + 補助情報)
- [`./behavior.md`](./behavior.md) — specforge 自身の振る舞い仕様 (self-dogfood)
- [`./decisions.md`](./decisions.md) — 設計判断記録 + 未決問題
- [`../examples/README.md`](../examples/README.md) — 動く例 8 件
- [`../tasks/todo.md`](../tasks/todo.md) — 残タスク
