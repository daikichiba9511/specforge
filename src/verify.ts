import { readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { formatParseError, parse } from "./parser.ts";
import { generateTla } from "./tla.ts";
import { preprocess } from "./spec_doc.ts";

/**
 * `specforge verify` の依存物 (副作用) を注入するインターフェイス。
 * テストでは `runTlc` をモックすることで実際の subprocess 実行を回避する。
 */
export type VerifyDeps = {
    readFile: (path: string) => string;
    makeTempDir: () => string;
    writeFile: (path: string, content: string) => void;
    runTlc: (
        javaPath: string,
        jarPath: string,
        specFile: string,
        cfgFile: string,
        cwd: string,
    ) => { stdout: string; stderr: string; code: number };
    findJava: () => string | null;
    findTlaJar: () => string | null;
};

const defaultFindJava = (): string | null => {
    const home = env.JAVA_HOME;
    if (home) {
        const p = join(home, "bin", "java");
        try {
            statSync(p);
            return p;
        } catch { /* fallthrough */ }
    }
    const candidates = [
        "/opt/homebrew/opt/openjdk/bin/java",
        "/usr/local/opt/openjdk/bin/java",
        "/usr/bin/java",
    ];
    for (const c of candidates) {
        try {
            statSync(c);
            return c;
        } catch { /* try next */ }
    }
    return null;
};

const defaultFindTlaJar = (): string | null => {
    const e = env.SPECFORGE_TLA_JAR;
    if (e) return e;
    const home = env.HOME ?? "";
    const candidates = [
        join(home, ".local", "share", "specforge", "tla2tools.jar"),
        join(home, "Library", "Application Support", "specforge", "tla2tools.jar"),
    ];
    for (const c of candidates) {
        try {
            statSync(c);
            return c;
        } catch { /* try next */ }
    }
    return null;
};

const defaultRunTlc = (
    javaPath: string,
    jarPath: string,
    specFile: string,
    cfgFile: string,
    cwd: string,
): { stdout: string; stderr: string; code: number } => {
    const cmd = new Deno.Command(javaPath, {
        args: [
            "-XX:+UseParallelGC",
            "-cp",
            jarPath,
            "tlc2.TLC",
            "-config",
            cfgFile,
            "-workers",
            "auto",
            specFile,
        ],
        cwd,
        stdout: "piped",
        stderr: "piped",
    });
    const out = cmd.outputSync();
    return {
        stdout: new TextDecoder().decode(out.stdout),
        stderr: new TextDecoder().decode(out.stderr),
        code: out.code,
    };
};

export const defaultVerifyDeps: VerifyDeps = {
    readFile: (path) => readFileSync(path, "utf-8"),
    makeTempDir: () => mkdtempSync(join(tmpdir(), "specforge-")),
    writeFile: (path, content) => writeFileSync(path, content),
    runTlc: defaultRunTlc,
    findJava: defaultFindJava,
    findTlaJar: defaultFindTlaJar,
};

/**
 * `specforge verify <spec>` の結果。`kind` で成否を判別する。
 *
 * - `verified`: TLC が走り、エラー報告無し。`stdout` に整形済サマリ
 * - `failed`: TLC が走ったがエラー / 反例検出。`stdout` に詳細
 * - `tool_missing`: java または tla2tools.jar が見つからず実行できない
 * - `parse_error`: 入力 spec のパース失敗
 * - `io_error`: ファイル読み書きの失敗
 */
export type VerifyResult =
    | { kind: "verified"; stdout: string }
    | { kind: "failed"; stdout: string; stderr: string; code: number }
    | { kind: "tool_missing"; message: string }
    | { kind: "parse_error"; message: string }
    | { kind: "io_error"; message: string };

const MODULE_NAME = "Spec";
const DEFAULT_CFG = "SPECIFICATION Spec\n";

const summarizeTlcOutput = (stdout: string): string => {
    // TLC の長い出力から「状態数 / 完了 / エラー」行のみ抜き出す。
    const lines = stdout.split("\n");
    const keep: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (
            /^(Error|Finished|Model checking completed|TLC2 Version|\d+ states generated|Computing initial|distinct states)/i
                .test(trimmed) ||
            /^(Invariant|Deadlock|Temporal property)/i.test(trimmed)
        ) {
            keep.push(trimmed);
        }
    }
    return keep.join("\n");
};

/**
 * spec を TLA+ 化 → TLC で検証する。
 *
 * @param specPath - 入力 spec (`.mmd` / `.md` どちらも可)
 * @param deps - 副作用注入 (省略時はデフォルト実装)
 */
export const verify = (
    specPath: string,
    deps: VerifyDeps = defaultVerifyDeps,
): VerifyResult => {
    let raw: string;
    try {
        raw = deps.readFile(specPath);
    } catch (e) {
        return {
            kind: "io_error",
            message: `could not read file: ${e instanceof Error ? e.message : String(e)}`,
        };
    }

    const doc = preprocess(raw);
    const parsed = parse(doc.mermaid);
    if (!parsed.ok) {
        return { kind: "parse_error", message: formatParseError(parsed.error) };
    }

    const javaPath = deps.findJava();
    if (!javaPath) {
        return {
            kind: "tool_missing",
            message: "java not found. Install JDK (e.g., `brew install openjdk`) or set JAVA_HOME.",
        };
    }
    const jarPath = deps.findTlaJar();
    if (!jarPath) {
        return {
            kind: "tool_missing",
            message: "tla2tools.jar not found. Set SPECFORGE_TLA_JAR or place jar at " +
                "~/.local/share/specforge/tla2tools.jar (download from " +
                "https://github.com/tlaplus/tlaplus/releases/latest).",
        };
    }

    const tla = generateTla(parsed.value, doc.guards, doc.stateVars, MODULE_NAME);

    let tempDir: string;
    try {
        tempDir = deps.makeTempDir();
    } catch (e) {
        return {
            kind: "io_error",
            message: `could not create temp dir: ${e instanceof Error ? e.message : String(e)}`,
        };
    }

    const tlaFile = join(tempDir, `${MODULE_NAME}.tla`);
    const cfgFile = join(tempDir, `${MODULE_NAME}.cfg`);
    try {
        deps.writeFile(tlaFile, tla);
        deps.writeFile(cfgFile, DEFAULT_CFG);
    } catch (e) {
        return {
            kind: "io_error",
            message: `could not write temp files: ${e instanceof Error ? e.message : String(e)}`,
        };
    }

    const result = deps.runTlc(javaPath, jarPath, tlaFile, cfgFile, tempDir);
    const summary = summarizeTlcOutput(result.stdout);

    if (result.code === 0) {
        return { kind: "verified", stdout: summary || result.stdout };
    }
    return {
        kind: "failed",
        stdout: summary || result.stdout,
        stderr: result.stderr,
        code: result.code,
    };
};
