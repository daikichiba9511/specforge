import { assertEquals } from "jsr:@std/assert@^1";
import { main } from "../src/cli.ts";

const VALID_SPEC = `stateDiagram-v2
    [*] --> A
    A --> B : event / action`;

const INVALID_SPEC = `not a spec at all`;

Deno.test("main: valid spec returns success with cspm on stdout", () => {
    const r = main(["spec.mmd"], { readFile: () => VALID_SPEC });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    assertEquals(r.stdout.includes("A ="), true);
});

Deno.test("main: missing arg returns failure with usage", () => {
    const r = main([]);
    assertEquals(r.kind, "failure");
    if (r.kind !== "failure") return;
    assertEquals(r.exitCode, 1);
    assertEquals(r.stderr.startsWith("usage"), true);
});

Deno.test("main: file read failure returns io error", () => {
    const r = main(["spec.mmd"], {
        readFile: () => {
            throw new Error("ENOENT: no such file");
        },
    });
    assertEquals(r.kind, "failure");
    if (r.kind !== "failure") return;
    assertEquals(r.exitCode, 1);
    assertEquals(r.stderr.startsWith("could not read file"), true);
});

Deno.test("main: parse error returns failure with line number", () => {
    const r = main(["spec.mmd"], { readFile: () => INVALID_SPEC });
    assertEquals(r.kind, "failure");
    if (r.kind !== "failure") return;
    assertEquals(r.exitCode, 1);
    assertEquals(r.stderr.startsWith("L1:"), true);
});

const MARKDOWN_SPEC = `# title

\`\`\`mermaid
stateDiagram-v2
A --> B : ev [ok] / act
\`\`\`

### ガード定義

| Guard | Cond |
| --- | --- |
| \`ok\` | \`x > 0\` |

### 共有状態

| Variable |
| --- |
| \`x\` |
`;

Deno.test("main: .md input extracts mermaid block and applies guard substitution", () => {
    const r = main(["spec.md"], { readFile: () => MARKDOWN_SPEC });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    assertEquals(r.stdout.includes("(x > 0) & ev -> act -> B"), true);
});

Deno.test("main: .md input emits channels + process parameters (Phase 4)", () => {
    const r = main(["spec.md"], { readFile: () => MARKDOWN_SPEC });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    // channels come first, then processes with parameters.
    assertEquals(r.stdout.startsWith("-- specforge: event / action channels"), true);
    assertEquals(r.stdout.includes("A(x) ="), true);
    assertEquals(r.stdout.includes("B(x)"), true);
});

Deno.test("main: --tla flag switches to TLA+ backend", () => {
    const r = main(["--tla", "spec.md"], { readFile: () => MARKDOWN_SPEC });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    assertEquals(r.stdout.startsWith("---- MODULE Spec ----"), true);
    assertEquals(r.stdout.includes("Spec == Init /\\ [][Next]_vars"), true);
});

Deno.test("main: --json flag outputs AST + metadata as JSON", () => {
    const r = main(["--json", "spec.md"], { readFile: () => MARKDOWN_SPEC });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    const parsed = JSON.parse(r.stdout);
    assertEquals(parsed.diagram.type, "stateDiagram-v2");
    assertEquals(parsed.guards.ok, "x > 0");
    assertEquals(parsed.stateVars, ["x"]);
});

const SPEC_WITH_WARNING = `stateDiagram-v2
A --> B : ev [missing_guard]`;

Deno.test("main: validation issues attached as warnings, success kind unchanged by default", () => {
    const r = main(["spec.mmd"], { readFile: () => SPEC_WITH_WARNING });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    assertEquals(r.warnings !== undefined && r.warnings.length > 0, true);
    assertEquals(r.warnings![0].includes("V001"), true);
});

Deno.test("main: --strict converts warnings into failure", () => {
    const r = main(["--strict", "spec.mmd"], { readFile: () => SPEC_WITH_WARNING });
    assertEquals(r.kind, "failure");
    if (r.kind !== "failure") return;
    assertEquals(r.exitCode, 1);
    assertEquals(r.warnings !== undefined && r.warnings.length > 0, true);
});

Deno.test("main: clean spec → no warnings attached", () => {
    const r = main(["spec.mmd"], { readFile: () => VALID_SPEC });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    assertEquals(r.warnings, []);
});

Deno.test("main: --bound=N propagates to TLA+ Domain", () => {
    // payload binding が無いと Domain が emit されない → bound 効果を検証するため
    // event payload と state var が一致する spec を用意する
    const SPEC = `# title

\`\`\`mermaid
stateDiagram-v2
A --> B : ev [ok]
\`\`\`

### ガード定義

| Guard | Cond |
| --- | --- |
| \`ok\` | \`x > 0\` |

### 共有状態

| Variable |
| --- |
| \`x\` |

### イベント契約

| Event | Payload |
| --- | --- |
| \`ev\` | \`{x}\` |
`;
    const r = main(["--tla", "--bound=4", "spec.md"], { readFile: () => SPEC });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    assertEquals(r.stdout.includes("Domain == 0..4"), true);
});

Deno.test("main: --bound=N propagates to CSPm nametype VAL", () => {
    // payload event を持つ spec で typed channel を emit させる
    const SPEC = `# title

\`\`\`mermaid
stateDiagram-v2
A --> B : ev
\`\`\`

### イベント契約

| Event | Payload |
| --- | --- |
| \`ev\` | \`{n}\` |
`;
    const r = main(["--bound=3", "spec.md"], { readFile: () => SPEC });
    assertEquals(r.kind, "success");
    if (r.kind !== "success") return;
    assertEquals(r.stdout.includes("nametype VAL = {0..3}"), true);
});

Deno.test("main: --bound=abc returns failure with informative message", () => {
    const r = main(["--bound=abc", "spec.mmd"], { readFile: () => VALID_SPEC });
    assertEquals(r.kind, "failure");
    if (r.kind !== "failure") return;
    assertEquals(r.stderr.includes("--bound"), true);
});

Deno.test("main: --bound=-1 (negative) is rejected", () => {
    const r = main(["--bound=-1", "spec.mmd"], { readFile: () => VALID_SPEC });
    assertEquals(r.kind, "failure");
});
