/**
 * 判別ユニオン網羅性チェックの番人。
 *
 * `switch` / `if` 分岐で全 case を handle していれば `default` の `x` が
 * `never` に narrow され、新 variant 追加時に compile error になる。
 * 仮に runtime に到達した場合は Error を投げる (= バグ検出)。
 *
 * @example
 * ```ts
 * switch (stmt.kind) {
 *     case "transition": return ...;
 *     case "composite":  return ...;
 *     case "alias":      return ...;
 *     default: return exhaustive(stmt);
 * }
 * ```
 */
export const exhaustive = (x: never): never => {
    throw new Error(`unreachable: unhandled variant ${JSON.stringify(x)}`);
};
