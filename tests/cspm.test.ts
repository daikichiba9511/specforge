import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { parse } from "../src/parser.ts";
import { generateCspm } from "../src/cspm.ts";
import { expectOk } from "./_helpers.ts";

const cspmOf = (src: string): string => generateCspm(expectOk(parse(src)));

Deno.test("flat process emission (baseline)", () => {
    const out = cspmOf(`stateDiagram-v2
[*] --> A
A --> B : ev / act
B --> [*]`);
    assertEquals(
        out,
        "A =\n  ev -> act -> B\n\nB =\n  tau -> SKIP",
    );
});

Deno.test("hierarchical composite (single region) inlines region entry", () => {
    const out = cspmOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}`);
    assertStringIncludes(out, "Outer = Inner");
    assertStringIncludes(out, "Inner =\n  tau -> SKIP");
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
