import { expect, test } from "bun:test";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { parse } from "../src/parser.ts";
import { generateCspm } from "../src/cspm.ts";
import { expectOk } from "./_helpers.ts";

/** テストの Mermaid 入力をパースし、指定した補助情報を使って比較用の CSPm を生成する。 */
function cspmOf(
    src: string,
    guards?: Map<string, string>,
    stateVars?: string[],
    eventPayloads?: Map<string, string[]>,
): string {
    return generateCspm(expectOk(parse(src)), guards, stateVars, eventPayloads);
}

test("flat process emission (baseline, no event = no prefix, no tau)", () => {
    const out = cspmOf(`stateDiagram-v2
[*] --> A
A --> B : ev / act
B --> [*]`);
    expect(out).toContain("A =\n  ev -> act -> B");
    expect(out).toContain("B =\n  SKIP");
});

test("hierarchical composite (single region) inlines region entry", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}`);
    expect(out).toContain("Outer = Inner");
    expect(out).toContain("Inner =\n  SKIP");
});

test("orthogonal composite emits ||| between region entries", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> A
    A --> [*]
    --
    [*] --> B
    B --> [*]
}`);
    expect(out).toContain("Outer = A ||| B");
});

test("composite completion transition uses ;", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next : / cleanup`);
    expect(out).toContain("Outer = Inner ; cleanup -> Next");
});

test("composite triggered transition uses /\\ interrupt", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Fault : abort / alert`);
    expect(out).toContain("Outer = Inner /\\ (abort -> alert -> Fault)");
});

test("composite with completion + triggered: (body ; complete) /\\ triggered", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next  : / done
Outer --> Fault : abort / alert`);
    expect(out).toContain("Outer = (Inner ; done -> Next) /\\ (abort -> alert -> Fault)");
});

test("orthogonal composite with completion wraps body in parens", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> A
    A --> [*]
    --
    [*] --> B
    B --> [*]
}
Outer --> Next : / done`);
    expect(out).toContain("Outer = (A ||| B) ; done -> Next");
});

test("multiple triggered transitions combined with [] under one /\\", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> X : ev1 / a1
Outer --> Y : ev2 / a2`);
    expect(out).toContain("Outer = Inner /\\ (ev1 -> a1 -> X [] ev2 -> a2 -> Y)");
});

test("flat transition expands action chain with ->", () => {
    const out = cspmOf(`stateDiagram-v2
A --> B : ev / a1, a2, a3`);
    expect(out).toContain("ev -> a1 -> a2 -> a3 -> B");
});

test("completion transition expands action chain", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next : / done, cleanup`);
    expect(out).toContain("Outer = Inner ; done -> cleanup -> Next");
});

test("triggered transition expands action chain inside /\\", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Fault : abort / log_err, alert`);
    expect(out).toContain("Outer = Inner /\\ (abort -> log_err -> alert -> Fault)");
});

test("action chain preserves arguments inside parens", () => {
    const out = cspmOf(`stateDiagram-v2
A --> B : ev / write(x, y), notify`);
    expect(out).toContain("ev -> write(x, y) -> notify -> B");
});

test("substitutes guard tag from dictionary", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [catalog_ok] / act`,
        new Map([["catalog_ok", "catalog_size > 0"]]),
    );
    expect(out).toContain("(catalog_size > 0) & ev -> act -> B");
});

test("leaves unmapped guard verbatim when not in dictionary", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [unknown_guard] / act`,
        new Map([["other", "x > 0"]]),
    );
    expect(out).toContain("(unknown_guard) & ev -> act -> B");
});

test("substitutes guard in completion transition", () => {
    const out = cspmOf(
        `stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next : [ok] / done`,
        new Map([["ok", "count > 0"]]),
    );
    expect(out).toContain("Outer = Inner ; (count > 0) & done -> Next");
});

test("substitutes guard in triggered transition (inside /\\)", () => {
    const out = cspmOf(
        `stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Fault : abort [bad] / alert`,
        new Map([["bad", "err_count > 0"]]),
    );
    expect(out).toContain("Outer = Inner /\\ ((err_count > 0) & abort -> alert -> Fault)");
});

test("Phase 4: parameterizes processes with state vars", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev / act`,
        undefined,
        ["catalog_size", "prelabeled_count"],
    );
    // Process LHS gets params; target invocation gets the same params.
    expect(out).toContain("A(catalog_size, prelabeled_count) =");
    expect(out).toContain("B(catalog_size, prelabeled_count)");
});

test("Phase 4: skips param threading when stateVars is empty", () => {
    const out = cspmOf(`stateDiagram-v2
A --> B : ev / act`);
    // No state vars → no params, falls back to plain process names.
    expect(out).toContain("A =");
    assertEquals(out.includes("A("), false);
});

test("Phase 4: emits Spec entry point with initial 0 values", () => {
    const out = cspmOf(
        `stateDiagram-v2
[*] --> A : / setup
A --> [*]`,
        undefined,
        ["x", "y"],
    );
    expect(out).toContain("Spec = setup -> A(0, 0)");
    expect(out).toContain("-- assert Spec :[deadlock free]");
});

test("Phase 4: payload field matching state var name shadows the param (auto-update)", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [ok] / act`,
        new Map([["ok", "catalog_size > 0"]]),
        ["catalog_size"],
        new Map([["ev", ["batch_id", "catalog_size"]]]),
    );
    // `?batch_id.catalog_size` で受信 → 続く B(catalog_size) に bound 値が thread される。
    expect(out).toContain(
        "ev?batch_id.catalog_size -> (catalog_size > 0) & act -> B(catalog_size)",
    );
});

test("bound param overrides default nametype VAL = {0..1}", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
A --> B : ev`));
    const out = generateCspm(
        diagram,
        new Map(),
        [],
        new Map([["ev", ["count"]]]),
        7,
    );
    expect(out).toContain("nametype VAL = {0..7}");
});

test("emits typed channel declaration for events with payload", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : sampling_done / act`,
        undefined,
        undefined,
        new Map([["sampling_done", ["batch_id", "catalog_size"]]]),
    );
    expect(out).toContain("nametype VAL = {0..1}");
    expect(out).toContain("channel sampling_done : VAL.VAL");
});

test("emits untyped channel for events / actions without payload", () => {
    const out = cspmOf(`stateDiagram-v2
A --> B : tick / log`);
    expect(out).toContain("channel tick");
    expect(out).toContain("channel log");
});

test("payload event uses ?-binding before guard (post-event guard)", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [ok] / act`,
        new Map([["ok", "catalog_size > 0"]]),
        undefined,
        new Map([["ev", ["batch_id", "catalog_size"]]]),
    );
    expect(out).toContain("ev?batch_id.catalog_size -> (catalog_size > 0) & act -> B");
});

test("non-payload event keeps pre-event guard form", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [ok] / act`,
        new Map([["ok", "x > 0"]]),
    );
    expect(out).toContain("(x > 0) & ev -> act -> B");
});

test("composite ID is not also emitted as a flat process", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next : ev / act`);
    const matches = out.match(/^Outer =/gm) ?? [];
    assertEquals(matches.length, 1, `expected exactly one 'Outer =' definition, got: ${out}`);
});
