import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { formatParseError, parse } from "./parser.ts";
import { generateCspm } from "./cspm.ts";

export type MainResult =
    | { kind: "success"; stdout: string }
    | { kind: "failure"; exitCode: number; stderr: string };

export type Deps = {
    readFile: (path: string) => string;
};

const defaultDeps: Deps = {
    readFile: (path) => readFileSync(path, "utf-8"),
};

export const main = (args: string[], deps: Deps = defaultDeps): MainResult => {
    if (args.length === 0) {
        return { kind: "failure", exitCode: 1, stderr: "usage: specforge <spec.mmd>" };
    }

    let input: string;
    try {
        input = deps.readFile(args[0]);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { kind: "failure", exitCode: 1, stderr: `could not read file: ${msg}` };
    }

    const result = parse(input);
    if (!result.ok) {
        return { kind: "failure", exitCode: 1, stderr: formatParseError(result.error) };
    }
    return { kind: "success", stdout: generateCspm(result.value) };
};

if (import.meta.main) {
    const r = main(argv.slice(2));
    if (r.kind === "success") {
        console.log(r.stdout);
        exit(0);
    } else {
        console.error(r.stderr);
        exit(r.exitCode);
    }
}
