# specforge — Codex Context

specforge 開発をセッション越しに継続するために Codex が最初に読む文脈。 詳細仕様 / 決定記録 /
残タスクは別 doc に分離してあるのでここは要点のみ。

## What this tool does

specforge は **Mermaid `stateDiagram-v2` 振る舞い仕様** を **形式検証ターゲット** に変換する (TLA+ +
TLC primary、 CSPm + FDR4 secondary)。 目的は Mermaid で書いた spec をモデルチェッカで
機械的に検証可能にすること。

**Pipeline**:

```
Mermaid stateDiagram-v2  →  typed AST  →  TLA+ (TLC input)   →  deadlock-free / liveness check
                                       ↘  CSPm (FDR4 input)  →  refinement / deadlock-free check
```

入力サブセットは **`spec-behavior` skill が書く形** に厳密に限定する。 サブセット外は parse 時に
拒絶。 詳細は [`docs/spec.md`](./docs/spec.md)。

## Why this exists

`.agents/skills/spec-behavior/SKILL.md` が書く Mermaid 状態機械は既に CSP-translatable な 規律を持つ
(UML `event [guard] / action`、 関数形式 `name(arg1, arg2)`、 イベント契約表、 直交領域、 冪等性 /
未定義イベント宣言など)。 specforge はそれを **機械的に TLA+ / CSPm に 変換する** 部品で、
形式検証側を「ボタン一発」にする。 `specforge verify` で TLC まで一気通貫。

## Canonical docs

- **[`docs/behavior-specs.md`](./docs/behavior-specs.md)** — 振る舞い仕様の目的、境界、完全性、
  合成、形式検証との関係
- **[`docs/writing-specs.md`](./docs/writing-specs.md)** — specforge 互換仕様の作成手順、表、
  設計メモ、validation、verify
- **[`docs/concepts.md`](./docs/concepts.md)** — 基本概念と背景 (拡張状態機械 / CSP / TLA+ / safety
  vs liveness / fairness / 検証できること & できないこと)。 新規ユーザはまずこれを読む
- **[`docs/spec.md`](./docs/spec.md)** — 入力言語契約 (Mermaid サブセット / BNF / 遷移ラベル /
  補助情報 / TLA+ + CSPm 変換セマンティクス)
- **[`docs/behavior.md`](./docs/behavior.md)** — specforge自身の実行時振る舞い仕様
  （specforge自身でTLA+へ変換し、TLCによるデッドロックと終端到達の検査済み）
- **[`docs/perf.md`](./docs/perf.md)** — bench (`deno task bench`) workflow / before-after 比較 /
  CPU プロファイル取得手順
- **[`docs/decisions.md`](./docs/decisions.md)** — 採用済の設計判断 (Deno 採用 / hand-roll parser /
  TLA+ primary / WF on Next default 等) + 未決の問題 (open design questions)
- **[`tasks/todo.md`](./tasks/todo.md)** — 残タスク (Pri A/B/C, Size S/M/L) + 完了履歴サマリ +
  「意図的にやらない」決定の記録
- **[`examples/README.md`](./examples/README.md)** — 10例（正常例7 + 問題例3）
- **[`reader-term-contract-documentation.md`](./reader-term-contract-documentation.md)** —
  利用者向け文書、 手順書、保守者向け文書の想定読者と用語の使い分け

## Status snapshot

主要マイルストーンは完了済:

- Phase 1〜4 (CSPm full): composite / 完了遷移 / triggered / action chain / guard substitution /
  payload binding / process parameter threading
- TLA+ Phase A + B + 2: flat / composite + 直交領域 / event payload binding
- `specforge verify` (TLC subprocess wrapper) + `--bound=N` で状態空間調整
- Validation V001〜V007 + `--strict` flag、 `--json` output mode
- Liveness/fairness 検証 (`### Liveness` 表 → TLA+ `<>Terminated` 等 + `WF_vars(Next)` 公平性)
- `docs/behavior.md`をspecforge自身で検査済み（上限3で674生成状態・373種類）
- 10例（正常例7 + 問題例3）+ CI + bench

