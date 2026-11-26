import { isPseudoState } from "./types.ts";
import type { Diagram, Region, Stmt } from "./types.ts";
import type { LivenessProp } from "./spec_doc.ts";

import { boundStateVarsForTransition, topLevelFlow } from "./transitions.ts";
import type { Transition } from "./transitions.ts";
type Composite = Extract<Stmt, { kind: "composite" }>;

// 各 transition が「トップレベル」か「composite C の region #N」のどちらに属するか。
type TransitionContext =
    | { kind: "top" }
    | { kind: "region"; compositeId: string; regionIdx: number };

/** 生成したアクションに対応する仕様の遷移。状態の表示名は元の領域内で解決する。 */
export type TlaTransition = { t: Transition; context: TransitionContext; region: Region };

type Analysis = {
    transitions: TlaTransition[];
    composites: Map<string, Composite>;
    topStates: Set<string>;
    regionEntries: Map<string, string>; // key: `${compositeId}:${regionIdx}` → 入口 state 名
};

/** 遷移の所属領域、各領域の入口、最上位の状態名を集め、TLA+ の変数とアクションの生成に使う。 */
function analyze(diagram: Diagram): Analysis {
    const transitions: TlaTransition[] = [];
    const composites = new Map<string, Composite>();
    const topStates = new Set<string>();
    const regionEntries = new Map<string, string>();

    /** 領域ごとに最初の入口を記録し、複合状態に入るたびに親の ID を切り替えて子の遷移を収集する。 */
    function recur(regions: Region[], parent: string | null): void {
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
                    transitions.push({ t: stmt, context, region });
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
    }

    recur(diagram.regions, null);
    return { transitions, composites, topStates, regionEntries };
}

/** ガードで使う `==`、`!=`、`&&`、`||` を対応する TLA+ 演算子に置き換える。 */
function toTlaOperators(expr: string): string {
    return expr
        .replace(/!=/g, "/=")
        .replace(/==/g, "=")
        .replace(/&&/g, "/\\")
        .replace(/\|\|/g, "\\/");
}

/** ガード名を辞書で展開し、TLA+ の演算子に変換する。辞書にない入力はそのまま式として変換する。 */
function resolveGuard(raw: string, guards: Map<string, string>): string {
    return toTlaOperators(guards.get(raw) ?? raw);
}

/** ペイロードで更新する状態変数だけを、ガード内で `new_<変数名>` に置き換える。識別子の部分一致は除く。 */
function renameInGuard(expr: string, names: string[]): string {
    let result = expr;
    for (const name of names) {
        const re = new RegExp(`\\b${name}\\b`, "g");
        result = result.replace(re, `new_${name}`);
    }
    return result;
}

/** 小文字にした複合状態 ID と 0 始まりの領域番号から、領域の現在状態を保持する変数名を作る。 */
function regionVarName(compositeId: string, regionIdx: number): string {
    return `${compositeId.toLowerCase()}_r${regionIdx}`;
}

/** 生成順が安定するよう、複合状態 ID の辞書順、次に領域の定義順で変数名を列挙する。 */
function allRegionVars(composites: Map<string, Composite>): string[] {
    const result: string[] = [];
    const ids = Array.from(composites.keys()).sort();
    for (const id of ids) {
        const c = composites.get(id)!;
        for (let i = 0; i < c.regions.length; i++) {
            result.push(regionVarName(id, i));
        }
    }
    return result;
}

/** アクション名に使えるよう、疑似状態 `[*]` を `Final` に、英数字とアンダースコア以外の文字を `_` に置き換える。 */
function sanitize(s: string): string {
    return s.replace(/\[\*\]/g, "Final").replace(/[^A-Za-z0-9_]/g, "_");
}

/** 同じ基本名の使用回数を記録し、2回目以降は `_2`、`_3` のように番号を付ける。 */
function uniqueName(base: string, used: Map<string, number>): string {
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
}

const REGION_DONE = `"_done"`;
const REGION_INACTIVE = `"_inactive"`;

type EmitContext = {
    stateVars: string[];
    regionVars: string[];
    composites: Map<string, Composite>;
    guards: Map<string, string>;
    eventPayloads: Map<string, string[]>;
    used: Map<string, number>;
};

