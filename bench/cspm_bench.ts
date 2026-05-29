import { parse } from "../src/parser.ts";
import { generateCspm } from "../src/cspm.ts";
import type { Diagram } from "../src/types.ts";
import { genComposite, genLinear } from "./_fixtures.ts";

const mkDiagram = (src: string): Diagram => {
    const r = parse(src);
    if (!r.ok) throw new Error(`fixture parse failed: ${r.error.message}`);
    return r.value;
};

const linear100 = mkDiagram(genLinear(100));
const linear1k = mkDiagram(genLinear(1_000));
const linear10k = mkDiagram(genLinear(10_000));
const composite20x50 = mkDiagram(genComposite(20, 50));

Deno.bench("cspm linear 100", () => {
    generateCspm(linear100);
});

Deno.bench("cspm linear 1k", () => {
    generateCspm(linear1k);
});

Deno.bench("cspm linear 10k", () => {
    generateCspm(linear10k);
});

Deno.bench("cspm composite 20x50", () => {
    generateCspm(composite20x50);
});