詳細は `git log` 参照。 残タスクは [`tasks/todo.md`](./tasks/todo.md)。

## How to develop

### Apply these skills

- **`spec-behavior`** — 入力 spec を書く / review する時。 syntax で迷ったら review モードを当てる
- **`tdd`** — parser / codegen の新機能はテスト先行 (既存テストは baseline)
- **`commit`** — commit メッセージ (conventional commits、 日本語 OK)
- **`code-review`** / **`simplify`** — non-trivial 変更を merge する前
- **`plan`** — 複数モジュールに跨る機能を入れる前

### Useful commands

```bash
deno task test       # run tests
deno task fmt        # format
deno task lint       # lint
deno task check      # type check
deno task cli examples/traffic-light.mmd          # CSPm 出力 (validation warnings は stderr)
deno task cli --tla examples/traffic-light.mmd    # TLA+ 出力
deno task cli --json examples/traffic-light.mmd   # AST + metadata の JSON 出力
deno task cli --strict examples/traffic-light.mmd # validation warning を error 扱い (exit 1)
deno task cli --bound=3 spec.md                   # Domain/VAL の値域を 0..3 に
deno task verify examples/traffic-light.mmd       # spec → TLA+ → TLC で検証
deno task verify --bound=5 spec.md                # 広い状態空間で検証
deno task compile    # produce bin/specforge binary
deno task bench      # run all benchmarks
deno task bench:compare /tmp/before.json /tmp/after.json   # compare two `deno bench --json` runs
```

パフォーマンス周りは [`docs/perf.md`](./docs/perf.md) に詳細。

### `verify` の前提

- **Java**: `brew install openjdk` で OpenJDK が入る。 verify は
  `/opt/homebrew/opt/openjdk/bin/java` → `JAVA_HOME/bin/java` → `/usr/bin/java` の順で探す
- **tla2tools.jar**: https://github.com/tlaplus/tlaplus/releases/latest から DL し
  `~/.local/share/specforge/tla2tools.jar` に配置 (もしくは `SPECFORGE_TLA_JAR` env var で上書き)
- TLA+ module 名は `Spec` 固定 (一時ファイルが `Spec.tla` / `Spec.cfg`)

## Key references

- **[`.agents/skills/spec-behavior/SKILL.md`](./.agents/skills/spec-behavior/SKILL.md)** — specforge
  互換 spec を作成、レビュー、検証する repo-local skill
- **[`.agents/skills/spec-behavior/references/behavior-spec-guide.md`](./.agents/skills/spec-behavior/references/behavior-spec-guide.md)**
  — 振る舞い仕様を書く側の規律 (specforge は これに追従する)
- **[`.agents/skills/spec-behavior/references/multi-entity-composition.md`](./.agents/skills/spec-behavior/references/multi-entity-composition.md)**
  — multi-entity / refinement / impl 分離パターン (multi-state-machine specs に拡張する時に効く)
- **Real-world example spec**: `~/job/docs/tasks/active/hitl-evaluation-system-phase-flow-spec.md` —
  composite + 直交領域 + multi-entity coverage の現実 spec (機密、 local 保持)

## Next session — recommended first step

仕様を書く場合は [`docs/behavior-specs.md`](./docs/behavior-specs.md) と
[`docs/writing-specs.md`](./docs/writing-specs.md) を読み、実装を変更する場合は
[`docs/spec.md`](./docs/spec.md) の入力契約を把握する。 AGENTS.md (本ファイル) はプロジェクト文脈の
wrapper で、構文と変換 semantics については spec.md が正準入力契約。

具体的な残タスクは [`tasks/todo.md`](./tasks/todo.md) に Pri (A/B/C) + Size (S/M/L) 付きで
列挙してある。 再開時は Pri A、 Size S から拾うのが手軽。
