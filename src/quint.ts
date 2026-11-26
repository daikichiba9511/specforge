import { err, ok } from "./result.ts";
import type { Result } from "./result.ts";
import type { SpecDoc } from "./spec_doc.ts";
import { boundStateVarsForTransition, topLevelFlow } from "./transitions.ts";
import type { Transition } from "./transitions.ts";
import { isPseudoState } from "./types.ts";
import type { Diagram } from "./types.ts";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMPARISON = /^([A-Za-z_]\w*|-?\d+)\s*(==|!=|<=|>=|<|>)\s*([A-Za-z_]\w*|-?\d+)$/;

const stateVar = (name: string): string => `state_${name}`;
const payloadField = (fields: string[], name: string, binding: string): string =>
    fields.length === 1 ? binding : `${binding}._${fields.indexOf(name) + 1}`;

const group = (operator: "all" | "any", terms: string[], indent = "    "): string =>
    `${operator} {\n${terms.map((term) => `${indent}    ${term},`).join("\n")}\n${indent}}`;

const renderGuard = (
    transition: Transition,
    doc: SpecDoc,
    fields: string[],
): Result<string | null, string> => {
    const tag = transition.label.guard;
    if (!tag) return ok(null);
    const expression = doc.guards.get(tag) ?? tag;
    const match = COMPARISON.exec(expression);
    const context = `Quint guard '${tag}' on ${transition.from} --> ${transition.to}`;
    if (!match) return err(`${context}: expected an integer comparison, got '${expression}'`);
    const operands: string[] = [];
    for (const token of [match[1], match[3]]) {
        if (fields.includes(token)) operands.push(payloadField(fields, token, "candidate"));
        else if (doc.stateVars.includes(token)) operands.push(stateVar(token));
        else if (/^-?\d+$/.test(token)) operands.push(BigInt(token).toString());
        else return err(`${context}: unknown state variable '${token}'`);
    }
    return ok(`${operands[0]} ${match[2]} ${operands[1]}`);
};

const renderTransition = (
    name: string,
    t: Transition,
    doc: SpecDoc,
    bound: number,
): Result<string, string> => {
    const fields = boundStateVarsForTransition(t, doc);
    if (new Set(fields).size !== fields.length) {
        return err(`Quint: repeated payload field in event '${t.label.event}'`);
    }
    const guard = renderGuard(t, doc, fields);
    if (!guard.ok) return guard;

    const conditions = [`phase == "${t.from}"`];
    if (fields.length === 0 && guard.value) conditions.push(guard.value);
    conditions.push(`phase' = "${t.to}"`);
    for (const v of doc.stateVars) {
        const next = fields.includes(v) ? payloadField(fields, v, "payload") : stateVar(v);
        conditions.push(`${stateVar(v)}' = ${next}`);
    }
    if (fields.length === 0) return ok(`    action ${name} = ${group("all", conditions)}`);

    const domain = `0.to(${bound})`;
    const product = fields.length === 1 ? domain : `tuples(${fields.map(() => domain).join(", ")})`;
    // Pick from enabled payloads so simulation cannot disable an enabled transition by chance.
    const choices = guard.value ? `${product}.filter(candidate => ${guard.value})` : product;
    return ok([
        `    action ${name} = {`,
        `        nondet payload = ${choices}.oneOf()`,
        `        ${group("all", conditions, "        ")}`,
        "    }",
    ].join("\n"));
};

export const generateQuint = (
    diagram: Diagram,
    doc: SpecDoc,
    bound: number,
): Result<string, string> => {
    if (doc.liveness.length > 0) {
        return err(
            `Quint export does not support temporal property '${
                doc.liveness[0].name
            }'. Use --tla or verify.`,
        );
    }
    if (diagram.regions.length !== 1) return err("Quint export requires one top-level region");
    const composite = diagram.regions[0].stmts.find((s) => s.kind === "composite");
    if (composite) return err(`Quint export does not support composite state '${composite.id}'`);
    if (!Number.isSafeInteger(bound) || bound < 0) {
        return err("Quint export requires a non-negative safe integer for --bound");
    }
    for (const v of doc.stateVars) {
        if (!IDENTIFIER.test(v)) return err(`Quint: invalid state variable name '${v}'`);
    }

    const { transitions, initialState, terminal } = topLevelFlow(diagram);
    const variables = doc.stateVars.map(stateVar);
    const init = [
        `phase' = "${initialState ?? "UNDEFINED"}"`,
        ...variables.map((v) => `${v}' = 0`),
    ];
    const blocks = [
        ["    var phase: str", ...variables.map((v) => `    var ${v}: int`)].join("\n"),
        `    action init = ${group("all", init)}`,
    ];
    const actions = new Set<string>();
    for (const t of transitions) {
        if (isPseudoState(t.from) || isPseudoState(t.to)) {
            if (t.label.guard || t.label.event) {
                return err(
                    `Quint: event or guard on pseudo-state transition ${t.from} --> ${t.to}`,
                );
            }
            continue;
        }
        const event = t.label.event ?? "tau";
        if (!IDENTIFIER.test(event)) return err(`Quint: invalid event name '${event}'`);
        const base = `tr_${t.from}_${event}_${t.to}`;
        let name = base;
        for (let n = 2; actions.has(name); n++) name = `${base}_${n}`;
        const action = renderTransition(name, t, doc, bound);
        if (!action.ok) return action;
        blocks.push(action.value);
        actions.add(name);
    }

    const unchanged = ["phase", ...variables].map((v) => `${v}' = ${v}`);
    if (terminal.size > 0) {
        const atTerminal = [...terminal].map((s) => `phase == "${s}"`).join(" or ");
        blocks.push(`    action stutter = ${group("all", [atTerminal, ...unchanged])}`);
        actions.add("stutter");
    }
    const step = actions.size > 0
        ? group("any", [...actions])
        : group("all", ["false", ...unchanged]);
    blocks.push(`    action step = ${step}`);
    return ok(`module Spec {\n${blocks.join("\n\n")}\n}`);
};
