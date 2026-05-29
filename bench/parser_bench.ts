import { parse } from "../src/parser.ts";
import { genComposite, genLabeled, genLinear } from "./_fixtures.ts";

const linear100 = genLinear(100);
const linear1k = genLinear(1_000);
const linear10k = genLinear(10_000);
const labeled1k = genLabeled(1_000);
const composite20x50 = genComposite(20, 50);

Deno.bench("parse linear 100", () => {
    parse(linear100);
});

Deno.bench("parse linear 1k", () => {
    parse(linear1k);
});

Deno.bench("parse linear 10k", () => {
    parse(linear10k);
});

Deno.bench("parse labeled 1k", () => {
    parse(labeled1k);
});

Deno.bench("parse composite 20x50", () => {
    parse(composite20x50);
});
