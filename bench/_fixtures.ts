/**
 * ベンチマーク用の合成入力ジェネレータ。
 * `_` プレフィックスで {@link Deno.bench} の自動検出対象から外している。
 */

/**
 * 線形チェーン `[*] --> S0 --> S1 --> ... --> Sn --> [*]` を生成する。
 * ラベル・guard・action は付かない。
 *
 * @param n - 中間遷移本数
 */
export const genLinear = (n: number): string => {
    const lines = ["stateDiagram-v2", "[*] --> S0"];
    for (let i = 0; i < n; i++) {
        lines.push(`S${i} --> S${i + 1}`);
    }
    lines.push(`S${n} --> [*]`);
    return lines.join("\n");
};

/**
 * 全遷移に `event [guard] / action` ラベルが付いた線形チェーンを生成する。
 * RE_LABEL のパース負荷を見るための fixture。
 */
export const genLabeled = (n: number): string => {
    const lines = ["stateDiagram-v2", "[*] --> S0"];
    for (let i = 0; i < n; i++) {
        lines.push(`S${i} --> S${i + 1} : ev${i} [g${i} > 0] / act${i}()`);
    }
    return lines.join("\n");
};

/**
 * `outerCount` 個の composite を並べ、各 composite に `innerCount` 本の内部遷移を入れる。
 * composite 再帰 (parseRegions ↔ parseStmt) の負荷を見るための fixture。
 */
export const genComposite = (outerCount: number, innerCount: number): string => {
    const lines = ["stateDiagram-v2"];
    for (let i = 0; i < outerCount; i++) {
        lines.push(`state Outer${i} {`);
        for (let j = 0; j < innerCount; j++) {
            lines.push(`  I${i}_${j} --> I${i}_${j + 1}`);
        }
        lines.push("}");
    }
    return lines.join("\n");
};
