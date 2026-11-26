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
