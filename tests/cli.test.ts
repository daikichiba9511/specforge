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
