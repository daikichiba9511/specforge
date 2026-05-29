import { isPseudoState } from "./types.ts";
import type { Diagram, Region, Stmt } from "./types.ts";

type Transition = Extract<Stmt, { kind: "transition" }>;
type Composite = Extract<Stmt, { kind: "composite" }>;

// 各 transition が「トップレベル」か「composite C の region #N」のどちらに属するか。
// region 内部の遷移と top-level の遷移では emit 形が違うので区別が必要。
type TransitionContext =
    | { kind: "top" }
    | { kind: "region"; compositeId: string; regionIdx: number };

type Located<T> = { t: T; context: TransitionContext };

type Analysis = {
    transitions: Located<Transition>[];
    composites: Map<string, Composite>;
    topStates: Set<string>; // phase 変数が取りうる値の集合 (leaf + composite ID)
    regionEntries: Map<string, string>; // key: `${compositeId}:${regionIdx}` → 入口 state 名
};

// 状態機械全体を歩いて各 transition の context を確定する。
const analyze = (diagram: Diagram): Analysis => {
    const transitions: Located<Transition>[] = [];
    const composites = new Map<string, Composite>();
    const topStates = new Set<string>();
    const regionEntries = new Map<string, string>();

    const recur = (regions: Region[], parent: string | null): void => {
        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];
            const context: TransitionContext = parent === null
                ? { kind: "top" }
                : { kind: "region", compositeId: parent, regionIdx: i };

            if (context.kind === "region") {
                for (const stmt of region.stmts) {
                    if (stmt.kind === "transition" && isPseudoState(stmt.from)) {
                        regionEntries.set(
                            `${context.compositeId}:${context.regionIdx}`,
                            stmt.to,
                        );
                        break;
                    }
                }
            }

            for (const stmt of region.stmts) {
                if (stmt.kind === "transition") {
                    transitions.push({ t: stmt, context });
                    if (context.kind === "top") {
                        if (!isPseudoState(stmt.from)) topStates.add(stmt.from);
                        if (!isPseudoState(stmt.to)) topStates.add(stmt.to);
                    }
                } else if (stmt.kind === "composite") {
                    composites.set(stmt.id, stmt);
                    if (context.kind === "top") topStates.add(stmt.id);
                    recur(stmt.regions, stmt.id);
                } else if (stmt.kind === "alias") {
                    if (context.kind === "top") topStates.add(stmt.id);
                }
            }
        }
    };

    recur(diagram.regions, null);
    return { transitions, composites, topStates, regionEntries };
};

const findInitialState = (diagram: Diagram): string | null => {
    for (const region of diagram.regions) {
        for (const stmt of region.stmts) {
            if (stmt.kind === "transition" && isPseudoState(stmt.from)) return stmt.to;
        }
    }
    return null;
};

// トップレベルの非疑似 from から非疑似 to への通常遷移を全て拾い、
// `--> [*]` で完了する from を terminal とみなす。
const collectTerminalStates = (analysis: Analysis): Set<string> => {
    const terminal = new Set<string>();
    for (const { t, context } of analysis.transitions) {
        if (context.kind !== "top") continue;
        if (isPseudoState(t.to) && !isPseudoState(t.from)) terminal.add(t.from);
    }
    return terminal;
};

// CSPm/C 風の演算子 (`==`, `!=`, `&&`, `||`) を TLA+ 流 (`=`, `/=`, `/\\`, `\\/`) に置換する。
// 単純な文字列置換なので、文字列リテラル内に `==` 等が含まれるエッジケースには弱い。
const toTlaOperators = (expr: string): string =>
    expr
        .replace(/!=/g, "/=")
        .replace(/==/g, "=")
        .replace(/&&/g, "/\\")
        .replace(/\|\|/g, "\\/");

const resolveGuard = (raw: string, guards: Map<string, string>): string =>
    toTlaOperators(guards.get(raw) ?? raw);

// composite C, region N に対応する region phase 変数名。
const regionVarName = (compositeId: string, regionIdx: number): string =>
    `${compositeId.toLowerCase()}_r${regionIdx}`;

// composite の region 変数を全て列挙する (出力順を安定化させるため id でソート)。
const allRegionVars = (composites: Map<string, Composite>): string[] => {
    const result: string[] = [];
    const ids = Array.from(composites.keys()).sort();
    for (const id of ids) {
        const c = composites.get(id)!;
        for (let i = 0; i < c.regions.length; i++) {
            result.push(regionVarName(id, i));
        }
    }
    return result;
};

