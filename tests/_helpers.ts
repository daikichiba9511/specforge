import type { Result } from "../src/result.ts";

/** 成功した `Result` から値を取り出す。失敗時は受け取ったエラーを表示してテストを止める。 */
export function expectOk<T, E>(r: Result<T, E>): T {
    if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
    return r.value;
}

/** 失敗した `Result` からエラーを取り出す。予期せず成功した場合は、その値を表示してテストを止める。 */
export function expectErr<T, E>(r: Result<T, E>): E {
    if (r.ok) throw new Error(`expected error, got ok: ${JSON.stringify(r.value)}`);
    return r.error;
}
