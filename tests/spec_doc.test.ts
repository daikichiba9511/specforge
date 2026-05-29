import { assertEquals } from "jsr:@std/assert@^1";
import { extractGuards, extractMermaid, preprocess } from "../src/spec_doc.ts";

Deno.test("extractMermaid: returns null when no fenced block", () => {
    assertEquals(extractMermaid("just text\nno fences"), null);
});

Deno.test("extractMermaid: returns null when fence is not stateDiagram-v2", () => {
    const md = "```mermaid\nsequenceDiagram\nA->>B: hi\n```";
    assertEquals(extractMermaid(md), null);
});

Deno.test("extractMermaid: extracts first stateDiagram-v2 block", () => {
    const md = `# heading
\`\`\`mermaid
stateDiagram-v2
[*] --> A
A --> [*]
\`\`\`

trailing text`;
    assertEquals(extractMermaid(md), "stateDiagram-v2\n[*] --> A\nA --> [*]");
});

Deno.test("extractMermaid: skips sequenceDiagram, picks the stateDiagram", () => {
    const md = `\`\`\`mermaid
sequenceDiagram
A->>B: hi
\`\`\`

\`\`\`mermaid
stateDiagram-v2
[*] --> X
\`\`\``;
    assertEquals(extractMermaid(md), "stateDiagram-v2\n[*] --> X");
});

Deno.test("extractGuards: returns empty map when no guard heading", () => {
    const guards = extractGuards("# Title\nsome content\n");
    assertEquals(guards.size, 0);
});

Deno.test("extractGuards: parses Japanese heading + backticked table", () => {
    const md = `### ガード定義

| ガード ID | 条件 | 根拠 |
|----------|------|------|
| \`catalog_ok\` | \`catalog_size > 0\` | あれば下流へ |
| \`catalog_empty\` | \`catalog_size == 0\` | データなし |
`;
    const guards = extractGuards(md);
    assertEquals(guards.size, 2);
    assertEquals(guards.get("catalog_ok"), "catalog_size > 0");
    assertEquals(guards.get("catalog_empty"), "catalog_size == 0");
});

Deno.test("extractGuards: parses English heading", () => {
    const md = `## Guards

| Tag | Expression |
|---|---|
| \`ok\` | \`n > 0\` |
`;
    const guards = extractGuards(md);
    assertEquals(guards.get("ok"), "n > 0");
});

Deno.test("extractGuards: works without backticks", () => {
    const md = `### ガード定義

| Guard | Condition |
| --- | --- |
| ready | active && !blocked |
`;
    const guards = extractGuards(md);
    assertEquals(guards.get("ready"), "active && !blocked");
});

Deno.test("extractGuards: stops at non-table line", () => {
    const md = `### ガード定義

| Tag | Cond |
| --- | --- |
| \`a\` | \`x > 0\` |
| \`b\` | \`y > 0\` |

other text not table

| spurious | row |
`;
    const guards = extractGuards(md);
    assertEquals(guards.size, 2);
    assertEquals(guards.has("spurious"), false);
});

Deno.test("preprocess: returns mermaid + guards for full .md", () => {
    const md = `# Spec

\`\`\`mermaid
stateDiagram-v2
A --> B : ev [ok] / act
\`\`\`

### ガード定義

| Guard | Cond |
| --- | --- |
| \`ok\` | \`x > 0\` |
`;
    const result = preprocess(md);
    assertEquals(result.mermaid, "stateDiagram-v2\nA --> B : ev [ok] / act");
    assertEquals(result.guards.get("ok"), "x > 0");
});

Deno.test("preprocess: falls back to raw input when no mermaid fence", () => {
    const raw = "stateDiagram-v2\n[*] --> A";
    const result = preprocess(raw);
    assertEquals(result.mermaid, raw);
    assertEquals(result.guards.size, 0);
});
