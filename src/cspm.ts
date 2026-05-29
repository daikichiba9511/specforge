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

const formatChannelDecls = (channels: Channels, bound: number): string => {
    if (channels.typed.length === 0 && channels.untyped.length === 0) return "";
    const lines = ["-- specforge: event / action channels"];
    if (channels.typed.length > 0) lines.push(`nametype VAL = {0..${bound}}`);
    for (const u of channels.untyped) lines.push(`channel ${u}`);
    for (const t of channels.typed) {
        const type = t.fields.map(() => "VAL").join(".");
        lines.push(`channel ${t.name} : ${type}  -- payload: [${t.fields.join(", ")}]`);
    }
    return lines.join("\n") + "\n\n";
};

// プロセス名を `Name(v1, v2, ...)` の invocation 形にする。
// stateVars が空、または name が `SKIP` の場合は素の name を返す。
const invokeProcess = (name: string, stateVars: string[]): string => {
    if (name === "SKIP" || stateVars.length === 0) return name;
    return `${name}(${stateVars.join(", ")})`;
};

// ガードタグを辞書で式に置換。辞書に無いタグは verbatim を返す。
const resolveGuard = (raw: string, guards: Map<string, string>): string => guards.get(raw) ?? raw;

// `["a", "b"]` + to="X" → "a -> b -> X"。空配列なら to のみ。
const formatActionsToTarget = (actions: string[], to: string): string =>
    actions.length > 0 ? `${actions.join(" -> ")} -> ${to}` : to;

// 1 つの遷移を CSPm の 1 ブランチに整える。
//
// セマンティクス:
// - 通常イベント (payload 無し) + guard: `(guard) & event -> ...` (pre-event guard)
// - payload event + guard: `event?p.q -> (guard) & ...` (binding が guard より前)
// - event 無し: prefix を省略 (`tau` は出さない)
// - 遷移先プロセスは {@link invokeProcess} で `Next(v1, v2, ...)` 形に。
//   payload field 名が state var 名と一致する場合は `?` で bind されてシャドウィングが起こり、
//   そのまま `Next(...)` に渡すと自動的に新値が thread される。
const formatBranch = (
    t: Transition,
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
    stateVars: string[],
    indent: string,
): string => {
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    const toInvocation = invokeProcess(to, stateVars);
    const guardWrapped = t.label.guard ? `(${resolveGuard(t.label.guard, guards)}) & ` : "";
    const targetChain = formatActionsToTarget(t.label.actions, toInvocation);
    const event = t.label.event;

    if (event === null) {
        return `${indent}${guardWrapped}${targetChain}`;
    }

    const payload = eventPayloads.get(event);
    if (payload && payload.length > 0) {
        const prefix = `${event}?${payload.join(".")}`;
        return `${indent}${prefix} -> ${guardWrapped}${targetChain}`;
    }

    return `${indent}${guardWrapped}${event} -> ${targetChain}`;
};

const formatLeafProcess = (
    from: string,
    transitions: Transition[],
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
    stateVars: string[],
): string => {
    const lhs = invokeProcess(from, stateVars);
    const branches = transitions
        .map((t) => formatBranch(t, guards, eventPayloads, stateVars, "  "))
        .join("\n  []\n");
    return `${lhs} =\n${branches}`;
};

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
const formatCompletionBranch = (
    t: Transition,
    guards: Map<string, string>,
    stateVars: string[],
): string => {
    const guard = t.label.guard ? `(${resolveGuard(t.label.guard, guards)}) & ` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    const toInvocation = invokeProcess(to, stateVars);
    return `${guard}${formatActionsToTarget(t.label.actions, toInvocation)}`;
};

// Render a composite state as a CSPm process:
//   Composite(v...) = body [; completion-choice] [/\\ triggered-choice]
const formatComposite = (
    c: Composite,
    outer: Transition[],
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
    stateVars: string[],
): string => {
    const entries = c.regions.map((region) => invokeProcess(regionEntry(region), stateVars));
    const orthogonal = entries.length > 1;
    const body = orthogonal ? entries.join(" ||| ") : (entries[0] ?? "SKIP");

    const completion = outer.filter((t) => t.label.event === null);
    const triggered = outer.filter((t) => t.label.event !== null);

    let core = body;

    if (completion.length > 0) {
        const completionStr = completion
            .map((t) => formatCompletionBranch(t, guards, stateVars))
            .join(" [] ");
        const bodyExpr = orthogonal ? `(${body})` : body;
        core = `${bodyExpr} ; ${completionStr}`;
    }

    if (triggered.length > 0) {
        const triggeredStr = triggered
            .map((t) => formatBranch(t, guards, eventPayloads, stateVars, ""))
            .join(" [] ");
        const coreExpr = completion.length > 0 || orthogonal ? `(${core})` : core;
        core = `${coreExpr} /\\ (${triggeredStr})`;
    }

    return `${invokeProcess(c.id, stateVars)} = ${core}`;
};

