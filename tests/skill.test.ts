import { assert, assertEquals } from "jsr:@std/assert@^1";
import { parse } from "../src/parser.ts";
import { preprocess } from "../src/spec_doc.ts";
import { validate } from "../src/validate.ts";

const SKILL_REFERENCE_FILES = [
    "../.agents/skills/spec-behavior/references/behavior-spec-guide.md",
    "../.agents/skills/spec-behavior/references/multi-entity-composition.md",
] as const;

const extractStateDiagrams = (markdown: string): string[] =>
    [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)]
        .map((match) => match[1].trim())
        .filter((block) => block.startsWith("stateDiagram-v2"));

Deno.test("repo-local spec-behavior examples stay parseable by specforge", async () => {
    let exampleCount = 0;

    for (const relativePath of SKILL_REFERENCE_FILES) {
        const path = new URL(relativePath, import.meta.url);
        const markdown = await Deno.readTextFile(path);
        const diagrams = extractStateDiagrams(markdown);
        exampleCount += diagrams.length;

        for (const [index, diagram] of diagrams.entries()) {
            const result = parse(diagram);
            assert(
                result.ok,
                `${relativePath} Mermaid example ${index + 1} is not specforge-compatible: ${
                    JSON.stringify(result)
                }`,
            );
        }
    }

    assertEquals(exampleCount > 0, true, "expected at least one stateDiagram-v2 example");
});

Deno.test("writing guide complete example passes strict validation", async () => {
    const guidePath = new URL("../docs/writing-specs.md", import.meta.url);
    const guide = await Deno.readTextFile(guidePath);
    const template = /````markdown\s*\n([\s\S]*?)\n````/.exec(guide)?.[1];
    assert(template, "docs/writing-specs.md must contain a complete Markdown example");

    const doc = preprocess(template);
    const result = parse(doc.mermaid);
    assert(result.ok, `complete example is not parseable: ${JSON.stringify(result)}`);
    assertEquals(validate(result.value, doc).issues, []);
});
