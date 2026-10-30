import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * AN EXPLICIT PER-FILE TIMEOUT, for the reason `float-money.inventory.spec.ts` records at
 * length: this spec READS THE API SOURCE TREE, which is genuinely hundreds of files of I/O
 * against vitest's 5000ms default, and `apps/api` sets no `testTimeout`. FILE-SCOPED, never
 * global — 5s is a real signal for the thousands of ordinary unit tests beside it.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * OWNER DECISION 52 — THIS SPEC IS THE PREMISE OF A SECURITY RECORD, NOT A STYLE RULE.
 *
 * `scripts/audit-check.mjs` records `multer` GHSA-q7qp-rjg7-q26m (DoS via a pending
 * ASYNCHRONOUS `fileFilter` after request teardown) as NOT EXPOSED — which is a different
 * and stronger claim than "a known vulnerability accepted", and the owner's ruling turns on
 * exactly that difference. The advisory's own words: *any application using multer with an
 * asynchronous fileFilter is affected... uploads using a synchronous fileFilter are not
 * affected.*
 *
 * THE RECORD RESTS ON EXACTLY TWO FACTS, AND IF EITHER CHANGES THE RECORD BECOMES FALSE
 * WITHOUT ANYTHING FAILING. That is what this spec exists to stop:
 *
 *   1. No upload route anywhere in this api passes a `fileFilter`.
 *   2. No upload route passes `files` greater than 1 — so no second file can sit with a
 *      filter pending while another is rejected, which IS the mechanism the advisory
 *      describes.
 *
 * SO IT FAILS ON THE PREMISE RATHER THAN ON THE FEATURE. A developer who adds a
 * `fileFilter` has not broken the upload; they have invalidated a security record, and the
 * message says so and names the file to edit. The acknowledgement must come out in the same
 * commit.
 *
 * AN INVENTORY OVER THE WHOLE SOURCE TREE, NEVER OVER ONE CONTROLLER, and that is the point
 * rather than thoroughness for its own sake: today `legacy-import.controller.ts` is the only
 * multipart route in the api, and a check written against that file would say nothing at all
 * about the SECOND upload route somebody adds next month. The hazard is a new route, not a
 * change to the old one.
 *
 * WHY THIS IS A WAIT WITH A DATE AND NOT A PERMANENT EXEMPTION: the fix exists upstream in
 * multer 2.5.0, and what is being waited for is Nest moving its exact pin.
 * `@nestjs/platform-express` pins `multer: 2.4.0` EXACTLY, and every published version
 * through 12.2.0 still pins 2.4.0 — checked one at a time rather than off the latest major.
 * That sentence is what makes the 2026-11-24 review date honest.
 *
 * AND `multer` IS NOT OUR DEPENDENCY, which is the measurement that withdrew the obvious
 * remedy. It appears exactly ONCE in the lockfile, as a dependency of
 * `@nestjs/platform-express`, and is declared in no `package.json` of ours. So removing our
 * one upload route would NOT remove the package and would NOT clear the advisory — it would
 * cost the customer-import feature and buy nothing.
 */

const API_SRC = join(__dirname, '..');

/**
 * The four Nest multipart interceptors. Named rather than pattern-matched on `Interceptor`,
 * because that word is all over this codebase for things with no file in them.
 */
const UPLOAD_INTERCEPTORS = [
  'FileInterceptor',
  'FilesInterceptor',
  'AnyFilesInterceptor',
  'FileFieldsInterceptor',
] as const;

function allSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allSources(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      out.push(full);
  }
  return out;
}

/**
 * Comments stripped before matching. This repository has twice been bitten the other way —
 * a guard that read a model named only in a COMMENT as "cleared", and one that flagged a
 * file whose single mention of a word was the paragraph explaining what it refuses to do.
 * Here it matters directly: the upload controller carries a comment about `diskStorage`, and
 * the header above mentions `fileFilter` many times.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** One call to a multipart interceptor: which file, which interceptor, and its argument text. */
interface UploadSite {
  file: string;
  interceptor: string;
  /** The parenthesised argument list, balanced, so a nested options object is kept whole. */
  args: string;
}

/**
 * Reads the balanced argument list of a call starting at `open` (the index of its `(`).
 * A regex cannot do this: the options object contains its own braces and parentheses, and
 * `[^)]*` stops at the first `)` inside `limits: { ... }` on a multi-line call. A matcher
 * that silently truncates its own capture is how this repository got a confidently wrong
 * answer out of a nested template literal.
 */
function balancedArgs(source: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function uploadSites(): UploadSite[] {
  const sites: UploadSite[] = [];
  for (const file of allSources(API_SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const interceptor of UPLOAD_INTERCEPTORS) {
      // The CALL, not the import. `\s*\(` is what separates `FileInterceptor('file', {...})`
      // from `import { FileInterceptor } from ...`, which would otherwise be a site with no
      // arguments and would make every assertion below vacuously true for that file.
      const pattern = new RegExp(`\\b${interceptor}\\s*\\(`, 'g');
      for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
        const open = m.index + m[0].length - 1;
        const args = balancedArgs(source, open);
        if (args === null) continue;
        sites.push({
          file: file.slice(API_SRC.length + 1).replace(/\\/g, '/'),
          interceptor,
          args,
        });
      }
    }
  }
  return sites;
}

