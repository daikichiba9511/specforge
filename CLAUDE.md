# specforge — Claude Context

This file gives Claude the context needed to continue specforge development across sessions. Read it
first when picking the project up.

## What this tool does

specforge translates **Mermaid `stateDiagram-v2` behavior specifications** into **formal
verification targets** (CSPm initially, TLA+ planned). The goal: make Mermaid-authored specs
mechanically verifiable with model checkers like FDR4.

**Pipeline**:

```
Mermaid stateDiagram-v2  →  typed AST  →  CSPm (FDR4 input)  →  refinement / deadlock-free check
```

The translator is intentionally strict about **what subset of Mermaid it accepts** — the subset is
the one the `spec-behavior` skill teaches the user to write.

## Why this exists

The `spec-behavior` skill at `~/.claude/skills/spec-behavior/SKILL.md` guides the user to author
behavior specs as Mermaid extended state machines. That skill already enforces a discipline that is
almost CSP-translatable:

- Transition labels follow UML convention `event [guard] / action`
- Argument notation `name(arg1, arg2)` maps to CSP channel passing
- Event contract tables specify sync/async (= CSP synchronization semantics)
- Composite states with orthogonal regions map to CSP parallel composition
- Per-channel ordering, idempotency rules, and undefined-event policies are already declared

specforge is the **mechanical translator** that turns those well-formed specs into CSPm, so the
formal property check side becomes a button-press.

## Canonical docs (read these before touching code)

- **[`docs/spec.md`](./docs/spec.md)** — input language contract: accepted Mermaid subset, BNF,
  transition label format, side artifacts, CSPm mapping semantics
- **[`docs/behavior.md`](./docs/behavior.md)** — specforge's own runtime pipeline behavior, written
  as a `spec-behavior`-style state machine. Doubles as the **dogfood target**: feed this through
  specforge itself once MVP is ready, run FDR4 on the output to verify deadlock-freeness and
  termination
- **[`docs/perf.md`](./docs/perf.md)** — bench (`deno task bench`) と before/after 比較
  (`deno task bench:compare`)、CPU プロファイル取得手順、最適化を始める時の着目ポイント

## The input language: `spec-behavior` subset

specforge accepts a **subset of Mermaid stateDiagram-v2** matching what the `spec-behavior` skill
produces. The canonical contract is documented in [`docs/spec.md`](./docs/spec.md) — read it before
extending the parser or CSPm generator.

Quick overview of the supported core:

- `stateDiagram-v2` header (required)
- `state "description" as ID` aliases
- `state ID { ... }` composite states
- `--` orthogonal region separator (only valid inside composites)
- `[*] --> X` initial transitions, `X --> [*]` final transitions
- `X --> Y : event [guard] / action` transitions (event / guard / action all optional)
- `%% ...` line comments

**Anything else is rejected at parse time**. This is intentional: the goal is to keep the input
strictly CSP-translatable, not to be a Mermaid clone. See `docs/spec.md` §6 for what specforge
rejects and the recommended alternative encoding for each case.

When the `spec-behavior` skill changes, both the parser and `docs/spec.md` may need to follow.
**Cross-check against `~/.claude/skills/spec-behavior/SKILL.md` when adding features.**

## Tech stack

- **Runtime**: Deno 2.x (TypeScript native, `deno compile` for single-binary release)
- **Zero third-party deps** in the parser/cspm core (hand-rolled to stay portable and stable)
- **Test framework**: `deno test` + `jsr:@std/assert`
- **Source is runtime-neutral** (`node:fs` / `node:process`) so it also runs on Bun / Node if needed
  for dev iteration

### Why not use the `mermaid` npm package as the parser?

We tested this in the PoC session. The `mermaid` package can be used via JSDOM/happy-dom shim, but:

- Pulls 425+ transitive deps just to get the AST
- DOMPurify requires DOM globals (`window`, `document`) — hacky shim required
- Mermaid's internal chunk structure is not a stable API; minor version bumps could break the
  integration

Hand-rolled parser is ~150 LOC, zero deps, can enforce the `spec-behavior` subset strictly. PoC was
validated against a real spec at `~/job/docs/tasks/active/hitl-evaluation-system-phase-flow-spec.md`
and against the spec-behavior examples.

### Why Deno over Bun?

Deno 2.x is more stable for a long-lived CLI tool (slower API evolution, fewer breaking changes).
Bun is faster at cold start and has more momentum, but stability is a concern for tooling that's
supposed to "just work" for years. Either runtime can run the source unchanged thanks to the `node:`
prefix imports — Bun is fine for local dev iteration.

## Status snapshot (at this scaffold)

**Done**:

- Parser (`src/parser.ts`) — header, aliases, composite, orthogonal regions, transitions, label
  sub-parsing (event/guard/action), comments
- CSPm generator (`src/cspm.ts`) — flat states, **hierarchical composite (inline)**, **orthogonal
  regions (`|||`)**, **completion transitions (`;`)**, **triggered external transitions (`/\\`)**
- CLI (`src/cli.ts`) — reads file, prints CSPm to stdout
- Parser tests (`tests/parser.test.ts`) + cspm tests (`tests/cspm.test.ts`)
- Example spec (`examples/traffic-light.mmd`)
- CI workflow (`deno fmt --check`, `deno lint`, `deno check`, `deno test`)
- Benches (`bench/*_bench.ts`) + before/after 比較 (`bench/compare.ts`) — `docs/perf.md`

**Pending (next-session priorities, roughly in order)**:

