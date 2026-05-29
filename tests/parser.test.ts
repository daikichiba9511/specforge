import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { parse, ParseError } from "../src/parser.ts";

Deno.test("parses minimal stateDiagram-v2", () => {
    const input = `stateDiagram-v2
    [*] --> A`;
    const diagram = parse(input);
    assertEquals(diagram.type, "stateDiagram-v2");
    assertEquals(diagram.regions.length, 1);
    assertEquals(diagram.regions[0].stmts.length, 1);
});

Deno.test("parses transition with guard and action", () => {
    const input = `stateDiagram-v2
    A --> B : event_name [guard_id] / action_id`;
    const diagram = parse(input);
    const stmt = diagram.regions[0].stmts[0];
    if (stmt.kind !== "transition") throw new Error("expected transition");
    assertEquals(stmt.from, "A");
    assertEquals(stmt.to, "B");
    assertEquals(stmt.label.event, "event_name");
    assertEquals(stmt.label.guard, "guard_id");
    assertEquals(stmt.label.action, "action_id");
});

Deno.test("parses composite state with orthogonal regions", () => {
    const input = `stateDiagram-v2
    state Outer {
        [*] --> A
        --
        [*] --> B
    }`;
    const diagram = parse(input);
    const composite = diagram.regions[0].stmts[0];
    if (composite.kind !== "composite") throw new Error("expected composite");
    assertEquals(composite.id, "Outer");
    assertEquals(composite.regions.length, 2);
});

Deno.test("parses alias with quoted description", () => {
    const input = `stateDiagram-v2
    state "待ち状態" as Waiting`;
    const diagram = parse(input);
    const alias = diagram.regions[0].stmts[0];
    if (alias.kind !== "alias") throw new Error("expected alias");
    assertEquals(alias.id, "Waiting");
    assertEquals(alias.description, "待ち状態");
});

Deno.test("rejects missing header", () => {
    const input = `[*] --> A`;
    assertThrows(() => parse(input), ParseError, "stateDiagram-v2");
});

Deno.test("strips line comments", () => {
    const input = `stateDiagram-v2
    %% this comment is stripped
    A --> B`;
    const diagram = parse(input);
    assertEquals(diagram.regions[0].stmts.length, 1);
});

Deno.test("parses label with only event", () => {
    const input = `stateDiagram-v2
    A --> B : timer`;
    const diagram = parse(input);
    const t = diagram.regions[0].stmts[0];
    if (t.kind !== "transition") throw new Error("expected transition");
    assertEquals(t.label.event, "timer");
    assertEquals(t.label.guard, null);
    assertEquals(t.label.action, null);
});

Deno.test("parses label with only action (completion transition)", () => {
    const input = `stateDiagram-v2
    A --> B : / notify_complete`;
    const diagram = parse(input);
    const t = diagram.regions[0].stmts[0];
    if (t.kind !== "transition") throw new Error("expected transition");
    assertEquals(t.label.event, null);
    assertEquals(t.label.action, "notify_complete");
});
