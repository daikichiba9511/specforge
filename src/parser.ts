import type { Diagram, Label, Region, Stmt } from "./types.ts";
import { err, ok, type Result } from "./result.ts";

export type ParseError = {
    kind: "ParseError";
    message: string;
    line: number;
};

const RE_HEADER = /^stateDiagram-v2\b/;
const RE_COMPOSITE = /^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/;
const RE_ALIAS = /^state\s+"([^"]*)"\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const RE_STATE_DECL = /^state\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const RE_TRANSITION =
    /^(\[\*\]|[A-Za-z_][A-Za-z0-9_]*)\s*-->\s*(\[\*\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(.*))?$/;
const RE_LABEL = /^([^\[\/]*?)\s*(?:\[([^\]]+)\])?\s*(?:\/\s*(.+))?$/;

const stripComment = (line: string): string => {
    const idx = line.indexOf("%%");
    return idx >= 0 ? line.substring(0, idx).trimEnd() : line;
};

const parseLabel = (raw: string): Label => {
    const trimmed = raw.trim();
    if (!trimmed) return { event: null, guard: null, action: null };
    const m = RE_LABEL.exec(trimmed);
    if (!m) return { event: trimmed, guard: null, action: null };
    const [, ev, gd, ac] = m;
    return {
        event: ev.trim() || null,
        guard: gd?.trim() ?? null,
        action: ac?.trim() ?? null,
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

        const composite = RE_COMPOSITE.exec(trimmed);
        if (composite) {
            pos++;
            const regions = parseRegions(1);
            if (!regions.ok) return regions;
            return ok({
                kind: "composite",
                id: composite[1],
                regions: regions.value,
            });
        }

        const alias = RE_ALIAS.exec(trimmed);
        if (alias) {
            pos++;
            return ok({
                kind: "alias",
                description: alias[1],
                id: alias[2],
            });
        }

        const stateDecl = RE_STATE_DECL.exec(trimmed);
        if (stateDecl) {
            pos++;
            return ok({
                kind: "alias",
                description: "",
                id: stateDecl[1],
            });
        }

        const trans = RE_TRANSITION.exec(trimmed);
        if (trans) {
            pos++;
            return ok({
                kind: "transition",
                from: trans[1],
                to: trans[2],
                label: parseLabel(trans[3] ?? ""),
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
