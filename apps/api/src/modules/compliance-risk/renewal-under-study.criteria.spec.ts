import { describe, expect, it } from 'vitest';
import {
  deriveLicenseStanding,
  type LicenseTermRow,
  type RegulatoryActRow,
} from './license-standing.config';
import { INSTRUMENT_LICENCE_FIGURES } from './legal-figures.double';

/**
 * 🔴 OWNER DECISION 128 §٧ — THE NINE QUALITY CRITERIA, EACH NAMED BY ITS NUMBER.
 *
 * «المكتب اللي خلص ترخيصه وقدّم التجديد بوقته ورفع إثبات التقديم بكمّل يصدر ويجدّد.»
 *
 * ## WHY A PURE UNIT SPEC FOR SEVEN OF THE NINE
 *
 * The same reason `license-standing.config.spec.ts` gives: db-test holds ONE brokerage office with
 * a term expiring far in the future and ZERO regulatory acts, so an e2e over it cannot reach a
 * single branch below. Three plants once survived an e2e in this module for exactly that reason.
 *
 * Criteria 8 and 9 are NOT here and cannot be — 8 is what a SCREEN renders and 9 is tenant
 * isolation, which `tenantScopeExtension` answers before the database is asked. Each is named at
 * the bottom of this file with the file that does prove it, rather than left to look covered.
 *
 * ⛔ NOTHING HERE READS THE CLOCK. Every case picks `now`, which is what makes criterion 7
 * ("advance the clock a year and nothing changes") a real assertion rather than a wait.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Past the printed expiry, with everything in order unless a case says otherwise. */
function term(over: Partial<LicenseTermRow> = {}): LicenseTermRow {
  return {
    issuedAt: d('2024-01-15'),
    expiresAt: d('2026-12-31'),
    // art. 11's deadline is 45 days before expiry, read from the legal-values catalogue.
    renewalRequestedAt: d('2026-10-01'),
    renewalProofDocumentId: 'doc-proof-1',
    renewalReferenceNumber: 'CBJ/IN/2026/4471',
    hasRenewalDeclaration: true,
    ...over,
  };
}

let actSeq = 0;
function act(over: Partial<RegulatoryActRow> = {}): RegulatoryActRow {
  actSeq += 1;
  return {
    kind: 'DEFICIENCY_NOTICE',
    basis: 'SANCTION',
    effectiveFrom: d('2026-11-01'),
    suspendedUntil: null,
    decisionRef: 'CBJ-2026-DN-9',
    recordedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, actSeq)),
    id: `act-${String(actSeq).padStart(4, '0')}`,
    ...over,
  };
}

/** AFTER the printed expiry, so decision 128 is the rule in force. */
const AFTER_EXPIRY = d('2027-02-01');

function standing(
  t: LicenseTermRow,
  acts: RegulatoryActRow[] = [],
  now = AFTER_EXPIRY,
) {
  return deriveLicenseStanding(t, acts, now, INSTRUMENT_LICENCE_FIGURES);
}

