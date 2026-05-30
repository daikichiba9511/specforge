# specforge 設計判断記録

PoC 期から積み上げた設計上の判断と、 まだ未決の問題のメモ。 ADR (Architecture Decision Record)
寄りの形を取るが厳密な ADR フォーマットには従わない。 「なぜ今この形になっているか」を
将来のセッションが復元できる粒度を目標にする。

---

## 採用済の判断

### D-01: Deno 2.x を runtime に採用

- Bun はコールドスタートが速く momentum もあるが、 長寿 CLI ツールには Deno の API 安定性が優位
  (slower API evolution、 fewer breaking changes)
- ソースは `node:` prefix import で書いてあるので Bun / Node でも実行可能 (dev iteration 用)。
  runtime 差は CLI entrypoint 周りのみ

### D-02: parser は hand-roll (`npm:mermaid` を使わない)

PoC 期に `npm:mermaid` + JSDOM / happy-dom shim 経由を試した結果、 以下の問題で却下:

- 425+ transitive deps を AST 取得だけのために抱える
- DOMPurify が DOM globals (`window` / `document`) を要求 → hacky shim 必要
- Mermaid 内部 chunk 構造は stable API ではない (minor 更新で壊れる可能性)

hand-roll parser は ~150 LOC、 zero deps、 `spec-behavior` subset を厳密に強制可能。 PoC は実際の
hitl spec と spec-behavior examples で受理確認済。

### D-03: parser / codegen は zero third-party deps

portability + stability 優先。 テストフレームワーク `jsr:@std/assert` のみ標準ライブラリから採用。
ソースは runtime-neutral (`node:fs` / `node:process`) で Bun / Node でも動かせる。

### D-04: TLA+ + TLC を primary、 CSPm + FDR4 を secondary

PoC 当初は CSPm + FDR4 が primary だったが:

- FDR4 の入手性が悪い (manual install + email 登録が必要)
- TLA+ の `tla2tools.jar` は GitHub releases から直接 DL 可能で setup が楽
- ローカル開発で `specforge verify` 一発で end-to-end 検証できる重要性

CSPm 出力は残してあるが、 FDR4 環境がある場合の追加検証用という位置付け (archive backend)。

### D-05: Liveness は `### Liveness` 表で opt-in、 fairness は WF on Next default

`### Liveness` 表が無い spec は safety only (deadlock-free のみ check) で従来通り。 1 件以上
宣言された spec に対してのみ:

- TLA+ に `Terminated == phase \in TerminalStates`、 `Fairness == WF_vars(Next)`、 各 property
  定義を emit
- Spec を `Init /\ [][Next]_vars /\ Fairness` に拡張
- `.cfg` に `PROPERTY <name>` 行を追加

**なぜ opt-in にしたか**:

- 既存 spec の挙動を変えない (後方互換)
- liveness は fairness 仮定が不可欠で、 安易に default 有効化すると pathological stutter loop の
  検出ができなくなる
- 仕様 author が「進行性を要求するか」を意識的に宣言する形にしたい

**なぜ WF on Next を default にしたか**:

- 多くの状態機械では「event は遅延しても最終的に処理される」(= WF) で十分
- Strong fairness (SF) は「無限に何度も enable される action は必ず firing」というより強い仮定で、
  実装上の保証も困難
- 細かい action 別の WF/SF 指定は将来の `### Fairness` 表で override 可能にする予定 (tasks/todo.md
  参照)

---

## 未決の問題 (open design questions)

実装が必要になった時点で決める。 各項目は将来のセッションで判断を更新する想定。

### Q-01: at-least-once event semantics の表現

- CSP は exactly-once 同期。 at-least-once を直接表現できない
- 候補:
  - (a) spec の冪等性アノテーションを信頼して重複を無視
  - (b) 明示的に duplicate channel をモデル化
- 現状: spec-behavior が冪等性アノテーションを要求するので (a) 寄り

### Q-02: Action / event の visibility (CSPm)

- イベントは CSP channel として扱う (clean)
- アクション (`log_skip` 等) は visible にするか、 `\ {action_set}` で hide するか?
- 候補: デフォルト visible、 flag で hideable
- TLA+ には対応する hiding 機構が無いので CSPm only の論点

### Q-03: Guard 式の構文制約

- spec-behavior は guard を「読みやすい単純な int 比較」に縛る
- specforge は現状 guard を verbatim emit (CSPm + TLA+ で演算子変換のみ実施)
- 候補:
  - (a) guard を sub-DSL に restrict し parser で validate
  - (b) free text を受理して parse 不可なものは warning

### Q-04: Composite 内の状態名衝突

- 同名 state が 2 つの composite に出た場合、 親で namespace すべきか?
- 現状: flat (collision 検出は未実装、 V005+ の候補)

---

## 参照

- [`./spec.md`](./spec.md) — 入力言語契約 (本 doc の議論対象)
- [`../tasks/todo.md`](../tasks/todo.md) §「既知の制約 / 設計判断 (記録用)」 — 「今のところ
  意図的にやらない」決定の記録 (本 doc とは別軸)
