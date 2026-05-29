import { isPseudoState } from "./types.ts";
import type { Diagram, Region, Stmt } from "./types.ts";
import { exhaustive } from "./util.ts";

type Transition = Extract<Stmt, { kind: "transition" }>;
type Composite = Extract<Stmt, { kind: "composite" }>;

type Collected = {
    transitions: Transition[];
    composites: Map<string, Composite>;
};

type Channels = {
    typed: Array<{ name: string; fields: string[] }>;
    untyped: string[];
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

// `name(arg1, arg2)` 等から先頭の識別子部分のみ取り出す。channel 宣言用。
const bareIdent = (s: string): string => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(s);
    return m ? m[1] : s;
};

// diagram 全体からチャネル化が必要な名前を収集する。
// event 名 + action 名 (bare 部分) を集める。null event は省略 (CSPm では prefix 不要)。
const collectChannels = (
    diagram: Diagram,
    eventPayloads: Map<string, string[]>,
): Channels => {
    const events = new Set<string>();
    const actions = new Set<string>();
    const walk = (rs: Region[]): void => {
        for (const region of rs) {
            for (const stmt of region.stmts) {
                if (stmt.kind === "transition") {
                    if (stmt.label.event !== null) events.add(stmt.label.event);
                    for (const a of stmt.label.actions) actions.add(bareIdent(a));
                } else if (stmt.kind === "composite") {
                    walk(stmt.regions);
                }
            }
        }
    };
    walk(diagram.regions);

    const typed: Array<{ name: string; fields: string[] }> = [];
    const untyped: string[] = [];

    for (const ev of events) {
        const fields = eventPayloads.get(ev) ?? [];
        if (fields.length > 0) typed.push({ name: ev, fields });
        else untyped.push(ev);
    }
    for (const a of actions) {
        if (!events.has(a)) untyped.push(a);
    }
    return { typed, untyped };
};

const NAMETYPE_BOUND = "nametype VAL = {0..1}";

// 冒頭に emit する channel 宣言ブロック。空なら "" を返す。
// 型付き event は nametype VAL を共用 (検証用に値域を小さく保つ)。
const formatChannelDecls = (channels: Channels): string => {
    if (channels.typed.length === 0 && channels.untyped.length === 0) return "";
    const lines = ["-- specforge: event / action channels"];
    if (channels.typed.length > 0) lines.push(NAMETYPE_BOUND);
    for (const u of channels.untyped) lines.push(`channel ${u}`);
    for (const t of channels.typed) {
        const type = t.fields.map(() => "VAL").join(".");
        lines.push(`channel ${t.name} : ${type}  -- payload: [${t.fields.join(", ")}]`);
    }
    return lines.join("\n") + "\n\n";
};

// 共有変数を CSPm 冒頭の定数定義 (初期値 0) として出力する。空配列なら "" を返す。
const formatStateVars = (stateVars: string[]): string => {
    if (stateVars.length === 0) return "";
    const header = "-- specforge: state variables (default: 0; edit to verify scenarios)";
    const decls = stateVars.map((v) => `${v} = 0`).join("\n");
    return `${header}\n${decls}\n\n`;
};

// ガードタグを辞書で式に置換。辞書に無いタグは verbatim を返す。
const resolveGuard = (raw: string, guards: Map<string, string>): string => guards.get(raw) ?? raw;

// `["a", "b"]` + to="X" → "a -> b -> X"。空配列なら to のみ。
const formatActionsToTarget = (actions: string[], to: string): string =>
    actions.length > 0 ? `${actions.join(" -> ")} -> ${to}` : to;

// イベント prefix を返す。payload があれば `event?f1.f2`、無ければ event 名そのまま。
const formatEventPrefix = (event: string, eventPayloads: Map<string, string[]>): string => {
    const payload = eventPayloads.get(event);
    if (!payload || payload.length === 0) return event;
    return `${event}?${payload.join(".")}`;
};

// 1 つの遷移を `[indent](guard) & event_prefix -> action_chain -> target` の形に整える。
//
// CSPm 上のセマンティクス選択:
// - 通常イベント (payload 無し) + guard: `(guard) & event -> ...` (pre-event guard、標準形)
// - payload event + guard: `event?p.q -> (guard) & ...` (binding が guard より前に来る必要)
// - event 無し (内部遷移 / 完了): event prefix を省略 (`tau` は出さない)
const formatBranch = (
    t: Transition,
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
    indent: string,
): string => {
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    const guardWrapped = t.label.guard ? `(${resolveGuard(t.label.guard, guards)}) & ` : "";
    const targetChain = formatActionsToTarget(t.label.actions, to);
    const event = t.label.event;

    if (event === null) {
        return `${indent}${guardWrapped}${targetChain}`;
    }

    const payload = eventPayloads.get(event);
    if (payload && payload.length > 0) {
        const prefix = formatEventPrefix(event, eventPayloads);
        return `${indent}${prefix} -> ${guardWrapped}${targetChain}`;
    }

    return `${indent}${guardWrapped}${event} -> ${targetChain}`;
};

