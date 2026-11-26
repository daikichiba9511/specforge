import { Bench } from "tinybench";
import { generateCspm } from "../src/cspm.ts";
import { parse } from "../src/parser.ts";
import { genComposite, genLabeled, genLinear } from "./_fixtures.ts";

const bench = new Bench({ throws: true });

for (const [name, source] of [
    ["linear 100", genLinear(100)],
    ["linear 1k", genLinear(1_000)],
    ["linear 10k", genLinear(10_000)],
    ["composite 20x50", genComposite(20, 50)],
]) {
    const diagram = parse(source);
    if (!diagram.ok) throw new Error(`fixture parse failed: ${diagram.error.message}`);
    bench.add(`parse ${name}`, () => {
        parse(source);
    });
    bench.add(`cspm ${name}`, () => {
        generateCspm(diagram.value);
    });
}
const labeled = genLabeled(1_000);
bench.add("parse labeled 1k", () => {
    parse(labeled);
});

await bench.run();
if (process.argv.includes("--json")) {
    // Keep the nanosecond units and file format used by bench:compare.
    const benches = bench.tasks.map(({ name, result }) => {
        if (result.state !== "completed") throw new Error(`${name}: ${result.state}`);
        return { name, results: [{ ok: { avg: result.latency.mean * 1_000_000 } }] };
    });
    console.log(JSON.stringify({ benches }));
} else {
    console.table(bench.table());
}