// 1 つの action body を組み立てる共通骨格。
//
// payload binding 有りの場合は `\E new_<var1>, ... \in Domain:` でラップし、guard と
// 引数依存の primed 更新を内側に置く。 binding 無しなら通常の `/\` リスト。
type ActionParts = {
    preconditions: string[]; // 例: `phase = "From"`, `outer_r0 = "A"`
    completionPreconds: string[]; // composite 完了遷移用: `outer_r0 = "_done"` 等
    guard: string | null; // 解決済み (まだ binding rename していない)
    primedUpdates: string[]; // 例: `phase' = "To"`, `outer_r0' = "_done"`
    boundVars: string[]; // event payload と state var の交差
    unchangedVars: string[];
};

/**
 * 遷移条件と次状態の更新を一つのアクションにまとめる。
 * ペイロードで束縛する新値は `Domain` から選び、残りの変数は `UNCHANGED` に含める。
 */
function buildBody(a: ActionParts): string {
    const outer = "    ";
    const inner = "         ";
    const lines: string[] = [];

    for (const p of a.preconditions) lines.push(`${outer}/\\ ${p}`);
    for (const p of a.completionPreconds) lines.push(`${outer}/\\ ${p}`);

    if (a.boundVars.length === 0) {
        if (a.guard) lines.push(`${outer}/\\ ${a.guard}`);
        for (const u of a.primedUpdates) lines.push(`${outer}/\\ ${u}`);
    } else {
        const newVars = a.boundVars.map((v) => `new_${v}`).join(", ");
        lines.push(`${outer}/\\ \\E ${newVars} \\in Domain:`);
        if (a.guard) {
            lines.push(`${inner}/\\ ${renameInGuard(a.guard, a.boundVars)}`);
        }
        for (const u of a.primedUpdates) {
            lines.push(`${inner}/\\ ${u}`);
        }
        for (const v of a.boundVars) {
            lines.push(`${inner}/\\ ${v}' = new_${v}`);
        }
    }

    if (a.unchangedVars.length > 0) {
        lines.push(`${outer}/\\ UNCHANGED <<${a.unchangedVars.join(", ")}>>`);
    }
    return lines.join("\n");
}

/** 最上位の遷移で `phase` とペイロードに対応する状態変数を更新し、すべての領域変数を保持する。 */
function formatTopAction(t: Transition, ctx: EmitContext): string {
    const bound = boundStateVarsForTransition(t, ctx);
    return buildBody({
        preconditions: [`phase = "${t.from}"`],
        completionPreconds: [],
        guard: t.label.guard ? resolveGuard(t.label.guard, ctx.guards) : null,
        primedUpdates: [`phase' = "${t.to}"`],
        boundVars: bound,
        unchangedVars: [
            ...ctx.stateVars.filter((v) => !bound.includes(v)),
            ...ctx.regionVars,
        ],
    });
}

/** 複合状態への遷移では各領域を入口状態に初期化する。入口が指定されていない領域には `_inactive` を設定する。 */
function formatEnterCompositeAction(
    t: Transition,
    targetComposite: string,
    ctx: EmitContext,
    regionEntries: Map<string, string>,
): string {
    const bound = boundStateVarsForTransition(t, ctx);
    const target = ctx.composites.get(targetComposite)!;
    const initRegions: string[] = [];
    const regionInits: string[] = [];
    for (let i = 0; i < target.regions.length; i++) {
        const entry = regionEntries.get(`${targetComposite}:${i}`) ?? "_inactive";
        const v = regionVarName(targetComposite, i);
        regionInits.push(`${v}' = "${entry}"`);
        initRegions.push(v);
    }
    return buildBody({
        preconditions: [`phase = "${t.from}"`],
        completionPreconds: [],
        guard: t.label.guard ? resolveGuard(t.label.guard, ctx.guards) : null,
        primedUpdates: [`phase' = "${targetComposite}"`, ...regionInits],
        boundVars: bound,
        unchangedVars: [
            ...ctx.stateVars.filter((v) => !bound.includes(v)),
            ...ctx.regionVars.filter((r) => !initRegions.includes(r)),
        ],
    });
}

