import type { Diagram, Region, Stmt } from "./types.ts";

type Transition = Extract<Stmt, { kind: "transition" }>;

const collectTransitions = (regions: Region[]): Transition[] =>
    regions.flatMap((region) =>
        region.stmts.flatMap((stmt): Transition[] => {
            if (stmt.kind === "transition") return [stmt];
            if (stmt.kind === "composite") return collectTransitions(stmt.regions);
            return [];
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
    const to = t.to === "[*]" ? "SKIP" : t.to;
    const event = t.label.event ?? "tau";
    return `  ${event}${guard}${action} -> ${to}`;
};

const formatProcess = (from: string, transitions: Transition[]): string =>
    `${from} =\n${transitions.map(formatBranch).join("\n  []\n")}`;

// Sketch CSPm generator. Current limitations (see CLAUDE.md "Pending"):
// - composite + orthogonal regions are flattened (no `|||` composition emitted)
// - composite exit cancellation (interrupt operator `/\`) not handled
// - state variables not threaded as process parameters
// - guards rendered verbatim — may not parse in FDR4 if expression contains unsupported operators
export const generateCspm = (diagram: Diagram): string =>
    Array.from(groupByFrom(collectTransitions(diagram.regions)).entries())
        .filter(([from]) => from !== "[*]")
        .map(([from, ts]) => formatProcess(from, ts))
        .join("\n\n");
