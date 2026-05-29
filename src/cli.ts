import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { parse } from "./parser.ts";
import { generateCspm } from "./cspm.ts";

const args = argv.slice(2);
if (args.length === 0) {
    console.error("usage: specforge <spec.mmd>");
    exit(1);
}

const input = readFileSync(args[0], "utf-8");
const diagram = parse(input);
const cspm = generateCspm(diagram);
console.log(cspm);
