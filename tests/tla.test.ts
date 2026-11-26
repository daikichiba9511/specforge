import { expect, test } from "bun:test";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { parse } from "../src/parser.ts";
import { generateTla } from "../src/tla.ts";
import { expectOk } from "./_helpers.ts";

/** テストの Mermaid 入力をパースし、指定した補助情報を使って比較用の TLA+ を生成する。 */
function tlaOf(
    src: string,
    guards?: Map<string, string>,
    stateVars?: string[],
    eventPayloads?: Map<string, string[]>,
    moduleName?: string,
): string {
    return generateTla(expectOk(parse(src)), guards, stateVars, eventPayloads, moduleName);
}

test("emits MODULE header + EXTENDS + footer", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> [*]`);
    expect(out).toContain("---- MODULE Spec ----");
    expect(out).toContain("EXTENDS Naturals");
    expect(out).toContain("====");
});

test("custom module name overrides default", () => {
    const out = tlaOf(
        `stateDiagram-v2
[*] --> A`,
        undefined,
        undefined,
        undefined,
        "Hitl",
    );
    expect(out).toContain("---- MODULE Hitl ----");
});

test("Init binds phase to the [*] --> X target", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Red
Red --> Green
Green --> Red`);
    expect(out).toContain(`phase = "Red"`);
});

test("each non-pseudo transition becomes an action with phase predicate", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> B : ev / act`);
    expect(out).toContain("A_ev_B ==");
    expect(out).toContain(`phase = "A"`);
    expect(out).toContain(`phase' = "B"`);
});

test("guard tags substituted from dictionary become TLA+ conjuncts", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        new Map([["ok", "count > 0"]]),
    );
    expect(out).toContain("/\\ count > 0");
});

test("state vars become VARIABLES and Init defaults", () => {
    const out = tlaOf(
        `stateDiagram-v2
[*] --> A`,
        undefined,
        ["count", "ready"],
    );
    expect(out).toContain("VARIABLES phase, count, ready");
    expect(out).toContain("vars == <<phase, count, ready>>");
    expect(out).toContain("/\\ count = 0");
    expect(out).toContain("/\\ ready = 0");
});

test("transitions add UNCHANGED for state vars (Phase A: no updates)", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev`,
        undefined,
        ["count"],
    );
    expect(out).toContain("/\\ UNCHANGED <<count>>");
});

test("X --> [*] makes X terminal; Stutter is added to Next", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> B
B --> [*]`);
    expect(out).toContain(`TerminalStates == {"B"}`);
    expect(out).toContain("Stutter ==");
    expect(out).toContain(`phase \\in TerminalStates`);
    expect(out).toContain("\\/ Stutter");
});

test("no terminal states → no Stutter emitted", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> B
B --> A`);
    assertEquals(out.includes("Stutter"), false);
    assertEquals(out.includes("TerminalStates"), false);
});

test("Next combines actions with disjunction; Spec wraps with always-next", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> B : ev1
B --> A : ev2`);
    expect(out).toContain("Next ==");
    expect(out).toContain("\\/ A_ev1_B");
    expect(out).toContain("\\/ B_ev2_A");
    expect(out).toContain("Spec == Init /\\ [][Next]_vars");
});

test("duplicate (from, event, to) actions get suffix to avoid collision", () => {
    const out = tlaOf(`stateDiagram-v2
A --> B : ev [g1]
A --> B : ev [g2]`);
    // 2 つの A_ev_B が出る → 2 つ目は A_ev_B_2 で uniquified
    expect(out).toContain("A_ev_B ==");
    expect(out).toContain("A_ev_B_2 ==");
});

test("Phase B: composite adds region phase variables", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> Inner
    Inner --> [*]
}
Outer --> Done : / finish`);
    expect(out).toContain("VARIABLES phase, outer_r0");
    // Init: initial が composite → region var 入口に
    expect(out).toContain(`outer_r0 = "Inner"`);
});

test("Phase B: region inner transitions update only the region phase var", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> A
    A --> B
    B --> [*]
}
Outer --> Done : / finish`);
    // region 内部 A --> B
    expect(out).toContain("Outer_r0_A_tau_B ==");
    expect(out).toContain(`phase = "Outer"`);
    expect(out).toContain(`outer_r0 = "A"`);
    expect(out).toContain(`outer_r0' = "B"`);
    // region 完了 B --> [*]
    expect(out).toContain("Outer_r0_B_tau_done ==");
    expect(out).toContain(`outer_r0' = "_done"`);
});

test("Phase B: orthogonal regions get separate variables, both progress independently", () => {
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
    expect(out).toContain("VARIABLES phase, outer_r0, outer_r1");
    expect(out).toContain(`outer_r0 = "A"`); // region 0 entry in Init
    expect(out).toContain(`outer_r1 = "B"`); // region 1 entry in Init
});

test("Phase B: completion transition requires all regions done", () => {
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
    expect(out).toContain("Outer_tau_Done ==");
    expect(out).toContain(`outer_r0 = "_done"`);
    expect(out).toContain(`outer_r1 = "_done"`);
    expect(out).toContain(`phase' = "Done"`);
    // 退出時 region を _inactive にリセット
    expect(out).toContain(`outer_r0' = "_inactive"`);
});

