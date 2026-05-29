import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { parse } from "../src/parser.ts";
import { generateTla } from "../src/tla.ts";
import { expectOk } from "./_helpers.ts";

const tlaOf = (
    src: string,
    guards?: Map<string, string>,
    stateVars?: string[],
    moduleName?: string,
): string => generateTla(expectOk(parse(src)), guards, stateVars, moduleName);

Deno.test("emits MODULE header + EXTENDS + footer", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> [*]`);
    assertStringIncludes(out, "---- MODULE Spec ----");
    assertStringIncludes(out, "EXTENDS Naturals");
    assertStringIncludes(out, "====");
});

Deno.test("custom module name overrides default", () => {
    const out = tlaOf(
        `stateDiagram-v2
[*] --> A`,
        undefined,
        undefined,
        "Hitl",
    );
    assertStringIncludes(out, "---- MODULE Hitl ----");
});

Deno.test("Init binds phase to the [*] --> X target", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Red
Red --> Green
Green --> Red`);
    assertStringIncludes(out, `phase = "Red"`);
});

Deno.test("each non-pseudo transition becomes an action with phase predicate", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> B : ev / act`);
    assertStringIncludes(out, "A_ev_B ==");
    assertStringIncludes(out, `phase = "A"`);
    assertStringIncludes(out, `phase' = "B"`);
});

Deno.test("guard tags substituted from dictionary become TLA+ conjuncts", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        new Map([["ok", "count > 0"]]),
    );
    assertStringIncludes(out, "/\\ count > 0");
});

Deno.test("state vars become VARIABLES and Init defaults", () => {
    const out = tlaOf(
        `stateDiagram-v2
[*] --> A`,
        undefined,
        ["count", "ready"],
    );
    assertStringIncludes(out, "VARIABLES phase, count, ready");
    assertStringIncludes(out, "vars == <<phase, count, ready>>");
    assertStringIncludes(out, "/\\ count = 0");
    assertStringIncludes(out, "/\\ ready = 0");
});

Deno.test("transitions add UNCHANGED for state vars (Phase A: no updates)", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev`,
        undefined,
        ["count"],
    );
    assertStringIncludes(out, "/\\ UNCHANGED <<count>>");
});

Deno.test("X --> [*] makes X terminal; Stutter is added to Next", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> B
B --> [*]`);
    assertStringIncludes(out, `TerminalStates == {"B"}`);
    assertStringIncludes(out, "Stutter ==");
    assertStringIncludes(out, `phase \\in TerminalStates`);
    assertStringIncludes(out, "\\/ Stutter");
});

Deno.test("no terminal states → no Stutter emitted", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> B
B --> A`);
    assertEquals(out.includes("Stutter"), false);
    assertEquals(out.includes("TerminalStates"), false);
});

Deno.test("Next combines actions with disjunction; Spec wraps with always-next", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> B : ev1
B --> A : ev2`);
    assertStringIncludes(out, "Next ==");
    assertStringIncludes(out, "\\/ A_ev1_B");
    assertStringIncludes(out, "\\/ B_ev2_A");
    assertStringIncludes(out, "Spec == Init /\\ [][Next]_vars");
});

Deno.test("duplicate (from, event, to) actions get suffix to avoid collision", () => {
    const out = tlaOf(`stateDiagram-v2
A --> B : ev [g1]
A --> B : ev [g2]`);
    // 2 つの A_ev_B が出る → 2 つ目は A_ev_B_2 で uniquified
    assertStringIncludes(out, "A_ev_B ==");
    assertStringIncludes(out, "A_ev_B_2 ==");
});
