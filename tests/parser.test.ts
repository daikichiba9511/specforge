import { assertEquals } from "jsr:@std/assert@^1";
import { parse, type ParseError } from "../src/parser.ts";
import type { Diagram } from "../src/types.ts";
import type { Result } from "../src/result.ts";

const expectOk = <T, E>(r: Result<T, E>): T => {
    if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
    return r.value;
};

const expectErr = <T, E>(r: Result<T, E>): E => {
    if (r.ok) throw new Error(`expected error, got ok: ${JSON.stringify(r.value)}`);
    return r.error;
};

Deno.test("parses minimal stateDiagram-v2", () => {
    const diagram: Diagram = expectOk(parse(`stateDiagram-v2
    [*] --> A`));
    assertEquals(diagram.type, "stateDiagram-v2");
    assertEquals(diagram.regions.length, 1);
    assertEquals(diagram.regions[0].stmts.length, 1);
});

Deno.test("parses transition with guard and action", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
    A --> B : event_name [guard_id] / action_id`));
    const stmt = diagram.regions[0].stmts[0];
    if (stmt.kind !== "transition") throw new Error("expected transition");
    assertEquals(stmt.from, "A");
    assertEquals(stmt.to, "B");
    assertEquals(stmt.label.event, "event_name");
    assertEquals(stmt.label.guard, "guard_id");
    assertEquals(stmt.label.action, "action_id");
});

Deno.test("parses composite state with orthogonal regions", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
    state Outer {
        [*] --> A
        --
        [*] --> B
    }`));
    const composite = diagram.regions[0].stmts[0];
    if (composite.kind !== "composite") throw new Error("expected composite");
    assertEquals(composite.id, "Outer");
    assertEquals(composite.regions.length, 2);
});

Deno.test("parses alias with quoted description", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
    state "待ち状態" as Waiting`));
    const alias = diagram.regions[0].stmts[0];
    if (alias.kind !== "alias") throw new Error("expected alias");
    assertEquals(alias.id, "Waiting");
    assertEquals(alias.description, "待ち状態");
});

Deno.test("rejects missing header", () => {
    const e: ParseError = expectErr(parse(`[*] --> A`));
    assertEquals(e.kind, "ParseError");
    assertEquals(e.message.includes("stateDiagram-v2"), true);
});

Deno.test("strips line comments", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
    %% this comment is stripped
    A --> B`));
    assertEquals(diagram.regions[0].stmts.length, 1);
});

Deno.test("parses label with only event", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
    A --> B : timer`));
    const t = diagram.regions[0].stmts[0];
    if (t.kind !== "transition") throw new Error("expected transition");
    assertEquals(t.label.event, "timer");
    assertEquals(t.label.guard, null);
    assertEquals(t.label.action, null);
});

Deno.test("parses label with only action (completion transition)", () => {
    const diagram = expectOk(parse(`stateDiagram-v2
    A --> B : / notify_complete`));
    const t = diagram.regions[0].stmts[0];
    if (t.kind !== "transition") throw new Error("expected transition");
    assertEquals(t.label.event, null);
    assertEquals(t.label.action, "notify_complete");
});

Deno.test("reports error line number for unrecognized statement", () => {
    const e = expectErr(parse(`stateDiagram-v2
    A --> B
    bogus statement here
    C --> D`));
    assertEquals(e.line, 3);
});
