/**
 * 状態への参照。state ID (英数 + `_`) または擬似状態 `[*]` のいずれか。
 * 擬似状態かの判定は {@link isPseudoState} を使う。
 */
export type StateRef = string;

/**
 * 擬似状態 (initial / final) の AST 上での canonical 表現値。
 * parser は入力中の `[*]` をそのままこの値として AST に格納し、
 * 消費側は {@link isPseudoState} で判定する (Connascence of Values 回避)。
 */
export const PSEUDO_STATE = "[*]" as const;

/**
 * {@link PSEUDO_STATE} の型 (`"[*]"` リテラル型)。
 */
export type PseudoState = typeof PSEUDO_STATE;

/**
 * `s` が擬似状態かを判定する type guard。
 */
export const isPseudoState = (s: string): s is PseudoState => s === PSEUDO_STATE;

/**
 * 遷移ラベル `event [guard] / action1, action2, ...` の構造化表現。
 *
 * - `event` は bare 名のみ (引数括弧は剥がす)。 不在は `null`。 例: 入力
 *   `coin_inserted(balance)` → `event = "coin_inserted"`、 `eventArgs = ["balance"]`
 * - `eventArgs` は event の引数列。 `()` 無しなら `[]`。 引数表記は `name(arg1, arg2)`
 *   の形を期待し、 トップレベル `,` で分割。 引数は payload field 名 (`spec-behavior` 規律) を
 *   想定するが、 parser は意味解釈せずそのまま保持
 * - `guard` は省略可、不在は `null`
 * - `actions` は 0 個以上のアクション列。トップレベル `,` で分割され、
 *   引数表記の括弧内 `,` は保持される (例: `write_task(item_id, count)` は 1 要素)。
 *   CSPm では `act1 -> act2 -> ...` の sequential prefix に展開される。
 *
 * 文法詳細は `docs/spec.md` §4 を参照。
 */
export type Label = {
    event: string | null;
    eventArgs: string[];
    guard: string | null;
    actions: string[];
};

/**
 * stateDiagram-v2 内の 1 文を表す判別ユニオン。
 *
 * - `alias`: state 宣言 (`state X` / `state "desc" as X`)
 * - `composite`: 階層状態 (`state X { ... }`)、内部に複数 region を持てる
 * - `transition`: 遷移 (`X --> Y : label`)
 */
export type Stmt =
    | { kind: "alias"; id: string; description: string }
    | { kind: "composite"; id: string; regions: Region[] }
    | { kind: "transition"; from: StateRef; to: StateRef; label: Label };

/**
 * {@link Stmt} の連なり。トップレベルや composite 内の各直交領域に 1 つずつ存在する。
 */
export type Region = { stmts: Stmt[] };

/**
 * パース後の AST ルート。トップレベル region 列を保持する。
 * composite 内の region は `Stmt.composite.regions` 経由でアクセス。
 */
export type Diagram = { type: "stateDiagram-v2"; regions: Region[] };
