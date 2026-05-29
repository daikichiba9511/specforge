/**
 * 成功 (`ok: true`) または失敗 (`ok: false`) のいずれかを表す判別ユニオン。
 * 例外を投げる代わりに関数の戻り値として明示する。
 *
 * 生成は {@link ok} / {@link err} ファクトリを使う。narrow は `r.ok` で行う。
 *
 * @typeParam T - 成功値の型
 * @typeParam E - エラー値の型
 *
 * @example
 * ```ts
 * const r = parse(input);
 * if (r.ok) console.log(r.value);
 * else console.error(r.error);
 * ```
 */
export type Result<T, E> =
    | { ok: true; value: T }
    | { ok: false; error: E };

/**
 * 成功 Result を生成するファクトリ。
 * 戻り値の型は `Result<T, never>` で、widening は呼び出し側で起こる。
 */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/**
 * 失敗 Result を生成するファクトリ。
 * 戻り値の型は `Result<never, E>` で、widening は呼び出し側で起こる。
 */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
