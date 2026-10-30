import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE COMPANY'S LICENCE STANDING GATES NOTHING — asserted as an ABSENCE, because that is the only
 * form that can fail.
 *
 * 7d's brief: *"NO refusal, NO warning on any action, NO gate. We have no article gating an office's
 * dealings with a company whose licence lapsed, and the absence is asserted."*
 *
 * This is not caution. The broker's own lapse rule BLOCKS new business, and it blocks under a named
 * article — art. 21/a/9. Nothing in this product establishes any article gating an office's dealings
 * with a company whose recorded licence has run out, so a refusal here would be a regulatory reading
 * nobody has made, enforced on a real office. The same refusal `broker-license-scope.config.ts`
 * declines to write about the 26 official branches, and the same refusal the retention floors
 * decline for a category whose statute nobody has read.
 *
 * ## WHAT THIS CHECKS, AND WHY IT IS A SWEEP RATHER THAN A LIST
 *
 * Every service and controller in `apps/api/src` is read. The standing may be DERIVED and RETURNED
 * by the company-record module and by nothing else — any other file mentioning it is either gating
 * on it or re-deriving it somewhere a reader cannot see, and both are the thing the brief forbids. A
 * hand-kept list of permitted files would go stale the first time a module was added; a sweep cannot.
 *
 * MEASURED BEFORE BUILDING, so the baseline is known rather than assumed: `insurerLicenseNumber` had
 * four non-spec readers — the company-record read and its view, the registration write, and the two
 * screens — and not one of them was a gate. 7d adds none.
 */

// File-scoped, never global: this spec walks the api source tree, and vitest's 5000ms default is a
// real signal for the thousands of ordinary tests beside it.
vi.setConfig({ testTimeout: 60_000 });

const API_SRC = join(__dirname, '..', '..');

/** Every `.ts` under `apps/api/src`, excluding specs — the files that could contain a gate. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (name.endsWith('.ts') && !name.includes('.spec.')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(API_SRC);

/**
 * The file with its COMMENTS REMOVED — and this is not a nicety, it is the defect this gate had on
 * its first run.
 *
 * It flagged `insurance-company-registration.service.ts`, whose only mention is a comment saying the
 * standing is NOT written; and it flagged the derivation itself for the word "refuse", which appears
 * in the paragraph explaining what it refuses to do. A mention in prose is not a gate.
 *
 * `check:seed-sweeps` recorded the same thing from the other direction — a model named only in a
 * COMMENT read as "cleared" — which is this repository's own rule biting inside the gate built to
 * enforce it. Twice now, so it is stripped rather than reasoned about.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The only files permitted to know the standing exists: the config that derives it, and the
 * company-record module that shows it on the company's own record.
 */
const PERMITTED = [
  join('modules', 'company', 'insurance-company-license.config.ts'),
  join('modules', 'company', 'company-record.service.ts'),
];

describe('the company licence standing reaches no gate', () => {
  it('the sweep found a real source tree — the floor, before any absence is claimed', () => {
    // Without this, a broken walk reports a clean result: every absence assertion below would pass
    // over an empty list. This project has recorded that failure three times, once inside a gate
    // built to prevent it.
    expect(FILES.length).toBeGreaterThan(400);
    const names = FILES.map((f) => f.slice(API_SRC.length + 1));
    for (const p of PERMITTED) {
      expect(names, `${p} must be in the swept set`).toContain(p);
    }
  });

  it('no file outside the company-record module mentions it at all', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const relative = file.slice(API_SRC.length + 1);
      if (PERMITTED.includes(relative)) continue;
      const text = codeOnly(readFileSync(file, 'utf8'));
      if (
        text.includes('licenseStanding') ||
        text.includes('deriveCompanyLicenseStanding') ||
        text.includes('InsuranceCompanyLicenseStanding')
      ) {
        offenders.push(relative);
      }
    }
    expect(
      offenders,
      'The company licence standing is shown on the company own record and NOWHERE else, and it ' +
        'gates nothing (7d). A file outside that module is either refusing on it or re-deriving it ' +
        'somewhere a reader cannot see. We hold NO article gating an office dealings with a company ' +
        'whose recorded licence has run out, so a refusal here would enforce a regulatory reading ' +
        'nobody has made. If the gateway module is what needs this, read the reopening condition in ' +
        'insurance-company-license.config.ts first: whether an expired recorded licence declares ' +
        'itself at a contract request is the owner decision, not an inference.',
    ).toEqual([]);
  });

  it('and the config that derives it refuses nothing itself', () => {
    const raw = readFileSync(
      join(
        API_SRC,
        'modules',
        'company',
        'insurance-company-license.config.ts',
      ),
      'utf8',
    );
    // The floor FIRST, against the raw text: it is the right file and it does derive.
    expect(raw).toContain('deriveCompanyLicenseStanding');
    // And then the absence against CODE ONLY — the file's own header discusses refusals at length,
    // which is exactly why the first version of this test failed on the word "refuse".
    const code = codeOnly(raw);
    for (const token of ['throw ', 'Exception', 'Forbidden']) {
      expect(
        code,
        `the derivation must not ${token.trim()} — it reports a standing and decides nothing`,
      ).not.toContain(token);
    }
  });

  it('nor does the term carry a status column for anything to branch on', () => {
    /*
     * The decision was already recorded — the registration DTO #12, decision 71 and the
     * dictionary's correction 3 («حالة الترخيص لا تُخزَّن») — and the migration asserts it by NAME
     * SHAPE so `status`, `licenseStatus` and `licenseStatusId` are all refused. Asserted here too
     * against the schema, because a column is what a future gate would reach for first.
     */
    const schema = readFileSync(
      join(
        API_SRC,
        '..',
        '..',
        '..',
        'packages',
        'db',
        'prisma',
        'schema.prisma',
      ),
      'utf8',
    );
    const start = schema.indexOf('model InsuranceCompanyLicenseTerm {');
    expect(start, 'the model must exist').toBeGreaterThan(-1);
    const block = schema.slice(start, schema.indexOf('\n}', start));
    expect(block).toContain('expiresAt');
    expect(block.toLowerCase()).not.toContain('status');
  });
});
