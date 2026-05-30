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

Functional. The parser covers the `spec-behavior` Mermaid subset; both backends emit composite /
orthogonal regions, event payload binding, guard substitution, and state variable threading.
Validation pass V001-V007 flags common spec mistakes (`--strict` promotes warnings to failures).
Liveness / fairness verification via a `### Liveness` markdown table (TLA+ `<>Terminated` etc. +
`WF_vars(Next)` fairness assumption). specforge verifies its own `docs/behavior.md` via TLC for both
deadlock-freeness and termination (self-dogfood).

If you are new, start with [`docs/concepts.md`](./docs/concepts.md) for the theoretical background
and how the tool connects the human-readable spec layer to TLA+ / TLC verification.

Remaining work is enumerated in [`tasks/todo.md`](./tasks/todo.md) with priority and size
annotations.

## Setup

開発環境は次の 3 通りで用意できる。

### Nix flake (推奨、再現性最高)

```bash
nix develop
```

Deno 2 / OpenJDK 21 / `tla2tools.jar` (v1.7.4) が揃った shell に入る。`SPECFORGE_TLA_JAR` と
`JAVA_HOME` も自動で設定されるので `deno task verify` がそのまま動く。

### mise

```bash
mise install
```

Deno 2 と OpenJDK 21 が入る (`mise.toml` で pin)。`verify` を使う場合は別途 `tla2tools.jar`
を配置する:

```bash
mkdir -p ~/.local/share/specforge
curl -L -o ~/.local/share/specforge/tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
```

`SPECFORGE_TLA_JAR` env var で任意のパスを指定することもできる。

### 手動

`brew install deno openjdk` などで Deno と OpenJDK を入れ、`tla2tools.jar` は上記 mise 節と
同じ手順で配置する。詳細は [`CLAUDE.md`](./CLAUDE.md) の `verify の前提` 節。

## Quickstart

```bash
deno task test
deno task cli examples/vending-machine.md               # CSPm output (default)
deno task cli --tla examples/vending-machine.md         # TLA+ output
deno task verify --bound=3 examples/vending-machine.md  # verify deadlock-freeness with TLC
```

## Tech stack

Deno 2.x runtime, TypeScript native, zero third-party dependencies in the parser / codegen core.
Source is runtime-neutral (`node:` prefix imports) so it also runs on Bun / Node for dev iteration.
Tests: `deno test` + `jsr:@std/assert`.

## Docs

- [`docs/concepts.md`](./docs/concepts.md) — primer: state machines, CSP / TLA+ basics, what the
  tool connects, and what TLC can verify (start here if you are new)
- [`docs/spec.md`](./docs/spec.md) — input language contract (Mermaid subset / BNF / transition
  label format / side artifacts / TLA+ + CSPm conversion semantics)
- [`docs/behavior.md`](./docs/behavior.md) — specforge's own runtime behavior, written as a
  `spec-behavior`-style state machine (self-dogfood verification target)
- [`docs/perf.md`](./docs/perf.md) — bench (`deno task bench`) workflow, before/after comparison,
  CPU profiling
- [`docs/decisions.md`](./docs/decisions.md) — design decision records and open questions
- [`examples/README.md`](./examples/README.md) — 8 worked examples (vending machine / DB pool /
  producer-consumer / order workflow / internal events / deadlock / unreachable demos)
- [`tasks/todo.md`](./tasks/todo.md) — remaining backlog with priority / size annotations

## Develop

See [`CLAUDE.md`](./CLAUDE.md) for the development context, recommended workflow skills, and useful
commands.
