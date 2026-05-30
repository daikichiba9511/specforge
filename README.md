# specforge

Forge Mermaid `stateDiagram-v2` behavior specifications into formal verification targets (TLA+ / TLC
primary, CSPm / FDR4 secondary).

## What it does

Takes Mermaid state machines authored under the `spec-behavior` discipline
(`event [guard] / action`, orthogonal regions, state variables, event payload contracts, etc.) and
emits TLA+ or CSPm. The TLA+ output can be model-checked directly with TLC via `specforge verify`.

```
mermaid spec.md  →  AST + side tables  →  TLA+  →  TLC (deadlock-free / liveness check)
                                       ↘  CSPm  →  FDR4 (archive backend)
```

## Status

Functional. Parser covers the `spec-behavior` Mermaid subset; both backends emit composite /
orthogonal regions, event payload binding, guard substitution, and state variable threading.
Validation pass V001〜V004 flags common spec mistakes (`--strict` で warning → failure 昇格)。
specforge は **自身の `docs/behavior.md`** を TLC で deadlock-free と検証済 (self-dogfood)。

残タスクは [`tasks/todo.md`](./tasks/todo.md) に優先度 / 規模付きで列挙。

## Quickstart

```bash
deno task test
deno task cli examples/vending-machine.md               # CSPm 出力 (デフォルト)
deno task cli --tla examples/vending-machine.md         # TLA+ 出力
deno task verify --bound=3 examples/vending-machine.md  # TLC で deadlock-free 検証
```

`verify` を使うには Java と `tla2tools.jar` のセットアップが必要 (詳細は [`CLAUDE.md`](./CLAUDE.md)
`verify の前提` 節)。

## Docs

- [`docs/spec.md`](./docs/spec.md) — 入力言語契約 (Mermaid subset / BNF / 遷移ラベル / 補助情報 /
  TLA+ + CSPm 変換セマンティクス)
- [`docs/behavior.md`](./docs/behavior.md) — specforge 自身のランタイム振る舞い仕様 (`spec-behavior`
  流に記述した self-dogfood ターゲット)
- [`docs/perf.md`](./docs/perf.md) — bench (`deno task bench`) workflow, before/after 比較, CPU
  プロファイル取得手順
- [`examples/README.md`](./examples/README.md) — 8 例 (vending machine / DB pool / producer-consumer
  / order workflow / internal events / deadlock / unreachable demos)
- [`tasks/todo.md`](./tasks/todo.md) — 残タスク (Pri A/B/C, Size S/M/L 付き)

## Develop

See [`CLAUDE.md`](./CLAUDE.md) for the development context, roadmap, and which dotfiles-managed
skills to apply.
