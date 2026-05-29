import type { Diagram, Label, Region, Stmt } from "./types.ts";
import { err, ok, type Result } from "./result.ts";

export type ParseError = {
    kind: "ParseError";
    message: string;
    line: number;
};

const RE_HEADER = /^stateDiagram-v2\b/;
const RE_COMPOSITE = /^state\s+(?<id>[A-Za-z_][A-Za-z0-9_]*)\s*\{$/;
const RE_ALIAS = /^state\s+"(?<description>[^"]*)"\s+as\s+(?<id>[A-Za-z_][A-Za-z0-9_]*)$/;
const RE_STATE_DECL = /^state\s+(?<id>[A-Za-z_][A-Za-z0-9_]*)$/;
const RE_TRANSITION =
    /^(?<from>\[\*\]|[A-Za-z_][A-Za-z0-9_]*)\s*-->\s*(?<to>\[\*\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(?<label>.*))?$/;
const RE_LABEL = /^(?<event>[^\[\/]*?)\s*(?:\[(?<guard>[^\]]+)\])?\s*(?:\/\s*(?<action>.+))?$/;

const stripComment = (line: string): string => {
    const idx = line.indexOf("%%");
    return idx >= 0 ? line.substring(0, idx).trimEnd() : line;
};

const parseLabel = (raw: string): Label => {
    const trimmed = raw.trim();
    if (!trimmed) return { event: null, guard: null, action: null };
    // RE_LABEL は trimmed が非空ならば必ず match する構造 (全 group が optional)。
    const groups = RE_LABEL.exec(trimmed)?.groups ?? {};
    return {
        event: groups.event?.trim() || null,
        guard: groups.guard?.trim() ?? null,
        action: groups.action?.trim() ?? null,
    };
};

export const parse = (input: string): Result<Diagram, ParseError> => {
    const lines = input.split("\n").map(stripComment);
    let pos = 0;

    const mkError = (message: string): ParseError => ({
        kind: "ParseError",
        message,
        line: pos + 1,
    });

    const skipBlank = (): void => {
        while (pos < lines.length && lines[pos].trim() === "") pos++;
    };

    const parseStmt = (): Result<Stmt, ParseError> => {
        const trimmed = lines[pos].trim();

        const compositeGroups = RE_COMPOSITE.exec(trimmed)?.groups;
        if (compositeGroups?.id) {
            pos++;
            const regions = parseRegions(1);
            if (!regions.ok) return regions;
            return ok({
                kind: "composite",
                id: compositeGroups.id,
                regions: regions.value,
            });
        }

        const aliasGroups = RE_ALIAS.exec(trimmed)?.groups;
        if (aliasGroups?.id) {
            pos++;
            return ok({
                kind: "alias",
                description: aliasGroups.description ?? "",
                id: aliasGroups.id,
            });
        }

        const stateDeclGroups = RE_STATE_DECL.exec(trimmed)?.groups;
        if (stateDeclGroups?.id) {
            pos++;
            return ok({
                kind: "alias",
                description: "",
                id: stateDeclGroups.id,
            });
        }

        const transGroups = RE_TRANSITION.exec(trimmed)?.groups;
        if (transGroups?.from && transGroups.to) {
            pos++;
            return ok({
                kind: "transition",
                from: transGroups.from,
                to: transGroups.to,
                label: parseLabel(transGroups.label ?? ""),
            });
        }

        return err(mkError(`unrecognized statement: '${trimmed}'`));
    };

    const parseRegions = (depth: number): Result<Region[], ParseError> => {
        const regions: Region[] = [];
        let current: Stmt[] = [];

        while (pos < lines.length) {
            const trimmed = lines[pos].trim();

            if (trimmed === "") {
                pos++;
                continue;
            }
            if (trimmed === "}") {
                if (depth === 0) return err(mkError("unexpected '}'"));
                pos++;
                regions.push({ stmts: current });
                return ok(regions);
            }
            if (trimmed === "--") {
                pos++;
                regions.push({ stmts: current });
                current = [];
                continue;
            }

            const stmt = parseStmt();
            if (!stmt.ok) return stmt;
            current.push(stmt.value);
        }

        if (depth > 0) return err(mkError("unexpected EOF, expected '}'"));
        regions.push({ stmts: current });
        return ok(regions);
    };

    skipBlank();
    const header = lines[pos]?.trim() ?? "";
    if (!RE_HEADER.test(header)) {
        return err(mkError(`expected 'stateDiagram-v2', got '${header}'`));
    }
    pos++;
    const regions = parseRegions(0);
    if (!regions.ok) return regions;
    return ok({ type: "stateDiagram-v2", regions: regions.value });
};

export const formatParseError = (e: ParseError): string => `L${e.line}: ${e.message}`;