// 文字列のサニタイズ: action 名に使える形に。`[*]` などの記号を Final 等に置換。
const sanitize = (s: string): string =>
    s.replace(/\[\*\]/g, "Final").replace(/[^A-Za-z0-9_]/g, "_");

// action 名を作る。重複は suffix `_2`, `_3`, ... を付ける。
const uniqueName = (base: string, used: Map<string, number>): string => {
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
};

const REGION_DONE = `"_done"`;
const REGION_INACTIVE = `"_inactive"`;

type EmitContext = {
    stateVars: string[];
    regionVars: string[]; // 全 composite の全 region 変数 (ソート済)
    composites: Map<string, Composite>;
    guards: Map<string, string>;
    used: Map<string, number>;
};

// composite C に入る遷移の action body: phase を C に、C の各 region を entry 状態に初期化、
// 他の region は inactive 維持、state var は UNCHANGED。
const formatEnterCompositeAction = (
    t: Transition,
    targetComposite: string,
    ctx: EmitContext,
    regionEntries: Map<string, string>,
): string => {
    const parts: string[] = [`/\\ phase = "${t.from}"`];
    if (t.label.guard) parts.push(`/\\ ${resolveGuard(t.label.guard, ctx.guards)}`);
    parts.push(`/\\ phase' = "${targetComposite}"`);

    const target = ctx.composites.get(targetComposite)!;
    const initRegions: string[] = [];
    for (let i = 0; i < target.regions.length; i++) {
        const entry = regionEntries.get(`${targetComposite}:${i}`) ?? "_inactive";
        const varName = regionVarName(targetComposite, i);
        parts.push(`/\\ ${varName}' = "${entry}"`);
        initRegions.push(varName);
    }
    const unchangedRegions = ctx.regionVars.filter((r) => !initRegions.includes(r));
    const unchanged = [...ctx.stateVars, ...unchangedRegions];
    if (unchanged.length > 0) parts.push(`/\\ UNCHANGED <<${unchanged.join(", ")}>>`);
    return parts.map((p) => `    ${p}`).join("\n");
};

// composite C から外への遷移の action body: phase を to に、C の region を inactive にリセット。
// 完了遷移 (event === null) なら C の全 region が "_done" であることを precondition に追加。
const formatExitCompositeAction = (
    t: Transition,
    sourceComposite: string,
    ctx: EmitContext,
): string => {
    const parts: string[] = [`/\\ phase = "${sourceComposite}"`];

    const source = ctx.composites.get(sourceComposite)!;
    const isCompletion = t.label.event === null;
    if (isCompletion) {
        for (let i = 0; i < source.regions.length; i++) {
            const v = regionVarName(sourceComposite, i);
            parts.push(`/\\ ${v} = ${REGION_DONE}`);
        }
    }
    if (t.label.guard) parts.push(`/\\ ${resolveGuard(t.label.guard, ctx.guards)}`);
    parts.push(`/\\ phase' = "${isPseudoState(t.to) ? "FINAL" : t.to}"`);

    const resetRegions: string[] = [];
    for (let i = 0; i < source.regions.length; i++) {
        const v = regionVarName(sourceComposite, i);
        parts.push(`/\\ ${v}' = ${REGION_INACTIVE}`);
        resetRegions.push(v);
    }
    const unchangedRegions = ctx.regionVars.filter((r) => !resetRegions.includes(r));
    const unchanged = [...ctx.stateVars, ...unchangedRegions];
    if (unchanged.length > 0) parts.push(`/\\ UNCHANGED <<${unchanged.join(", ")}>>`);
    return parts.map((p) => `    ${p}`).join("\n");
};

// region 内部の遷移の action body: 親 composite の phase + 自 region phase の更新のみ。
// to が [*] なら region 完了として `_done` に。
const formatRegionAction = (
    t: Transition,
    compositeId: string,
    regionIdx: number,
    ctx: EmitContext,
): string => {
    const regionVar = regionVarName(compositeId, regionIdx);
    const parts: string[] = [
        `/\\ phase = "${compositeId}"`,
        `/\\ ${regionVar} = "${t.from}"`,
    ];
    if (t.label.guard) parts.push(`/\\ ${resolveGuard(t.label.guard, ctx.guards)}`);
    const newRegionValue = isPseudoState(t.to) ? REGION_DONE : `"${t.to}"`;
    parts.push(`/\\ ${regionVar}' = ${newRegionValue}`);

    const otherRegions = ctx.regionVars.filter((r) => r !== regionVar);
    const unchanged = ["phase", ...ctx.stateVars, ...otherRegions];
    if (unchanged.length > 0) parts.push(`/\\ UNCHANGED <<${unchanged.join(", ")}>>`);
    return parts.map((p) => `    ${p}`).join("\n");
};

