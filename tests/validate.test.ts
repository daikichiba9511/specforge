import { expect, test } from "bun:test";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { parse } from "../src/parser.ts";
import { formatIssue, validate } from "../src/validate.ts";
import type { SpecDoc } from "../src/spec_doc.ts";
import { expectOk } from "./_helpers.ts";

/** 検査に使う表を空にした仕様を用意し、各テストが指定した項目だけを上書きする。 */
function mkDoc(overrides: Partial<SpecDoc> = {}): SpecDoc {
    return {
        mermaid: "",
        guards: new Map(),
        stateVars: [],
        eventPayloads: new Map(),
        liveness: [],
        ...overrides,
    };
}

/** パースの成功を確認した上で補助情報と突き合わせ、意味検査の結果を返す。 */
function validateOf(src: string, doc?: Partial<SpecDoc>) {
    return validate(expectOk(parse(src)), mkDoc(doc));
}

test("V001: guard tag missing from dictionary → warning", () => {
    const report = validateOf(`stateDiagram-v2
A --> B : ev [unknown_guard]`);
    const v001 = report.issues.filter((i) => i.code === "V001");
    assertEquals(v001.length, 1);
    expect(v001[0].message).toContain("unknown_guard");
});

test("V001: guard tag present in dictionary → no warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        { guards: new Map([["ok", "count > 0"]]), stateVars: ["count"] },
    );
    assertEquals(report.issues.filter((i) => i.code === "V001").length, 0);
});

test("V002: variable in guard expression not declared anywhere → warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        { guards: new Map([["ok", "missing_var > 0"]]) },
    );
    const v002 = report.issues.filter((i) => i.code === "V002");
    assertEquals(v002.length, 1);
    expect(v002[0].message).toContain("missing_var");
});

test("V002: variable in state vars → no warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        {
            guards: new Map([["ok", "count > 0"]]),
            stateVars: ["count"],
        },
    );
    assertEquals(report.issues.filter((i) => i.code === "V002").length, 0);
});

test("V002: variable bound by event payload → no warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        {
            guards: new Map([["ok", "count > 0"]]),
            eventPayloads: new Map([["ev", ["count"]]]),
        },
    );
    assertEquals(report.issues.filter((i) => i.code === "V002").length, 0);
});

test("V002: TRUE / FALSE / in are treated as keywords, not variables", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev [g]`,
        {
            guards: new Map([["g", "x in pool || ready == TRUE"]]),
            stateVars: ["x", "pool", "ready"],
        },
    );
    assertEquals(report.issues.filter((i) => i.code === "V002").length, 0);
});

test("V002: numeric literals are not flagged", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev [g]`,
        {
            guards: new Map([["g", "count >= 5 && count <= 100"]]),
            stateVars: ["count"],
        },
    );
    assertEquals(report.issues.filter((i) => i.code === "V002").length, 0);
});

test("V003: composite region without [*] -->" + " entry → warning", () => {
    const report = validateOf(`stateDiagram-v2
state Outer {
    A --> B
}`);
    const v003 = report.issues.filter((i) => i.code === "V003");
    assertEquals(v003.length, 1);
    expect(v003[0].message).toContain("Outer");
});

test("V003: composite region WITH [*] --> entry → no warning", () => {
    const report = validateOf(`stateDiagram-v2
state Outer {
    [*] --> A
    A --> [*]
}`);
    assertEquals(report.issues.filter((i) => i.code === "V003").length, 0);
});

test("V003: orthogonal composite: per-region check", () => {
    const report = validateOf(`stateDiagram-v2
state Outer {
    [*] --> A
    A --> [*]
    --
    B --> [*]
}`);
    // region 0 has entry, region 1 doesn't → 1 warning
    const v003 = report.issues.filter((i) => i.code === "V003");
    assertEquals(v003.length, 1);
    expect(v003[0].message).toContain("region 1");
});

test("formatIssue includes code, message, hint", () => {
    const out = formatIssue({
        level: "warning",
        code: "V999",
        message: "something happened",
        suggestion: "do X instead",
    });
    expect(out).toContain("warn V999: something happened");
    expect(out).toContain("hint: do X instead");
});

test("V004: state declared but no transition leads to it → warning", () => {
    const report = validateOf(`stateDiagram-v2
state Orphan
[*] --> A
A --> B
B --> [*]
Orphan --> B`);
    const v004 = report.issues.filter((i) => i.code === "V004");
    assertEquals(v004.length, 1);
    expect(v004[0].message).toContain("Orphan");
});

test("V004: every declared state reachable → no warning", () => {
    const report = validateOf(`stateDiagram-v2
[*] --> A
A --> B
B --> [*]`);
    assertEquals(report.issues.filter((i) => i.code === "V004").length, 0);
});

test("V004: alias with reachable transition → no warning", () => {
    const report = validateOf(`stateDiagram-v2
state "開始" as Start
state "終了" as End
[*] --> Start
Start --> End
End --> [*]`);
    assertEquals(report.issues.filter((i) => i.code === "V004").length, 0);
});

