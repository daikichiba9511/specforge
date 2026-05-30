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
Validation pass V001-V004 flags common spec mistakes (`--strict` promotes warnings to failures).
specforge verifies its own `docs/behavior.md` via TLC (self-dogfood, deadlock-free).

Remaining work is enumerated in [`tasks/todo.md`](./tasks/todo.md) with priority and size
annotations.

## Quickstart

```bash
deno task test
deno task cli examples/vending-machine.md               # CSPm output (default)
deno task cli --tla examples/vending-machine.md         # TLA+ output
deno task verify --bound=3 examples/vending-machine.md  # verify deadlock-freeness with TLC
```

Running `verify` requires Java and `tla2tools.jar`; see the `verify の前提` section in
[`CLAUDE.md`](./CLAUDE.md) for setup details.

## Tech stack

Deno 2.x runtime, TypeScript native, zero third-party dependencies in the parser / codegen core.
Source is runtime-neutral (`node:` prefix imports) so it also runs on Bun / Node for dev iteration.
Tests: `deno test` + `jsr:@std/assert`.

## Docs

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
