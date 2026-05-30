import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { formatParseError, parse } from "./parser.ts";
import { generateCspm } from "./cspm.ts";
import { generateTla } from "./tla.ts";
import { preprocess } from "./spec_doc.ts";
import { verify } from "./verify.ts";
import { formatIssue, validate } from "./validate.ts";

/**
 * CLI 実行結果を表す判別ユニオン。
 *
 * - `success`: 正常完了。`stdout` に CSPm を持ち、exit code は常に 0
 * - `failure`: 何らかの失敗。`stderr` にエラー文、`exitCode` に non-zero
 * - `warnings`: validate() が返した issue を整形した文字列群。stdout/stderr 後に呼び出し側が
 *   stderr へ書く想定。空配列も可
 *
 * 実際の stdout/stderr 書き出しと `exit` は呼び出し側で行う。
 */
export type MainResult =
    | { kind: "success"; stdout: string; warnings?: string[] }
    | { kind: "failure"; exitCode: number; stderr: string; warnings?: string[] };

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

// SpecDoc + Diagram を 1 つの JSON-serializable な object に変換する。
// Map は plain object に。
const docAndDiagramToJson = (
    doc: ReturnType<typeof preprocess>,
    diagram: unknown,
): string => {
    return JSON.stringify(
        {
            diagram,
            guards: Object.fromEntries(doc.guards),
            stateVars: doc.stateVars,
            eventPayloads: Object.fromEntries(doc.eventPayloads),
        },
        null,
        2,
    );
};

/**
 * specforge CLI のエントリポイント。
 *
 * 引数を受けて {@link MainResult} を返す pure 関数。 stdout/stderr/exit などの
 * 副作用は呼び出し側 (`import.meta.main` ブロック) で実施する。
 *
 * フラグ:
 * - `--tla`: CSPm の代わりに TLA+ を出力
 * - `--json`: AST + metadata を JSON で出力 (CSPm/TLA+ 出力に代えて)
 * - `--strict`: validation で warning が 1 件でもあれば failure (exit 1) として返す
 * - `--bound=N`: TLA+ の `Domain == 0..N` / CSPm の `nametype VAL = {0..N}` を上書き
 *   (デフォルト 1)。state var が取りうる値域を広げると TLC の探索空間が増える
 *
 * @param args - CLI 引数 (通常は `argv.slice(2)`)
 * @param deps - 副作用注入。デフォルトは `fs.readFileSync` を使う実装
 *
 * @example
 * ```ts
 * const r = main(["spec.mmd"], { readFile: () => "stateDiagram-v2\n[*] --> A" });
 * if (r.kind === "success") console.log(r.stdout);
 * else console.error(r.stderr);
 * ```
 */
export const main = (args: string[], deps: Deps = defaultDeps): MainResult => {
    if (args[0] === "verify") {
        return runVerify(args.slice(1), deps);
    }

    const useTla = args.includes("--tla");
    const useJson = args.includes("--json");
    const strict = args.includes("--strict");
    const bound = parseBoundArg(args);
    if (bound instanceof Error) {
        return { kind: "failure", exitCode: 1, stderr: bound.message };
    }
    const positional = args.filter((a) => !a.startsWith("--"));
    if (positional.length === 0) {
        return {
            kind: "failure",
            exitCode: 1,
            stderr: "usage: specforge [--tla|--json] [--strict] [--bound=N] <spec.mmd|spec.md>\n" +
                "       specforge verify [--strict] [--bound=N] <spec.mmd|spec.md>",
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

    const report = validate(result.value, doc);
    const warnings = report.issues.map(formatIssue);
    if (strict && report.issues.length > 0) {
        return {
            kind: "failure",
            exitCode: 1,
            stderr: `validation found ${report.issues.length} issue(s) (--strict)`,
            warnings,
        };
    }

    let stdout: string;
    if (useJson) {
        stdout = docAndDiagramToJson(doc, result.value);
    } else if (useTla) {
        stdout = generateTla(
            result.value,
            doc.guards,
            doc.stateVars,
            doc.eventPayloads,
            "Spec",
            bound,
            doc.liveness,
        );
    } else {
        stdout = generateCspm(
            result.value,
            doc.guards,
            doc.stateVars,
            doc.eventPayloads,
            bound,
        );
    }
    return { kind: "success", stdout, warnings };
};

// `--bound=N` を args から拾って整数に変換。 値が壊れていたら Error を返す (caller が failure 化)。
const parseBoundArg = (args: string[]): number | Error => {
    const arg = args.find((a) => a.startsWith("--bound="));
    if (!arg) return 1;
    const raw = arg.slice("--bound=".length);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        return new Error(`--bound expects a non-negative integer, got '${raw}'`);
    }
    return n;
};

// `verify` サブコマンドの実装。verify モジュールへの委譲 + 結果を MainResult に整形。
const runVerify = (verifyArgs: string[], deps: Deps): MainResult => {
    const strict = verifyArgs.includes("--strict");
    const bound = parseBoundArg(verifyArgs);
    if (bound instanceof Error) {
        return { kind: "failure", exitCode: 1, stderr: bound.message };
    }
    const positional = verifyArgs.filter((a) => !a.startsWith("--"));
    if (positional.length === 0) {
        return {
            kind: "failure",
            exitCode: 1,
            stderr: "usage: specforge verify [--strict] [--bound=N] <spec.mmd|spec.md>",
        };
    }

    // verify は spec 全体を読み直すが、 validation は spec 読み込み段階で走らせる必要がある。
    // verify モジュール内に取り込む手もあるが、責任を分けるため CLI 側で先に validation を実施。
    let raw: string;
    try {
        raw = deps.readFile(positional[0]);
    } catch {
        // 読めない場合は verify() 側のエラーハンドリングに任せる
        return finalizeVerify(positional[0], strict, bound, []);
    }
    const doc = preprocess(raw);
    const parsed = parse(doc.mermaid);
    const warnings: string[] = parsed.ok ? validate(parsed.value, doc).issues.map(formatIssue) : [];

    if (strict && warnings.length > 0) {
        return {
            kind: "failure",
            exitCode: 1,
            stderr: `validation found ${warnings.length} issue(s) (--strict)`,
            warnings,
        };
    }

    return finalizeVerify(positional[0], strict, bound, warnings);
};

const finalizeVerify = (
    specPath: string,
    _strict: boolean,
    bound: number,
    warnings: string[],
): MainResult => {
    const result = verify(specPath, undefined, bound);
    switch (result.kind) {
        case "verified":
            return { kind: "success", stdout: `verified ok\n\n${result.stdout}`, warnings };
        case "failed":
            return {
                kind: "failure",
                exitCode: 1,
                stderr:
                    `verification failed (code ${result.code})\n\n${result.stdout}\n\n${result.stderr}`,
                warnings,
            };
        case "tool_missing":
            return { kind: "failure", exitCode: 2, stderr: result.message, warnings };
        case "parse_error":
            return { kind: "failure", exitCode: 1, stderr: result.message, warnings };
        case "io_error":
            return { kind: "failure", exitCode: 1, stderr: result.message, warnings };
    }
};

if (import.meta.main) {
    const r = main(argv.slice(2));
    // warnings は stdout/stderr 前に flush (人間が見るときに先に注目しやすいよう)
    if (r.warnings && r.warnings.length > 0) {
        for (const w of r.warnings) console.error(w);
        console.error("");
    }
    if (r.kind === "success") {
        console.log(r.stdout);
        exit(0);
    } else {
        console.error(r.stderr);
        exit(r.exitCode);
    }
}
