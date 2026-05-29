import { isPseudoState } from "./types.ts";
import type { Diagram, Region, Stmt } from "./types.ts";
import { exhaustive } from "./util.ts";

type Transition = Extract<Stmt, { kind: "transition" }>;
type Composite = Extract<Stmt, { kind: "composite" }>;

type Collected = {
    transitions: Transition[];
    composites: Map<string, Composite>;
};

const collectAll = (regions: Region[]): Collected => {
    const transitions: Transition[] = [];
    const composites = new Map<string, Composite>();
    const walk = (rs: Region[]): void => {
        for (const region of rs) {
            for (const stmt of region.stmts) {
                switch (stmt.kind) {
                    case "transition":
                        transitions.push(stmt);
                        break;
                    case "composite":
                        composites.set(stmt.id, stmt);
                        walk(stmt.regions);
                        break;
                    case "alias":
                        break;
                    default:
                        exhaustive(stmt);
                }
            }
        }
    };
    walk(regions);
    return { transitions, composites };
};

const groupByFrom = (transitions: Transition[]): Map<string, Transition[]> => {
    const result = new Map<string, Transition[]>();
    for (const t of transitions) {
        const arr = result.get(t.from);
        if (arr) arr.push(t);
        else result.set(t.from, [t]);
    }
    return result;
};

const formatLeafBranch = (t: Transition): string => {
    const guard = t.label.guard ? ` & ${t.label.guard}` : "";
    const action = t.label.action ? ` -> ${t.label.action}` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    const event = t.label.event ?? "tau";
    return `  ${event}${guard}${action} -> ${to}`;
};

const formatLeafProcess = (from: string, transitions: Transition[]): string =>
    `${from} =\n${transitions.map(formatLeafBranch).join("\n  []\n")}`;

// `[*] --> X` inside a region marks X as the region entry. ill-formed input
// (no entry transition) falls back to SKIP so codegen doesn't crash.
const regionEntry = (region: Region): string => {
    for (const stmt of region.stmts) {
        if (stmt.kind === "transition" && isPseudoState(stmt.from)) return stmt.to;
    }
    return "SKIP";
};

// Completion transition from a composite (event == null). Emit as a CSP
// guard / action / target prefix that runs AFTER the composite body SKIPs.
const formatCompletionBranch = (t: Transition): string => {
    const guard = t.label.guard ? `${t.label.guard} & ` : "";
    const action = t.label.action ? `${t.label.action} -> ` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    return `${guard}${action}${to}`;
};

// Triggered external transition from a composite (event != null). Becomes
// the branch inside the interrupt operator `/\\ (...)`.
const formatTriggeredBranch = (t: Transition): string => {
    const event = t.label.event ?? "tau";
    const guard = t.label.guard ? ` & ${t.label.guard}` : "";
    const action = t.label.action ? ` -> ${t.label.action}` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    return `${event}${guard}${action} -> ${to}`;
};

// Render a composite state as a CSPm process:
//   Composite = body [; completion-choice] [/\\ triggered-choice]
// where
//   body              = R1 ||| R2 ||| ...   (one entry per orthogonal region; hierarchical = R1)
//   completion-choice = c1 [] c2 [] ...     (completion transitions, event == null)
//   triggered-choice  = t1 [] t2 [] ...     (triggered transitions, event != null)
// Parens are inserted so CSPm precedence (`;` tighter than `|||`, `/\\` looser
// than `;`) does not silently change the grouping.
const formatComposite = (c: Composite, outer: Transition[]): string => {
    const entries = c.regions.map(regionEntry);
    const orthogonal = entries.length > 1;
    const body = orthogonal ? entries.join(" ||| ") : (entries[0] ?? "SKIP");

    const completion = outer.filter((t) => t.label.event === null);
    const triggered = outer.filter((t) => t.label.event !== null);

    let core = body;

    if (completion.length > 0) {
        const completionStr = completion.map(formatCompletionBranch).join(" [] ");
        const bodyExpr = orthogonal ? `(${body})` : body;
        core = `${bodyExpr} ; ${completionStr}`;
    }

    if (triggered.length > 0) {
        const triggeredStr = triggered.map(formatTriggeredBranch).join(" [] ");
        const coreExpr = completion.length > 0 || orthogonal ? `(${core})` : core;
        core = `${coreExpr} /\\ (${triggeredStr})`;
    }

    return `${c.id} = ${core}`;
};

/**
 * {@link Diagram} から CSPm (FDR4 入力) 文字列を生成する。
 *
 * 出力構造:
 * - 各 leaf state (transition の `from`): `State = ev -> act -> Next [] ...`
 * - 各 composite state: `Composite = (R1 ||| R2) [; 完了遷移] [/\\ triggered]`
 *   - orthogonal region は `|||` で並列合成
 *   - 階層 composite (region 1 つ) は entry process を inline
 *   - composite 外への完了遷移 (`: / action`) は `;` で sequential 接続
 *   - composite 外への triggered 遷移は `/\\` (interrupt) で包む
 *
 * 現状の制約 (`docs/spec.md` §7、`CLAUDE.md` "Pending" 参照):
 * - 状態変数のプロセスパラメータ化未対応
 * - action のカンマ列 (`a1, a2`) は verbatim 出力 (action chain 展開未対応)
 * - guard 式は verbatim 出力 (FDR4 で構文エラーになる可能性あり)
 *
 * @param diagram - パース済みの AST
 * @returns プロセス定義群を `\n\n` 区切りで連結した CSPm 文字列
 */
export const generateCspm = (diagram: Diagram): string => {
    const { transitions, composites } = collectAll(diagram.regions);
    const byFrom = groupByFrom(transitions);

    const processes: string[] = [];

    for (const [id, composite] of composites) {
        const outer = byFrom.get(id) ?? [];
        processes.push(formatComposite(composite, outer));
    }

    for (const [from, ts] of byFrom) {
        if (isPseudoState(from)) continue;
        if (composites.has(from)) continue;
        processes.push(formatLeafProcess(from, ts));
    }

    return processes.join("\n\n");
};
