import { expect, test } from "bun:test";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { verify, type VerifyDeps } from "../src/verify.ts";

const VALID_SPEC = `stateDiagram-v2
[*] --> A
A --> B
B --> A`;

/** ファイル操作と TLC の実行をテスト用に置き換え、対象のシナリオで異なる操作だけを差し替える。 */
function mkDeps(overrides: Partial<VerifyDeps> = {}): VerifyDeps {
    return {
        readFile: () => VALID_SPEC,
        makeTempDir: () => "/tmp/test",
        writeFile: () => {},
        runTlc: () => ({
            stdout: "Model checking completed. No error has been found.",
            stderr: "",
            code: 0,
        }),
        findJava: () => "/usr/bin/java",
        findTlaJar: () => "/path/to/tla2tools.jar",
        ...overrides,
    };
}

test("verify: returns verified when TLC succeeds (code 0)", () => {
    const result = verify("spec.mmd", mkDeps());
    assertEquals(result.kind, "verified");
});

test("verify: returns failed with summary when TLC exits non-zero", () => {
    const result = verify(
        "spec.mmd",
        mkDeps({
            runTlc: () => ({
                stdout: "Error: Deadlock reached.\n",
                stderr: "",
                code: 11,
            }),
        }),
    );
    assertEquals(result.kind, "failed");
    if (result.kind !== "failed") return;
    assertEquals(result.code, 11);
    expect(result.stdout).toContain("Deadlock");
});

test("verify: renders both the path and the closing edge of a TLC counterexample", async () => {
    const source = await Bun.file(new URL("../examples/parallel-order-retry.md", import.meta.url))
        .text();
    const stdout = [
        "Error: Temporal properties were violated.",
        "State 1: <Initial predicate>",
        '/\\ phase = "Processing"',
        "State 2: <Processing_r0_Authorizing_payment_timed_out_Retrying line 18, col 5 to line 21, col 41 of module Spec>",
        "Back to state 1: <Processing_r0_Retrying_retry_started_Authorizing line 24, col 5 to line 27, col 41 of module Spec>",
    ].join("\r\n");
    const result = verify(
        "order.md",
        mkDeps({
            readFile: () => source,
            runTlc: () => ({ stdout, stderr: "", code: 13 }),
        }),
    );
    if (result.kind !== "failed") throw new Error(result.kind);
    expect(result.stdout).toContain("1. [*] → Processing");
    expect(result.stdout).toContain("決済中 --payment_timed_out--> 決済再試行中");
    expect(result.stdout).toContain("手順 1 の直後に戻る");
    expect(result.stdout).toContain("決済再試行中 --retry_started--> 決済中");
});

test("verify: a finite deadlock ends at the last transition without a loop marker", () => {
    const result = verify(
        "flat.mmd",
        mkDeps({
            readFile: () => "stateDiagram-v2\n[*] --> A\nA --> B : run",
            runTlc: () => ({
                code: 11,
                stderr: "",
                stdout:
                    'Error: Deadlock reached.\nState 1: <Initial predicate>\nphase = "A"\nState 2: <A_run_B line 15, col 5 to line 16, col 19 of module Spec>\nphase = "B"',
            }),
        }),
    );
    if (result.kind !== "failed") throw new Error(result.kind);
    expect(result.stdout).toContain("2. A --run--> B");
    expect(result.stdout).not.toContain("繰り返");
});

test("verify: distinguishes TLC stuttering from an event returning to an earlier state", () => {
    const result = verify(
        "spec.mmd",
        mkDeps({
            runTlc: () => ({
                code: 13,
                stderr: "",
                stdout:
                    "Error: Temporal properties were violated.\nState 1: <Initial predicate>\nState 2: Stuttering",
            }),
        }),
    );
    if (result.kind !== "failed") throw new Error(result.kind);
    expect(result.stdout).toContain("手順 1 の状態を繰り返す");
});

test("verify: uses the exact generated action when Mermaid transitions share state and event names", () => {
    const source = [
        "stateDiagram-v2",
        "[*] --> A",
        "A --> B : tick [fast]",
        "A --> B : tick [slow]",
    ].join("\n");
    const result = verify(
        "guarded.mmd",
        mkDeps({
            readFile: () => source,
            runTlc: () => ({
                code: 11,
                stderr: "",
                stdout:
                    "Error: Deadlock reached.\nState 1: <Initial predicate>\nState 2: <A_tick_B_2 line 25, col 5 to line 30, col 4 of module Spec>",
            }),
        }),
    );
    if (result.kind !== "failed") throw new Error(result.kind);
    expect(result.stdout).toContain("2. A --tick--> B [slow]");
});

