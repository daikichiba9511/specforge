import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { parse } from "../src/parser.ts";
import { generateCspm } from "../src/cspm.ts";
import { expectOk } from "./_helpers.ts";

const cspmOf = (
    src: string,
    guards?: Map<string, string>,
    stateVars?: string[],
    eventPayloads?: Map<string, string[]>,
): string => generateCspm(expectOk(parse(src)), guards, stateVars, eventPayloads);

Deno.test("flat process emission (baseline, no event = no prefix, no tau)", () => {
    const out = cspmOf(`stateDiagram-v2
[*] --> A
A --> B : ev / act
B --> [*]`);
    assertStringIncludes(out, "A =\n  ev -> act -> B");
    assertStringIncludes(out, "B =\n  SKIP");
});

Deno.test("hierarchical composite (single region) inlines region entry", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}`);
    assertStringIncludes(out, "Outer = Inner");
    assertStringIncludes(out, "Inner =\n  SKIP");
});

Deno.test("orthogonal composite emits ||| between region entries", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> A
    A --> [*]
    --
    [*] --> B
    B --> [*]
}`);
    assertStringIncludes(out, "Outer = A ||| B");
});

Deno.test("composite completion transition uses ;", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next : / cleanup`);
    assertStringIncludes(out, "Outer = Inner ; cleanup -> Next");
});

Deno.test("composite triggered transition uses /\\ interrupt", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Fault : abort / alert`);
    assertStringIncludes(out, "Outer = Inner /\\ (abort -> alert -> Fault)");
});

Deno.test("composite with completion + triggered: (body ; complete) /\\ triggered", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next  : / done
Outer --> Fault : abort / alert`);
    assertStringIncludes(out, "Outer = (Inner ; done -> Next) /\\ (abort -> alert -> Fault)");
});

Deno.test("orthogonal composite with completion wraps body in parens", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> A
    A --> [*]
    --
    [*] --> B
    B --> [*]
}
Outer --> Next : / done`);
    assertStringIncludes(out, "Outer = (A ||| B) ; done -> Next");
});

Deno.test("multiple triggered transitions combined with [] under one /\\", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> X : ev1 / a1
Outer --> Y : ev2 / a2`);
    assertStringIncludes(
        out,
        "Outer = Inner /\\ (ev1 -> a1 -> X [] ev2 -> a2 -> Y)",
    );
});

Deno.test("flat transition expands action chain with ->", () => {
    const out = cspmOf(`stateDiagram-v2
A --> B : ev / a1, a2, a3`);
    assertStringIncludes(out, "ev -> a1 -> a2 -> a3 -> B");
});

Deno.test("completion transition expands action chain", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next : / done, cleanup`);
    assertStringIncludes(out, "Outer = Inner ; done -> cleanup -> Next");
});

Deno.test("triggered transition expands action chain inside /\\", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Fault : abort / log_err, alert`);
    assertStringIncludes(out, "Outer = Inner /\\ (abort -> log_err -> alert -> Fault)");
});

Deno.test("action chain preserves arguments inside parens", () => {
    const out = cspmOf(`stateDiagram-v2
A --> B : ev / write(x, y), notify`);
    assertStringIncludes(out, "ev -> write(x, y) -> notify -> B");
});

Deno.test("substitutes guard tag from dictionary", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [catalog_ok] / act`,
        new Map([["catalog_ok", "catalog_size > 0"]]),
    );
    assertStringIncludes(out, "(catalog_size > 0) & ev -> act -> B");
});

