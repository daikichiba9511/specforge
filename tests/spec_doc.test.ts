import { assertEquals } from "jsr:@std/assert@^1";
import { extractGuards, extractMermaid, extractStateVars, preprocess } from "../src/spec_doc.ts";

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

Deno.test("extractStateVars: returns empty when no matching heading", () => {
    assertEquals(extractStateVars("# Title\nsome content"), []);
});

Deno.test("extractStateVars: parses Japanese heading + first column as var name", () => {
    const md = `### 共有状態と排他制御

| 共有変数 | 読み手 | 書き手 | 競合可能性 |
|---------|--------|--------|----------|
| \`catalog_size\` | Sampling 遷移時のガード | Sampling step | なし |
| \`prelabeled_count\` | Prelabeling 遷移時のガード | Prelabeling step | なし |
| \`filtered_pair_count\` | Filtering 遷移時のガード | Filtering step | なし |
`;
    assertEquals(extractStateVars(md), [
        "catalog_size",
        "prelabeled_count",
        "filtered_pair_count",
    ]);
});

Deno.test("extractStateVars: parses English heading", () => {
    const md = `## State variables

| Variable | Type | Writer |
|---|---|---|
| \`count\` | int | StepA |
| \`flag\` | bool | StepB |
`;
    assertEquals(extractStateVars(md), ["count", "flag"]);
});

Deno.test("extractStateVars: skips dup names, preserves order", () => {
    const md = `### State variables

| Var |
| --- |
| \`a\` |
| \`b\` |
| \`a\` |
| \`c\` |
`;
    assertEquals(extractStateVars(md), ["a", "b", "c"]);
});

Deno.test("extractStateVars: works without backticks", () => {
    const md = `### 共有状態

| 変数 | 型 |
| --- | --- |
| count | int |
| ready | bool |
`;
    assertEquals(extractStateVars(md), ["count", "ready"]);
});

Deno.test("preprocess: returns mermaid + guards + stateVars for full .md", () => {
    const md = `# Spec

\`\`\`mermaid
stateDiagram-v2
A --> B : ev [ok] / act
\`\`\`

### ガード定義

| Guard | Cond |
| --- | --- |
| \`ok\` | \`count > 0\` |

### 共有状態

| Variable |
| --- |
| \`count\` |
`;
    const result = preprocess(md);
    assertEquals(result.guards.get("ok"), "count > 0");
    assertEquals(result.stateVars, ["count"]);
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
    assertEquals(result.stateVars, []);
});
