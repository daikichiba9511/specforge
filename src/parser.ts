import type { Diagram, Label, Region, Stmt } from "./types.ts";
import { err, ok, type Result } from "./result.ts";

export type ParseError = {
    kind: "ParseError";
    message: string;
    line: number;
};

// Parser の進行状態。`lines` は不変、`pos` は advance で次の状態オブジェクトを返す
// (= 関数間で同じ pos を共有しない、Connascence of Identity 回避)。
type ParserState = {
    readonly lines: readonly string[];
    readonly pos: number;
};

// 各 parse 関数の戻り値: 成功時に次の state と value、失敗時に ParseError。
type Step<T> = Result<{ state: ParserState; value: T }, ParseError>;

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

const advance = (s: ParserState): ParserState => ({ ...s, pos: s.pos + 1 });

const skipBlank = (s: ParserState): ParserState => {
    let cur = s;
    while (cur.pos < cur.lines.length && cur.lines[cur.pos].trim() === "") {
        cur = advance(cur);
    }
    return cur;
};

const mkError = (s: ParserState, message: string): ParseError => ({
    kind: "ParseError",
    message,
    line: s.pos + 1,
});

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

const parseStmt = (state: ParserState): Step<Stmt> => {
    const trimmed = state.lines[state.pos].trim();

    const compositeGroups = RE_COMPOSITE.exec(trimmed)?.groups;
    if (compositeGroups?.id) {
        const sub = parseRegions(advance(state), 1);
        if (!sub.ok) return sub;
        return ok({
            state: sub.value.state,
            value: {
                kind: "composite",
                id: compositeGroups.id,
                regions: sub.value.value,
            },
        });
    }

    const aliasGroups = RE_ALIAS.exec(trimmed)?.groups;
    if (aliasGroups?.id) {
        return ok({
            state: advance(state),
            value: {
                kind: "alias",
                description: aliasGroups.description ?? "",
                id: aliasGroups.id,
            },
        });
    }

    const stateDeclGroups = RE_STATE_DECL.exec(trimmed)?.groups;
    if (stateDeclGroups?.id) {
        return ok({
            state: advance(state),
            value: {
                kind: "alias",
                description: "",
                id: stateDeclGroups.id,
            },
        });
    }

    const transGroups = RE_TRANSITION.exec(trimmed)?.groups;
    if (transGroups?.from && transGroups.to) {
        return ok({
            state: advance(state),
            value: {
                kind: "transition",
                from: transGroups.from,
                to: transGroups.to,
                label: parseLabel(transGroups.label ?? ""),
            },
        });
    }

    return err(mkError(state, `unrecognized statement: '${trimmed}'`));
};

const parseRegions = (state: ParserState, depth: number): Step<Region[]> => {
    let cur = state;
    const regions: Region[] = [];
    let current: Stmt[] = [];

    while (cur.pos < cur.lines.length) {
        const trimmed = cur.lines[cur.pos].trim();

        if (trimmed === "") {
            cur = advance(cur);
            continue;
        }
        if (trimmed === "}") {
            if (depth === 0) return err(mkError(cur, "unexpected '}'"));
            regions.push({ stmts: current });
            return ok({ state: advance(cur), value: regions });
        }
        if (trimmed === "--") {
            cur = advance(cur);
            regions.push({ stmts: current });
            current = [];
            continue;
        }

        const stmt = parseStmt(cur);
        if (!stmt.ok) return stmt;
        cur = stmt.value.state;
        current.push(stmt.value.value);
    }

    if (depth > 0) return err(mkError(cur, "unexpected EOF, expected '}'"));
    regions.push({ stmts: current });
    return ok({ state: cur, value: regions });
};

export const parse = (input: string): Result<Diagram, ParseError> => {
    const initial: ParserState = {
        lines: input.split("\n").map(stripComment),
        pos: 0,
    };
    const skipped = skipBlank(initial);
    const header = skipped.lines[skipped.pos]?.trim() ?? "";
    if (!RE_HEADER.test(header)) {
        return err(mkError(skipped, `expected 'stateDiagram-v2', got '${header}'`));
    }
    const afterHeader = advance(skipped);
    const regions = parseRegions(afterHeader, 0);
    if (!regions.ok) return regions;
    return ok({ type: "stateDiagram-v2", regions: regions.value.value });
};

export const formatParseError = (e: ParseError): string => `L${e.line}: ${e.message}`;
