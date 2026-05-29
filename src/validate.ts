import { isPseudoState } from "./types.ts";
import type { Diagram, Region, Stmt } from "./types.ts";
import type { SpecDoc } from "./spec_doc.ts";

type Transition = Extract<Stmt, { kind: "transition" }>;
type Composite = Extract<Stmt, { kind: "composite" }>;

/**
 * Validation issue の重要度。`error` は `--strict` 時に exit code を non-zero にする根拠。
 */
export type ValidationLevel = "warning" | "error";

/**
 * Spec の意味検証で見つかった 1 件分の問題。
 *
 * - `code`: `V001` `V002` ... の安定 ID (将来 docs にぶら下げる用)
 * - `message`: 何が問題か (人間向け)
 * - `suggestion`: 直し方の候補 (省略可)
 */
export type ValidationIssue = {
    level: ValidationLevel;
    code: string;
    message: string;
    suggestion?: string;
};

export type ValidationReport = {
    issues: ValidationIssue[];
};

// spec-behavior 流ガード式で使う予約語 + TLA+ で評価可能な literal。
// extractIdentifiers が拾うが、変数として宣言要求しない名前。
const RESERVED_NAMES = new Set([
    "TRUE",
    "FALSE",
    "in",
    "not",
    "and",
    "or",
]);

// 単純な正規表現で識別子を抽出する。演算子・数値・括弧は除外。
const extractIdentifiers = (expr: string): string[] => {
    const matches = expr.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g);
    return [...matches].map((m) => m[0]);
};

const collectTransitions = (diagram: Diagram): Transition[] => {
    const result: Transition[] = [];
    const recur = (regions: Region[]): void => {
        for (const region of regions) {
            for (const stmt of region.stmts) {
                if (stmt.kind === "transition") result.push(stmt);
                else if (stmt.kind === "composite") recur(stmt.regions);
            }
        }
    };
    recur(diagram.regions);
    return result;
};

const collectComposites = (diagram: Diagram): Composite[] => {
    const result: Composite[] = [];
    const recur = (regions: Region[]): void => {
        for (const region of regions) {
            for (const stmt of region.stmts) {
                if (stmt.kind === "composite") {
                    result.push(stmt);
                    recur(stmt.regions);
                }
            }
        }
    };
    recur(diagram.regions);
    return result;
};

const regionHasEntry = (region: Region): boolean => {
    for (const stmt of region.stmts) {
        if (stmt.kind === "transition" && isPseudoState(stmt.from)) return true;
    }
    return false;
};

/**
 * Parse 後の {@link Diagram} と前処理済みの {@link SpecDoc} に対して意味検証を走らせる。
 *
 * 現在のチェック (出現順に code が安定):
 * - **V001**: 遷移ラベルの guard タグがガード辞書 (`doc.guards`) に登録されていない
 * - **V002**: ガード式が state var にも event payload field にも無い識別子を参照している
 * - **V003**: composite の region に `[*] --> <entry>` の初期遷移が無い (region 入口が SKIP に
 *   フォールバックして TLA+ / CSPm の意味がおかしくなる)
 *
 * 各 issue は `level: "warning"` で返す。CLI 側 `--strict` で warning → 失敗に昇格させる。
 *
 * @param diagram - パース済み AST
 * @param doc     - `.md` 前処理で抽出した metadata
 */
export const validate = (diagram: Diagram, doc: SpecDoc): ValidationReport => {
    const issues: ValidationIssue[] = [];
    const transitions = collectTransitions(diagram);
    const composites = collectComposites(diagram);

    // V001: guard タグの辞書漏れ
    for (const t of transitions) {
        if (t.label.guard && !doc.guards.has(t.label.guard)) {
            issues.push({
                level: "warning",
                code: "V001",
                message: `guard tag '${t.label.guard}' is not defined in the guard dictionary ` +
                    `(used in ${t.from} --> ${t.to})`,
                suggestion: `Add '${t.label.guard}' to the '### ガード定義' / '### Guards' table.`,
            });
        }
    }

    // V002: 解決済みガード式の識別子が宣言されていない
    for (const t of transitions) {
        if (!t.label.guard) continue;
        const expr = doc.guards.get(t.label.guard);
        if (!expr) continue; // V001 で報告済
        const referenced = extractIdentifiers(expr);
        const payload = t.label.event ? doc.eventPayloads.get(t.label.event) ?? [] : [];
        const known = new Set([
            ...doc.stateVars,
            ...payload,
            ...RESERVED_NAMES,
        ]);
        const reported = new Set<string>();
        for (const id of referenced) {
            if (known.has(id) || reported.has(id)) continue;
            reported.add(id);
            issues.push({
                level: "warning",
                code: "V002",
                message: `guard expression '${expr}' (tag '${t.label.guard}') references ` +
                    `'${id}' which is not in state vars nor in event '${
                        t.label.event ?? "<no event>"
                    }' payload`,
                suggestion: `Add '${id}' to the '### 共有状態' / '### State variables' table, ` +
                    `or include it in the event payload column.`,
            });
        }
    }

    // V003: composite region の入口欠落
    for (const c of composites) {
        for (let i = 0; i < c.regions.length; i++) {
            if (!regionHasEntry(c.regions[i])) {
                issues.push({
                    level: "warning",
                    code: "V003",
                    message: `composite '${c.id}' region ${i} has no '[*] --> <entry>' transition`,
                    suggestion: `Add '[*] --> <EntryState>' inside the region body.`,
                });
            }
        }
    }

    return { issues };
};

/**
 * 1 件の issue を `warn V001: <message>\n  hint: <suggestion>` 形式に整形する。
 * CLI が stderr に出すときの想定形式。
 */
export const formatIssue = (issue: ValidationIssue): string => {
    const prefix = issue.level === "error" ? "error" : "warn";
    const lines = [`${prefix} ${issue.code}: ${issue.message}`];
    if (issue.suggestion) lines.push(`  hint: ${issue.suggestion}`);
    return lines.join("\n");
};