test("verify: preserves an unmapped TLC header and a loop with no recorded action", () => {
    const result = verify(
        "spec.mmd",
        mkDeps({
            runTlc: () => ({
                code: 13,
                stderr: "",
                stdout:
                    "Error: Temporal properties were violated.\nState 1: <Initial predicate>\nState 2: <line 18, col 5 of module Spec>\nBack to state 1",
            }),
        }),
    );
    if (result.kind !== "failed") throw new Error(result.kind);
    expect(result.stdout).toContain("2. <line 18, col 5 of module Spec>");
    expect(result.stdout).toContain("手順 1 の直後に戻る");
});

test("verify: tool_missing when java not found", () => {
    const result = verify("spec.mmd", mkDeps({ findJava: () => null }));
    assertEquals(result.kind, "tool_missing");
    if (result.kind !== "tool_missing") return;
    expect(result.message).toContain("java not found");
});

test("verify: tool_missing when tla2tools.jar not found", () => {
    const result = verify("spec.mmd", mkDeps({ findTlaJar: () => null }));
    assertEquals(result.kind, "tool_missing");
    if (result.kind !== "tool_missing") return;
    expect(result.message).toContain("tla2tools.jar not found");
});

test("verify: parse_error propagates parser failures", () => {
    const result = verify(
        "spec.mmd",
        mkDeps({ readFile: () => "not a valid spec" }),
    );
    assertEquals(result.kind, "parse_error");
});

test("verify: io_error when readFile throws", () => {
    const result = verify(
        "missing.mmd",
        mkDeps({
            readFile: () => {
                throw new Error("ENOENT");
            },
        }),
    );
    assertEquals(result.kind, "io_error");
    if (result.kind !== "io_error") return;
    expect(result.message).toContain("could not read file");
});

test("verify: writes Spec.tla and Spec.cfg to temp dir", () => {
    const written: Array<[string, string]> = [];
    verify(
        "spec.mmd",
        mkDeps({
            makeTempDir: () => "/tmp/specforge-x",
            writeFile: (path, content) => written.push([path, content]),
        }),
    );
    const paths = written.map(([p]) => p);
    assertEquals(paths.some((p) => p.endsWith("Spec.tla")), true);
    assertEquals(paths.some((p) => p.endsWith("Spec.cfg")), true);
    const cfgEntry = written.find(([p]) => p.endsWith("Spec.cfg"));
    if (cfgEntry) expect(cfgEntry[1]).toContain("SPECIFICATION Spec");
});

const SPEC_WITH_LIVENESS = `# Spec

\`\`\`mermaid
stateDiagram-v2
[*] --> A
A --> [*]
\`\`\`

### Liveness

| name | formula |
| --- | --- |
| \`Termination\` | \`<>Terminated\` |
`;

test("verify: cfg includes PROPERTY when liveness declared", () => {
    const written: Array<[string, string]> = [];
    verify(
        "spec.md",
        mkDeps({
            readFile: () => SPEC_WITH_LIVENESS,
            writeFile: (path, content) => written.push([path, content]),
        }),
    );
    const cfgEntry = written.find(([p]) => p.endsWith("Spec.cfg"));
    if (!cfgEntry) throw new Error("Spec.cfg not written");
    expect(cfgEntry[1]).toContain("SPECIFICATION Spec");
    expect(cfgEntry[1]).toContain("PROPERTY Termination");
});

test("verify: TLA+ includes Fairness + Termination def when liveness declared", () => {
    const written: Array<[string, string]> = [];
    verify(
        "spec.md",
        mkDeps({
            readFile: () => SPEC_WITH_LIVENESS,
            writeFile: (path, content) => written.push([path, content]),
        }),
    );
    const tlaEntry = written.find(([p]) => p.endsWith("Spec.tla"));
    if (!tlaEntry) throw new Error("Spec.tla not written");
    expect(tlaEntry[1]).toContain("Fairness == WF_vars(Next)");
    expect(tlaEntry[1]).toContain("Termination == <>Terminated");
});

test("verify: cfg has no PROPERTY when no liveness declared", () => {
    const written: Array<[string, string]> = [];
    verify("spec.mmd", mkDeps({ writeFile: (path, content) => written.push([path, content]) }));
    const cfgEntry = written.find(([p]) => p.endsWith("Spec.cfg"));
    if (!cfgEntry) throw new Error("Spec.cfg not written");
    expect(cfgEntry[1]).toContain("SPECIFICATION Spec");
    assertEquals(cfgEntry[1].includes("PROPERTY"), false);
});
