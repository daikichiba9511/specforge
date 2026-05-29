export type StateRef = string;

// 擬似状態 (initial / final) の AST 上での canonical 表現。
// parser は入力中の `[*]` をそのままこの値として AST に格納し、
// cspm など消費側は isPseudoState で判定する (Connascence of Values 回避)。
export const PSEUDO_STATE = "[*]" as const;
export type PseudoState = typeof PSEUDO_STATE;
export const isPseudoState = (s: string): s is PseudoState => s === PSEUDO_STATE;

export type Label = {
    event: string | null;
    guard: string | null;
    action: string | null;
};

export type Stmt =
    | { kind: "alias"; id: string; description: string }
    | { kind: "composite"; id: string; regions: Region[] }
    | { kind: "transition"; from: StateRef; to: StateRef; label: Label };

export type Region = { stmts: Stmt[] };

export type Diagram = { type: "stateDiagram-v2"; regions: Region[] };
