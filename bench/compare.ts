import { readFile } from "node:fs/promises";

/**
 * `bun run bench --json` の出力 2 ファイルを比較し、変化率の表を出力する。
 *
 * 用途: ローカルで before / after を比較する。CI 連携は無し。
 *
 * @example
 * ```bash
 * bun run bench --json > /tmp/before.json
 * # ... edit code ...
 * bun run bench --json > /tmp/after.json
 * bun run bench:compare /tmp/before.json /tmp/after.json
 * # 閾値変更:
 * bun run bench:compare /tmp/before.json /tmp/after.json --threshold=10
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

/** `bench --json` の計測結果をファイルから読み込み、比較に使うデータに戻す。 */
async function readJson(path: string): Promise<BenchFile> {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as BenchFile;
}

/** 各ベンチマークの先頭の計測結果から、成功したものだけを名前と平均実行時間の対応にまとめる。 */
function extractAvgs(f: BenchFile): Map<string, number> {
    const m = new Map<string, number>();
    for (const b of f.benches) {
        const ok = b.results[0]?.ok;
        if (ok) m.set(b.name, ok.avg);
    }
    return m;
}

/** ナノ秒で記録した平均時間を、大きさに応じて ns、µs、ms のいずれかで表示する。 */
function fmtNs(ns: number): string {
    if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
    if (ns >= 1_000) return `${(ns / 1_000).toFixed(2)} µs`;
    return `${ns.toFixed(1)} ns`;
}

/** 実行時間の変化率を小数1桁で表示する。増加と横ばいには `+` を付ける。 */
function fmtPct(pct: number): string {
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
}

/** 両方の計測にある項目だけを比較し、平均実行時間の増加率が大きい順に並べる。 */
function compare(before: Map<string, number>, after: Map<string, number>): Row[] {
    const rows: Row[] = [];
    for (const [name, b] of before) {
        const a = after.get(name);
        if (a === undefined) continue;
        rows.push({ name, before: b, after: a, pct: ((a - b) / b) * 100 });
    }
    rows.sort((x, y) => y.pct - x.pct);
    return rows;
}

/** 変更前後の平均時間と変化率を、比較結果の順番を保って Markdown の表にする。 */
function renderTable(rows: Row[]): string {
    const lines = [
        "| bench | before | after | change |",
        "| --- | --- | --- | --- |",
    ];
    for (const r of rows) {
        lines.push(`| ${r.name} | ${fmtNs(r.before)} | ${fmtNs(r.after)} | ${fmtPct(r.pct)} |`);
    }
    return lines.join("\n");
}

/** 比較対象のファイル2件と許容する増加率を読み取る。ファイル数やしきい値が不正なら `null` を返す。 */
function parseArgs(
    args: string[],
): { beforePath: string; afterPath: string; threshold: number } | null {
    const positional = args.filter((a) => !a.startsWith("--"));
    if (positional.length !== 2) return null;
    const thresholdArg = args.find((a) => a.startsWith("--threshold="));
    const threshold = thresholdArg ? Number(thresholdArg.slice("--threshold=".length)) : 20;
    if (!Number.isFinite(threshold)) return null;
    return { beforePath: positional[0], afterPath: positional[1], threshold };
}

const usage = "usage: bun run bench:compare <before.json> <after.json> " +
    "[--threshold=<percent>]";

/** 比較表を出力し、許容する増加率を超えたら 1、引数の誤りや比較対象の不足なら 2 を返す。 */
async function main(args: string[]): Promise<number> {
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
}

if (import.meta.main) {
    process.exitCode = await main(process.argv.slice(2));
}
