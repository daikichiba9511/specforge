/**
 * Markdown 文書 (`.md`) を入力として受けたときの前処理。
 *
 * specforge は `.mmd` (生 Mermaid) と `.md` (Mermaid block を含む markdown) の
 * いずれも受理する。本モジュールは `.md` から
 *
 * - 最初の `stateDiagram-v2` 始まりの ```mermaid``` ブロック
 * - ガード辞書 (見出し `### ガード定義` / `### Guards` 等の直後の markdown 表)
 *
 * を抽出する。`.mmd` の場合は preprocess が「Mermaid そのもの + 空辞書」を返す。
 */

/**
 * `.md` 前処理の結果。
 *
 * - `mermaid`: AST パーサに渡す Mermaid 文字列
 * - `guards`: ガードタグ → CSP/CSPm 式 の辞書 (空でも可)
 * - `stateVars`: 共有状態テーブルで宣言された変数名リスト (順序保持、重複除去)。
 *   cspm 生成時に冒頭の `<var> = 0` 定義として emit される。
 */
export type SpecDoc = {
    mermaid: string;
    guards: Map<string, string>;
    stateVars: string[];
};

const RE_MERMAID_OPEN = /^```mermaid\b/;
const RE_FENCE_CLOSE = /^```\s*$/;
const RE_TABLE_ROW = /^\s*\|/;
const RE_TABLE_SEPARATOR = /^\s*\|[\s|:-]+\|\s*$/;
// 見出し (`#` 1〜6 個) の本文に "ガード" または "Guard(s)" を含むもの。
// `\b` は ASCII にしか効かないため Japanese 側は境界条件を付けない。
const RE_GUARD_HEADING = /^#{1,6}\s+.*(?:ガード|Guards?\b)/i;
// 共有状態 / state variable(s) / shared state を含む見出し。
const RE_STATE_VAR_HEADING =
    /^#{1,6}\s+.*(?:共有(?:状態|変数)|State\s*Variables?\b|Shared\s*State\b)/i;

const stripBackticks = (s: string): string => {
    const t = s.trim();
    return t.startsWith("`") && t.endsWith("`") && t.length >= 2 ? t.slice(1, -1).trim() : t;
};

const parseTableRow = (line: string): string[] => {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|\s*$/, "");
    return trimmed.split("|").map((c) => c.trim());
};

/**
 * 入力 markdown 内の最初の `stateDiagram-v2` Mermaid ブロック本体を返す。
 * 該当ブロックが無ければ `null` (sequenceDiagram のみ等のケース)。
 */
export const extractMermaid = (input: string): string | null => {
    const lines = input.split("\n");
    let i = 0;
    while (i < lines.length) {
        if (RE_MERMAID_OPEN.test(lines[i])) {
            const start = i + 1;
            let end = start;
            while (end < lines.length && !RE_FENCE_CLOSE.test(lines[end])) end++;
            const block = lines.slice(start, end).join("\n");
            const firstNonBlank = block.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
            if (firstNonBlank.startsWith("stateDiagram-v2")) return block;
            i = end + 1;
            continue;
        }
        i++;
    }
    return null;
};

/**
 * `### ガード定義` (もしくは `Guards` を含む見出し) の直後の markdown 表から
 * `tag → 式` の対応を抽出する。
 *
 * 受理形式:
 * - 見出し行: 任意レベルの `#` + 本文に "ガード" or "Guard" を含む
 * - 表の 1 列目 = ガードタグ、2 列目 = 条件式
 * - セル前後の backtick (`` `catalog_ok` ``) は剥がされる
 * - 表の終了は「`|` で始まらない行」で判定 (空行 / 別 heading / 他テキスト)
 */
export const extractGuards = (input: string): Map<string, string> => {
    const guards = new Map<string, string>();
    const lines = input.split("\n");

    let i = 0;
    while (i < lines.length && !RE_GUARD_HEADING.test(lines[i])) i++;
    if (i >= lines.length) return guards;

    i++;
    while (i < lines.length && !RE_TABLE_ROW.test(lines[i])) i++;
    if (i >= lines.length) return guards;

    i++; // skip header row
    if (i < lines.length && RE_TABLE_SEPARATOR.test(lines[i])) i++;

    while (i < lines.length && RE_TABLE_ROW.test(lines[i])) {
        const cells = parseTableRow(lines[i]);
        if (cells.length >= 2) {
            const tag = stripBackticks(cells[0]);
            const expr = stripBackticks(cells[1]);
            if (tag && expr) guards.set(tag, expr);
        }
        i++;
    }
    return guards;
};

/**
 * `### 共有状態` (もしくは `State variable(s)` 等を含む見出し) の直後の markdown 表から
 * 1 列目を変数名として取り出す。
 *
 * 受理形式:
 * - 見出し行: 任意レベル `#` + 本文に "共有(状態|変数)" / "State variable(s)" / "Shared state"
 * - 表の 1 列目 = 変数名 (backtick 任意)
 * - 重複は除去、出現順を保持
 */
export const extractStateVars = (input: string): string[] => {
    const vars: string[] = [];
    const seen = new Set<string>();
    const lines = input.split("\n");

    let i = 0;
    while (i < lines.length && !RE_STATE_VAR_HEADING.test(lines[i])) i++;
    if (i >= lines.length) return vars;

    i++;
    while (i < lines.length && !RE_TABLE_ROW.test(lines[i])) i++;
    if (i >= lines.length) return vars;

    i++; // header row
    if (i < lines.length && RE_TABLE_SEPARATOR.test(lines[i])) i++;

    while (i < lines.length && RE_TABLE_ROW.test(lines[i])) {
        const cells = parseTableRow(lines[i]);
        if (cells.length >= 1) {
            const name = stripBackticks(cells[0]);
            if (name && !seen.has(name)) {
                seen.add(name);
                vars.push(name);
            }
        }
        i++;
    }
    return vars;
};

/**
 * `.md` / `.mmd` どちらの入力でも適切に前処理した {@link SpecDoc} を返す。
 * Mermaid block が見つからない場合は入力そのものを Mermaid として扱う (= 生 `.mmd`)。
 */
export const preprocess = (input: string): SpecDoc => {
    const extracted = extractMermaid(input);
    if (extracted === null) {
        return { mermaid: input, guards: new Map(), stateVars: [] };
    }
    return {
        mermaid: extracted,
        guards: extractGuards(input),
        stateVars: extractStateVars(input),
    };
};
