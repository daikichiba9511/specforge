import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { formatParseError, parse } from "./parser.ts";
import { generateCspm } from "./cspm.ts";
import { generateTla } from "./tla.ts";
import { preprocess } from "./spec_doc.ts";
import { verify } from "./verify.ts";

/**
 * CLI 実行結果を表す判別ユニオン。
 *
 * - `success`: 正常完了。`stdout` に CSPm を持ち、exit code は常に 0
 * - `failure`: 何らかの失敗。`stderr` にエラー文、`exitCode` に non-zero
 *
 * 実際の stdout/stderr 書き出しと `exit` は呼び出し側で行う。
 */
export type MainResult =
    | { kind: "success"; stdout: string }
    | { kind: "failure"; exitCode: number; stderr: string };

/**
 * {@link main} の依存物 (副作用) を注入するインターフェイス。
 * テストでは `readFile` をモックすることで実ファイル I/O を回避できる。
 */
export type Deps = {
    readFile: (path: string) => string;
};

const defaultDeps: Deps = {
    readFile: (path) => readFileSync(path, "utf-8"),
};

/**
 * specforge CLI のエントリポイント。
 *
 * 引数を受けて {@link MainResult} を返す pure 関数。stdout/stderr/exit などの
 * 副作用は呼び出し側 (`import.meta.main` ブロック) で実施する。
 *
 * @param args - CLI 引数 (通常は `argv.slice(2)`)
 * @param deps - 副作用注入。デフォルトは `fs.readFileSync` を使う実装
 * @returns success / failure の判別ユニオン
 *
 * @example
 * ```ts
 * const r = main(["spec.mmd"], { readFile: () => "stateDiagram-v2\n[*] --> A" });
 * if (r.kind === "success") console.log(r.stdout);
 * else console.error(r.stderr);
 * ```
 */
export const main = (args: string[], deps: Deps = defaultDeps): MainResult => {
    // `verify` サブコマンドだけ別経路: TLA+ 化 → TLC を subprocess で実行
    if (args[0] === "verify") {
        return runVerify(args.slice(1));
    }

    const useTla = args.includes("--tla");
    const positional = args.filter((a) => !a.startsWith("--"));
    if (positional.length === 0) {
        return {
            kind: "failure",
            exitCode: 1,
            stderr: "usage: specforge [--tla] <spec.mmd|spec.md>\n" +
                "       specforge verify <spec.mmd|spec.md>",
        };
    }

    let raw: string;
    try {
        raw = deps.readFile(positional[0]);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { kind: "failure", exitCode: 1, stderr: `could not read file: ${msg}` };
    }

    const doc = preprocess(raw);
    const result = parse(doc.mermaid);
    if (!result.ok) {
        return { kind: "failure", exitCode: 1, stderr: formatParseError(result.error) };
    }
    const stdout = useTla
        ? generateTla(result.value, doc.guards, doc.stateVars, doc.eventPayloads)
        : generateCspm(result.value, doc.guards, doc.stateVars, doc.eventPayloads);
    return { kind: "success", stdout };
};

// `verify` サブコマンドの実装。verify モジュールへの委譲 + 結果を MainResult に整形。
const runVerify = (verifyArgs: string[]): MainResult => {
    if (verifyArgs.length === 0) {
        return {
            kind: "failure",
            exitCode: 1,
            stderr: "usage: specforge verify <spec.mmd|spec.md>",
        };
    }
    const result = verify(verifyArgs[0]);
    switch (result.kind) {
        case "verified":
            return { kind: "success", stdout: `verified ok\n\n${result.stdout}` };
        case "failed":
            return {
                kind: "failure",
                exitCode: 1,
                stderr:
                    `verification failed (code ${result.code})\n\n${result.stdout}\n\n${result.stderr}`,
            };
        case "tool_missing":
            return { kind: "failure", exitCode: 2, stderr: result.message };
        case "parse_error":
            return { kind: "failure", exitCode: 1, stderr: result.message };
        case "io_error":
            return { kind: "failure", exitCode: 1, stderr: result.message };
    }
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