/** 退出する複合状態の領域を非アクティブに戻す。イベントを伴わない完了遷移では、全領域の完了を前提条件に加える。 */
function formatExitCompositeAction(
    t: Transition,
    sourceComposite: string,
    ctx: EmitContext,
): string {
    const bound = boundStateVarsForTransition(t, ctx);
    const source = ctx.composites.get(sourceComposite)!;
    const isCompletion = t.label.event === null;

    const completionPreconds: string[] = [];
    if (isCompletion) {
        for (let i = 0; i < source.regions.length; i++) {
            completionPreconds.push(`${regionVarName(sourceComposite, i)} = ${REGION_DONE}`);
        }
    }

    const resetRegions: string[] = [];
    const regionResets: string[] = [];
    for (let i = 0; i < source.regions.length; i++) {
        const v = regionVarName(sourceComposite, i);
        regionResets.push(`${v}' = ${REGION_INACTIVE}`);
        resetRegions.push(v);
    }
    const target = isPseudoState(t.to) ? "FINAL" : t.to;

    return buildBody({
        preconditions: [`phase = "${sourceComposite}"`],
        completionPreconds,
        guard: t.label.guard ? resolveGuard(t.label.guard, ctx.guards) : null,
        primedUpdates: [`phase' = "${target}"`, ...regionResets],
        boundVars: bound,
        unchangedVars: [
            ...ctx.stateVars.filter((v) => !bound.includes(v)),
            ...ctx.regionVars.filter((r) => !resetRegions.includes(r)),
        ],
    });
}

/** 複合状態内で一つの領域を進める。`[*]` に達した領域を `_done` にし、親の `phase` と他の領域の値は保持する。 */
function formatRegionAction(
    t: Transition,
    compositeId: string,
    regionIdx: number,
    ctx: EmitContext,
): string {
    const bound = boundStateVarsForTransition(t, ctx);
    const regionVar = regionVarName(compositeId, regionIdx);
    const newValue = isPseudoState(t.to) ? REGION_DONE : `"${t.to}"`;
    return buildBody({
        preconditions: [`phase = "${compositeId}"`, `${regionVar} = "${t.from}"`],
        completionPreconds: [],
        guard: t.label.guard ? resolveGuard(t.label.guard, ctx.guards) : null,
        primedUpdates: [`${regionVar}' = ${newValue}`],
        boundVars: bound,
        unchangedVars: [
            "phase",
            ...ctx.stateVars.filter((v) => !bound.includes(v)),
            ...ctx.regionVars.filter((r) => r !== regionVar),
        ],
    });
}

/** 状態名を文字列リテラルとして並べた TLA+ の集合を返す。空集合は `{}` と表記する。 */
function formatStateSet(states: Set<string>): string {
    return `{${Array.from(states).map((s) => `"${s}"`).join(", ")}}`;
}

/** ペイロードで状態変数を更新する遷移があるか調べ、生成するモジュールに `Domain` が必要かを判定する。 */
function hasAnyPayloadBinding(analysis: Analysis, ctx: EmitContext): boolean {
    for (const { t } of analysis.transitions) {
        if (boundStateVarsForTransition(t, ctx).length > 0) return true;
    }
    return false;
}

/**
 * {@link Diagram} から TLA+ (TLC 入力) 文字列を生成する。
 *
 * Phase A (flat) + Phase B (composite/直交領域) + Phase 2 (event payload binding) 対応:
 *
 * - 各 transition は context (top / region) に応じて action body を組み立てる
 * - composite には region 変数 `<composite>_r<N>` を追加し、入口/_done/_inactive で region 進行を track
 * - event payload field 名が state var 名と一致する場合、 `\E new_<var> \in Domain:` で
 *   非決定的に値を bind し、guard 内の変数参照を rename、`<var>' = new_<var>` で更新
 * - ペイロードの値域は `0..bound`。既定の上限は 1
 * - terminal state は `Stutter == phase \in TerminalStates /\ UNCHANGED vars` で TLC の
 *   deadlock false-positive を回避
 *
 * @param diagram       - パース済みの AST
 * @param guards        - ガードタグ → TLA+ 式 の辞書
 * @param stateVars     - state var 名のリスト
 * @param eventPayloads - event → payload field 名のリスト (省略時は binding 無し)
 * @param moduleName    - MODULE 名 (省略時 "Spec")
 * @param bound         - `Domain == 0..bound` の N。大きいほど state var が取りうる値が増えて
 *                        TLC が探索する状態空間も増える。省略時 1 (最小: {0, 1})
 * @param liveness      - `### Liveness` 表の時相プロパティ列。 1 件以上ある場合は
 *                        `Fairness == WF_vars(Next)` と各 property 定義が emit される。
 *                        省略時 空 (safety のみ、 fairness 無し)
 * @param onAction - 反例表示のため、生成したアクション名と元の遷移を受け取る。
 */
