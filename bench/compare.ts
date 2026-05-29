/**
 * `deno bench --json` の出力 2 ファイルを比較し、変化率の表を出力する。
 *
 * 用途: ローカルで before / after を比較する。CI 連携は無し。
 *
 * @example
 * ```bash
 * deno bench --json bench/ > /tmp/before.json
 * # ... edit code ...
 * deno bench --json bench/ > /tmp/after.json
 * deno task bench:compare /tmp/before.json /tmp/after.json
 * # 閾値変更:
 * deno task bench:compare /tmp/before.json /tmp/after.json --threshold=10
 * ```
 *
 * 終了コード:
 * - 0: 全 bench が閾値以内
 * - 1: 1 つでも閾値を超えるレギュレッション
 * - 2: 引数エラー
 */

type BenchResult = {
    name: string;
    results: Array<{ ok?: { avg: number } }>;
};

type BenchFile = {
    benches: BenchResult[];
};

type Row = {
    name: string;
    before: number;
    after: number;
    pct: number;
};

const readJson = async (path: string): Promise<BenchFile> => {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as BenchFile;
};

const extractAvgs = (f: BenchFile): Map<string, number> => {
    const m = new Map<string, number>();
    for (const b of f.benches) {
        const ok = b.results[0]?.ok;
        if (ok) m.set(b.name, ok.avg);
    }
    return m;
};

const fmtNs = (ns: number): string => {
    if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
    if (ns >= 1_000) return `${(ns / 1_000).toFixed(2)} µs`;
    return `${ns.toFixed(1)} ns`;
};

const fmtPct = (pct: number): string => {
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
};

const compare = (before: Map<string, number>, after: Map<string, number>): Row[] => {
    const rows: Row[] = [];
    for (const [name, b] of before) {
        const a = after.get(name);
        if (a === undefined) continue;
        rows.push({ name, before: b, after: a, pct: ((a - b) / b) * 100 });
    }
    rows.sort((x, y) => y.pct - x.pct);
    return rows;
};

const renderTable = (rows: Row[]): string => {
    const lines = [
        "| bench | before | after | change |",
        "| --- | --- | --- | --- |",
    ];
    for (const r of rows) {
        lines.push(`| ${r.name} | ${fmtNs(r.before)} | ${fmtNs(r.after)} | ${fmtPct(r.pct)} |`);
    }
    return lines.join("\n");
};

const parseArgs = (
    args: string[],
): { beforePath: string; afterPath: string; threshold: number } | null => {
    const positional = args.filter((a) => !a.startsWith("--"));
    if (positional.length !== 2) return null;
    const thresholdArg = args.find((a) => a.startsWith("--threshold="));
    const threshold = thresholdArg ? Number(thresholdArg.slice("--threshold=".length)) : 20;
    if (!Number.isFinite(threshold)) return null;
    return { beforePath: positional[0], afterPath: positional[1], threshold };
};

const usage = "usage: deno run --allow-read bench/compare.ts <before.json> <after.json> " +
    "[--threshold=<percent>]";

const main = async (args: string[]): Promise<number> => {
    const parsed = parseArgs(args);
    if (!parsed) {
        console.error(usage);
        return 2;
    }
    const [before, after] = await Promise.all([
        readJson(parsed.beforePath),
        readJson(parsed.afterPath),
    ]);
    const rows = compare(extractAvgs(before), extractAvgs(after));
    if (rows.length === 0) {
        console.error("no overlapping bench names between the two files");
        return 2;
    }
    console.log(renderTable(rows));
    const worst = rows[0];
    if (worst.pct > parsed.threshold) {
        console.error(
            `\nRegression detected: '${worst.name}' is ${fmtPct(worst.pct)} ` +
                `(threshold ${parsed.threshold}%)`,
        );
        return 1;
    }
    return 0;
};

if (import.meta.main) {
    Deno.exit(await main(Deno.args));
}
