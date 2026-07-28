import { parse } from "../../../../src/parser.ts";
import { preprocess } from "../../../../src/spec_doc.ts";
import type { Region, Stmt } from "../../../../src/types.ts";
import { validate } from "../../../../src/validate.ts";

type Transition = Extract<Stmt, { kind: "transition" }>;

type ExpectationResult = {
    text: string;
    passed: boolean;
    evidence: string;
};

const EXPECTATIONS = [
    "approval-request.md contains a parseable Mermaid stateDiagram-v2 with submit(item_count), review_passed, review_failed, and cancel paths",
    "approval-request.md contains event, action, guard, shared-state, liveness, and design-notes sections",
    "The guard table defines positive and zero item_count branches without undeclared identifiers",
    "specforge strict validation exits successfully with no V001-V007 issues",
    "Spec.tla is generated with Domain 0..3, item_count, Fairness, Terminated, and a termination property",
    "TLC exits successfully and reports that no error was found",
] as const;

const collectTransitions = (regions: Region[]): Transition[] =>
    regions.flatMap((region) =>
        region.stmts.flatMap((stmt): Transition[] =>
            stmt.kind === "transition"
                ? [stmt]
                : stmt.kind === "composite"
                ? collectTransitions(stmt.regions)
                : []
        )
    );

const containsHeading = (markdown: string, patterns: readonly RegExp[]): boolean =>
    patterns.some((pattern) => pattern.test(markdown));

const makeResult = (text: string, passed: boolean, evidence: string): ExpectationResult => ({
    text,
    passed,
    evidence,
});

const outputDirArg = Deno.args[0];
if (!outputDirArg) {
    console.error("usage: deno run grade.ts <outputs-dir>");
    Deno.exit(2);
}

const outputDir = outputDirArg.replace(/\/$/, "");
const specPath = `${outputDir}/approval-request.md`;
const tlaPath = `${outputDir}/Spec.tla`;
const verificationPath = `${outputDir}/verification.txt`;
const reportPath = `${outputDir}/report.md`;

const [spec, tla, verification] = await Promise.all([
    Deno.readTextFile(specPath),
    Deno.readTextFile(tlaPath),
    Deno.readTextFile(verificationPath),
]);

const doc = preprocess(spec);
const parsed = parse(doc.mermaid);
const transitions = parsed.ok ? collectTransitions(parsed.value.regions) : [];
const validationIssues = parsed.ok ? validate(parsed.value, doc).issues : [];
const events = new Set(transitions.map((transition) => transition.label.event).filter(Boolean));
const submitWithItemCount = transitions.some((transition) =>
    transition.label.event === "submit" && transition.label.eventArgs.includes("item_count")
);

const expectedEvents = ["submit", "review_passed", "review_failed", "cancel"];
const missingEvents = expectedEvents.filter((event) => !events.has(event));
const results: ExpectationResult[] = [];

results.push(makeResult(
    EXPECTATIONS[0],
    parsed.ok && submitWithItemCount && missingEvents.length === 0,
    parsed.ok
        ? `Parser accepted the diagram; submit(item_count)=${submitWithItemCount}; missing events=${
            JSON.stringify(missingEvents)
        }.`
        : `Parser rejected the diagram: ${JSON.stringify(parsed.error)}.`,
));