describe('OWNER DECISION 128 §٧ — the nine criteria', () => {
  it('BASELINE: all four conditions hold, so the office issues and the state is UNDER_STUDY', () => {
    /*
     * The floor every refusal below rests on. Without it each «يُمنَع» case would pass just as
     * happily against a derivation that refused everything — which is the shape this repository
     * has paid for more than once.
     */
    const s = standing(term());
    expect(s.renewalUnderStudy.state).toBe('UNDER_STUDY');
    expect(s.mayPractise).toBe(true);
    expect(s.status).toBe('RENEWAL_PENDING');
  });

  it('criterion 1 — «شِل الإثبات ⟵ يُمنَع»: a filing date with no proof file opens nothing', () => {
    /*
     * 🔴 THE DEFECT DECISION 128 EXISTS TO CORRECT. Before it, `isValidPendingRenewalDecision`
     * compared a DATE with a deadline and `mayPractise` came back true — so a date typed into a
     * field opened all six issuance acts. «الإثبات يفتح، لا التاريخ.»
     */
    const s = standing(term({ renewalProofDocumentId: null }));
    expect(s.renewalUnderStudy.state).toBe('NO_PROOF');
    expect(s.mayPractise).toBe(false);
  });

  it('criterion 1 (the other half) — a proof with no reference number is not a proof either', () => {
    /*
     * The reference is PART of the proof, not beside it. An inspector asking «which application
     * is this?» is asking for a number, and reading one out of a scanned PDF is not something
     * the system can do. Blank-but-present must fail exactly as absent does.
     */
    expect(
      standing(term({ renewalReferenceNumber: null })).renewalUnderStudy.state,
    ).toBe('NO_PROOF');
    expect(
      standing(term({ renewalReferenceNumber: '   ' })).renewalUnderStudy.state,
    ).toBe('NO_PROOF');
  });

  it('criterion 2 — «تاريخ تقديم بعد المهلة، ومعه ملف ⟵ يُمنَع»', () => {
    /*
     * A complete proof filed LATE. Both halves matter: the file is present, so this case can
     * only fail on the deadline — which is what makes it a test of condition 1 rather than a
     * second test of condition 2.
     */
    const s = standing(term({ renewalRequestedAt: d('2026-12-20') }));
    expect(s.renewalUnderStudy.state).toBe('NOT_FILED_ON_TIME');
    expect(s.mayPractise).toBe(false);
  });

  it('criterion 2 (the other half) — no application at all is NOT_FILED_ON_TIME', () => {
    expect(
      standing(term({ renewalRequestedAt: null })).renewalUnderStudy.state,
    ).toBe('NOT_FILED_ON_TIME');
  });

  it.each([['DEFICIENCY_NOTICE' as const], ['RENEWAL_REFUSAL' as const]])(
    'criterion 3 — «سجِّل %s ⟵ يُمنَع فوراً», and the state names which arrived',
    (kind) => {
      const s = standing(term(), [act({ kind })]);
      expect(s.renewalUnderStudy).toEqual({ state: 'ENDED_BY_ACT', kind });
      expect(s.mayPractise).toBe(false);
    },
  );

  it('🔴 criterion 3 — and neither kind is folded as a SUSPENSION', () => {
    /*
     * THE HAZARD WIDENING THE TYPE MADE VISIBLE. `foldActs`'s loop ends with a bare
     * `suspension = act`, so before the two kinds were named and skipped, a deficiency notice
     * arriving from the repository would have folded AS A SUSPENSION: the office reported
     * SUSPENDED, every gated act refused, and a CBJ decision reference displayed for a letter
     * that suspended nothing.
     *
     * ⛔ Asserted on a term still INSIDE its printed dates, which is where the difference is
     * visible: there, these two kinds must move nothing at all.
     */
    const inside = d('2026-06-01');
    const withoutAnyAct = standing(term(), [], inside);
    expect(withoutAnyAct.mayPractise, 'the control case already refused').toBe(
      true,
    );
    for (const kind of ['DEFICIENCY_NOTICE', 'RENEWAL_REFUSAL'] as const) {
      /*
       * Compared against the SAME term with no act at all, rather than against a hard-coded
       * status. «Moves nothing» is a statement about a difference, and pinning a literal here
       * would make this test fail whenever the surrounding rules legitimately changed — while
       * still passing if both answers moved together, which is the thing it must catch.
       */
      expect(
        standing(
          term(),
          [act({ kind, effectiveFrom: d('2026-05-01') })],
          inside,
        ),
        `${kind} changed the standing of a term inside its printed dates`,
      ).toEqual(withoutAnyAct);
    }
  });

  it('criterion 3 — an act dated BEFORE the filing is a previous cycle and does not end this one', () => {
    /*
     * «منذ التقديم». A deficiency notice about last year's application has nothing to say about
     * this year's, and reading it as current would strand an office that had already fixed it.
     */
    const s = standing(term(), [act({ effectiveFrom: d('2026-09-01') })]);
    expect(s.renewalUnderStudy.state).toBe('UNDER_STUDY');
  });

  it('criterion 4 — «ارفع الشهادة الجديدة ⟵ يرجع طبيعياً»', () => {
    /*
     * A NEW CERTIFICATE is a new TERM, and the derivation is asked about the latest one — so the
     * office is simply inside its dates again. There is no cured state and no timer anywhere:
     * that is «حالة لا مدة» expressed as an absence of mechanism.
     *
     * ⛔ AND THE REFUSAL IS LIFTED BY THE PAPER, NOT BY TIME. The same act that ended the old
     * term's study is still on file here and changes nothing, which is the assertion.
     */
    const fresh = term({
      issuedAt: d('2027-01-01'),
      expiresAt: d('2029-12-31'),
      renewalRequestedAt: null,
      renewalProofDocumentId: null,
      renewalReferenceNumber: null,
      hasRenewalDeclaration: false,
    });
    const s = standing(fresh, [act({ kind: 'RENEWAL_REFUSAL' })]);
    expect(s.status).toBe('ACTIVE');
    expect(s.mayPractise).toBe(true);
    expect(s.renewalUnderStudy.state).toBe('NOT_PAST_EXPIRY');
  });

  it('criterion 6 — «ما يستمرّ يستمرّ»: a standing SUSPENSION outranks the renewal question', () => {
    /*
     * PRECEDENCE RULE 1, asserted rather than assumed. An office the Central Bank has SUSPENDED
     * does not become able to practise by filing a renewal and declaring — and the four
     * conditions all hold here, so this case can only pass if precedence is real.
     */
    const s = standing(term(), [
      act({
        kind: 'SUSPENSION',
        basis: 'SANCTION',
        effectiveFrom: d('2026-06-01'),
      }),
    ]);
    expect(s.status).toBe('SUSPENDED');
    expect(s.mayPractise).toBe(false);
    expect(s.renewalUnderStudy.state).toBe('NOT_PAST_EXPIRY');
  });

  it('🔴 criterion 7 — «قدِّم الساعة سنة ⟵ لا شيء يتغيّر بلا ورقة»', () => {
    /*
     * A STATE, NOT A PERIOD. The derivation has no `now`-dependent branch beyond the expiry
     * comparison itself, so advancing the clock a year changes nothing — and the assertion is a
     * DEEP EQUALITY over the whole standing rather than one field, because a timer could hide in
     * any of them.
     */
    const t = term();
    const near = standing(t, [], d('2027-01-02'));
    const aYearOn = standing(t, [], d('2028-01-02'));
    expect(aYearOn).toEqual(near);
    expect(aYearOn.renewalUnderStudy.state).toBe('UNDER_STUDY');
  });

  it('criterion 7 — and that holds for a REFUSED office too: no timer cures a refusal', () => {
    const t = term();
    const acts = [act({ kind: 'RENEWAL_REFUSAL' })];
    expect(standing(t, acts, d('2028-01-02'))).toEqual(
      standing(t, acts, d('2027-01-02')),
    );
  });

  it('OWNER DECISION 136(ب) — everything but the declaration gives AWAITING_DECLARATION', () => {
    /*
     * The state her refusal sentence exists for. `mayPractise` is FALSE — the office genuinely
     * may not issue — but the reason is one act by their own administrator, and a boolean would
     * have collapsed «one more click from your manager» into «your licence has expired».
     *
     * `EXPIRED` is the honest status word: the term IS past its printed date.
     */
    const s = standing(term({ hasRenewalDeclaration: false }));
    expect(s.renewalUnderStudy.state).toBe('AWAITING_DECLARATION');
    expect(s.mayPractise).toBe(false);
    expect(s.status).toBe('EXPIRED');
  });

  it('⛔ criterion 8 — the screen never says «ساري» for this office, at the derivation', () => {
    /*
     * Criterion 8 is about a SCREEN and is proven in Playwright. What CAN be proven here is the
     * half the screen cannot get wrong on its own: the status word it is handed. `ACTIVE` maps
     * to «ساري» in the dictionary, so an office in any of these states reaching `ACTIVE` would
     * make the screen say it however carefully the screen were written.
     */
    for (const t of [
      term(),
      term({ hasRenewalDeclaration: false }),
      term({ renewalProofDocumentId: null }),
      term({ renewalRequestedAt: null }),
    ]) {
      expect(
        standing(t).status,
        'an office past expiry reached ACTIVE',
      ).not.toBe('ACTIVE');
    }
    expect(
      standing(term(), [act({ kind: 'RENEWAL_REFUSAL' })]).status,
    ).not.toBe('ACTIVE');
  });
});

/**
 * WHAT THIS FILE DOES NOT PROVE, NAMED SO IT DOES NOT LOOK COVERED.
 *
 * Criterion 5 («every document issued in the state carries the stamp, and it is not removed») is
 * `certificate-stored.e2e-spec.ts` plus the five stamp call sites, because it is about what a
 * WRITE records rather than what a derivation returns.
 *
 * Criterion 8's other half is Playwright: `regulatory-compliance.spec.ts` renders the screen.
 *
 * Criterion 9 («another office's account sees neither the proof nor the declaration») is
 * `certificate-stored.e2e-spec.ts`, asserted through `APP_DATABASE_URL` — ⛔ never through the
 * e2e suite's own client, which on db-test is a superuser with BYPASSRLS and would pass with
 * every policy dropped.
 */
