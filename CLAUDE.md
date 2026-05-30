# specforge — Claude Context

specforge 開発をセッション越しに継続するために Claude が最初に読む文脈。 詳細仕様 / 決定記録 /
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

`~/.claude/skills/spec-behavior/SKILL.md` が書く Mermaid 状態機械は既に CSP-translatable な
規律を持つ (UML `event [guard] / action`、 関数形式 `name(arg1, arg2)`、 イベント契約表、 直交領域、
冪等性 / 未定義イベント宣言など)。 specforge はそれを **機械的に TLA+ / CSPm に 変換する** 部品で、
形式検証側を「ボタン一発」にする。 `specforge verify` で TLC まで一気通貫。

## Canonical docs

- **[`docs/spec.md`](./docs/spec.md)** — 入力言語契約 (Mermaid サブセット / BNF / 遷移ラベル /
  補助情報 / TLA+ + CSPm 変換セマンティクス)
- **[`docs/behavior.md`](./docs/behavior.md)** — specforge 自身のランタイム振る舞い仕様
  (`spec-behavior` 流の self-dogfood ターゲット、 TLC verified deadlock-free 済)
- **[`docs/perf.md`](./docs/perf.md)** — bench (`deno task bench`) workflow / before-after 比較 /
  CPU プロファイル取得手順
- **[`docs/decisions.md`](./docs/decisions.md)** — 採用済の設計判断 (Deno 採用 / hand-roll parser /
  TLA+ primary 等) + 未決の問題 (open design questions)
- **[`tasks/todo.md`](./tasks/todo.md)** — 残タスク (Pri A/B/C, Size S/M/L) + 完了履歴サマリ +
  「意図的にやらない」決定の記録
- **[`examples/README.md`](./examples/README.md)** — 8 例 (正常 6 + 反例 2)

## Status snapshot

主要マイルストーンは完了済:

- Phase 1〜4 (CSPm full): composite / 完了遷移 / triggered / action chain / guard substitution /
  payload binding / process parameter threading
- TLA+ Phase A + B + 2: flat / composite + 直交領域 / event payload binding
- `specforge verify` (TLC subprocess wrapper) + `--bound=N` で状態空間調整
- Validation V001〜V005 + `--strict` flag、 `--json` output mode
- self-dogfood 達成 (`docs/behavior.md` を TLC verified deadlock-free、 10 states / 6 distinct)
- 8 examples (正常 6 + deadlock / unreachable 反例 2) + CI + bench

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

## Key references (in dotfiles / outside repo)

- **`~/.claude/skills/spec-behavior/SKILL.md`** — specforge が受理する spec 言語の定義 (specforge は
  これに追従する)
- **`~/.claude/skills/spec-behavior/references/multi-entity-composition.md`** — multi-entity /
  refinement / impl 分離パターン (multi-state-machine specs に拡張する時に効く)
- **Real-world example spec**: `~/job/docs/tasks/active/hitl-evaluation-system-phase-flow-spec.md` —
  composite + 直交領域 + multi-entity coverage の現実 spec (機密、 local 保持)

## Next session — recommended first step

まず [`docs/spec.md`](./docs/spec.md) を読んで入力契約を把握する。 CLAUDE.md (本ファイル) は
プロジェクト文脈の wrapper で、 spec.md が正準入力契約。

具体的な残タスクは [`tasks/todo.md`](./tasks/todo.md) に Pri (A/B/C) + Size (S/M/L) 付きで
列挙してある。 再開時は Pri A、 Size S から拾うのが手軽。
