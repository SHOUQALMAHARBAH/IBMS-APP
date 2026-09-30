#!/usr/bin/env node
/**
 * Extract a test run's summary line, and FAIL LOUDLY when there is nothing to extract.
 *
 * ## Why this exists
 *
 * Three times in one session an extraction matched nothing and the nothing read as a result:
 *
 *   1. `grep -E "Tests +[0-9]+ (failed|passed)"` — defeated by the ANSI colour codes vitest writes
 *      BETWEEN the word "Tests" and the count. Six plants printed six blank lines, which is exactly what
 *      six plants that killed nothing would print.
 *   2. The same pattern again on a later loop, same cause.
 *   3. `grep -E "^ *[0-9]+ (failed|passed)"` on Playwright — and the real reason there was no summary was
 *      that `CI=1` had correctly refused a lingering dev server on port 3000. The grep swallowed the one
 *      message that explained the blank.
 *
 * The lesson was written down after each and recurred after each. So the TOOL changes, which is the same
 * conclusion `plant.mjs` reached: it refuses an empty plant list rather than trusting anyone to notice.
 *
 * **Blank is not zero, and the two must not print the same.**
 *
 * ## What it does
 *
 * Reads a test run's output on stdin, strips ANSI, and prints the summary. If no summary is found it exits
 * NON-ZERO and prints the tail of the input, so the actual cause — a port in use, a missing DATABASE_URL, a
 * crashed bootstrap — is visible rather than hidden behind an empty line.
 *
 * Usage:
 *   npx vitest run path/to.spec.ts 2>&1 | node scripts/test-summary.mjs
 *   npx playwright test e2e/x.spec.ts 2>&1 | node scripts/test-summary.mjs --expect-fail
 *   node scripts/test-summary.mjs --self-test
 *
 * `--expect-fail` inverts the exit code: the run is EXPECTED to report at least one failure, which is what
 * a plant asserts. It exits non-zero when everything passed — so a plant that killed nothing is a red,
 * not a line somebody has to read carefully.
 */
import fs from 'node:fs';

/** Matchers for the runners this repo uses. Each must capture `passed` and, where present, `failed`. */
const SUMMARY_PATTERNS = [
  // vitest:  " Tests  2 failed | 3 passed (5)"  /  " Tests  12 passed (12)"
  {
    runner: 'vitest',
    re: /^\s*Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed/m,
    failed: 1,
    passed: 2,
  },
  // vitest, everything failed: " Tests  2 failed (2)"
  { runner: 'vitest', re: /^\s*Tests\s+(\d+) failed\s*\(/m, failed: 1, passed: null },
  // playwright: "  1 failed" + "  6 passed (30.4s)" — two lines, so matched separately below.
  { runner: 'playwright', re: /^\s*(\d+) passed \(/m, failed: null, passed: 1 },
];
const PLAYWRIGHT_FAILED = /^\s*(\d+) failed\s*$/m;

/**
 * vitest's FILE-level line: " Test Files  1 failed | 12 passed (13)".
 *
 * THE GAP THIS CLOSES, WHICH WAS THIS TOOL'S OWN FAILURE MODE. A test file that cannot LOAD contributes no
 * failing tests, so the `Tests` line reads clean. On 2026-09-30 vitest printed
 *
 *     Test Files  1 failed | 12 passed (13)
 *           Tests  118 passed (118)
 *
 * and this tool reported "118 passed, 0 failed" and EXITED 0 — which is precisely the "blank is not zero"
 * mistake it exists to prevent, one level up: not a missing summary, but a summary that is true about tests
 * while a whole file never ran. Six tests were silently absent from every figure reported that way.
 *
 * The file in question read a path relative to `process.cwd()` and the run used `--root`, so it threw on
 * import. That is a common shape — a bad import, a missing env var, a syntax error — and in every case the
 * honest answer is that the suite did not run, not that it passed.
 */
const VITEST_FILES_FAILED = /^\s*Test Files\s+(?:.*?\|\s*)?(\d+) failed/m;
const VITEST_FILES_FAILED_FIRST = /^\s*Test Files\s+(\d+) failed/m;

/** ANSI, including the colour codes vitest puts INSIDE the summary line. Failure mode 1 and 2. */
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, '');
}

