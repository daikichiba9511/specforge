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

// V006 用: 名前を case-insensitive かつ underscore を除いた canonical 形にする。
// 例: `CatalogSize` / `catalog_size` / `catalogsize` → 全部 `catalogsize`
const normalizeName = (s: string): string => s.toLowerCase().replace(/_/g, "");

// V006 用: Levenshtein 1 相当を full DP テーブル無しに判定する。
// - 同長: 1 substitution のみで一致するか
// - 長さ差 1: 1 insertion / 1 deletion のみで一致するか
// 完全一致 (`a === b`) は「off」ではないので false を返す。
const isOneCharOff = (a: string, b: string): boolean => {
    if (a === b) return false;
    const lenDiff = Math.abs(a.length - b.length);
    if (lenDiff > 1) return false;
    if (a.length === b.length) {
        let diffs = 0;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                diffs++;
                if (diffs > 1) return false;
            }
        }
        return diffs === 1;
    }
    // 長さ差 1: 短い方を長い方から 1 文字削除して一致するかを線形走査で確認
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    let i = 0, j = 0;
    let skipped = false;
    while (i < shorter.length && j < longer.length) {
        if (shorter[i] === longer[j]) {
            i++;
            j++;
        } else {
            if (skipped) return false;
            skipped = true;
            j++;
        }
    }
    return true;
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
 * - **V004**: state が宣言されているが、 どの transition の `to` にも現れない (= 未到達)
 * - **V005**: state は到達可能だが、 どの transition の `from` にも現れない (= 出口なし、 stuck
 *   する可能性)。 V004 と排他: 未到達状態は V004 のみ、 到達可能 + 出口なしは V005 のみ
 * - **V006**: event payload field の名前が state var と「似ているが一致しない」 (1 文字違い or
 *   case/underscore 差) → タイポ / 命名規則漏れの疑い。 完全一致は Phase 2 binding の対象なので
 *   warn しない
 * - **V007**: 同一 `(from, to, event, guard)` の tuple が複数 transition に出現 (action だけ違う、
 *   完全重複等)。 ガード競合 / 重複定義 の可能性
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

    // V004: 未到達 state — 宣言されているが誰の to にもならない
    // V005: 出口なし state — 到達可能だが誰の from にもならない (stuck パターン)
    const reachable = new Set<string>();
    const hasOutbound = new Set<string>();
    for (const t of transitions) {
        if (!isPseudoState(t.to)) reachable.add(t.to);
        if (!isPseudoState(t.from)) hasOutbound.add(t.from);
    }
    const declared = collectDeclaredStates(diagram);
    for (const name of declared) {
        if (!reachable.has(name)) {
            issues.push({
                level: "warning",
                code: "V004",
                message:
                    `state '${name}' is declared but unreachable (no transition has it as 'to')`,
                suggestion: `Add a transition '<from> --> ${name}' from a reachable state, ` +
                    `or remove the declaration if intentional.`,
            });
        } else if (!hasOutbound.has(name)) {
            issues.push({
                level: "warning",
                code: "V005",
                message: `state '${name}' has no outbound transition (will stuck if reached, ` +
                    `no path forward or to terminal)`,
                suggestion: `Add a transition '${name} --> <next>' or '${name} --> [*]', ` +
                    `or remove the declaration if intentional.`,
            });
        }
    }

    // V006: event payload field と state var の fuzzy ミスマッチ
    // - 完全一致は Phase 2 binding 対象なので skip
    // - 正規化 (lowercase + underscore 除去) で一致 → case/underscore 差を警告
    // - 1 文字違い → タイポを警告
    // 報告は payload-field ごとに 1 件 (正規化一致を優先、 次に 1 文字違い)
    const stateVarSet = new Set(doc.stateVars);
    const stateVarByNormalized = new Map<string, string>();
    for (const sv of doc.stateVars) {
        stateVarByNormalized.set(normalizeName(sv), sv);
    }
    for (const [eventName, payloadFields] of doc.eventPayloads) {
        for (const p of payloadFields) {
            if (stateVarSet.has(p)) continue;
            const normMatch = stateVarByNormalized.get(normalizeName(p));
            if (normMatch && normMatch !== p) {
                issues.push({
                    level: "warning",
                    code: "V006",
                    message: `event '${eventName}' payload field '${p}' normalizes to ` +
                        `state var '${normMatch}' (case/underscore mismatch)`,
                    suggestion: `If they should be the same, rename one to match. Otherwise pick ` +
                        `clearly distinct names.`,
                });
                continue;
            }
            for (const sv of doc.stateVars) {
                if (!isOneCharOff(p, sv)) continue;
                issues.push({
                    level: "warning",
                    code: "V006",
                    message: `event '${eventName}' payload field '${p}' is 1 character off ` +
                        `from state var '${sv}' (possible typo)`,
                    suggestion: `If you meant '${sv}', rename the payload field. Otherwise ` +
                        `rename to avoid confusion.`,
                });
                break;
            }
        }
    }

    // V007: 同一 (from, to, event, guard) tuple の重複
    const groups = new Map<string, Transition[]>();
    for (const t of transitions) {
        const key = [t.from, t.to, t.label.event ?? "", t.label.guard ?? ""].join("|");
        const list = groups.get(key);
        if (list) list.push(t);
        else groups.set(key, [t]);
    }
    for (const list of groups.values()) {
        if (list.length <= 1) continue;
        const t = list[0];
        const eventStr = t.label.event ? ` : ${t.label.event}` : "";
        const guardStr = t.label.guard ? ` [${t.label.guard}]` : "";
        issues.push({
            level: "warning",
            code: "V007",
            message: `${list.length} transitions share the same (from, to, event, guard) ` +
                `tuple: '${t.from} --> ${t.to}${eventStr}${guardStr}'`,
            suggestion: `Distinguish them with different guards / events, or remove ` +
                `the duplicates if redundant.`,
        });
    }

    return { issues };
};

// 状態として宣言されているもの全て (composite ID + alias ID + transition の from/to に
// 現れた非疑似 state)。
const collectDeclaredStates = (diagram: Diagram): Set<string> => {
    const declared = new Set<string>();
    const recur = (regions: Region[]): void => {
        for (const region of regions) {
            for (const stmt of region.stmts) {
                if (stmt.kind === "composite") {
                    declared.add(stmt.id);
                    recur(stmt.regions);
                } else if (stmt.kind === "alias") {
                    declared.add(stmt.id);
                } else if (stmt.kind === "transition") {
                    if (!isPseudoState(stmt.from)) declared.add(stmt.from);
                    if (!isPseudoState(stmt.to)) declared.add(stmt.to);
                }
            }
        }
    };
    recur(diagram.regions);
    return declared;
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
