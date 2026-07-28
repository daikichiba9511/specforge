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

- [x] **V005**: 到達可能だが出口無しの state を検出。 `examples/deadlock.md` の `Stuck` を静的検出
      可能になり、 TLC の動的 deadlock 検出と相補。 V004 と排他 (未到達なら V004、 到達可能で
      出口無しなら V005)
- [x] **V006**: event payload field の名前が state var と「似ているが一致しない」(1 文字違い or
      case/underscore 差) を fuzzy 検出。 Levenshtein full DP は使わず、 同長 1 substitution / 長さ
      差 1 の 1 insertion/deletion を線形走査 + 正規化一致の 2 段構え
- [x] **V007**: 同一 (from, to, event, guard) tuple の重複 transition を warning。 action だけ 違う
      / ガード競合 / 完全コピペミス を静的に検出
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

- [x] **liveness check の自動 emit**: `### Liveness` 表で時相プロパティを宣言すると TLA+ 出力に
      `Terminated == phase \in TerminalStates` + 各 property 定義が emit され、 `.cfg` に
      `PROPERTY <name>` 行が入る。 1 件以上宣言で **`Fairness == WF_vars(Next)` 自動付加** +
      `Spec == Init /\ [][Next]_vars /\ Fairness`。 docs/behavior.md で end-to-end 検証済
- [ ] **fairness 種別の override**: 現状は WF on Next 一律。 `### Fairness` 表で action 毎に WF/SF
      を指定 / 一部 action のみ fairness 仮定する形を検討。 多くの spec では WF on Next で
      足りるはずなので優先度は低い
- [ ] **反例の整形**: 現在はTLC出力から違反の種類と探索結果だけを要約し、詳細な状態列を表示しない。
      進行性違反時の状態列を、仕様上の状態とイベントへ対応付けて簡潔に表示する

### parser 拡張

- [x] **`event_name(arg)` の bare 名抽出**: parser が `name(arg1, arg2)` を分解して
      `label.event = name` (bare) + `label.eventArgs = [...]` を AST に格納。 event 契約表との
      lookup が `event(args)` 形式の Mermaid でも match するようになった。 vending-machine.md を
      spec-behavior 規律準拠形 (`coin_inserted(balance)`) に書き換えても TLC verify pass
- [ ] **`state "desc" as ID { ... }` の単一行 composite + alias**: 現状 alias と composite は
      別行宣言が必要。 Mermaid 公式は受理する。 RE_COMPOSITE / RE_ALIAS の正規表現に統合形を追加

### CSPm 側の磨き込み

- [ ] **直交領域の broadcast 同期**: 同名 event を持つ region を CSPm の `[| S |]` で同期し、 TLA+
      でも一つの step で対象 region を同時更新する。現状は両 backend とも interleaving
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

- **アクションの内部処理は展開しない**。CSPmではイベント名として残すが、TLA+の状態更新には反映しない。
  実際の副作用や冪等性は振る舞いモデルの検査対象外である。Phase
  5で状態変数の更新規則を追加する可能性はあるが、現在はこの境界を維持する
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
- [x] Validation pass V001〜V007 + `--strict` flag
- [x] `--json` output mode
- [x] Self-dogfood: `docs/behavior.md` 自身を TLC で verified ok
- [x] examples 10 例: traffic-light / vending-machine / db-connection-pool / producer-consumer /
      order-workflow / internal-events / parallel-order-retry / parallel-order-retry-fixed /
      deadlock (TLC 検出) / unreachable-state (V004 検出)
- [x] bench 基盤 + `docs/perf.md` (Deno.bench + before/after 比較)
- [x] CI workflow (deno fmt / lint / check / test)
- [x] 振る舞い仕様の概念 doc + specforge 向け執筆 guide + repo-local `spec-behavior` skill を同梱。
      skill 内の Mermaid 例と執筆 guide の完全例を test で parser / validation に同期