// 通常のトップレベル間遷移 (composite を介さない) の action body。
const formatTopAction = (t: Transition, ctx: EmitContext): string => {
    const parts: string[] = [`/\\ phase = "${t.from}"`];
    if (t.label.guard) parts.push(`/\\ ${resolveGuard(t.label.guard, ctx.guards)}`);
    parts.push(`/\\ phase' = "${t.to}"`);
    const unchanged = [...ctx.stateVars, ...ctx.regionVars];
    if (unchanged.length > 0) parts.push(`/\\ UNCHANGED <<${unchanged.join(", ")}>>`);
    return parts.map((p) => `    ${p}`).join("\n");
};

const formatStateSet = (states: Set<string>): string =>
    `{${Array.from(states).map((s) => `"${s}"`).join(", ")}}`;

/**
 * {@link Diagram} から TLA+ (TLC 入力) 文字列を生成する (Phase A + B)。
 *
 * 構造:
 * 1. `MODULE <moduleName>` ヘッダ
 * 2. `VARIABLES phase, <state_vars>, <region_vars>` 宣言。region 変数は composite ごとに
 *    `<composite_id>_r<N>` で命名 (例: `parallelsetup_r0`)。region 変数は
 *    `"_inactive"` (外部) / 入口 state 名 (進行中) / `"_done"` (完了) のいずれかを取る
 * 3. `Init`: 初期 state (`[*] --> X`) + 各 state var = 0 + 全 region 変数 `_inactive`。
 *    初期 state が composite なら region 変数も入口 state に
 * 4. 各 transition を context に応じて action として emit:
 *    - top → top: `phase = From /\ guard /\ phase' = To /\ UNCHANGED <<other vars>>`
 *    - top → composite: 上記 + composite の region 変数を入口 state に init
 *    - composite → top (完了遷移、event=null): 全 region が `_done` を precondition、
 *      region を `_inactive` にリセット
 *    - composite → top (triggered、event!=null): event に応じて発火、region をリセット
 *    - region 内部: `phase = composite /\ region_var = From /\ region_var' = To`
 *    - region → `[*]`: region_var を `_done` に
 * 5. `Stutter == phase \in TerminalStates /\ UNCHANGED vars` (TLC deadlock 検出を回避)
 * 6. `Next == \/ action1 \/ ... \/ Stutter`
 * 7. `Spec == Init /\ [][Next]_vars`
 *
 * 現状の制約 (Phase 2+ で対応予定):
 * - event payload binding 未対応 (state var は遷移で UNCHANGED 固定)
 * - 入れ子 composite (composite 内の composite) は未検証
 * - action の semantics は無視 (TLA+ 上に乗らない)
 *
 * @param diagram     - パース済みの AST
 * @param guards      - ガードタグ → TLA+ 式 の辞書 (省略時は置換無し)
 * @param stateVars   - state var 名のリスト (省略時は phase のみ)
 * @param moduleName  - MODULE 名 (省略時 "Spec")
 */
