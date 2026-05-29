// 判別ユニオンの switch / if 分岐で網羅性を compile-time に強制する。
// 全 case を handle していれば default で x が never に narrow され、
// 新 variant 追加時は型エラーになる。
export const exhaustive = (x: never): never => {
    throw new Error(`unreachable: unhandled variant ${JSON.stringify(x)}`);
};