test("Phase B: triggered exit (event != null) interrupts without requiring _done", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Outer
state Outer {
    [*] --> A
    A --> [*]
}
Outer --> Fault : abort / log`);
    // triggered: event "abort" がある → 完了条件 (region = _done) は precondition に入れない
    expect(out).toContain("Outer_abort_Fault ==");
    // Outer_abort_Fault 内に `outer_r0 = "_done"` precondition は無い
    const actionBlock = out.substring(
        out.indexOf("Outer_abort_Fault =="),
        out.indexOf("Stutter") > 0 ? out.indexOf("Stutter") : out.length,
    );
    assertEquals(actionBlock.includes(`outer_r0 = "_done"`), false);
    // 退出時 region は _inactive にリセット
    expect(actionBlock).toContain(`outer_r0' = "_inactive"`);
});

test("Phase B: entering composite from top-level initializes its regions", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> Start
Start --> Outer : begin
state Outer {
    [*] --> Inner
    Inner --> [*]
}`);
    // Start → Outer は composite 入る遷移 → outer_r0 を入口に init
    expect(out).toContain("Start_begin_Outer ==");
    expect(out).toContain(`outer_r0' = "Inner"`);
});

test("Phase 2: event payload matching state var → \\E binding + var' update", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        new Map([["ok", "catalog_size > 0"]]),
        ["catalog_size"],
        new Map([["ev", ["batch_id", "catalog_size"]]]),
    );
    // Domain が emit される
    expect(out).toContain("Domain == 0..1");
    // \E new_catalog_size \in Domain: で wrap
    expect(out).toContain("\\E new_catalog_size \\in Domain:");
    // guard 内の catalog_size が new_catalog_size にリネーム
    expect(out).toContain("new_catalog_size > 0");
    // primed update
    expect(out).toContain("catalog_size' = new_catalog_size");
    // catalog_size は bound なので UNCHANGED から除外される
    const actionBlock = out.substring(out.indexOf("A_ev_B =="));
    assertEquals(actionBlock.includes("UNCHANGED <<catalog_size"), false);
});

test("Phase 2: payload field NOT matching any state var → no binding", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev`,
        undefined,
        ["count"],
        new Map([["ev", ["unrelated_field"]]]),
    );
    assertEquals(out.includes("\\E new_"), false);
    // count は UNCHANGED に入る
    expect(out).toContain("UNCHANGED <<count");
});

test("Phase 2: empty eventPayloads → no Domain emitted, UNCHANGED everywhere", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev`,
        undefined,
        ["count"],
    );
    assertEquals(out.includes("Domain =="), false);
    assertEquals(out.includes("\\E new_"), false);
});

test("Phase 2: bound update works in region action too", () => {
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
    expect(out).toContain("Outer_r0_A_ev_B ==");
    expect(out).toContain("\\E new_count \\in Domain:");
    expect(out).toContain("count' = new_count");
});

test("Phase 2: CSPm-style operators in guard are translated to TLA+ flavor", () => {
    const out = tlaOf(
        `stateDiagram-v2
A --> B : ev [g]`,
        new Map([["g", "count == 0 && other != 1"]]),
        ["count", "other"],
    );
    // == → =, != → /=, && → /\
    expect(out).toContain("count = 0 /\\ other /= 1");
});

test("bound param overrides default Domain = 0..1", () => {
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
    expect(out).toContain("Domain == 0..5");
});

test("Liveness: empty list → no Fairness / Property, Spec stays safety-only", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> [*]`);
    assertEquals(out.includes("Fairness =="), false);
    assertEquals(out.includes("WF_vars"), false);
    expect(out).toContain("Spec == Init /\\ [][Next]_vars");
});

test("Liveness: single property emits Fairness + property def + Spec conjunction", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
[*] --> A
A --> [*]`));
    const out = generateTla(
        diagram,
        new Map(),
        [],
        new Map(),
        "Spec",
        1,
        [{ name: "Termination", formula: "<>Terminated" }],
    );
    expect(out).toContain("Terminated == phase \\in TerminalStates");
    expect(out).toContain("Fairness == WF_vars(Next)");
    expect(out).toContain("Spec == Init /\\ [][Next]_vars /\\ Fairness");
    expect(out).toContain("Termination == <>Terminated");
});

test("Liveness: multiple properties each get their own definition", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
[*] --> A
A --> [*]`));
    const out = generateTla(
        diagram,
        new Map(),
        [],
        new Map(),
        "Spec",
        1,
        [
            { name: "Termination", formula: "<>Terminated" },
            { name: "EventuallyDone", formula: `<>(phase = "Done")` },
        ],
    );
    expect(out).toContain("Termination == <>Terminated");
    expect(out).toContain(`EventuallyDone == <>(phase = "Done")`);
});

test("Stutter uses Terminated predicate (refactored from inline)", () => {
    const out = tlaOf(`stateDiagram-v2
[*] --> A
A --> [*]`);
    expect(out).toContain("Terminated == phase \\in TerminalStates");
    expect(out).toContain("/\\ Terminated");
});
