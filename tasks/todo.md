# specforge 残タスク

CLAUDE.md の Pending を展開した実作業リスト。優先度別 (Pri) と規模感 (Size) を付して、
セッション再開時に「次に何を握るか」を即決できるようにする。

凡例:

- Pri: `A` (今すぐ着手したい) / `B` (近いうち) / `C` (将来)
- Size: `S` (~1 セッション分) / `M` (~2-3 セッション) / `L` (要設計 + 複数セッション)
- ステータス: `- [ ]` 未着手 / `- [x]` 完了

---

## 直近の磨き込み (Pri A、Size S)

### Validation rules の拡張 (V005〜)

- [ ] **V005**: state が `to` にはあるが `from` にない (= 出口なし、非 terminal なのに stuck
      する可能性)。 ただし `--> [*]` がある state は除外。 `examples/deadlock.md` の Stuck が
      該当する pattern を静的に検出できるようにする。 ~30 LOC + tests
- [ ] **V006**: event payload field の名前が state var とミスマッチ警告。 「state var に似てる けど
      1 文字違い」を Levenshtein でなく簡易な fuzzy match で。 開発中のリネームミス検出用
- [ ] **V007**: 同一 (from, to, event, guard) 組合せが複数 transition 出現 → warning。 hitl
      の中でも実害ありそうな pattern
- [ ] validation rule の登録機構をデータ駆動化 (現状は `validate()` 内 手書き分岐)。 ルールが 10
      個超えると保守性厳しくなるので

### CLI / output 細部

- [ ] **JSON 出力に warnings を含める**: 現状 `--json` は warnings を stderr に出すだけ。 パイプ先
      (jq 等) で warnings も参照したいなら JSON に attach
- [ ] **`--no-warn` flag**: validation を完全に skip (CI 高速化目的)
- [ ] **error / warning の色付け** (NO_COLOR 環境変数尊重)

---

## TLA+ / TLC 強化 (Pri A〜B、Size M)

### Liveness / fairness 検証

- [ ] **liveness check の自動 emit**: 現状 `assert Spec :[deadlock free]` 相当のみ。 `<>Terminated`
      (termination) や custom invariant を `.cfg` に書き出せるように
- [ ] **fairness 仮定**: weak / strong fairness を action 毎に `.cfg` で指定可能に。 spec 内
      `### fairness` 表で declarative に書ける形を検討
- [ ] **counterexample の整形**: 現状 TLC の生 stdout を流すだけ。 path を読みやすく整形

### parser 拡張

- [ ] **`event_name(arg)` の bare 名抽出**: 現状 mermaid に `coin_inserted(balance)` と書くと parser
      は全文字列を event 名扱いし event 契約表 (`coin_inserted` で登録) とマッチしない。
      `RE_TRANSITION` の event part を `name` と `args` に分割する。 ~50 LOC + tests
- [ ] **`state "desc" as ID { ... }` の単一行 composite + alias**: 現状 alias と composite は
      別行宣言が必要。 Mermaid 公式は受理する。 RE_COMPOSITE / RE_ALIAS の正規表現に統合形を追加

### CSPm 側の磨き込み

- [ ] **`internal_*` の hiding 対応** (CSPm): `Spec = Initial \ {internal_check_lockout, ...}`
      の形で trace から hide。 TLA+ には対応する概念無いので CSPm only
- [ ] **FDR4 で実機検証**: FDR4 を手動 install してから、 hitl spec / 各 example の CSPm 出力を FDR4
      が受理するか確認。 不整合があれば修正

---

## 未実装機能 (Pri B〜C、Size M〜L)

### Action update semantics (Phase 5)

- [ ] AST 拡張: action にメタ情報を持たせる。 `action_name(updates_var=expr)` のような annotation
      で「この action は <var> を <expr> に更新する」を表現
- [ ] spec-behavior skill 側の規律拡張 (action 表に「更新する変数」列追加)
- [ ] CSPm / TLA+ 両 backend で action 更新を反映 (Phase 2 の event payload binding と統合)

### Multi-entity / refinement

- [ ] **multi-entity**: 複数の spec ファイル間で event を共有 (event 契約表が橋渡し)。 specforge
      で複数 spec を同時にパース、event 名 / payload の整合性チェック
- [ ] **refinement**: 親 spec の抽象状態 → 子 spec の詳細展開。 親子で同じ event /
      状態名が出るときの参照解決

### IDE 統合 / DX

- [ ] **VS Code 拡張**: spec を save 時に backend で validation 走らせて inline warning 表示
- [ ] **`specforge fmt`**: spec ファイル自体を canonical 形式に整形 (Mermaid 内インデント、 表の
      column 揃え等)
- [ ] **`specforge --watch`**: spec を保存するたびに自動 verify

---

## 既知の制約 / 設計判断 (記録用)

ここは「将来やる」というより「**今のところ意図的にやらない**」決定の記録。

- **action は opaque な channel として扱う** (CSPm の event prefix / TLA+ で名前のみ)。 action
  内部の semantics は spec のスコープ外 (実装層責務)。 Phase 5 で再考予定だが、 spec
  をシンプルに保つために現状の境界を維持する判断
- **TLA+ Domain は単一型 (Int)**: 全 state var が同じ `0..bound` domain を共有。 per-var domain
  を入れると spec の表現力は上がるが、 表の column を増やす必要があり敷居が高くなる。 必要に
  なれば検討
- **CSPm 出力は archive (FDR4 環境がない限り unused)**: TLA+ + TLC を primary verifier として
  扱う方針。 CSPm を磨き込むのは secondary

---

## 完了履歴 (主要マイルストーン)

直近の commits ベース。詳細は CLAUDE.md の `Done` セクション + `git log` を参照。

- [x] Phase 1〜4 (CSPm backend full): composite / 完了 / triggered / action chain / guard
      substitution / state var declarations / payload binding / process parameter threading
- [x] TLA+ backend (Phase A + B + 2): flat / composite / 直交領域 / payload binding
- [x] `specforge verify` (TLC subprocess wrapper) + `--bound=N` で 状態空間調整
- [x] Validation pass V001〜V004 + `--strict` flag
- [x] `--json` output mode
- [x] Self-dogfood: `docs/behavior.md` 自身を TLC で verified ok
- [x] examples 8 例: traffic-light / vending-machine / db-connection-pool / producer-consumer /
      order-workflow / internal-events / deadlock (TLC 検出) / unreachable-state (V004 検出)
- [x] bench 基盤 + `docs/perf.md` (Deno.bench + before/after 比較)
- [x] CI workflow (deno fmt / lint / check / test)
