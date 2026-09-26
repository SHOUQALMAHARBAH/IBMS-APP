import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * THE UNANCHORED READ, AS A TEST.
 *
 * Playwright has three reads that do not auto-wait — `count()`, `evaluateAll()` and
 * `allInnerTexts()` — and one assertion that is satisfied by a blank page, `toHaveCount(0)`. Used
 * before the page has rendered, the first three answer "zero" and the fourth passes. Zero is a
 * plausible number and a passing test is a silent one, so the failure mode is a suite that reports
 * green while measuring an unrendered screen.
 *
 * This happened four times in a single session, in four different files, each written by someone who
 * knew about the trap and had written a comment about it. That is the evidence that a comment is not
 * a control. So:
 *
 *   - the three reads are an eslint error inside every e2e spec, and `e2e/support/anchored.ts` is the
 *     only exemption — enforcement at the point of writing;
 *   - this test enforces the property the helper exists for, at the point of running: every absence
 *     assertion has something POSITIVE asserted before it, in the same test.
 *
 * The two overlap deliberately. `npm run lint` on this package takes minutes on a developer machine;
 * this file takes milliseconds, so it is the copy that actually gets run during a change.
 */
const E2E = join(__dirname, "..", "e2e");

/**
 * An anchor is anything that AUTO-WAITS on a real element: a positive assertion, or an action —
 * `click`/`fill`/`check` all wait for actionability, which cannot be satisfied before render.
 */
const ANCHORS = [
  "toBeVisible",
  "toContainText",
  "toHaveText",
  "toHaveValue",
  "toBeChecked",
  "toBeEnabled",
  "toBeDisabled",
  "toHaveAttribute",
  "toBeFocused",
  "toHaveURL",
  "toHaveTitle",
  "not.toHaveCount",
  "toHaveCount(1",
  "toHaveCount(2",
  "toHaveCount(3",
  "toHaveCount(4",
  "toHaveCount(5",
  "waitFor",
  ".click(",
  ".fill(",
  ".check(",
  ".uncheck(",
  ".selectOption(",
  ".press(",
  ".setInputFiles(",
  ".hover(",
  ".dragTo(",
  // The helpers assert their own anchor, which is the whole reason they exist.
  "anchoredCount",
  "anchoredAttributes",
  "anchoredTexts",
  "expectNone",
];

/** `toBeHidden` is deliberately NOT an anchor: it is satisfied by an element that does not exist. */
const ABSENCE = "toHaveCount(0)";

function specs(): string[] {
  return readdirSync(E2E)
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => join(E2E, f));
}

/**
 * Only WHOLE-LINE comments are stripped. A trailing `//` cannot be removed safely — every mock in
 * this suite contains `http://localhost:4000`, and cutting at the first `//` would delete the rest
 * of a line that may hold the anchor. Whole-line is also how this codebase writes comments.
 */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

/** One entry per `test(...)` block. Block-local is sound here: no `beforeEach` in this suite asserts anything. */
function testBlocks(file: string): { title: string; body: string }[] {
  const code = withoutComments(readFileSync(file, "utf8"));
  return code
    .split(/\ntest(?:\.skip|\.fixme|\.only)?\(/)
    .slice(1)
    .map((body) => ({
      title: (body.match(/^\s*["'`](.+?)["'`]/) ?? [, "(untitled)"])[1] as string,
      body,
    }));
}

describe("an absence assertion is anchored on something that proves the page rendered", () => {
  it("has no toHaveCount(0) that a blank page would satisfy", () => {
    const unanchored: string[] = [];
    for (const file of specs()) {
      for (const { title, body } of testBlocks(file)) {
        const at = body.indexOf(ABSENCE);
        if (at === -1) continue;
        const before = body.slice(0, at);
        if (!ANCHORS.some((a) => before.includes(a))) {
          unanchored.push(`${file.split(/[\\/]/).pop()} :: ${title}`);
        }
      }
    }
    expect(
      unanchored,
      'An absence assertion with nothing positive asserted before it cannot tell "correctly withheld" from "never rendered" — it passes either way. Assert something that MUST be on the page first, or use expectNone(target, anchor) from e2e/support/anchored.',
    ).toEqual([]);
  });

  it("scans real specs and really finds absence assertions, so the guarantee is not vacuous", () => {
    // Both halves matter. A wrong directory makes the test above pass by scanning nothing; a broken
    // block split makes it pass by finding no assertions to check. This is the standard failure of
    // every "we assert the absence of X" test, and it is worth its own assertion.
    const files = specs();
    expect(files.length, "no spec files found — check E2E").toBeGreaterThan(50);

    const blocks = files.flatMap((f) => testBlocks(f));
    expect(blocks.length, "no test blocks parsed — the split pattern has drifted").toBeGreaterThan(400);

    const asserting = blocks.filter((b) => b.body.includes(ABSENCE));
    expect(asserting.length, "no absence assertions found — nothing is being checked").toBeGreaterThan(50);
  });
});

describe("the three non-waiting reads are reached only through the helper", () => {
  // eslint enforces this while typing; this is the copy that runs in the fast gate. A spec that calls
  // `count()` directly is not wrong today — it is wrong on the day someone moves it above the anchor.
  const RAW_READS = [".count()", ".evaluateAll(", ".allInnerTexts()", ".allTextContents()"];

  it("appears in no spec file", () => {
    const offenders: string[] = [];
    for (const file of specs()) {
      const code = withoutComments(readFileSync(file, "utf8"));
      for (const read of RAW_READS) {
        if (code.includes(read)) offenders.push(`${file.split(/[\\/]/).pop()} calls ${read}`);
      }
    }
    expect(
      offenders,
      "These reads do not auto-wait: before render they answer 0 or []. Use anchoredCount / anchoredAttributes / anchoredTexts / expectNone from e2e/support/anchored.",
    ).toEqual([]);
  });

  it("is available from the helper, which is where the waiting happens", () => {
    const helper = readFileSync(join(E2E, "support", "anchored.ts"), "utf8");
    for (const name of ["anchoredCount", "anchoredAttributes", "anchoredTexts", "expectNone"]) {
      expect(helper, `${name} is missing from the helper`).toContain(`export async function ${name}`);
    }
    // Each one anchors before reading. Without this, the helper could be an alias for the raw read.
    expect(helper.match(/toBeVisible/g)?.length, "every helper must assert its anchor first").toBe(4);
  });
});
