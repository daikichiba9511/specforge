import { test } from "bun:test";
import { deepStrictEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse } from "../src/parser.ts";
import { preprocess } from "../src/spec_doc.ts";
import { topLevelFlow } from "../src/transitions.ts";
import { isPseudoState } from "../src/types.ts";
import { validate } from "../src/validate.ts";
import { verify, type VerifyDeps } from "../src/verify.ts";

// Only the environment is scripted. The order of calls and the final outcome come from verify().
const observeVerify = (scenario: string): string[] => {
    const events: string[] = [];
    const fault = new Error("simulated external failure");
    const record = <T>(event: string, value: T): T => {
        events.push(event);
        return value;
    };
    const fail = (event: string): never => {
        events.push(event);
        throw fault;
    };
    const write = (operation: string) => {
        if (scenario === operation + "_error") fail(scenario);
        events.push(operation + "_ok");
    };
    const deps: VerifyDeps = {
        readFile: () => {
            if (scenario === "read_error") return fail(scenario);
            if (scenario === "read_invalid") return record(scenario, "invalid diagram");
            return record("read_valid", "stateDiagram-v2\n[*] --> Ready\nReady --> [*]");
        },
        findJava: () =>
            scenario === "java_missing"
                ? record(scenario, null)
                : record("java_found", "/jdk/bin/java"),
        findTlaJar: () =>
            scenario === "jar_missing"
                ? record(scenario, null)
                : record("jar_found", "/tla2tools.jar"),
        makeTempDir: () => {
            if (scenario === "mkdir_error") return fail(scenario);
            return record("mkdir_ok", "/tmp/specforge-test");
        },
        writeFile: (path) => {
            const file = basename(path);
            ok(file === "Spec.tla" || file === "Spec.cfg", `unexpected file: ${file}`);
            write(file === "Spec.tla" ? "write_tla" : "write_cfg");
        },
        runTlc: () => {
            if (scenario === "tlc_throws") return fail(scenario);
            const code = scenario === "tlc_nonzero" ? 11 : 0;
            return record(code === 0 ? "tlc_zero" : "tlc_nonzero", {
                code,
                stdout: "",
                stderr: "",
            });
        },
    };
    try {
        events.push(verify("input.md", deps).kind);
    } catch (e) {
        if (e !== fault) throw e;
        events.push("exception");
    }
    return events;
};

test("verify follows the documented call order and outcomes on success and failure", () => {
    const path = new URL("../docs/verify-execution.md", import.meta.url);
    const doc = preprocess(readFileSync(path, "utf8"));
    const parsed = parse(doc.mermaid);
    ok(parsed.ok);
    deepStrictEqual(validate(parsed.value, doc).issues, []);
    const { initialState, terminal, transitions } = topLevelFlow(parsed.value);
    ok(initialState);
    const observed = new Set<typeof transitions[number]>();
    for (const scenario of [
        "tlc_zero",
        "read_error",
        "read_invalid",
        "java_missing",
        "jar_missing",
        "mkdir_error",
        "write_tla_error",
        "write_cfg_error",
        "tlc_nonzero",
        "tlc_throws",
    ]) {
        let state: string = initialState;
        for (const event of observeVerify(scenario)) {
            const next = transitions.filter((edge) =>
                edge.from === state && !isPseudoState(edge.to)
            );
            const matches = next.filter((edge) => edge.label.event === event);
            deepStrictEqual(
                matches.length,
                1,
                `${scenario}: in ${state}, observed ${event}, expected one of ${
                    next.map((edge) => edge.label.event).join(", ")
                }`,
            );
            observed.add(matches[0]);
            state = matches[0].to;
        }
        ok(terminal.has(state), `${scenario}: verify stopped in ${state}`);
    }
    const untested = transitions.filter((edge) =>
        !isPseudoState(edge.from) && !isPseudoState(edge.to) && !observed.has(edge)
    );
    deepStrictEqual(untested, [], "documented transitions missing an implementation scenario");
});
