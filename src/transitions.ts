import { isPseudoState } from "./types.ts";
import type { Diagram, Stmt } from "./types.ts";
import type { SpecDoc } from "./spec_doc.ts";

export type Transition = Extract<Stmt, { kind: "transition" }>;

export const topLevelFlow = (diagram: Diagram) => {
    const transitions = diagram.regions.flatMap(({ stmts }) =>
        stmts.filter((stmt): stmt is Transition => stmt.kind === "transition")
    );
    const initialState = transitions.find((t) => isPseudoState(t.from))?.to ?? null;
    const terminal = new Set(
        transitions.filter((t) => isPseudoState(t.to) && !isPseudoState(t.from)).map((t) => t.from),
    );
    return { transitions, initialState, terminal };
};

export const boundStateVarsForTransition = (
    transition: Transition,
    { stateVars, eventPayloads }: Pick<SpecDoc, "stateVars" | "eventPayloads">,
): string[] => {
    if (transition.label.event === null) return [];
    const fields = eventPayloads.get(transition.label.event) ?? [];
    return fields.filter((field) => stateVars.includes(field));
};