describe('owner decision 52: the multer advisory is NOT EXPOSED, and these are its two premises', () => {
  /*
   * THE NON-VACUITY FLOOR, FIRST, because every assertion below is a loop and an empty loop
   * passes. If the extraction breaks — an interceptor renamed upstream, the balanced-argument
   * reader returning null, the comment stripper eating a call — this spec would report a clean
   * nothing, which is indistinguishable from "no upload route passes a fileFilter" and is the
   * failure mode this repository has paid for four times.
   */
  it('finds the upload routes at all — a clean nothing here is a broken extractor', () => {
    const sites = uploadSites();
    expect(
      sites.length,
      'No multipart upload route was found anywhere in apps/api/src. That is almost certainly ' +
        'this spec breaking rather than the routes going away: check UPLOAD_INTERCEPTORS against ' +
        "Nest's current exports, and check balancedArgs. If an upload route really was removed, " +
        'note that it does NOT remove multer — the package is a dependency of ' +
        '@nestjs/platform-express and is declared in no package.json of ours.',
    ).toBeGreaterThan(0);

    // And the one route we know about is named, so a rename cannot turn this into a loop over
    // one file fewer and pass.
    expect(
      sites.map((s) => s.file),
      "customer/legacy-import.controller.ts is the api's only multipart route and is not in the " +
        'extracted set — re-point this expectation rather than deleting it.',
    ).toContain('modules/customer/legacy-import.controller.ts');
  });

  it('PREMISE 1 — no upload route passes a fileFilter', () => {
    const offenders = uploadSites().filter((s) =>
      /\bfileFilter\b/.test(s.args),
    );
    expect(
      offenders.map((s) => `${s.file} (${s.interceptor})`),
      'An upload route now passes a `fileFilter`, which INVALIDATES A SECURITY RECORD rather ' +
        'than breaking an upload. `scripts/audit-check.mjs` records multer ' +
        'GHSA-q7qp-rjg7-q26m as NOT EXPOSED on the ground that this product contains no ' +
        'fileFilter at all — the advisory says a SYNCHRONOUS filter is unaffected, but the ' +
        'record does not depend on reading your filter correctly, it depends on there being ' +
        'none. Remove the filter, or remove the ACKNOWLEDGED entry in the same commit and let ' +
        'the gate block until multer 2.5.0 is reachable.',
    ).toEqual([]);
  });

  it('PREMISE 2 — no upload route accepts more than one file', () => {
    /*
     * `files: N` inside the options object. The second premise is not decoration: the
     * advisory's mechanism is a request that is ABORTED because one file was rejected while
     * another file's filter is still pending, so a route that can only ever receive one file
     * cannot reach it even if a filter were added by accident.
     *
     * A MISSING `files` IS ALSO A FAILURE HERE, deliberately, and it is the direction that
     * matters: multer's own default is UNLIMITED files, so a route that says nothing is a
     * route that accepts many. Reading "no `files` key" as safe would be exactly backwards.
     */
    const bad: string[] = [];
    for (const site of uploadSites()) {
      const match = /\bfiles\s*:\s*(\d+)/.exec(site.args);
      if (!match) {
        bad.push(
          `${site.file} (${site.interceptor}) — declares NO \`files\` limit, and multer's ` +
            'default is unlimited',
        );
        continue;
      }
      if (Number(match[1]) > 1) {
        bad.push(
          `${site.file} (${site.interceptor}) — \`files: ${match[1]}\`, more than one`,
        );
      }
    }
    expect(
      bad,
      'An upload route accepts more than one file (or declares no limit, which means ' +
        'unlimited). That is the second premise of the multer NOT-EXPOSED record in ' +
        '`scripts/audit-check.mjs`: with `files: 1` there can never be a second file sitting ' +
        'with a filter pending while another is rejected, which IS the mechanism ' +
        'GHSA-q7qp-rjg7-q26m describes. Either keep the limit at 1, or remove the ' +
        'ACKNOWLEDGED entry in the same commit.',
    ).toEqual([]);
  });

  it('the record it defends still exists and still names a review date', () => {
    /*
     * The other half of the pairing. Without this, deleting the ACKNOWLEDGED entry would
     * leave three green tests guarding a premise for a record that is gone — and deleting the
     * record is the RIGHT move when a premise fails, so the two have to be able to see each
     * other.
     */
    const gate = readFileSync(
      join(API_SRC, '../../../scripts/audit-check.mjs'),
      'utf8',
    );
    expect(
      gate.includes('GHSA-q7qp-rjg7-q26m'),
      'The multer entry has gone from scripts/audit-check.mjs. If multer 2.5.0 became ' +
        'reachable and the entry was removed, DELETE THIS SPEC in the same commit — a premise ' +
        'guard for a record that no longer exists is three tests nobody can interpret.',
    ).toBe(true);
    expect(
      gate.includes("reviewBy: '2026-11-24'"),
      'The multer entry has lost its review date. Rule 3 of that file exists so an ' +
        'acknowledgement cannot quietly become permanent.',
    ).toBe(true);
  });
});
