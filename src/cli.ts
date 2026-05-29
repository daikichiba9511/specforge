import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { formatParseError, parse } from "./parser.ts";
import { generateCspm } from "./cspm.ts";

const args = argv.slice(2);
if (args.length === 0) {
    console.error("usage: specforge <spec.mmd>");
    exit(1);
}

const input = readFileSync(args[0], "utf-8");
const result = parse(input);
if (!result.ok) {
    console.error(formatParseError(result.error));
    exit(1);
}
console.log(generateCspm(result.value));
