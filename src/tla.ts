import { isPseudoState } from "./types.ts";
import type { Diagram, Region, Stmt } from "./types.ts";
import { exhaustive } from "./util.ts";

type Transition = Extract<Stmt, { kind: "transition" }>;

// 全 region を再帰的に歩いて、 (a) 非疑似 transition のリスト、(b) 出現した state 名集合
// を作る。composite は state として扱うだけ (中身も同じ平面に展開)。
type Walked = {
    transitions: Transition[];
    states: Set<string>;
};

const walk = (regions: Region[]): Walked => {
    const transitions: Transition[] = [];
    const states = new Set<string>();
    const recur = (rs: Region[]): void => {
        for (const region of rs) {
            for (const stmt of region.stmts) {
                switch (stmt.kind) {
                    case "transition":
                        transitions.push(stmt);
                        if (!isPseudoState(stmt.from)) states.add(stmt.from);
                        if (!isPseudoState(stmt.to)) states.add(stmt.to);
                        break;
                    case "composite":
                        states.add(stmt.id);
                        recur(stmt.regions);
                        break;
                    case "alias":
                        states.add(stmt.id);
                        break;
                    default:
                        exhaustive(stmt);
                }
            }
        }
    };
    recur(regions);
    return { transitions, states };
};

// 初期遷移 `[*] --> X` のトップレベル X を返す (見つからなければ null)。composite 内 `[*] -->` は対象外。
const findInitialState = (diagram: Diagram): string | null => {
    for (const region of diagram.regions) {
        for (const stmt of region.stmts) {
            if (stmt.kind === "transition" && isPseudoState(stmt.from)) {
                return stmt.to;
            }
        }
    }
    return null;
};

const collectTerminalStates = (transitions: Transition[]): Set<string> => {
    const terminal = new Set<string>();
    for (const t of transitions) {
        if (isPseudoState(t.to) && !isPseudoState(t.from)) terminal.add(t.from);
    }
    return terminal;
};

const resolveGuard = (raw: string, guards: Map<string, string>): string => guards.get(raw) ?? raw;

// 1 遷移を TLA+ action として整形する (action 本体のみ、名前は呼び出し側で付ける)。
//
// Phase A の単純化:
// - state vars は更新されない (UNCHANGED で全部素通り)。event payload binding は Phase B 以降
// - guard は verbatim で predicate として埋め込む
// - action は opaque な動作扱いで TLA+ には乗らない (state にも channel にもしない)
const formatActionBody = (
    t: Transition,
    guards: Map<string, string>,
    stateVars: string[],
): string => {
    const parts: string[] = [`/\\ phase = "${t.from}"`];
    if (t.label.guard) parts.push(`/\\ ${resolveGuard(t.label.guard, guards)}`);
    parts.push(`/\\ phase' = "${t.to}"`);
    if (stateVars.length > 0) {
        parts.push(`/\\ UNCHANGED <<${stateVars.join(", ")}>>`);
    }
    return parts.map((p) => `    ${p}`).join("\n");
};

