import type { Diagram, Region, Stmt } from "./types.ts";

// Sketch CSPm generator. Current limitations (see CLAUDE.md "Pending"):
// - composite + orthogonal regions are flattened (no `|||` composition emitted)
// - composite exit cancellation (interrupt operator `/\`) not handled
// - state variables not threaded as process parameters
// - guards rendered verbatim — may not parse in FDR4 if expression contains operators
export function generateCspm(diagram: Diagram): string {
    const byFrom = new Map<string, Array<Stmt & { kind: "transition" }>>();

    const walk = (region: Region): void => {
        for (const stmt of region.stmts) {
            if (stmt.kind === "transition") {
                const arr = byFrom.get(stmt.from) ?? [];
                arr.push(stmt);
                byFrom.set(stmt.from, arr);
            } else if (stmt.kind === "composite") {
                for (const r of stmt.regions) walk(r);
            }
        }
    };
    for (const r of diagram.regions) walk(r);

    const blocks: string[] = [];
    for (const [from, transitions] of byFrom) {
        if (from === "[*]") continue;
        const branches = transitions.map((t) => {
            const guard = t.label.guard ? ` & ${t.label.guard}` : "";
            const action = t.label.action ? ` -> ${t.label.action}` : "";
            const to = t.to === "[*]" ? "SKIP" : t.to;
            const event = t.label.event ?? "tau";
            return `  ${event}${guard}${action} -> ${to}`;
        });
        blocks.push(`${from} =\n${branches.join("\n  []\n")}`);
    }
    return blocks.join("\n\n");
}
