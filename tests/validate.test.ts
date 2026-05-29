import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import { parse } from "../src/parser.ts";
import { formatIssue, validate } from "../src/validate.ts";
import type { SpecDoc } from "../src/spec_doc.ts";
import { expectOk } from "./_helpers.ts";

const mkDoc = (overrides: Partial<SpecDoc> = {}): SpecDoc => ({
    mermaid: "",
    guards: new Map(),
    stateVars: [],
    eventPayloads: new Map(),
    ...overrides,
});

const validateOf = (src: string, doc?: Partial<SpecDoc>) =>
    validate(expectOk(parse(src)), mkDoc(doc));

Deno.test("V001: guard tag missing from dictionary → warning", () => {
    const report = validateOf(`stateDiagram-v2
A --> B : ev [unknown_guard]`);
    const v001 = report.issues.filter((i) => i.code === "V001");
    assertEquals(v001.length, 1);
    assertStringIncludes(v001[0].message, "unknown_guard");
});

Deno.test("V001: guard tag present in dictionary → no warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        { guards: new Map([["ok", "count > 0"]]), stateVars: ["count"] },
    );
    assertEquals(report.issues.filter((i) => i.code === "V001").length, 0);
});

Deno.test("V002: variable in guard expression not declared anywhere → warning", () => {
    const report = validateOf(
        `stateDiagram-v2
A --> B : ev [ok]`,
        { guards: new Map([["ok", "missing_var > 0"]]) },
    );
    const v002 = report.issues.filter((i) => i.code === "V002");
    assertEquals(v002.length, 1);
    assertStringIncludes(v002[0].message, "missing_var");
});

Deno.test("V002: variable in state vars → no warning", () => {
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

Deno.test("V002: variable bound by event payload → no warning", () => {
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

Deno.test("V002: TRUE / FALSE / in are treated as keywords, not variables", () => {
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

Deno.test("V002: numeric literals are not flagged", () => {
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

Deno.test("V003: composite region without [*] -->" + " entry → warning", () => {
    const report = validateOf(`stateDiagram-v2
state Outer {
    A --> B
}`);
    const v003 = report.issues.filter((i) => i.code === "V003");
    assertEquals(v003.length, 1);
    assertStringIncludes(v003[0].message, "Outer");
});

Deno.test("V003: composite region WITH [*] --> entry → no warning", () => {
    const report = validateOf(`stateDiagram-v2
state Outer {
    [*] --> A
    A --> [*]
}`);
    assertEquals(report.issues.filter((i) => i.code === "V003").length, 0);
});

Deno.test("V003: orthogonal composite: per-region check", () => {
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
    assertStringIncludes(v003[0].message, "region 1");
});

Deno.test("formatIssue includes code, message, hint", () => {
    const out = formatIssue({
        level: "warning",
        code: "V999",
        message: "something happened",
        suggestion: "do X instead",
    });
    assertStringIncludes(out, "warn V999: something happened");
    assertStringIncludes(out, "hint: do X instead");
});

Deno.test("clean spec produces no issues", () => {
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