const formatLeafProcess = (
    from: string,
    transitions: Transition[],
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
): string =>
    `${from} =\n${
        transitions.map((t) => formatBranch(t, guards, eventPayloads, "  "))
            .join("\n  []\n")
    }`;

// `[*] --> X` inside a region marks X as the region entry. ill-formed input
// (no entry transition) falls back to SKIP so codegen doesn't crash.
const regionEntry = (region: Region): string => {
    for (const stmt of region.stmts) {
        if (stmt.kind === "transition" && isPseudoState(stmt.from)) return stmt.to;
    }
    return "SKIP";
};

// Completion transition from a composite (event == null). The body SKIPs first,
// then this branch runs in sequence after `;`.
const formatCompletionBranch = (t: Transition, guards: Map<string, string>): string => {
    const guard = t.label.guard ? `(${resolveGuard(t.label.guard, guards)}) & ` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    return `${guard}${formatActionsToTarget(t.label.actions, to)}`;
};

// Render a composite state as a CSPm process:
//   Composite = body [; completion-choice] [/\\ triggered-choice]
const formatComposite = (
    c: Composite,
    outer: Transition[],
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
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
            .map((t) => formatBranch(t, guards, eventPayloads, ""))
            .join(" [] ");
        const coreExpr = completion.length > 0 || orthogonal ? `(${core})` : core;
        core = `${coreExpr} /\\ (${triggeredStr})`;
    }

    return `${c.id} = ${core}`;
};

/**
 * {@link Diagram} から CSPm (FDR4 入力) 文字列を生成する。
 *
 * 出力構造:
 * 1. channel 宣言ブロック: diagram 中の event / action を全て CSP channel として宣言。
 *    `eventPayloads` に登録された event は `channel ev : VAL.VAL` 形式で型付き、それ以外は
 *    `channel ev` で untyped。
 * 2. 状態変数ブロック: `stateVars` で指定された変数の `<name> = 0` 定数定義 (空配列なら省略)。
 * 3. プロセス定義群:
 *    - 各 leaf state: `State = (guard) & event -> action -> Next [] ...`
 *      (`event?p.q -> ...` 形式は payload event のみ。guard binding 順序の都合で post-event)
 *    - 各 composite state: `Composite = (R1 ||| R2) [; 完了] [/\\ triggered]`
 *
 * 詳細セマンティクス:
 * - `guards` 辞書: guard タグを CSPm 式に置換 (例: `catalog_ok` → `catalog_size > 0`)
 * - `stateVars`: 参照変数の初期値 (グローバル定数)
 * - `eventPayloads`: event → payload field 列。payload event は受信パターン `?f1.f2` に変換
 *   され、続く guard / action から bound 名を参照可能
 *
 * 現状の制約 (`docs/spec.md` §7、`CLAUDE.md` "Pending" 参照):
 * - 状態変数のプロセス間 thread は未対応 (event payload で受け取った値は次状態に渡らない)
 * - 引数付き action (`write(item_id)` 等) は verbatim 出力、channel decl は bare 名のみ
 *
 * @param diagram       - パース済みの AST
 * @param guards        - ガードタグ → CSPm 式 の辞書 (省略時は置換無し)
 * @param stateVars     - 共有変数名のリスト (省略時は宣言を emit しない)
 * @param eventPayloads - event → payload field 名のリスト (省略時は全 event untyped)
 * @returns 各セクションを `\n\n` 区切りで連結した CSPm 文字列
 */
export const generateCspm = (
    diagram: Diagram,
    guards: Map<string, string> = new Map(),
    stateVars: string[] = [],
    eventPayloads: Map<string, string[]> = new Map(),
): string => {
    const { transitions, composites } = collectAll(diagram.regions);
    const byFrom = groupByFrom(transitions);

    const processes: string[] = [];

    for (const [id, composite] of composites) {
        const outer = byFrom.get(id) ?? [];
        processes.push(formatComposite(composite, outer, guards, eventPayloads));
    }

    for (const [from, ts] of byFrom) {
        if (isPseudoState(from)) continue;
        if (composites.has(from)) continue;
        processes.push(formatLeafProcess(from, ts, guards, eventPayloads));
    }

    const channels = collectChannels(diagram, eventPayloads);
    return (
        formatChannelDecls(channels) +
        formatStateVars(stateVars) +
        processes.join("\n\n")
    );
};
