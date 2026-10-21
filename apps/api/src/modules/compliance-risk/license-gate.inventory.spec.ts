import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  LICENCE_GATED_ACTS,
  LICENCE_UNGATED_ACTS,
  LicenseGateService,
  refusal,
} from './license-gate.service';
import type { DerivedLicenseStanding } from './license-standing.config';

/**
 * ONE ANSWER TO "IS THIS OFFICE LICENSED", AND THE GATE USES IT.
 *
 * ## WHAT THIS GUARD IS FOR
 *
 * MEASURED before the gate existed, and this is the whole reason the file is here:
 *
 *   (a) `deriveLicenseStanding` — six states, `mayPractise` beside them — had **zero non-spec
 *       consumers**;
 *   (b) `PolicyService.assertLicenseNotLapsed` was a PRIVATE second derivation with ONE caller;
 *   (c) `BrokerLicense.status` was a stored third, two values against six.
 *
 * A CBJ suspension therefore blocked nothing. The fix is one engine, and the hazard a month from now
 * is not that somebody deletes it — it is that somebody writes a fourth answer, privately, because
 * injecting one more service felt heavier than four lines of date arithmetic. That is exactly how
 * (b) came to exist.
 *
 * So this file reads the api SOURCE and fails by name on:
 *   1. a second derivation — any non-spec file outside this module computing the standing itself;
 *   2. a second refusal — art. 21/a/9 cited anywhere that is not the gate or a display string;
 *   3. the two properties of the old gate that must survive (latest term; live recompute);
 *   4. a gated act with no refusal clause of its own.
 *
 * COMMENTS ARE STRIPPED before any sweep, which is 7d's lesson from the other direction: a file
 * whose only mention of the standing is a comment EXPLAINING that it does not consult it was flagged
 * as a consumer, and a guard with a false positive is a guard people switch off.
 */

const API_SRC = join(__dirname, '..', '..');
const THIS_MODULE = join(API_SRC, 'modules', 'compliance-risk');

/**
 * THE ONE EXEMPTION, AND IT IS A DECLARED LIMIT RATHER THAN A CONVENIENCE.
 *
 * The provider dashboard reads OTHER offices through `ProviderOfficeState`, a
 * `security_invoker = false` view — which exists precisely because those rows are unreachable by
 * RLS. `RegulatoryAction` carries `organizationId`, so it is tenant-scoped like everything else and
 * the view exposes none of it.
 *
 * So that screen can derive an office's standing from the TERM DATES ONLY. It cannot see that the
 * CBJ suspended another office, and it will show such an office as holding a current term.
 *
 * FIXING IT IS A CROSS-OFFICE DISCLOSURE DECISION, NOT A REFACTOR: putting a regulator decision in
 * that view would tell every holder of `provider.office-state.read` that a competitor has been
 * sanctioned, and the view's own migration says no column may be added without making that argument
 * again. It is the owner's call, it is recorded in `docs/deferred-register.md`, and the service
 * declares the limit where it is derived.
 *
 * What makes it survivable is that the dashboard GATES NOTHING. The gate reads the office's own
 * standing, acts included, and refuses on it.
 */
const DECLARED_SECOND_DERIVATION =
  'modules/compliance-risk/provider-office-state.service.ts';

/** The derivation, the gate, the config that holds `pickCurrentTerm`, and the repositories that feed
 *  them. These are the files that ARE the one answer. */
