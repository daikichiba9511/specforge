import type { Result } from "../src/result.ts";

export const expectOk = <T, E>(r: Result<T, E>): T => {
    if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
    return r.value;
};

export const expectErr = <T, E>(r: Result<T, E>): E => {
    if (r.ok) throw new Error(`expected error, got ok: ${JSON.stringify(r.value)}`);
    return r.error;
};