export function summarise(rawOutput) {
  const text = stripAnsi(rawOutput);
  for (const p of SUMMARY_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const passed = p.passed === null ? 0 : Number(m[p.passed]);
    let failed = p.failed === null ? 0 : Number(m[p.failed] ?? 0);
    if (p.runner === 'playwright' && p.failed === null) {
      const f = PLAYWRIGHT_FAILED.exec(text);
      failed = f ? Number(f[1]) : 0;
    }
    // A FILE that failed to load counts as a failure even though no test did. Added to `failed` rather
    // than reported separately, so every existing caller — including `--expect-fail` and the exit code —
    // treats it as what it is: a run that did not happen.
    let fileFailures = 0;
    if (p.runner === 'vitest') {
      const ff = VITEST_FILES_FAILED_FIRST.exec(text) ?? VITEST_FILES_FAILED.exec(text);
      fileFailures = ff ? Number(ff[1]) : 0;
    }
    return {
      runner: p.runner,
      passed,
      failed: failed + fileFailures,
      fileFailures,
      // Trailing `(` trimmed off the echoed line: the Playwright matcher has to include it to avoid
      // matching a bare "7 passed" inside prose, but echoing `[36 passed (]` reads like truncated output —
      // and a tool whose own output looks broken is a tool people stop trusting.
      line:
        m[0].trim().replace(/\s*\($/, '') +
        (fileFailures > 0
          ? `  — plus ${fileFailures} test FILE(S) that failed to load, contributing no failing tests`
          : ''),
    };
  }
  return null;
}

function tail(text, n) {
  const lines = stripAnsi(text).trimEnd().split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ self-test */

function selfTest() {
  const cases = [
    {
      // THE REAL CASE, verbatim from a 2026-09-30 run. A test file that could not LOAD contributed no
      // failing tests, so the Tests line read clean and this tool said "118 passed, 0 failed" and exited 0.
      // Six tests were missing from every figure reported that way. Built from the actual output rather
      // than invented, which is this repo's rule for a self-test case.
      name: 'vitest, a test FILE failed to load while every test that ran passed',
      input:
        ' Test Files  1 failed | 12 passed (13)' + String.fromCharCode(10) +
        '       Tests  118 passed (118)' + String.fromCharCode(10),
      expect: { passed: 118, failed: 1 },
    },
    {
      name: 'vitest, all passed',
      input: '[2m Test Files [22m 1 passed\n[2m      Tests [22m [1m[32m12 passed[39m[22m[90m (12)[39m\n',
      expect: { passed: 12, failed: 0 },
    },
    {
      name: 'vitest, mixed — THE ANSI CASE that defeated the grep three times',
      input: '[2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m4 passed[39m[22m[90m (5)[39m\n',
      expect: { passed: 4, failed: 1 },
    },
    {
      name: 'vitest, everything failed',
      input: '      Tests  2 failed (2)\n',
      expect: { passed: 0, failed: 2 },
    },
    {
      name: 'playwright, all passed',
      input: 'Running 7 tests using 2 workers\n·······\n  7 passed (24.6s)\n',
      expect: { passed: 7, failed: 0 },
    },
    {
      name: 'playwright, one failed',
      input: '  1 failed\n    [chromium] › e2e/x.spec.ts:12:5 › a thing\n  6 passed (30.4s)\n',
      expect: { passed: 6, failed: 1 },
    },
    {
      name: 'THE PORT-IN-USE CASE — no summary at all, must return null rather than zero',
      input:
        'Error: http://localhost:3000 is already used, make sure that nothing is running on the port/url\n::error ::Error: http://localhost:3000 is already used\n',
      expect: null,
    },
    {
      name: 'empty input — must return null, never a zero-passed summary',
      input: '',
      expect: null,
    },
  ];

  let failures = 0;
  for (const c of cases) {
    const got = summarise(c.input);
    let ok;
    if (c.expect === null) {
      ok = got === null;
    } else {
      ok = got !== null && got.passed === c.expect.passed && got.failed === c.expect.failed;
    }
    console.log(`  ${ok ? 'ok  ' : '*** FAIL *** '}${c.name}`);
    if (!ok) {
      failures += 1;
      console.log(`      expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }
  if (failures) {
    console.error(`\nSELF-TEST FAILED — ${failures} case(s).`);
    process.exit(1);
  }
  console.log('\nSELF-TEST PASSED — a blank run is distinguishable from a zero-failure run.');
  return 0;
}

/* ------------------------------------------------------------------------ main */

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const expectFail = args.includes('--expect-fail');
  const raw = readStdin();
  const summary = summarise(raw);

  if (!summary) {
    // THE WHOLE POINT. An extractor that finds nothing says so, and shows what it was looking at, because
    // the reason for the blank is almost always IN the output that got swallowed.
    console.error('NO TEST SUMMARY FOUND — this is NOT a passing run and NOT zero failures.');
    console.error(
      'Nothing matched a known vitest or Playwright summary line, which means the run did not reach its ' +
        'own summary. Common causes: a port already in use (Playwright with CI=1 refuses a lingering dev ' +
        'server), a missing DATABASE_URL, or a crash during bootstrap.',
    );
    console.error('\n--- last 25 lines of the output it was given -------------------');
    console.error(tail(raw, 25) || '(the input was EMPTY — was the command piped in at all?)');
    console.error('---------------------------------------------------------------');
    process.exit(1);
  }

  console.log(
    `${summary.runner}: ${summary.passed} passed, ${summary.failed} failed   [${summary.line}]`,
  );

  if (expectFail && summary.failed === 0) {
    console.error(
      '\nEXPECTED AT LEAST ONE FAILURE and everything passed. If this was a plant, the plant killed ' +
        'nothing — either it did not apply, or no test observes what it changed.',
    );
    process.exit(1);
  }
  if (!expectFail && summary.failed > 0) process.exit(1);
  return 0;
}

main();