1. **Action chain expansion**: action のカンマ列 (`alert_op, write_failed_list`) を CSP の
   `alert_op -> write_failed_list -> ...` に展開する。現状は verbatim 出力で FDR4 に流すと syntax
   error。hitl spec で実害あり。
2. **State variable threading**: Specs reference state variables in guards (`catalog_size > 0`). CSP
   requires these as process parameters: `Sampling(catalog_size) = ...`. Need to (a) collect
   variable references from guards/actions, (b) thread them through process definitions, (c) update
   channel signatures.
3. **Validation pass**: post-parse pass to enforce CSP-friendly subset (warn on suspect labels,
   reject unparseable guards).
4. **FDR4 invocation**: subprocess wrapper for `fdr4 batch-process`, parse output for verification
   results. Could be a separate command (`specforge verify spec.mmd`).
5. **JSON output mode** for piping into other tools.
6. **Self-dogfood milestone**: once items 1-2 land, run `specforge docs/behavior.md` and feed the
   output to FDR4. Verify deadlock-freeness and termination on specforge's own pipeline spec. This
   is the first end-to-end demonstration that the spec-behavior → specforge → FDR4 chain works.
7. **TLA+ backend** (eventual): same AST, different generator. Stub `src/tla.ts`.

## How to develop

### Apply these dotfiles-managed skills

- **`spec-behavior`** — for understanding/extending what input the parser accepts. When in doubt
  about syntax, run review mode on a spec.
- **`tdd`** — write tests first for new parser/cspm features. Existing tests are baseline only.
- **`commit`** — for commits (conventional commits, Japanese OK).
- **`code-review`** / **`simplify`** — before merging non-trivial changes.
- **`plan`** — when adding a feature that touches multiple modules (e.g., state variable threading).

### Useful commands

```bash
deno task test       # run tests
deno task fmt        # format
deno task lint       # lint
deno task check      # type check
deno task cli examples/traffic-light.mmd   # run on example
deno task compile    # produce bin/specforge binary
deno task bench      # run all benchmarks
deno task bench:compare /tmp/before.json /tmp/after.json   # compare two `deno bench --json` runs
```

パフォーマンス周りは `docs/perf.md` に詳細あり。

## Key references (in dotfiles / outside repo)

- **`~/.claude/skills/spec-behavior/SKILL.md`** — the spec language definition specforge must follow
- **`~/.claude/skills/spec-behavior/references/multi-entity-composition.md`** — multi-entity /
  refinement / impl-separation patterns (will matter when extending to multi-state-machine specs)
- **Real-world example spec**: `~/job/docs/tasks/active/hitl-evaluation-system-phase-flow-spec.md` —
  well-formed spec to test composite + orthogonal regions + multi-entity coverage against.
  Confidential, but kept local.

## Open design questions

These were noted during the PoC and haven't been decided yet. A future session should resolve them
as the relevant feature is implemented:

- **at-least-once event semantics**: How to model in CSP? CSP is exactly-once synchronous. Options:
  (a) trust the spec's idempotency declarations and ignore duplicates, (b) explicit duplicate
  channel modeling. Lean toward (a) since spec-behavior already requires idempotency annotation.
- **Action / event visibility in CSPm**: Events are CSP channels (clean). Actions like `log_skip` —
  should they be visible CSP events (so trace properties can reference them) or hidden via
  `\ {action_set}`? Probably visible by default, hideable via flag.
- **Guard expressions**: spec-behavior keeps guards readable, but disciplines them to simple integer
  comparisons. specforge currently emits guards verbatim, which can break FDR4 if the expression
  uses unsupported syntax. Either (a) restrict guards to a sub-DSL the parser validates, or (b)
  accept free text and surface unparseable guards as warnings.
- **State naming collisions across composites**: Same state name in two composites — namespace them
  by parent? Currently flat.

## Conversation context (how we got here)

This scaffold is the output of a session where:

1. The `spec-behavior` skill in dotfiles was authored, reviewed, and iterated through multiple PRs.
2. A real spec at `~/job/docs/tasks/active/hitl-evaluation-system-phase-flow-spec.md` was assessed
   for CSP translatability — assessed as **unusually well-suited** because spec-behavior's
   discipline already aligns with CSP semantics.
3. PoC tried four runtime + library combinations:
   - Deno + `npm:mermaid` (works with JSDOM shim, but heavy)
   - Bun + `mermaid` (works with happy-dom shim, but same hack)
   - Deno + hand-roll parser (clean, fast, zero deps)
   - Bun + hand-roll parser (same source as Deno, runtime-portable)
4. Decision: **hand-roll parser, Deno-primary**. Hand-roll avoids the DOM shim hack and the 425-dep
   weight; Deno over Bun for tooling stability.
5. Named `specforge` (forge formal verification targets from behavior specs).

## Next session — recommended first step

Before writing more code, **read `docs/spec.md`** to know what the parser/cspm must honor. The spec
doc is the canonical contract; CLAUDE.md (this file) is the project context wrapper around it.

Then pick item 1 from "Pending" (Action chain expansion):

1. Add a test in `tests/cspm.test.ts` for action chain expansion — input `a, b, c` should emit
   `a -> b -> c -> Next` (instead of the current `a, b, c -> Next`).
2. Watch it fail.
3. Update label parsing or `src/cspm.ts` (decision: split actions at parser level into `string[]`,
   or split at codegen time) to expand action chains.
4. Re-run on `/tmp/hitl-statechart.mmd` and verify FDR4-syntactic output.
5. Commit with `feat(cspm): ...` per conventional commits.
