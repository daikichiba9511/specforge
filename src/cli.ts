import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { formatParseError, parse } from "./parser.ts";
import { generateCspm } from "./cspm.ts";

export type MainResult = {
    exitCode: number;
    stdout?: string;
    stderr?: string;
};

export const main = (args: string[]): MainResult => {
    if (args.length === 0) {
        return { exitCode: 1, stderr: "usage: specforge <spec.mmd>" };
    }

    let input: string;
    try {
        input = readFileSync(args[0], "utf-8");
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { exitCode: 1, stderr: `could not read file: ${msg}` };
    }

    const result = parse(input);
    if (!result.ok) {
        return { exitCode: 1, stderr: formatParseError(result.error) };
    }
    return { exitCode: 0, stdout: generateCspm(result.value) };
};

if (import.meta.main) {
    const r = main(argv.slice(2));
    if (r.stdout) console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    exit(r.exitCode);
}