const THE_ONE_ANSWER = [
  join(THIS_MODULE, 'license-gate.service.ts'),
  join(THIS_MODULE, 'license-standing.config.ts'),
  join(THIS_MODULE, 'broker-license.config.ts'),
  join(THIS_MODULE, 'broker-license.service.ts'),
  join(API_SRC, 'repositories', 'broker-license.repository.ts'),
  join(API_SRC, 'repositories', 'regulatory-action.repository.ts'),
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Every non-spec api source file, comments stripped. */
function productionSources(): { path: string; code: string }[] {
  const files = walk(API_SRC).filter(
    (p) => !p.endsWith('.spec.ts') && !p.endsWith('.d.ts'),
  );
  // A floor, not decoration: a glob that silently stops matching reports a clean sweep, which is
  // indistinguishable from a clean tree. This has caught a broken matcher three times in this repo.
  expect(files.length).toBeGreaterThan(400);
  return files.map((p) => ({
    path: relative(API_SRC, p).split(sep).join('/'),
    code: stripComments(readFileSync(p, 'utf8')),
  }));
}

function standing(
  over: Partial<DerivedLicenseStanding> = {},
): DerivedLicenseStanding {
  return {
    status: 'EXPIRED',
    mayPractise: false,
    standingActDecisionRef: null,
    deemedCancelledUnderArticle14C: false,
    ...over,
  };
}

describe('the licence standing has ONE answer', () => {
  it('nothing outside this module derives it, and nothing reads a stored status column', () => {
    const offenders: string[] = [];
    for (const { path, code } of productionSources()) {
      const isTheAnswer = THE_ONE_ANSWER.some(
        (a) => relative(API_SRC, a).split(sep).join('/') === path,
      );
      if (isTheAnswer) continue;
      if (path === DECLARED_SECOND_DERIVATION) continue;
      // A SECOND DERIVATION. `deriveLicenseStanding` and `isBrokerLicenseCurrentlyLapsed` are the
      // two shapes a private copy reaches for — the second is what `PolicyService` used.
      if (
        /\bderiveLicenseStanding\s*\(/.test(code) ||
        /\bisBrokerLicenseCurrentlyLapsed\s*\(/.test(code)
      ) {
        offenders.push(`${path} derives the standing itself`);
      }
      // AND A STORED FLAG. The column is dropped, so this can only be a reinstated one — which
      // would be the third answer coming back.
      if (/\.status\s*===\s*'lapsed'|licenseStatus/.test(code)) {
        offenders.push(`${path} reads a stored licence status`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the article is cited by the gate, not re-argued at a call site', () => {
    const offenders: string[] = [];
    for (const { path, code } of productionSources()) {
      if (path === 'modules/compliance-risk/license-gate.service.ts') continue;
      // `21/a/9` anywhere else in CODE (comments are stripped) means a second refusal sentence.
      // The provider dashboard's wording is a TRANSLATION KEY in the web workspace, which this
      // sweep does not reach, and that is the right place for it: it DISPLAYS a standing rather
      // than deciding one.
      if (/21\s*\/\s*a\s*\/\s*9/.test(code)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every gated act reaches the gate, and the gate is injected rather than re-implemented', () => {
    // Six acts, and each must appear as an `assertMayPractise('<ACT>')` call somewhere in the api.
    // This is the half that catches a gate added to the list and never wired — §1.62's shape, which
    // this repo has shipped twice.
    const all = productionSources()
      .map((f) => f.code)
      .join('\n');
    const unwired = Object.keys(LICENCE_GATED_ACTS).filter(
      (act) => !new RegExp(`assertMayPractise\\(\\s*'${act}'`).test(all),
    );
    expect(unwired).toEqual([]);
  });
});

describe('the two properties of the old gate that must survive', () => {
  it('the LATEST term decides, through pickCurrentTerm — never the term covering today', () => {
    const src = readFileSync(
      join(THIS_MODULE, 'license-gate.service.ts'),
      'utf8',
    );
    const code = stripComments(src);
    // Art. 11 lets an office hold two terms at once: between filing a renewal 45 days before expiry
    // and the old term running out. The NEWER one says whether it may practise, so a reading that
    // picked "the term covering today" would report a renewed office as expiring.
    expect(code).toMatch(/pickCurrentTerm\(\s*terms\s*\)/);
    // And it must not re-sort or re-pick: a second ordering here is a second answer to which term
    // governs, and `pickCurrentTerm` is where that tie-break (expiry, then id) lives.
    expect(code).not.toMatch(/\.sort\(/);
    expect(code).not.toMatch(/find\(\s*\(?t\)?\s*=>/);
  });

  it('it is a LIVE recompute — nothing cached, and `now` is taken as an argument', () => {
    const code = stripComments(
      readFileSync(join(THIS_MODULE, 'license-gate.service.ts'), 'utf8'),
    );
    // The block must be correct the INSTANT `expiresAt` passes, not after a sweep. A cache here
    // would be a fourth answer with a staleness window, and the window is precisely the period in
    // which an office whose licence ended yesterday can still place business.
    // WORD-BOUNDED, after the first version matched `ttl` inside **settling** — in the ungated
    // acts list, so the guard reported a cached standing in a file that has no cache. A
    // three-letter alternation with no boundary is the same class as this repo's `'99'` base64
    // trap: it passes until the day a word happens to contain it.
    expect(code).not.toMatch(/\bcaches?\b|\bcached\b|\bttl\b|\bTTL\b/i);
    // `now` defaults rather than being required, so forgetting it still gives a correct live answer.
    expect(code).toMatch(/now: Date = new Date\(\)/);
  });
});

describe('the refusal says enough to act on', () => {
  it('names the act and cites the article once', () => {
    const s = refusal('RENEW_POLICY', standing());
    expect(s).toContain('Renewing a policy');
    expect(s).toContain('art. 21/a/9');
    expect(s.match(/21\/a\/9/g)).toHaveLength(1);
  });

  it('names a DIFFERENT cause per standing, because the six are not interchangeable', () => {
    // An office with no term on record has a different thing to do from one the CBJ suspended, and
    // a single generic "your licence is not current" would send both to guess.
    const causes = new Set(
      (['NO_TERM_ON_RECORD', 'EXPIRED', 'SUSPENDED', 'CANCELLED'] as const).map(
        (status) => refusal('PLACE_POLICY', standing({ status })),
      ),
    );
    expect(causes.size).toBe(4);
  });

  it('cites the CBJ decision when there is one, and says so when there is not', () => {
    expect(
      refusal(
        'PLACE_POLICY',
        standing({
          status: 'SUSPENDED',
          standingActDecisionRef: 'CBJ/2026/77',
        }),
      ),
    ).toContain('decision CBJ/2026/77');
    // The honest form of the other case. A suspension nobody can cite is the state `RegulatoryAction`
    // exists to end, and asserting a CBJ decision that is not on record would be worse than saying
    // the reference is missing.
    expect(
      refusal('PLACE_POLICY', standing({ status: 'SUSPENDED' })),
    ).toContain('no CBJ decision reference on record');
  });

  it('tells an art. 14/c cancellation apart from one the CBJ decided', () => {
    const deemed = refusal(
      'PLACE_POLICY',
      standing({ status: 'CANCELLED', deemedCancelledUnderArticle14C: true }),
    );
    expect(deemed).toContain('art. 14/c');
    // Only the deemed one is something an office can be surprised by, which is why the flag exists.
    expect(
      refusal(
        'PLACE_POLICY',
        standing({ status: 'CANCELLED', standingActDecisionRef: 'CBJ/9' }),
      ),
    ).not.toContain('art. 14/c');
  });

  it('says what lifts the block, and that existing business is not affected', () => {
    const s = refusal('ISSUE_CERTIFICATE', standing());
    // A refusal with no way forward gets escalated as a system fault. The way out is the mechanism
    // that already existed: `certificateDocumentId` is NOT NULL, so recording the term WITH its
    // certificate is the unblock, and there is no separate act.
    expect(s).toContain('certificate');
    // AND THE OTHER HALF — an over-wide reading of the block is a worse defect than the block
    // missing, so the sentence names what continues.
    expect(s).toMatch(/collection/i);
    expect(s).toMatch(/claims/i);
  });

  it('does not read as a policy statement', () => {
    // The house rule for a regulatory refusal: it cites an instrument, it does not scold.
    const s = refusal('PLACE_POLICY', standing());
    expect(s).not.toMatch(/policy|not allowed|forbidden/i);
  });
});

describe('what is NOT gated, declared', () => {
  it('names ز.٢`s five, so the omission is auditable rather than implicit', () => {
    // These are not a comment: `license-gate.e2e-spec.ts` asserts each as SUCCEEDING with a lapsed
    // licence, because an absence of refusal is not something a negative test can show.
    expect(LICENCE_UNGATED_ACTS).toHaveLength(5);
    expect(LICENCE_UNGATED_ACTS.join(' | ')).toMatch(/collection/i);
    expect(LICENCE_UNGATED_ACTS.join(' | ')).toMatch(/claims/i);
    expect(LICENCE_UNGATED_ACTS.join(' | ')).toMatch(/cancellation/i);
  });

  it('the gate exposes exactly two methods, so a caller cannot ask it a third question', () => {
    const methods = Object.getOwnPropertyNames(
      LicenseGateService.prototype,
    ).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['assertMayPractise', 'standing']);
  });
});