// トップレベル `[*] --> Initial` 遷移を 1 つ拾う (見つからなければ null)。
// region 内の `[*] -->` (= composite 内 entry) は対象外。
const findInitialTransition = (diagram: Diagram): Transition | null => {
    for (const region of diagram.regions) {
        for (const stmt of region.stmts) {
            if (stmt.kind === "transition" && isPseudoState(stmt.from)) return stmt;
        }
    }
    return null;
};

// `Spec = Initial(0, 0, ...)` の entry point を組み立てる。
// state var が無い、もしくは `[*] -->` が見つからない場合は何も出さない。
// 初期遷移の event は drop (外部トリガと見なす)、action chain は保持。
const formatEntryPoint = (diagram: Diagram, stateVars: string[]): string => {
    if (stateVars.length === 0) return "";
    const init = findInitialTransition(diagram);
    if (!init) return "";
    const initialValues = stateVars.map(() => "0").join(", ");
    const target = isPseudoState(init.to) ? "SKIP" : `${init.to}(${initialValues})`;
    const chain = formatActionsToTarget(init.label.actions, target);
    return [
        "-- specforge: entry point with default initial values (edit to verify scenarios)",
        `Spec = ${chain}`,
        "-- assert Spec :[deadlock free]",
        "",
        "",
    ].join("\n");
};

/**
 * {@link Diagram} から CSPm (FDR4 入力) 文字列を生成する。
 *
 * 出力構造:
 * 1. channel 宣言ブロック: diagram 中の event / action を全て CSP channel として宣言。
 *    `eventPayloads` に登録された event は `channel ev : VAL.VAL` 形式で型付き、それ以外は
 *    `channel ev` で untyped。
 * 2. entry point ブロック (state var あり時のみ): `Spec = Initial(0, 0, ...)` と
 *    assert 用テンプレート。初期遷移 `[*] --> Initial` から target を取り、event は drop、
 *    action chain は保持する。
 * 3. プロセス定義群:
 *    - state var が宣言されていると、全プロセスが `P(v1, v2, ...) = ...` の形で
 *      パラメータ化される。target invocation も `Next(v1, v2, ...)` に展開
 *    - 各 leaf state: `State(v...) = ev -> action -> Next(v...) [] ...`
 *    - 各 composite state: `Composite(v...) = (R1(v...) ||| R2(v...)) [; 完了] [/\\ triggered]`
 *
 * Phase 4 (process parameter threading) のセマンティクス:
 * - event payload field の名前が state var 名と一致する場合、`?` 受信で CSPm のスコープ
 *   シャドウィングが起こり、続く target invocation で新値が自動的に thread される
 * - 一致しない field は branch 内ローカルにのみ bind され、param には伝播しない
 *
 * @param diagram       - パース済みの AST
 * @param guards        - ガードタグ → CSPm 式 の辞書 (省略時は置換無し)
 * @param stateVars     - state var 名のリスト (空なら process はパラメータ化されない)
 * @param eventPayloads - event → payload field 名のリスト
 * @param bound         - `nametype VAL = {0..bound}` の N。typed channel の payload 値域を制御
 *                        (デフォルト 1 = `{0, 1}`)。FDR4 の状態空間に直接影響する
 * @returns 各セクションを `\n\n` 区切りで連結した CSPm 文字列
 */
export const generateCspm = (
    diagram: Diagram,
    guards: Map<string, string> = new Map(),
    stateVars: string[] = [],
    eventPayloads: Map<string, string[]> = new Map(),
    bound: number = 1,
): string => {
    const { transitions, composites } = collectAll(diagram.regions);
    const byFrom = groupByFrom(transitions);

    const processes: string[] = [];

    for (const [id, composite] of composites) {
        const outer = byFrom.get(id) ?? [];
        processes.push(formatComposite(composite, outer, guards, eventPayloads, stateVars));
    }

    for (const [from, ts] of byFrom) {
        if (isPseudoState(from)) continue;
        if (composites.has(from)) continue;
        processes.push(formatLeafProcess(from, ts, guards, eventPayloads, stateVars));
    }

    const channels = collectChannels(diagram, eventPayloads);
    return (
        formatChannelDecls(channels, bound) +
        formatEntryPoint(diagram, stateVars) +
        processes.join("\n\n")
    );
};