test("V004: composite ID with inbound transition → reachable", () => {
    const report = validateOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> [*]
}
[*] --> Outer
Outer --> Done : / finish
Done --> [*]`);
    // Outer は [*] --> Outer の to なので reachable、Inner も [*] --> Inner の to なので reachable
    assertEquals(report.issues.filter((i) => i.code === "V004").length, 0);
});

test("V005: reachable state with no outbound → warning", () => {
    const report = validateOf(`stateDiagram-v2
[*] --> A
A --> Stuck
A --> [*]`);
    const v005 = report.issues.filter((i) => i.code === "V005");
    assertEquals(v005.length, 1);
    expect(v005[0].message).toContain("Stuck");
});

test("V005: state with `--> [*]` outbound → no warning", () => {
    const report = validateOf(`stateDiagram-v2
[*] --> A
A --> [*]`);
    assertEquals(report.issues.filter((i) => i.code === "V005").length, 0);
});

test("V005: unreachable stuck state → V004 fires, V005 does not (mutually exclusive)", () => {
    const report = validateOf(`stateDiagram-v2
state Orphan
[*] --> A
A --> [*]`);
    assertEquals(report.issues.filter((i) => i.code === "V004").length, 1);
    assertEquals(report.issues.filter((i) => i.code === "V005").length, 0);
});

test("V005: stuck state inside composite region → warning", () => {
    const report = validateOf(`stateDiagram-v2
state Outer {
    [*] --> Inner
    Inner --> Stuck
}
[*] --> Outer
Outer --> Done : / finish
Done --> [*]`);
    const v005 = report.issues.filter((i) => i.code === "V005");
    assertEquals(v005.length, 1);
    expect(v005[0].message).toContain("Stuck");
});

test("V007: identical transitions (action only differs) → warning", () => {
    const report = validateOf(`stateDiagram-v2
A --> B : ev / action1
A --> B : ev / action2
B --> [*]`);
    const v007 = report.issues.filter((i) => i.code === "V007");
    assertEquals(v007.length, 1);
    expect(v007[0].message).toContain("A --> B");
    expect(v007[0].message).toContain(": ev");
});

test("V007: same event with different guards → no warning", () => {
    const report = validateOf(`stateDiagram-v2
A --> B : ev [g1]
A --> B : ev [g2]
B --> [*]`);
    assertEquals(report.issues.filter((i) => i.code === "V007").length, 0);
});

test("V007: different events → no warning", () => {
    const report = validateOf(`stateDiagram-v2
A --> B : ev1
A --> B : ev2
B --> [*]`);
    assertEquals(report.issues.filter((i) => i.code === "V007").length, 0);
});

test("V007: completely identical 3 transitions → warning mentions count", () => {
    const report = validateOf(`stateDiagram-v2
A --> B : ev [g]
A --> B : ev [g]
A --> B : ev [g]
B --> [*]`);
    const v007 = report.issues.filter((i) => i.code === "V007");
    assertEquals(v007.length, 1);
    expect(v007[0].message).toContain("3 transitions");
});

test("V006: payload field exact match with state var → no warning (Phase 2 binding)", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev
B --> [*]`,
        {
            stateVars: ["balance"],
            eventPayloads: new Map([["ev", ["balance"]]]),
        },
    );
    assertEquals(report.issues.filter((i) => i.code === "V006").length, 0);
});

test("V006: payload field 1 char off from state var (substitution) → warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev
B --> [*]`,
        {
            stateVars: ["balance"],
            eventPayloads: new Map([["ev", ["ballance"]]]), // 1 extra 'l'
        },
    );
    const v006 = report.issues.filter((i) => i.code === "V006");
    assertEquals(v006.length, 1);
    expect(v006[0].message).toContain("ballance");
    expect(v006[0].message).toContain("balance");
    expect(v006[0].message).toContain("1 character off");
});

test("V006: payload field normalizes to state var (case mismatch) → warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev
B --> [*]`,
        {
            stateVars: ["catalog_size"],
            eventPayloads: new Map([["ev", ["CatalogSize"]]]),
        },
    );
    const v006 = report.issues.filter((i) => i.code === "V006");
    assertEquals(v006.length, 1);
    expect(v006[0].message).toContain("CatalogSize");
    expect(v006[0].message).toContain("catalog_size");
    expect(v006[0].message).toContain("normalizes");
});

test("V006: underscore difference → normalized match warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev
B --> [*]`,
        {
            stateVars: ["catalog_size"],
            eventPayloads: new Map([["ev", ["catalogsize"]]]),
        },
    );
    const v006 = report.issues.filter((i) => i.code === "V006");
    assertEquals(v006.length, 1);
    expect(v006[0].message).toContain("normalizes");
});

test("V006: completely different name → no warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev
B --> [*]`,
        {
            stateVars: ["balance"],
            eventPayloads: new Map([["ev", ["timestamp"]]]), // not similar
        },
    );
    assertEquals(report.issues.filter((i) => i.code === "V006").length, 0);
});

test("V006: 1 char insertion (`count` vs `counts`) → warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev
B --> [*]`,
        {
            stateVars: ["count"],
            eventPayloads: new Map([["ev", ["counts"]]]),
        },
    );
    const v006 = report.issues.filter((i) => i.code === "V006");
    assertEquals(v006.length, 1);
});

test("V006: 1 char deletion (`catlog` vs `catalog`) → warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev
B --> [*]`,
        {
            stateVars: ["catalog"],
            eventPayloads: new Map([["ev", ["catlog"]]]), // missing 'a'
        },
    );
    const v006 = report.issues.filter((i) => i.code === "V006").length;
    assertEquals(v006, 1);
});

test("clean spec produces no issues", () => {
    const report = validateOf(
        `stateDiagram-v2
[*] --> A
A --> B : ev [ok]
B --> [*]`,
        {
            guards: new Map([["ok", "count > 0"]]),
            stateVars: ["count"],
            eventPayloads: new Map([["ev", ["count"]]]),
        },
    );
    assertEquals(report.issues.length, 0);
});