export const generateTla = (
    diagram: Diagram,
    guards: Map<string, string> = new Map(),
    stateVars: string[] = [],
    moduleName: string = "Spec",
): string => {
    const analysis = analyze(diagram);
    const initialState = findInitialState(diagram);
    const terminal = collectTerminalStates(analysis);

    const regionVars = allRegionVars(analysis.composites);
    const allVars = ["phase", ...stateVars, ...regionVars];
    const varsTuple = `<<${allVars.join(", ")}>>`;

    const ctx: EmitContext = {
        stateVars,
        regionVars,
        composites: analysis.composites,
        guards,
        used: new Map(),
    };

    const lines: string[] = [];
    lines.push(`---- MODULE ${moduleName} ----`);
    lines.push("");
    lines.push("EXTENDS Naturals");
    lines.push("");
    if (allVars.length === 1) lines.push(`VARIABLE phase`);
    else lines.push(`VARIABLES ${allVars.join(", ")}`);
    lines.push("");
    lines.push(`vars == ${varsTuple}`);
    lines.push("");

    if (analysis.topStates.size > 0) {
        lines.push(`States == ${formatStateSet(analysis.topStates)}`);
    }
    if (terminal.size > 0) {
        lines.push(`TerminalStates == ${formatStateSet(terminal)}`);
    }
    lines.push("");

    // Init
    const initParts: string[] = [];
    if (initialState !== null) {
        initParts.push(`/\\ phase = "${initialState}"`);
    } else {
        initParts.push(`/\\ phase = "UNDEFINED"  \\* no [*] --> Initial found`);
    }
    for (const v of stateVars) initParts.push(`/\\ ${v} = 0`);
    // region 変数は基本 _inactive、ただし initialState が composite なら入口で起動
    const initialCompositeId = initialState !== null && analysis.composites.has(initialState)
        ? initialState
        : null;
    for (const rv of regionVars) {
        if (initialCompositeId !== null) {
            const prefix = `${initialCompositeId.toLowerCase()}_r`;
            if (rv.startsWith(prefix)) {
                const idx = parseInt(rv.substring(prefix.length), 10);
                const entry = analysis.regionEntries.get(`${initialCompositeId}:${idx}`) ??
                    "_inactive";
                initParts.push(`/\\ ${rv} = "${entry}"`);
                continue;
            }
        }
        initParts.push(`/\\ ${rv} = ${REGION_INACTIVE}`);
    }
    lines.push(`Init ==`);
    for (const p of initParts) lines.push(`    ${p}`);
    lines.push("");

    // Actions
    const actionNames: string[] = [];
    for (const { t, context } of analysis.transitions) {
        if (isPseudoState(t.from)) continue; // initial transitions handled by Init

        if (context.kind === "region") {
            // region 内部の遷移 (Inner --> Inner or Inner --> [*])
            const base = sanitize(
                `${context.compositeId}_r${context.regionIdx}_${t.from}_${t.label.event ?? "tau"}_${
                    isPseudoState(t.to) ? "done" : t.to
                }`,
            );
            const name = uniqueName(base, ctx.used);
            actionNames.push(name);
            lines.push(`${name} ==`);
            lines.push(formatRegionAction(t, context.compositeId, context.regionIdx, ctx));
            lines.push("");
            continue;
        }

        // context は top
        if (isPseudoState(t.to)) continue; // top → [*] は Stutter で処理

        const fromIsComposite = analysis.composites.has(t.from);
        const toIsComposite = analysis.composites.has(t.to);

        const baseName = sanitize(`${t.from}_${t.label.event ?? "tau"}_${t.to}`);
        const name = uniqueName(baseName, ctx.used);
        actionNames.push(name);
        lines.push(`${name} ==`);

        if (fromIsComposite && !toIsComposite) {
            lines.push(formatExitCompositeAction(t, t.from, ctx));
        } else if (!fromIsComposite && toIsComposite) {
            lines.push(formatEnterCompositeAction(t, t.to, ctx, analysis.regionEntries));
        } else if (fromIsComposite && toIsComposite) {
            // 入れ子 / composite 間: まず source を reset、次に target を init。
            // 単純実装として exit と enter の合成形を inline。
            const exitBody = formatExitCompositeAction(t, t.from, ctx);
            // exit body にはすでに phase' = t.to が入っているので、target が composite なら
            // 追加で region init が必要。手抜き実装として exit のみ採用 (composite→composite は
            // hitl に出ないので Phase B v1 ではこの制限を受け入れる)。
            lines.push(exitBody);
        } else {
            lines.push(formatTopAction(t, ctx));
        }
        lines.push("");
    }

    // Stutter
    if (terminal.size > 0) {
        lines.push(`Stutter ==`);
        lines.push(`    /\\ phase \\in TerminalStates`);
        lines.push(`    /\\ UNCHANGED vars`);
        lines.push("");
    }

    const branches = [...actionNames];
    if (terminal.size > 0) branches.push("Stutter");
    if (branches.length === 0) {
        lines.push(`Next == FALSE  \\* no transitions`);
    } else if (branches.length === 1) {
        lines.push(`Next == ${branches[0]}`);
    } else {
        lines.push(`Next ==`);
        for (const b of branches) lines.push(`    \\/ ${b}`);
    }
    lines.push("");

    lines.push(`Spec == Init /\\ [][Next]_vars`);
    lines.push("");

    lines.push(`\\* Properties — enable in .cfg to check:`);
    lines.push(`\\* INVARIANT: phase \\in States`);
    if (terminal.size > 0) {
        lines.push(`\\* PROPERTY:  <>(phase \\in TerminalStates)  \\* termination`);
    }
    lines.push("");

    lines.push(`====`);
    return lines.join("\n");
};
