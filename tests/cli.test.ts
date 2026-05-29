import { assertEquals } from "jsr:@std/assert@^1";
import { main } from "../src/cli.ts";

Deno.test("main: valid spec returns exit 0 with cspm on stdout", () => {
    const r = main(["examples/traffic-light.mmd"]);
    assertEquals(r.exitCode, 0);
    if (!r.stdout) throw new Error("expected stdout");
    assertEquals(r.stdout.includes("Red ="), true);
    assertEquals(r.stderr, undefined);
});

Deno.test("main: missing arg returns exit 1 with usage", () => {
    const r = main([]);
    assertEquals(r.exitCode, 1);
    assertEquals(r.stderr?.startsWith("usage"), true);
    assertEquals(r.stdout, undefined);
});

Deno.test("main: missing file returns exit 1 with io error", () => {
    const r = main(["nonexistent-spec.mmd"]);
    assertEquals(r.exitCode, 1);
    assertEquals(r.stderr?.startsWith("could not read file"), true);
    assertEquals(r.stdout, undefined);
});