// 同じ (from, event, to) の action が複数あると衝突するため、name に index を suffix する。
const actionName = (t: Transition, used: Map<string, number>): string => {
    const event = t.label.event ?? "tau";
    const base = `${t.from}_${event}_${t.to.replace(/\[\*\]/g, "Final")}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
};

// state 一覧を TLA+ の集合リテラル `{"A", "B", "C"}` 形式に。
const formatStateSet = (states: Set<string>): string =>
    `{${Array.from(states).map((s) => `"${s}"`).join(", ")}}`;

/**
 * {@link Diagram} から TLA+ (TLC 入力) 文字列を生成する (Phase A: flat states)。
 *
 * 出力構造:
 * 1. `MODULE <moduleName>` ヘッダ (TLC は file 名と module 名の一致が必要)
 * 2. `VARIABLES phase, <state_vars>` 宣言 + `vars` tuple
 * 3. `States` / `TerminalStates` 集合定義
 * 4. `Init`: 初期 state (`[*] --> X` の X) + 各 state var = 0
 * 5. 各 transition を action として: `<From>_<event>_<To> == phase=From /\\ guard /\\ phase'=To /\\ UNCHANGED <<vars>>`
 * 6. `Stutter == phase \\in TerminalStates /\\ UNCHANGED vars` (terminal state の永続化、TLC の deadlock 検出を避ける)
 * 7. `Next == \\/ action1 \\/ action2 ...`
 * 8. `Spec == Init /\\ [][Next]_vars`
 *
 * Phase A の制約 (Phase B+ で対応予定):
 * - composite / 直交領域は state として平坦化される (parallel composition の意味は失われる)
 * - event payload binding 未対応 (state var は遷移で更新されない)
 * - action の semantics は無視 (TLA+ 上に乗らない)
 *
 * @param diagram     - パース済みの AST
 * @param guards      - ガードタグ → TLA+ 式 の辞書 (省略時は置換無し)
 * @param stateVars   - state var 名のリスト (省略時は phase のみ)
 * @param moduleName  - MODULE 名 (省略時 "Spec")。TLC は file 名と一致を要求する
 * @returns TLA+ 文字列
 */
export const generateTla = (
    diagram: Diagram,
    guards: Map<string, string> = new Map(),
    stateVars: string[] = [],
    moduleName: string = "Spec",
): string => {
    const { transitions, states } = walk(diagram.regions);
    const initialState = findInitialState(diagram);
    const terminal = collectTerminalStates(transitions);

    const allVars = ["phase", ...stateVars];
    const varsTuple = `<<${allVars.join(", ")}>>`;

    const lines: string[] = [];
    lines.push(`---- MODULE ${moduleName} ----`);
    lines.push("");
    lines.push("EXTENDS Naturals");
    lines.push("");
    if (allVars.length === 1) {
        lines.push(`VARIABLE phase`);
    } else {
        lines.push(`VARIABLES ${allVars.join(", ")}`);
    }
    lines.push("");
    lines.push(`vars == ${varsTuple}`);
    lines.push("");

    if (states.size > 0) {
        lines.push(`States == ${formatStateSet(states)}`);
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
    lines.push(`Init ==`);
    for (const p of initParts) lines.push(`    ${p}`);
    lines.push("");

    // Actions for each non-pseudo transition
    const actionNames: string[] = [];
    const usedNames = new Map<string, number>();
    for (const t of transitions) {
        if (isPseudoState(t.from)) continue; // skip [*] --> X (handled by Init)
        if (isPseudoState(t.to)) continue; // skip X --> [*] (handled by Stutter)
        const name = actionName(t, usedNames);
        actionNames.push(name);
        lines.push(`${name} ==`);
        lines.push(formatActionBody(t, guards, stateVars));
        lines.push("");
    }

    // Stutter for terminal states (so TLC doesn't flag them as deadlock).
    if (terminal.size > 0) {
        lines.push(`Stutter ==`);
        lines.push(`    /\\ phase \\in TerminalStates`);
        lines.push(`    /\\ UNCHANGED vars`);
        lines.push("");
    }

    // Next: disjunction of all actions + Stutter.
    const nextBranches = [...actionNames];
    if (terminal.size > 0) nextBranches.push("Stutter");
    if (nextBranches.length === 0) {
        lines.push(`Next == FALSE  \\* no transitions found`);
    } else if (nextBranches.length === 1) {
        lines.push(`Next == ${nextBranches[0]}`);
    } else {
        lines.push(`Next ==`);
        for (const b of nextBranches) lines.push(`    \\/ ${b}`);
    }
    lines.push("");

    lines.push(`Spec == Init /\\ [][Next]_vars`);
    lines.push("");

    // Helpful invariants / properties (commented; user enables in .cfg).
    lines.push(`\\* Properties — enable in .cfg to check:`);
    lines.push(`\\* INVARIANT: phase \\in States`);
    if (terminal.size > 0) {
        lines.push(`\\* PROPERTY:  <>(phase \\in TerminalStates)  \\* termination`);
    }
    lines.push("");

    lines.push(`====`);
    return lines.join("\n");
};
