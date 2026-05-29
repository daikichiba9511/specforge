import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { parse } from "../src/parser.ts";
import { generateTla } from "../src/tla.ts";
import { expectOk } from "./_helpers.ts";

const tlaOf = (
    src: string,
    guards?: Map<string, string>,
    stateVars?: string[],
    eventPayloads?: Map<string, string[]>,
    moduleName?: string,
): string => generateTla(expectOk(parse(src)), guards, stateVars, eventPayloads, moduleName);

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

Deno.test("Phase B: composite adds region phase variables", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Done : / finish`);
    assertStringIncludes(out, "VARIABLES phase, outer_r0");
    // Init: initial が composite → region var 入口に
    assertStringIncludes(out, `outer_r0 = "Inner"`);
});

Deno.test("Phase B: region inner transitions update only the region phase var", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> A
    A --> B
    B --> [*]
}
Outer --> Done : / finish`);
    // region 内部 A --> B
    assertStringIncludes(out, "Outer_r0_A_tau_B ==");
    assertStringIncludes(out, `phase = "Outer"`);
    assertStringIncludes(out, `outer_r0 = "A"`);
    assertStringIncludes(out, `outer_r0' = "B"`);
    // region 完了 B --> [*]
    assertStringIncludes(out, "Outer_r0_B_tau_done ==");
    assertStringIncludes(out, `outer_r0' = "_done"`);
});

Deno.test("Phase B: orthogonal regions get separate variables, both progress independently", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> A
    A --> [*]
    --
    [*] --> B
    B --> [*]
}
Outer --> Done : / finish`);
    assertStringIncludes(out, "VARIABLES phase, outer_r0, outer_r1");
    assertStringIncludes(out, `outer_r0 = "A"`); // region 0 entry in Init
    assertStringIncludes(out, `outer_r1 = "B"`); // region 1 entry in Init
});

Deno.test("Phase B: completion transition requires all regions done", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> A
    A --> [*]
    --
    [*] --> B
    B --> [*]
}
Outer --> Done : / finish`);
    // composite → top で event=null (完了遷移) → 両 region が _done を precondition
    assertStringIncludes(out, "Outer_tau_Done ==");
    assertStringIncludes(out, `outer_r0 = "_done"`);
    assertStringIncludes(out, `outer_r1 = "_done"`);
    assertStringIncludes(out, `phase' = "Done"`);
    // 退出時 region を _inactive にリセット
    assertStringIncludes(out, `outer_r0' = "_inactive"`);
});

Deno.test("Phase B: triggered exit (event != null) interrupts without requiring _done", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> A
    A --> [*]
}
Outer --> Fault : abort / log`);
    // triggered: event "abort" がある → 完了条件 (region = _done) は precondition に入れない
    assertStringIncludes(out, "Outer_abort_Fault ==");
    // Outer_abort_Fault 内に `outer_r0 = "_done"` precondition は無い
    const actionBlock = out.substring(
        out.indexOf("Outer_abort_Fault =="),
        out.indexOf("Stutter") > 0 ? out.indexOf("Stutter") : out.length,
    );
    assertEquals(actionBlock.includes(`outer_r0 = "_done"`), false);
    // 退出時 region は _inactive にリセット
    assertStringIncludes(actionBlock, `outer_r0' = "_inactive"`);
});

Deno.test("Phase B: entering composite from top-level initializes its regions", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Start
Start --> Outer : begin
state Outer {
    [*] --> Inner
    Inner --> [*]
}`);
    // Start → Outer は composite 入る遷移 → outer_r0 を入口に init
    assertStringIncludes(out, "Start_begin_Outer ==");
    assertStringIncludes(out, `outer_r0' = "Inner"`);
});

Deno.test("Phase 2: event payload matching state var → \\E binding + var' update", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        new Map([["ok", "catalog_size > 0"]]),
        ["catalog_size"],
        new Map([["ev", ["batch_id", "catalog_size"]]]),
    );
    // Domain が emit される
    assertStringIncludes(out, "Domain == 0..1");
    // \E new_catalog_size \in Domain: で wrap
    assertStringIncludes(out, "\\E new_catalog_size \\in Domain:");
    // guard 内の catalog_size が new_catalog_size にリネーム
    assertStringIncludes(out, "new_catalog_size > 0");
    // primed update
    assertStringIncludes(out, "catalog_size' = new_catalog_size");
    // catalog_size は bound なので UNCHANGED から除外される
    const actionBlock = out.substring(out.indexOf("A_ev_B =="));
    assertEquals(actionBlock.includes("UNCHANGED <<catalog_size"), false);
});

Deno.test("Phase 2: payload field NOT matching any state var → no binding", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev`,
        undefined,
        ["count"],
        new Map([["ev", ["unrelated_field"]]]),
    );
    assertEquals(out.includes("\\E new_"), false);
    // count は UNCHANGED に入る
    assertStringIncludes(out, "UNCHANGED <<count");
});

Deno.test("Phase 2: empty eventPayloads → no Domain emitted, UNCHANGED everywhere", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev`,
        undefined,
        ["count"],
    );
    assertEquals(out.includes("Domain =="), false);
    assertEquals(out.includes("\\E new_"), false);
});

Deno.test("Phase 2: bound update works in region action too", () => {
    const out = tlaOf(
        `stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> A
    A --> B : ev [ok]
}`,
        new Map([["ok", "count > 0"]]),
        ["count"],
        new Map([["ev", ["count"]]]),
    );
    // region 内の遷移でも payload binding が効く
    assertStringIncludes(out, "Outer_r0_A_ev_B ==");
    assertStringIncludes(out, "\\E new_count \\in Domain:");
    assertStringIncludes(out, "count' = new_count");
});

Deno.test("Phase 2: CSPm-style operators in guard are translated to TLA+ flavor", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev [g]`,
        new Map([["g", "count == 0 && other != 1"]]),
        ["count", "other"],
    );
    // == → =, != → /=, && → /\
    assertStringIncludes(out, "count = 0 /\\ other /= 1");
});

Deno.test("bound param overrides default Domain = 0..1", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
A --> B : ev`));
    const out = generateTla(
        diagram,
        new Map(),
        ["count"],
        new Map([["ev", ["count"]]]),
        "Spec",
        5,
    );
    assertStringIncludes(out, "Domain == 0..5");
});