const sectionChecks = {
    event: containsHeading(spec, [/^#{1,6}\s+イベント(?:契約|一覧|定義)/m, /^#{1,6}\s+Event/m]),
    action: containsHeading(spec, [/^#{1,6}\s+アクション/m, /^#{1,6}\s+Action/m]),
    guard: containsHeading(spec, [/^#{1,6}\s+ガード/m, /^#{1,6}\s+Guard/m]),
    sharedState: containsHeading(spec, [
        /^#{1,6}\s+共有(?:状態|変数)/m,
        /^#{1,6}\s+(?:Shared state|State variables?)/mi,
    ]),
    liveness: containsHeading(spec, [/^#{1,6}\s+(?:Liveness|進行性|Temporal propert)/mi]),
    designNotes: containsHeading(spec, [/^#{1,6}\s+設計メモ/m, /^#{1,6}\s+Design notes?/mi]),
};
results.push(makeResult(
    EXPECTATIONS[1],
    Object.values(sectionChecks).every(Boolean),
    `Section presence: ${JSON.stringify(sectionChecks)}.`,
));

const guardExpressions = [...doc.guards.values()];
const hasPositiveGuard = guardExpressions.some((expression) =>
    /item_count\s*>\s*0/.test(expression)
);
const hasZeroGuard = guardExpressions.some((expression) => /item_count\s*==\s*0/.test(expression));
results.push(makeResult(
    EXPECTATIONS[2],
    hasPositiveGuard && hasZeroGuard && validationIssues.length === 0,
    `Guard expressions=${JSON.stringify(guardExpressions)}; validation issues=${
        JSON.stringify(validationIssues)
    }.`,
));

const strictExitZero =
    /(?:strict validation|--json --strict)[\s\S]{0,500}?(?:exit(?: code)?\s*[:=]?\s*0|終了コード\s*[:=]?\s*0)/i
        .test(verification);
results.push(makeResult(
    EXPECTATIONS[3],
    parsed.ok && validationIssues.length === 0 && strictExitZero,
    `Independent validation found ${validationIssues.length} issue(s); recorded strict exit 0=${strictExitZero}.`,
));

const livenessNames = doc.liveness.map((property) => property.name);
const tlaChecks = {
    domain: /Domain\s*==\s*0\.\.3/.test(tla),
    itemCount: /\bitem_count\b/.test(tla),
    fairness: /Fairness\s*==/.test(tla),
    terminated: /Terminated\s*==/.test(tla),
    property: livenessNames.length > 0 &&
        livenessNames.every((name) => new RegExp(`^${name}\\s*==`, "m").test(tla)),
};
results.push(makeResult(
    EXPECTATIONS[4],
    Object.values(tlaChecks).every(Boolean),
    `TLA+ checks: ${JSON.stringify(tlaChecks)}; declared liveness=${
        JSON.stringify(livenessNames)
    }.`,
));

const verifyExitZero =
    /(?:deno task verify|specforge verify)[\s\S]{0,3000}?(?:exit(?: code)?\s*[:=]?\s*0|終了コード\s*[:=]?\s*0)/i
        .test(verification);
const noTlcError = /Model checking completed\. No error has been found\./.test(verification);
results.push(makeResult(
    EXPECTATIONS[5],
    verifyExitZero && noTlcError,
    `Recorded verify exit 0=${verifyExitZero}; TLC no-error message=${noTlcError}.`,
));

const passed = results.filter((result) => result.passed).length;
const outputFiles = [specPath, tlaPath, verificationPath, reportPath];
const outputChars =
    (await Promise.all(outputFiles.map(async (path) => (await Deno.readTextFile(path)).length)))
        .reduce((sum, length) => sum + length, 0);
const grading = {
    expectations: results,
    summary: {
        passed,
        failed: results.length - passed,
        total: results.length,
        pass_rate: passed / results.length,
    },
    execution_metrics: {
        tool_calls: {},
        total_tool_calls: 0,
        total_steps: 0,
        errors_encountered: results.length - passed,
        output_chars: outputChars,
        transcript_chars: verification.length,
    },
    claims: [
        {
            claim: "The generated specification passes specforge validation.",
            type: "quality",
            verified: parsed.ok && validationIssues.length === 0,
            evidence:
                `Independent parser/validator result: parsed=${parsed.ok}, issues=${validationIssues.length}.`,
        },
        {
            claim: "TLC found no counterexample for the generated model.",
            type: "factual",
            verified: verifyExitZero && noTlcError,
            evidence:
                `verification.txt contains exit 0=${verifyExitZero} and no-error message=${noTlcError}.`,
        },
    ],
    user_notes_summary: {
        uncertainties: [],
        needs_review: [],
        workarounds: [],
    },
    eval_feedback: {
        suggestions: [],
        overall:
            "Assertions combine independent parser/validator checks with generated TLA+ and recorded TLC evidence.",
    },
};

const gradingPath = `${outputDir}/../grading.json`;
await Deno.writeTextFile(gradingPath, `${JSON.stringify(grading, null, 2)}\n`);
console.log(`${gradingPath}: ${passed}/${results.length} expectations passed`);
