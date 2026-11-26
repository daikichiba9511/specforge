import { expect, test } from "bun:test";
import { main } from "../src/cli.ts";

const vending = await Bun.file(new URL("../examples/vending-machine.md", import.meta.url)).text();
const exportModel = (source: string, ...options: string[]) =>
    main(["--quint", ...options, "spec.md"], { readFile: () => source });

test("export the vending model with bounded payloads, unchanged balance on refund, and terminal stuttering", () => {
    const result = exportModel(vending, "--strict", "--bound=3");
    if (result.kind === "failure") throw new Error(result.stderr);
    expect(result.stdout).toContain("module Spec {");
    expect(result.stdout).toContain("0.to(3)");
    expect(result.stdout).toContain("action tr_Selecting_refund_Idle");
    expect(result.stdout).toContain("state_balance' = state_balance");
    expect(result.stdout).toContain('phase == "Done"');
    expect(result.stdout).toContain("action step");
});

test.each([
    ["a composite", "stateDiagram-v2\nstate Outer {\n[*] --> A\n}\n", "Outer"],
    ["orthogonal regions", "stateDiagram-v2\n[*] --> A\n--\n[*] --> B", "region"],
    [
        "a temporal property",
        vending + "\n### Liveness\n\n| Name | Formula |\n| --- | --- |\n| End | <>Terminated |\n",
        "End",
    ],
    ["an untranslatable guard", vending.replace("balance > 0", "balance + 1 > 0"), "has_money"],
    ["an undeclared guard operand", vending.replace("balance > 0", "missing > 0"), "missing"],
    [
        "a missing guard definition",
        vending.replace("[has_money]", "[undefined_tag]"),
        "undefined_tag",
    ],
])("report %s instead of emitting a partial model", (_, spec, detail) => {
    const result = exportModel(spec);
    if (result.kind === "success") throw new Error("unexpected success");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(detail);
});

test.each([["--json"], ["--tla"]])("reject ambiguous Quint output with %s", (option) => {
    expect(exportModel(vending, option).kind).toBe("failure");
});

test("verify rejects the export flag before trying to run TLC", () => {
    const result = main(["verify", "--quint", "unused"]);
    if (result.kind === "success") throw new Error("unexpected success");
    expect(result.stderr).toContain("--quint");
});

test("choose all bound payload fields together before evaluating their guard", () => {
    const source = [
        "```mermaid",
        "stateDiagram-v2",
        "[*] --> A",
        "A --> B : update(x, y) [ordered]",
        "B --> [*]",
        "```",
        "### Guards",
        "| Name | Condition |",
        "| --- | --- |",
        "| ordered | x < y |",
        "### State variables",
        "| Name |",
        "| --- |",
        "| x |",
        "| y |",
        "| old |",
        "### Event contracts",
        "| Event | Payload |",
        "| --- | --- |",
        "| update | {x, y} |",
    ].join("\n");
    const result = exportModel(source);
    if (result.kind === "failure") throw new Error(result.stderr);
    expect(result.stdout).toContain(
        "tuples(0.to(1), 0.to(1)).filter(candidate => candidate._1 < candidate._2)",
    );
    expect(result.stdout).toContain("state_x' = payload._1");
    expect(result.stdout).toContain("state_y' = payload._2");
    expect(result.stdout).toContain("state_old' = state_old");
});

test("a nonterminal state with no outgoing transition cannot stutter", () => {
    const result = exportModel("stateDiagram-v2\n[*] --> Stuck");
    if (result.kind === "failure") throw new Error(result.stderr);
    expect(result.stdout).not.toContain("action stutter");
    expect(result.stdout).toMatch(/action step = all \{\s*false,/);
});

test("keep identically named transitions as separate actions", () => {
    const result = exportModel("stateDiagram-v2\n[*] --> A\nA --> B : go\nA --> B : go");
    if (result.kind === "failure") throw new Error(result.stderr);
    expect(result.stdout).toMatch(/action step = any \{\s*tr_A_go_B,\s*tr_A_go_B_2,/);
});