Deno.test("leaves unmapped guard verbatim when not in dictionary", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [unknown_guard] / act`,
        new Map([["other", "x > 0"]]),
    );
    assertStringIncludes(out, "(unknown_guard) & ev -> act -> B");
});

Deno.test("substitutes guard in completion transition", () => {
    const out = cspmOf(
        `stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next : [ok] / done`,
        new Map([["ok", "count > 0"]]),
    );
    assertStringIncludes(out, "Outer = Inner ; (count > 0) & done -> Next");
});

Deno.test("substitutes guard in triggered transition (inside /\\)", () => {
    const out = cspmOf(
        `stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Fault : abort [bad] / alert`,
        new Map([["bad", "err_count > 0"]]),
    );
    assertStringIncludes(out, "Outer = Inner /\\ ((err_count > 0) & abort -> alert -> Fault)");
});

Deno.test("Phase 4: parameterizes processes with state vars", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev / act`,
        undefined,
        ["catalog_size", "prelabeled_count"],
    );
    // Process LHS gets params; target invocation gets the same params.
    assertStringIncludes(out, "A(catalog_size, prelabeled_count) =");
    assertStringIncludes(out, "B(catalog_size, prelabeled_count)");
});

Deno.test("Phase 4: skips param threading when stateVars is empty", () => {
    const out = cspmOf(`stateDiagram-v2
A --> B : ev / act`);
    // No state vars → no params, falls back to plain process names.
    assertStringIncludes(out, "A =");
    assertEquals(out.includes("A("), false);
});

Deno.test("Phase 4: emits Spec entry point with initial 0 values", () => {
    const out = cspmOf(
        `stateDiagram-v2
[*] --> A : / setup
A --> [*]`,
        undefined,
        ["x", "y"],
    );
    assertStringIncludes(out, "Spec = setup -> A(0, 0)");
    assertStringIncludes(out, "-- assert Spec :[deadlock free]");
});

Deno.test("Phase 4: payload field matching state var name shadows the param (auto-update)", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [ok] / act`,
        new Map([["ok", "catalog_size > 0"]]),
        ["catalog_size"],
        new Map([["ev", ["batch_id", "catalog_size"]]]),
    );
    // `?batch_id.catalog_size` で受信 → 続く B(catalog_size) に bound 値が thread される。
    assertStringIncludes(
        out,
        "ev?batch_id.catalog_size -> (catalog_size > 0) & act -> B(catalog_size)",
    );
});

Deno.test("bound param overrides default nametype VAL = {0..1}", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
A --> B : ev`));
    const out = generateCspm(
        diagram,
        new Map(),
        [],
        new Map([["ev", ["count"]]]),
        7,
    );
    assertStringIncludes(out, "nametype VAL = {0..7}");
});

Deno.test("emits typed channel declaration for events with payload", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : sampling_done / act`,
        undefined,
        undefined,
        new Map([["sampling_done", ["batch_id", "catalog_size"]]]),
    );
    assertStringIncludes(out, "nametype VAL = {0..1}");
    assertStringIncludes(out, "channel sampling_done : VAL.VAL");
});

Deno.test("emits untyped channel for events / actions without payload", () => {
    const out = cspmOf(`stateDiagram-v2
A --> B : tick / log`);
    assertStringIncludes(out, "channel tick");
    assertStringIncludes(out, "channel log");
});

Deno.test("payload event uses ?-binding before guard (post-event guard)", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [ok] / act`,
        new Map([["ok", "catalog_size > 0"]]),
        undefined,
        new Map([["ev", ["batch_id", "catalog_size"]]]),
    );
    assertStringIncludes(out, "ev?batch_id.catalog_size -> (catalog_size > 0) & act -> B");
});

Deno.test("non-payload event keeps pre-event guard form", () => {
    const out = cspmOf(
        `stateDiagram-v2
A --> B : ev [ok] / act`,
        new Map([["ok", "x > 0"]]),
    );
    assertStringIncludes(out, "(x > 0) & ev -> act -> B");
});

Deno.test("composite ID is not also emitted as a flat process", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Next : ev / act`);
    const matches = out.match(/^Outer =/gm) ?? [];
    assertEquals(matches.length, 1, `expected exactly one 'Outer =' definition, got: ${out}`);
});