export function generateTla(
    diagram: Diagram,
    guards: Map<string, string> = new Map(),
    stateVars: string[] = [],
    eventPayloads: Map<string, string[]> = new Map(),
    moduleName: string = "Spec",
    bound: number = 1,
    liveness: LivenessProp[] = [],
    onAction?: (name: string, source: TlaTransition) => void,
): string {
    const analysis = analyze(diagram);
    const { initialState, terminal } = topLevelFlow(diagram);

    const regionVars = allRegionVars(analysis.composites);
    const allVars = ["phase", ...stateVars, ...regionVars];

    const ctx: EmitContext = {
        stateVars,
        regionVars,
        composites: analysis.composites,
        guards,
        eventPayloads,
        used: new Map(),
    };

    const needDomain = hasAnyPayloadBinding(analysis, ctx);

    const lines: string[] = [];
    lines.push(`---- MODULE ${moduleName} ----`);
    lines.push("");
    lines.push("EXTENDS Naturals");
    lines.push("");
    if (allVars.length === 1) lines.push(`VARIABLE phase`);
    else lines.push(`VARIABLES ${allVars.join(", ")}`);
    lines.push("");
    lines.push(`vars == <<${allVars.join(", ")}>>`);
    lines.push("");

    if (needDomain) {
        lines.push(
            `Domain == 0..${bound}  \\* bounded value domain for event payload bindings`,
        );
        lines.push("");
    }

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
        if (onAction) {
            const entry = analysis.transitions.find(({ t, context }) =>
                context.kind === "top" && isPseudoState(t.from)
            );
            if (entry) onAction("Init", entry);
        }
        initParts.push(`/\\ phase = "${initialState}"`);
    } else {
        initParts.push(`/\\ phase = "UNDEFINED"  \\* no [*] --> Initial found`);
    }
    for (const v of stateVars) initParts.push(`/\\ ${v} = 0`);
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
    for (const source of analysis.transitions) {
        const { t, context } = source;
        if (isPseudoState(t.from)) continue;

        if (context.kind === "region") {
            const base = sanitize(
                `${context.compositeId}_r${context.regionIdx}_${t.from}_${t.label.event ?? "tau"}_${
                    isPseudoState(t.to) ? "done" : t.to
                }`,
            );
            const name = uniqueName(base, ctx.used);
            onAction?.(name, source);
            actionNames.push(name);
            lines.push(`${name} ==`);
            lines.push(formatRegionAction(t, context.compositeId, context.regionIdx, ctx));
            lines.push("");
            continue;
        }

        if (isPseudoState(t.to)) continue;

        const fromIsComposite = analysis.composites.has(t.from);
        const toIsComposite = analysis.composites.has(t.to);

        const baseName = sanitize(`${t.from}_${t.label.event ?? "tau"}_${t.to}`);
        const name = uniqueName(baseName, ctx.used);
        onAction?.(name, source);
        actionNames.push(name);
        lines.push(`${name} ==`);

        if (fromIsComposite && !toIsComposite) {
            lines.push(formatExitCompositeAction(t, t.from, ctx));
        } else if (!fromIsComposite && toIsComposite) {
            lines.push(formatEnterCompositeAction(t, t.to, ctx, analysis.regionEntries));
        } else if (fromIsComposite && toIsComposite) {
            // 簡略: composite → composite は exit のみ扱う (Phase B 範囲外)
            lines.push(formatExitCompositeAction(t, t.from, ctx));
        } else {
            lines.push(formatTopAction(t, ctx));
        }
        lines.push("");
    }

    if (terminal.size > 0) {
        lines.push(`Terminated == phase \\in TerminalStates`);
        lines.push("");
        lines.push(`Stutter ==`);
        lines.push(`    /\\ Terminated`);
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

    if (liveness.length > 0) {
        lines.push(`Fairness == WF_vars(Next)`);
        lines.push("");
        lines.push(`Spec == Init /\\ [][Next]_vars /\\ Fairness`);
        lines.push("");
        for (const prop of liveness) {
            lines.push(`${prop.name} == ${prop.formula}`);
        }
        lines.push("");
    } else {
        lines.push(`Spec == Init /\\ [][Next]_vars`);
        lines.push("");
        lines.push(`\\* Properties — enable in .cfg to check:`);
        lines.push(`\\* INVARIANT: phase \\in States`);
        if (terminal.size > 0) {
            lines.push(`\\* PROPERTY:  <>Terminated  \\* termination`);
        }
        lines.push("");
    }

    lines.push(`====`);
    return lines.join("\n");
}
