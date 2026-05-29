import type { Diagram, Label, Region, Stmt } from "./types.ts";

export class ParseError extends Error {
    constructor(msg: string, public line: number) {
        super(`L${line}: ${msg}`);
    }
}

const RE_HEADER = /^stateDiagram-v2\b/;
const RE_COMPOSITE = /^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/;
const RE_ALIAS = /^state\s+"([^"]*)"\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const RE_STATE_DECL = /^state\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const RE_TRANSITION =
    /^(\[\*\]|[A-Za-z_][A-Za-z0-9_]*)\s*-->\s*(\[\*\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(.*))?$/;
const RE_LABEL = /^([^\[\/]*?)\s*(?:\[([^\]]+)\])?\s*(?:\/\s*(.+))?$/;

export class Parser {
    private lines: string[];
    private pos = 0;

    constructor(input: string) {
        this.lines = input.split("\n").map((l) => {
            const idx = l.indexOf("%%");
            return idx >= 0 ? l.substring(0, idx).trimEnd() : l;
        });
    }

    parse(): Diagram {
        this.skipBlank();
        const header = this.lines[this.pos]?.trim() ?? "";
        if (!RE_HEADER.test(header)) {
            throw new ParseError(
                `expected 'stateDiagram-v2', got '${header}'`,
                this.pos + 1,
            );
        }
        this.pos++;
        const regions = this.parseRegions(0);
        return { type: "stateDiagram-v2", regions };
    }

    private parseRegions(depth: number): Region[] {
        const regions: Region[] = [];
        let current: Stmt[] = [];

        while (this.pos < this.lines.length) {
            const trimmed = this.lines[this.pos].trim();

            if (trimmed === "") {
                this.pos++;
                continue;
            }
            if (trimmed === "}") {
                if (depth === 0) {
                    throw new ParseError("unexpected '}'", this.pos + 1);
                }
                this.pos++;
                regions.push({ stmts: current });
                return regions;
            }
            if (trimmed === "--") {
                this.pos++;
                regions.push({ stmts: current });
                current = [];
                continue;
            }

            current.push(this.parseStmt());
        }

        if (depth > 0) {
            throw new ParseError("unexpected EOF, expected '}'", this.pos);
        }
        regions.push({ stmts: current });
        return regions;
    }

    private parseStmt(): Stmt {
        const trimmed = this.lines[this.pos].trim();

        const composite = RE_COMPOSITE.exec(trimmed);
        if (composite) {
            this.pos++;
            const regions = this.parseRegions(1);
            return { kind: "composite", id: composite[1], regions };
        }

        const alias = RE_ALIAS.exec(trimmed);
        if (alias) {
            this.pos++;
            return { kind: "alias", description: alias[1], id: alias[2] };
        }

        const stateDecl = RE_STATE_DECL.exec(trimmed);
        if (stateDecl) {
            this.pos++;
            return { kind: "alias", description: "", id: stateDecl[1] };
        }

        const trans = RE_TRANSITION.exec(trimmed);
        if (trans) {
            this.pos++;
            return {
                kind: "transition",
                from: trans[1],
                to: trans[2],
                label: this.parseLabel(trans[3] ?? ""),
            };
        }

        throw new ParseError(
            `unrecognized statement: '${trimmed}'`,
            this.pos + 1,
        );
    }

    private parseLabel(s: string): Label {
        const trimmed = s.trim();
        if (!trimmed) return { event: null, guard: null, action: null };
        const m = RE_LABEL.exec(trimmed);
        if (!m) return { event: trimmed, guard: null, action: null };
        const [, ev, gd, ac] = m;
        return {
            event: ev.trim() || null,
            guard: gd?.trim() ?? null,
            action: ac?.trim() ?? null,
        };
    }

    private skipBlank() {
        while (
            this.pos < this.lines.length && this.lines[this.pos].trim() === ""
        ) {
            this.pos++;
        }
    }
}

export function parse(input: string): Diagram {
    return new Parser(input).parse();
}
