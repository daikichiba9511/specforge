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

// `["a", "b", "c"]` を ` -> a -> b -> c` の suffix 形に。空配列は "" を返す。
const actionsSuffix = (actions: string[]): string =>
    actions.length > 0 ? ` -> ${actions.join(" -> ")}` : "";

// `["a", "b"]` を `a -> b -> ` の prefix 形に。空配列は "" を返す (完了遷移用)。
const actionsPrefix = (actions: string[]): string =>
    actions.length > 0 ? `${actions.join(" -> ")} -> ` : "";

// ガードタグを辞書で式に置換。辞書に無いタグは verbatim を返す。
const resolveGuard = (raw: string, guards: Map<string, string>): string => guards.get(raw) ?? raw;

const formatLeafBranch = (t: Transition, guards: Map<string, string>): string => {
    const guard = t.label.guard ? ` & ${resolveGuard(t.label.guard, guards)}` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    const event = t.label.event ?? "tau";
    return `  ${event}${guard}${actionsSuffix(t.label.actions)} -> ${to}`;
};

const formatLeafProcess = (
    from: string,
    transitions: Transition[],
    guards: Map<string, string>,
): string => `${from} =\n${transitions.map((t) => formatLeafBranch(t, guards)).join("\n  []\n")}`;

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
const formatCompletionBranch = (t: Transition, guards: Map<string, string>): string => {
    const guard = t.label.guard ? `${resolveGuard(t.label.guard, guards)} & ` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    return `${guard}${actionsPrefix(t.label.actions)}${to}`;
};

// Triggered external transition from a composite (event != null). Becomes
// the branch inside the interrupt operator `/\\ (...)`.
const formatTriggeredBranch = (t: Transition, guards: Map<string, string>): string => {
    const event = t.label.event ?? "tau";
    const guard = t.label.guard ? ` & ${resolveGuard(t.label.guard, guards)}` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    return `${event}${guard}${actionsSuffix(t.label.actions)} -> ${to}`;
};

// Render a composite state as a CSPm process:
//   Composite = body [; completion-choice] [/\\ triggered-choice]
// where
//   body              = R1 ||| R2 ||| ...   (one entry per orthogonal region; hierarchical = R1)
//   completion-choice = c1 [] c2 [] ...     (completion transitions, event == null)
//   triggered-choice  = t1 [] t2 [] ...     (triggered transitions, event != null)
// Parens are inserted so CSPm precedence (`;` tighter than `|||`, `/\\` looser
// than `;`) does not silently change the grouping.
const formatComposite = (
    c: Composite,
    outer: Transition[],
    guards: Map<string, string>,
): string => {
    const entries = c.regions.map(regionEntry);
    const orthogonal = entries.length > 1;
    const body = orthogonal ? entries.join(" ||| ") : (entries[0] ?? "SKIP");

    const completion = outer.filter((t) => t.label.event === null);
    const triggered = outer.filter((t) => t.label.event !== null);

    let core = body;

    if (completion.length > 0) {
        const completionStr = completion
            .map((t) => formatCompletionBranch(t, guards))
            .join(" [] ");
        const bodyExpr = orthogonal ? `(${body})` : body;
        core = `${bodyExpr} ; ${completionStr}`;
    }

    if (triggered.length > 0) {
        const triggeredStr = triggered
            .map((t) => formatTriggeredBranch(t, guards))
            .join(" [] ");
        const coreExpr = completion.length > 0 || orthogonal ? `(${core})` : core;
        core = `${coreExpr} /\\ (${triggeredStr})`;
    }

    return `${c.id} = ${core}`;
};

// 共有変数を CSPm 冒頭の定数定義 (初期値 0) として出力する。空配列なら "" を返す。
// ユーザは生成された CSPm を編集して値を変えることでシナリオを切り替える。
const formatStateVars = (stateVars: string[]): string => {
    if (stateVars.length === 0) return "";
    const header = "-- specforge: state variables (default: 0; edit to verify scenarios)";
    const decls = stateVars.map((v) => `${v} = 0`).join("\n");
    return `${header}\n${decls}\n\n`;
};

/**
 * {@link Diagram} から CSPm (FDR4 入力) 文字列を生成する。
 *
 * 出力構造:
 * - 冒頭: `stateVars` で指定された変数の `<name> = 0` 定数定義 (空配列なら省略)
 * - 各 leaf state (transition の `from`): `State = ev -> act -> Next [] ...`
 * - 各 composite state: `Composite = (R1 ||| R2) [; 完了遷移] [/\\ triggered]`
 *   - orthogonal region は `|||` で並列合成
 *   - 階層 composite (region 1 つ) は entry process を inline
 *   - composite 外への完了遷移 (`: / action`) は `;` で sequential 接続
 *   - composite 外への triggered 遷移は `/\\` (interrupt) で包む
 *
 * `guards` 辞書を渡すと、`[catalog_ok]` のような guard タグが対応する CSPm 式
 * (例: `catalog_size > 0`) に置換される。辞書に無いタグは verbatim を維持。
 * 辞書は `.md` 入力時に {@link "./spec_doc.ts"} の preprocess が抽出する。
 *
 * 現状の制約 (`docs/spec.md` §7、`CLAUDE.md` "Pending" 参照):
 * - 状態変数はトップレベル定数として宣言されるが、プロセスパラメータとして thread されない
 *   (= シナリオごとに生成 CSPm の値を手で書き換える必要あり、Phase 3 で対応予定)
 *
 * @param diagram   - パース済みの AST
 * @param guards    - ガードタグ → CSPm 式 の辞書 (省略時は置換無し)
 * @param stateVars - 共有変数名のリスト (省略時は宣言を emit しない)
 * @returns プロセス定義群を `\n\n` 区切りで連結した CSPm 文字列
 */
export const generateCspm = (
    diagram: Diagram,
    guards: Map<string, string> = new Map(),
    stateVars: string[] = [],
): string => {
    const { transitions, composites } = collectAll(diagram.regions);
    const byFrom = groupByFrom(transitions);

    const processes: string[] = [];

    for (const [id, composite] of composites) {
        const outer = byFrom.get(id) ?? [];
        processes.push(formatComposite(composite, outer, guards));
    }

    for (const [from, ts] of byFrom) {
        if (isPseudoState(from)) continue;
        if (composites.has(from)) continue;
        processes.push(formatLeafProcess(from, ts, guards));
    }

    return formatStateVars(stateVars) + processes.join("\n\n");
};
