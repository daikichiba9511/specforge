# specforge

Forge Mermaid `stateDiagram-v2` behavior specifications into formal verification targets (CSPm
initially, TLA+ planned).

## What it does

Takes Mermaid state machines authored under the `spec-behavior` discipline
(`event [guard] / action`, orthogonal regions, etc.) and emits CSPm suitable for FDR4 model
checking.

```
mermaid spec.mmd  →  AST  →  CSPm  →  FDR4 (deadlock-free / refinement check)
```

## Status

Scaffolding stage. Parser covers the `spec-behavior` Mermaid subset; CSPm generator is a sketch
(composite + orthogonal regions, state variables, and interrupt semantics are pending).

## Quickstart

```bash
deno task test
deno task cli examples/traffic-light.mmd
```

## Docs

- [`docs/spec.md`](./docs/spec.md) — input language contract (accepted Mermaid subset, BNF,
  transition label form, side artifacts, CSPm mapping)
- [`docs/behavior.md`](./docs/behavior.md) — specforge's own runtime pipeline behavior, written as a
  `spec-behavior`-style state machine (dogfood target for self-verification)

## Develop

See [`CLAUDE.md`](./CLAUDE.md) for the development context, roadmap, and which dotfiles-managed
skills to apply.
