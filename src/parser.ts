import type { Diagram, Label, Region, Stmt } from "./types.ts";
import { err, ok, type Result } from "./result.ts";

/**
 * パース失敗を表すエラー型。
 * `line` は 1-indexed の入力行番号。例外として throw されることはなく、
 * `Result<_, ParseError>` の `error` 側に乗せて返される。
 */
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
const RE_LABEL = /^(?<event>[^[/]*?)\s*(?:\[(?<guard>[^\]]+)\])?\s*(?:\/\s*(?<action>.+))?$/;
// event 名 + 引数括弧の分解。 例: `coin_inserted(balance)` → name=coin_inserted、 args=balance
// 引数なしの `timer` / `timer()` 両方を受理する。
const RE_EVENT_NAME = /^(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:\((?<args>[^)]*)\))?$/;

/** 最初の `%%` 以降を、行の残りとともにコメントとして取り除く。 */
function stripComment(line: string): string {
    const idx = line.indexOf("%%");
    return idx >= 0 ? line.substring(0, idx).trimEnd() : line;
}

/** 入力行を共有したまま、読み取り位置だけを1行進めた状態を返す。 */
function advance(s: ParserState): ParserState {
    return { ...s, pos: s.pos + 1 };
}

/** 空白行を読み飛ばし、次の文または入力末尾を指す状態を返す。 */
function skipBlank(s: ParserState): ParserState {
    let cur = s;
    while (cur.pos < cur.lines.length && cur.lines[cur.pos].trim() === "") {
        cur = advance(cur);
    }
    return cur;
}

/** 内部の読み取り位置を、利用者向けの1始まりの行番号に変換してエラーに添える。 */
function mkError(s: ParserState, message: string): ParseError {
    return {
        kind: "ParseError",
        message,
        line: s.pos + 1,
    };
}

/** 括弧の外側のカンマでアクションを分ける。`f(x, y)` の引数を区切るカンマは保持する。 */
function splitActions(raw: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === "(") depth++;
        else if (c === ")" && depth > 0) depth--;
        else if (c === "," && depth === 0) {
            const seg = raw.slice(start, i).trim();
            if (seg) result.push(seg);
            start = i + 1;
        }
    }
    const last = raw.slice(start).trim();
    if (last) result.push(last);
    return result;
}

/**
 * `name(arg1, arg2)` をイベント名と引数に分ける。
 * 空欄はイベントなしとして扱い、書式が合わない文字列はそのまま名前に残す。
 */
function parseEventName(raw: string | null): { name: string | null; args: string[] } {
    if (!raw) return { name: null, args: [] };
    const m = RE_EVENT_NAME.exec(raw);
    if (!m?.groups?.name) return { name: raw, args: [] };
    const argsRaw = m.groups.args;
    const args = argsRaw === undefined
        ? []
        : argsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    return { name: m.groups.name, args };
}

/** 遷移ラベルからイベント、引数、ガード、アクションを読み取る。空のラベルは無条件の遷移を表す。 */
function parseLabel(raw: string): Label {
    const trimmed = raw.trim();
    if (!trimmed) return { event: null, eventArgs: [], guard: null, actions: [] };
    // RE_LABEL は trimmed が非空ならば必ず match する構造 (全 group が optional)。
    const groups = RE_LABEL.exec(trimmed)?.groups ?? {};
    const eventRaw = groups.event?.trim() || null;
    const { name, args } = parseEventName(eventRaw);
    return {
        event: name,
        eventArgs: args,
        guard: groups.guard?.trim() ?? null,
        actions: splitActions(groups.action ?? ""),
    };
}

/** 現在行から文を1件読み取り、次の読み取り位置を返す。複合状態の場合は、その閉じ括弧までを1件として消費する。 */
function parseStmt(state: ParserState): Step<Stmt> {
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
}

/** `--` で並行領域を区切って読む。最上位は入力末尾まで、複合状態の内部は対応する `}` までを消費する。 */
function parseRegions(state: ParserState, depth: number): Step<Region[]> {
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
}

/**
 * Mermaid stateDiagram-v2 入力を specforge の AST にパースする。
 *
 * 受理サブセットの定義は `docs/spec.md` §3 を参照。サブセット外の構文は
 * {@link ParseError} として失敗を返す (例外は投げない)。
 *
 * @param input - 入力スペック文字列。`\n` 区切り、`%%` 以降の行内コメント可
 * @returns 成功時は {@link Diagram}、失敗時は行番号付き {@link ParseError}
 *
 * @example
 * ```ts
 * const r = parse("stateDiagram-v2\n[*] --> A");
 * if (r.ok) console.log(r.value.regions[0].stmts.length); // 1
 * ```
 */
export function parse(input: string): Result<Diagram, ParseError> {
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
}

/**
 * {@link ParseError} を `L<line>: <message>` 形式の 1 行に整形する。
 * CLI / log 出力の表示用ヘルパ。
 */
export function formatParseError(e: ParseError): string {
    return `L${e.line}: ${e.message}`;
}
