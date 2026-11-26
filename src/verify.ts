import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { formatParseError, parse } from "./parser.ts";
import { generateTla, type TlaTransition } from "./tla.ts";
import type { Region } from "./types.ts";
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

/** `JAVA_HOME/bin/java`、Homebrew、`/usr/bin/java` の順に探し、見つかった最初のパスを返す。 */
function defaultFindJava(): string | null {
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
}

/**
 * `SPECFORGE_TLA_JAR` があればその値を使う。
 * 省略時はユーザーのデータディレクトリを探し、見つからなければ `null` を返す。
 */
function defaultFindTlaJar(): string | null {
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
}

/** 指定の作業ディレクトリで TLC を同期実行し、標準出力、標準エラー、終了コードを返す。プロセスの起動エラーは呼び出し側に伝える。 */
function defaultRunTlc(
    javaPath: string,
    jarPath: string,
    specFile: string,
    cfgFile: string,
    cwd: string,
): { stdout: string; stderr: string; code: number } {
    const result = spawnSync(javaPath, [
        "-XX:+UseParallelGC",
        "-cp",
        jarPath,
        "tlc2.TLC",
        "-config",
        cfgFile,
        "-workers",
        "auto",
        specFile,
    ], { cwd, encoding: "utf8", maxBuffer: Infinity });
    if (result.error) throw result.error;
    return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.status ?? 1,
    };
}

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

/** TLC の設定に `SPECIFICATION Spec` を書き、時相プロパティがあれば対応する定義名を `PROPERTY` 行に並べる。 */
function buildCfg(propertyNames: readonly string[]): string {
    const lines = ["SPECIFICATION Spec"];
    if (propertyNames.length > 0) {
        lines.push(`PROPERTY ${propertyNames.join(" ")}`);
    }
    return lines.join("\n") + "\n";
}

/** CLI の検証結果に表示するため、TLC の出力から状態数、進行状況、検査の成否に関する行を抜き出す。 */
function summarizeTlcOutput(stdout: string): string {
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
}

/** TLC が記録したアクション名を元の矢印に戻す。対応が取れないときは TLC の記述を残す。 */
function describeTraceAction(
    header: string,
    origins: Map<string, TlaTransition>,
    regionLabels: Map<Region, Map<string, string>>,
): string {
    const name = header === "<Initial predicate>" ? "Init" : /^<(\w+)(?:\s|>)/.exec(header)?.[1];
    if (name === "Stutter") return "終端状態を維持";
    const origin = name && origins.get(name);
    if (!origin) return header;
    const { t, region, context } = origin;
    let labels = regionLabels.get(region);
    if (!labels) {
        labels = new Map();
        for (const stmt of region.stmts) {
            if (stmt.kind === "alias" && stmt.description) labels.set(stmt.id, stmt.description);
        }
        regionLabels.set(region, labels);
    }
    const to = labels.get(t.to) ?? t.to;
    if (name === "Init") return `[*] → ${to}`;
    const scope = context.kind === "region"
        ? `[${context.compositeId} 領域 ${context.regionIdx + 1}] `
        : "";
    const event = t.label.event;
    const args = t.label.eventArgs.length ? `(${t.label.eventArgs.join(", ")})` : "";
    const arrow = event ? ` --${event}${args}--> ` : " → ";
    const guard = t.label.guard ? ` [${t.label.guard}]` : "";
    return scope + (labels.get(t.from) ?? t.from) + arrow + to + guard;
}

/** 状態番号を TLC と揃えて、デッドロックまでの経路や進行性違反のループを表示する。 */
function formatCounterexample(stdout: string, origins: Map<string, TlaTransition>): string {
    const steps: string[] = [];
    const regionLabels = new Map<Region, Map<string, string>>();
    for (const line of stdout.split(/\r?\n/)) {
        const state = /^State (\d+):\s*(.+)$/.exec(line);
        if (state) {
            const [, number, header] = state;
            const action = header.trim() === "Stuttering"
                ? `手順 ${Number(number) - 1} の状態を繰り返す`
                : describeTraceAction(header.trim(), origins, regionLabels);
            steps.push(`  ${number}. ${action}`);
            continue;
        }
        const loop = /^Back to state (\d+)(?::\s*(.*))?\s*$/i.exec(line);
        if (loop && steps.length) {
            const action = loop[2]
                ? `　${describeTraceAction(loop[2].trim(), origins, regionLabels)}`
                : "";
            steps.push(`  ↩ 手順 ${loop[1]} の直後に戻る（繰り返し）${action}`);
        }
    }
    return steps.length ? ["反例（仕様上の遷移）", ...steps].join("\n") : "";
}

/**
 * spec を TLA+ 化 → TLC で検証する。
 *
 * @param specPath - 入力 spec (`.mmd` / `.md` どちらも可)
 * @param deps - 副作用注入 (省略時はデフォルト実装)
 * @param bound - generateTla の bound (Domain == 0..N) パラメータ。省略時 1
 */
export function verify(
    specPath: string,
    deps: VerifyDeps = defaultVerifyDeps,
    bound: number = 1,
): VerifyResult {
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

    const origins = new Map<string, TlaTransition>();
    const tla = generateTla(
        parsed.value,
        doc.guards,
        doc.stateVars,
        doc.eventPayloads,
        MODULE_NAME,
        bound,
        doc.liveness,
        (name, source) => origins.set(name, source),
    );

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
        deps.writeFile(cfgFile, buildCfg(doc.liveness.map((p) => p.name)));
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
    const trace = formatCounterexample(result.stdout, origins);
    return {
        kind: "failed",
        stdout: [summary || result.stdout, trace].filter(Boolean).join("\n\n"),
        stderr: result.stderr,
        code: result.code,
    };
}
