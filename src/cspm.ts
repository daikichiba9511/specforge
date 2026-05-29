import { isPseudoState } from "./types.ts";
import type { Diagram, Region, Stmt } from "./types.ts";
import { exhaustive } from "./util.ts";

type Transition = Extract<Stmt, { kind: "transition" }>;

const collectTransitions = (regions: Region[]): Transition[] =>
    regions.flatMap((region) =>
        region.stmts.flatMap((stmt): Transition[] => {
            switch (stmt.kind) {
                case "transition":
                    return [stmt];
                case "composite":
                    return collectTransitions(stmt.regions);
                case "alias":
                    return [];
                default:
                    return exhaustive(stmt);
            }
        })
    );

const groupByFrom = (transitions: Transition[]): Map<string, Transition[]> => {
    const result = new Map<string, Transition[]>();
    for (const t of transitions) {
        const arr = result.get(t.from);
        if (arr) arr.push(t);
        else result.set(t.from, [t]);
    }
    return result;
};

const formatBranch = (t: Transition): string => {
    const guard = t.label.guard ? ` & ${t.label.guard}` : "";
    const action = t.label.action ? ` -> ${t.label.action}` : "";
    const to = isPseudoState(t.to) ? "SKIP" : t.to;
    const event = t.label.event ?? "tau";
    return `  ${event}${guard}${action} -> ${to}`;
};

const formatProcess = (from: string, transitions: Transition[]): string =>
    `${from} =\n${transitions.map(formatBranch).join("\n  []\n")}`;

/**
 * {@link Diagram} から CSPm (FDR4 入力) 文字列を生成する。
 *
 * 現状 sketch 実装で以下は未対応 (`docs/spec.md` §7、`CLAUDE.md` "Pending" 参照):
 * - composite + 直交領域 (`|||` 合成)
 * - composite 退出時の interrupt (`/\`)
 * - 状態変数のプロセスパラメータ化
 * - guard 式は verbatim 出力 (FDR4 で構文エラーになる可能性あり)
 *
 * @param diagram - パース済みの AST
 * @returns プロセス定義群を `\n\n` 区切りで連結した CSPm 文字列
 */
export const generateCspm = (diagram: Diagram): string =>
    Array.from(groupByFrom(collectTransitions(diagram.regions)).entries())
        .filter(([from]) => !isPseudoState(from))
        .map(([from, ts]) => formatProcess(from, ts))
        .join("\n\n");
