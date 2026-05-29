export type StateRef = string;

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
