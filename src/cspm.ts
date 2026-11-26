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

/** 入れ子の領域も含めて遷移を列挙し、複合状態を ID から引けるようにする。 */
function collectAll(regions: Region[]): Collected {
    const transitions: Transition[] = [];
    const composites = new Map<string, Composite>();
    /** 複合状態の本体を深さ優先でたどり、遷移と複合状態を外側の収集結果に追加する。 */
    function walk(rs: Region[]): void {
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
    }
    walk(regions);
    return { transitions, composites };
}

/** 同じ状態から出る遷移を、仕様に現れる順序でまとめる。 */
function groupByFrom(transitions: Transition[]): Map<string, Transition[]> {
    const result = new Map<string, Transition[]>();
    for (const t of transitions) {
        const arr = result.get(t.from);
        if (arr) arr.push(t);
        else result.set(t.from, [t]);
    }
    return result;
}

/** アクションのチャネル宣言に使う先頭の識別子を取り出す。識別子で始まらなければ元の文字列を返す。 */
function bareIdent(s: string): string {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(s);
    return m ? m[1] : s;
}

/** ペイロードを持つイベントを型付きチャネルに分ける。イベントと同名のアクションは二重に宣言しない。 */
function collectChannels(
    diagram: Diagram,
    eventPayloads: Map<string, string[]>,
): Channels {
    const events = new Set<string>();
    const actions = new Set<string>();
    /** 入れ子の遷移もたどり、イベント名とアクションの先頭識別子を別々の集合に集める。 */
    function walk(rs: Region[]): void {
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
    }
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
}

/** CSPm のチャネル宣言を生成する。型付きチャネルがある場合だけ、その値域 `VAL` を `0..bound` として宣言する。 */
function formatChannelDecls(channels: Channels, bound: number): string {
    if (channels.typed.length === 0 && channels.untyped.length === 0) return "";
    const lines = ["-- specforge: event / action channels"];
    if (channels.typed.length > 0) lines.push(`nametype VAL = {0..${bound}}`);
    for (const u of channels.untyped) lines.push(`channel ${u}`);
    for (const t of channels.typed) {
        const type = t.fields.map(() => "VAL").join(".");
        lines.push(`channel ${t.name} : ${type}  -- payload: [${t.fields.join(", ")}]`);
    }
    return lines.join("\n") + "\n\n";
}

/** 状態変数をプロセスの実引数にする。状態変数がない場合と `SKIP` には引数を付けない。 */
function invokeProcess(name: string, stateVars: string[]): string {
    if (name === "SKIP" || stateVars.length === 0) return name;
    return `${name}(${stateVars.join(", ")})`;
}

/** ガード名に対応する式を返す。辞書にない場合は入力をそのまま CSPm の式として使う。 */
function resolveGuard(raw: string, guards: Map<string, string>): string {
    return guards.get(raw) ?? raw;
}

/** 遷移先の手前にアクションを入力順に `->` でつなぐ。アクションがなければ遷移先だけを返す。 */
function formatActionsToTarget(actions: string[], to: string): string {
    return actions.length > 0 ? `${actions.join(" -> ")} -> ${to}` : to;
}

/**
 * 遷移を CSPm の選択肢に変換する。ペイロードがある場合はイベントで値を束縛してからガードを評価し、値を遷移先に渡す。
 * 通常のイベントではガードを先に評価する。イベントがなければ接頭辞を省略する。
 */
function formatBranch(
    t: Transition,
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
    stateVars: string[],
    indent: string,
): string {
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
}

/** 同じ状態から出る各遷移を外部選択 `[]` で結び、葉状態のプロセス定義を組み立てる。 */
function formatLeafProcess(
    from: string,
    transitions: Transition[],
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
    stateVars: string[],
): string {
    const lhs = invokeProcess(from, stateVars);
    const branches = transitions
        .map((t) => formatBranch(t, guards, eventPayloads, stateVars, "  "))
        .join("\n  []\n");
    return `${lhs} =\n${branches}`;
}

/** 領域の `[*]` から出る最初の遷移の行き先を返す。入口がなければ `SKIP` を使う。 */
function regionEntry(region: Region): string {
    for (const stmt of region.stmts) {
        if (stmt.kind === "transition" && isPseudoState(stmt.from)) return stmt.to;
    }
    return "SKIP";
}

/** 複合状態の本体が終了した後に実行する、ガードとアクション付きの完了遷移を生成する。 */
function formatCompletionBranch(
    t: Transition,
    guards: Map<string, string>,
    stateVars: string[],
): string {
    const guard = t.label.guard ? `(${resolveGuard(t.label.guard, guards)}) & ` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    const toInvocation = invokeProcess(to, stateVars);
    return `${guard}${formatActionsToTarget(t.label.actions, toInvocation)}`;
}

/** 直交領域を `|||` で並行合成する。完了遷移は本体の後に続け、イベントによる退出は割り込みとして組み込む。 */
function formatComposite(
    c: Composite,
    outer: Transition[],
    guards: Map<string, string>,
    eventPayloads: Map<string, string[]>,
    stateVars: string[],
): string {
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
}

/** 最上位の領域で `[*]` から出る最初の遷移を探す。複合状態の内部にある入口は対象外とする。 */
function findInitialTransition(diagram: Diagram): Transition | null {
    for (const region of diagram.regions) {
        for (const stmt of region.stmts) {
            if (stmt.kind === "transition" && isPseudoState(stmt.from)) return stmt;
        }
    }
    return null;
}

/**
 * 状態変数と初期遷移が揃っていれば、各変数を 0 にして `Spec` を開始する。
 * 初期遷移のアクションは実行し、イベントは待たない。
 */
function formatEntryPoint(diagram: Diagram, stateVars: string[]): string {
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
}

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
export function generateCspm(
    diagram: Diagram,
    guards: Map<string, string> = new Map(),
    stateVars: string[] = [],
    eventPayloads: Map<string, string[]> = new Map(),
    bound: number = 1,
): string {
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
}
