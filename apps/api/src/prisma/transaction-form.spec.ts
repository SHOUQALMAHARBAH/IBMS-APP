import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 NOTHING USES THE ARRAY FORM OF `$transaction` — AND THE REASON IS A CROSS-OFFICE READ, NOT A
 * STYLE PREFERENCE.
 *
 * `tenant-scope.extension.ts` refuses it by name:
 *
 *   «The array form of $transaction is not supported under tenant isolation: its operations are
 *    built before the transaction opens, so app.current_org_id cannot be set for them. Use the
 *    callback form, $transaction(async (tx) => ...).»
 *
 * So an array-form call does not merely fail to be atomic — its operations would run with **no
 * tenant scope at all**. The extension throws, which is the right outcome; what it cannot do is
 * tell the author before they push.
 *
 * ## Why this file exists
 *
 * Decision 167/13's invoice list was written as `$transaction([findMany, count])`, reasoning that a
 * page and its total must be one atomic read. ⚠️ **It was the only array-form call in the
 * codebase, and nothing caught it locally**: `tsc` is happy (the overload exists on the base
 * client), every unit test mocks the repository, and the extension's throw is reachable only
 * through a real Prisma client — which means the api e2e, which does not run on the authoring
 * machine. CI's step 27 answered 500 and named it.
 *
 * ⟶ So this is the guard that runs in BOTH places, which is the lesson #80 paid for twice: anything
 *   the authoring machine cannot verify gets a check that it can.
 *
 * ## ⛔ And the answer is not always the callback form either
 *
 * `/policies` needs a page and a count and uses NO transaction: `findManyForActor` and
 * `countForActor` are two methods over `buildPolicyListWhere`, and its own comment states the
 * guarantee — «counts on the SAME `where` the page query runs, so the two can never disagree about
 * what is being counted». The shared builder is what makes them agree. `invoice.repository.ts`
 * follows that, with `buildInvoiceListWhere`.
 */

const API_SRC = join(__dirname, '..');

/** Every `.ts` under `apps/api/src` that is not a test. */
function productionSources(): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      if (entry.endsWith('.spec.ts') || entry.endsWith('.double.ts')) continue;
      out.push({
        path: full
          .slice(API_SRC.length + 1)
          .split('\\')
          .join('/'),
        code: readFileSync(full, 'utf8'),
      });
    }
  };
  walk(API_SRC);
  return out;
}

/**
 * ⚠️ COMMENTS STRIPPED, AND NEWLINES KEPT.
 *
 * The fix's own comment QUOTES `$transaction([findMany, count])` while explaining why it is wrong —
 * so a matcher over raw text reports the file that fixed the defect. That is the
 * comment-quotes-the-pattern blindness this repository has met more than nine times, and it is why
 * a permanent case for it sits in the self-test below.
 *
 * Newlines are preserved so a reported line number is the real one.
 */
function withoutComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) =>
      '\n'.repeat((m.match(/\n/g) ?? []).length),
    )
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
}

/** `$transaction(` followed by an opening bracket — the array form, in any spacing. */
const ARRAY_FORM = /\$transaction\s*\(\s*\[/;

describe('the array form of $transaction is never used', () => {
  it('no production source under apps/api/src calls it', () => {
    const offenders: string[] = [];
    for (const { path, code } of productionSources()) {
      const stripped = withoutComments(code);
      if (!ARRAY_FORM.test(stripped)) continue;
      const line =
        stripped.split('\n').findIndex((l) => ARRAY_FORM.test(l)) + 1;
      offenders.push(`${path}:${line}`);
    }
    expect(
      offenders,
      'The array form of $transaction runs its operations with NO tenant scope — tenant-scope.extension.ts throws on it. ' +
        'Use the callback form, $transaction(async (tx) => …) — or, for a page and its count, two calls over ONE shared `where` builder as /policies does.',
    ).toEqual([]);
  });

  it('the sweep is not vacuous — it really reads the repositories', () => {
    /*
     * A walk that found nothing would pass the test above while proving nothing. This pins that the
     * file the defect was in is among the sources read, and that the codebase does use the CALLBACK
     * form somewhere — so the matcher is discriminating between the two forms rather than finding
     * no transactions at all.
     */
    const sources = productionSources();
    expect(sources.length).toBeGreaterThan(200);
    expect(
      sources.some((s) => s.path === 'repositories/invoice.repository.ts'),
    ).toBe(true);
    expect(
      sources.some((s) => /\$transaction\s*\(\s*async/.test(s.code)),
      'the callback form should exist somewhere, or this matcher is not telling the two apart',
    ).toBe(true);
  });

  it('⚠️ and a COMMENT quoting the array form is NOT a finding', () => {
    /*
     * THE PERMANENT CASE. `invoice.repository.ts`'s own comment quotes
     * `$transaction([findMany, count])` while recording why it is wrong, and a raw-text matcher
     * reports the file that FIXED the defect. Both comment forms are covered.
     */
    const block = `
      /* a note mentioning $transaction([findMany, count]) as history */
      const x = 1;
    `;
    const line = `
      // another note: $transaction([a, b]) is refused under tenant isolation
      const y = 2;
    `;
    expect(ARRAY_FORM.test(withoutComments(block))).toBe(false);
    expect(ARRAY_FORM.test(withoutComments(line))).toBe(false);
    // AND THE OTHER DIRECTION: real code is still caught once the comments are gone.
    expect(
      ARRAY_FORM.test(
        withoutComments(`
          /* a note */
          await prisma.$transaction([one, two]);
        `),
      ),
    ).toBe(true);
  });

  it('⚠️ and a URL is not a comment — the stripper must not eat one', () => {
    /*
     * `//` inside `https://…` is not a line comment. The stripper requires the two slashes not to
     * be preceded by a colon, and this pins it: a file whose only `$transaction([` sits after a URL
     * on the same line must still be caught.
     */
    const code =
      'const doc = "https://pris.ly/x"; await p.$transaction([a, b]);';
    expect(ARRAY_FORM.test(withoutComments(code))).toBe(true);
  });

  it('the extension really is what refuses it — the premise, not an assumption', () => {
    const extension = readFileSync(
      join(API_SRC, 'prisma', 'tenant-scope.extension.ts'),
      'utf8',
    );
    expect(extension).toContain(
      'The array form of $transaction is not supported',
    );
    // And it refuses by TESTING for an array, so the throw is reachable for any array argument.
    expect(extension).toMatch(/Array\.isArray\(\s*arg\s*\)/);
  });
});
