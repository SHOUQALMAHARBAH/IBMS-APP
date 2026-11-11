import { describe, expect, it, vi } from 'vitest';
import { LicenseGateService } from './license-gate.service';
import type { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import type { RegulatoryActionRepository } from '../../repositories/regulatory-action.repository';
import { instrumentLegalValues } from './legal-figures.double';

/**
 * ART. 21/b/5 AT THE GATE — AND THE ONE DECISION WORTH A SPEC OF ITS OWN IS THE UNRESOLVED CASE.
 *
 * `deriveLicenseStanding` already has a pure spec for which branches are blocked. What cannot be
 * tested there is what the GATE does with that list, and the three answers are not symmetric:
 *
 *   the branch is blocked        -> refuse
 *   the branch is not blocked    -> permit
 *   the branch is UNKNOWN        -> REFUSE
 *
 * The third is the load-bearing one. A caller that cannot name its branch leaves the gate unable to
 * tell a permitted act from a forbidden one, and permitting would make a recorded CBJ suspension
 * block nothing while the screen shows it in force — a suspension that exists in the register and
 * not in the product, which nobody finds out about. Refusing is visible on the first attempt.
 *
 * ## WHY THE REAL SERVICE WITH FAKE REPOSITORIES, AND NOT THE DOUBLE
 *
 * `license-gate.double.ts` exists so that specs about OTHER modules do not have to care about the
 * licence. Using it here would assert the double. A double that reimplemented "is this branch
 * blocked" would also be the second answer to the question this gate exists to answer once.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const MOTOR = 'line-motor';
const MEDICAL = 'line-medical';

function gate(
  scopeLines: {
    insuranceLineId: string | null;
    officeInsuranceLineId: string | null;
  }[],
) {
  const licenses = {
    findTerms: vi.fn(() =>
      Promise.resolve([
        {
          issuedAt: d('2024-01-15'),
          expiresAt: d('2030-12-31'),
          renewalRequestedAt: null,
        },
      ]),
    ),
  } as unknown as BrokerLicenseRepository;

  const acts = {
    findAll: vi.fn(() =>
      Promise.resolve([
        {
          kind: 'SUSPENSION',
          basis: 'SANCTION',
          effectiveFrom: d('2026-03-01'),
          suspendedUntil: null,
          decisionRef: 'CBJ-2026-91',
          recordedAt: d('2026-03-01'),
          id: 'act-1',
          scopeLines,
        },
      ]),
    ),
  } as unknown as RegulatoryActionRepository;

  return new LicenseGateService(licenses, acts, instrumentLegalValues());
}

/** The office is stopped in motor only. Every case below reads the same standing. */
const motorSuspended = () =>
  gate([{ insuranceLineId: MOTOR, officeInsuranceLineId: null }]);

/**
 * An office with NO regulatory act at all.
 *
 * Distinct from `gate([])`, and the distinction cost a test: `gate([])` is an act carrying zero
 * scope lines, which by the compatibility rule is an OFFICE-WIDE suspension. The fixture for "no
 * branch is suspended" has to be no act, not an unscoped one.
 */
function cleanLicence() {
  const licenses = {
    findTerms: vi.fn(() =>
      Promise.resolve([
        {
          issuedAt: d('2024-01-15'),
          expiresAt: d('2030-12-31'),
          renewalRequestedAt: null,
        },
      ]),
    ),
  } as unknown as BrokerLicenseRepository;
  const acts = {
    findAll: vi.fn(() => Promise.resolve([])),
  } as unknown as RegulatoryActionRepository;
  return new LicenseGateService(licenses, acts, instrumentLegalValues());
}

describe('art. 21/b/5 at the licence gate', () => {
  it('permits an act in a branch the office is still licensed for', async () => {
    await expect(
      motorSuspended().assertMayPractise(
        'PLACE_POLICY',
        { insuranceLineId: MEDICAL, officeInsuranceLineId: null },
        d('2026-07-01'),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses the same act in the suspended branch, naming art. 21/b/5', async () => {
    // The compound case, from the gate's side: ONE standing, two branches, opposite answers. Either
    // assertion alone passes against a defect — a gate that refused everything would satisfy this
    // one, and the test above is what rules that out.
    await expect(
      motorSuspended().assertMayPractise(
        'PLACE_POLICY',
        { insuranceLineId: MOTOR, officeInsuranceLineId: null },
        d('2026-07-01'),
      ),
    ).rejects.toThrow(/art\. 21\/b\/5/);
  });

  it('REFUSES when the caller cannot name the branch, rather than permitting', async () => {
    // The decision this file exists for. `null` is what a call site passes when it genuinely cannot
    // resolve a branch, and it must not be a way through an unchecked licence limit.
    await expect(
      motorSuspended().assertMayPractise('PLACE_POLICY', null, d('2026-07-01')),
    ).rejects.toThrow(/does not say which branch/);
  });

  it('refuses a branch reference whose columns are BOTH null, which is the same unknown', async () => {
    // The § 1.25 trap arriving in TypeScript: two all-null references must not compare equal to
    // each other or to a real branch. `insuranceBranchKey` returns null and this is the refusal.
    await expect(
      motorSuspended().assertMayPractise(
        'PLACE_POLICY',
        { insuranceLineId: null, officeInsuranceLineId: null },
        d('2026-07-01'),
      ),
    ).rejects.toThrow(/does not say which branch/);
  });

  it('does not call the resolver at all when no branch is suspended', async () => {
    // The cost argument, asserted rather than claimed: the thunk exists so the extra read happens
    // only under a partial suspension, and every office today has none.
    const resolver = vi.fn(() =>
      Promise.resolve({ insuranceLineId: MOTOR, officeInsuranceLineId: null }),
    );
    await expect(
      cleanLicence().assertMayPractise(
        'PLACE_POLICY',
        resolver,
        d('2026-07-01'),
      ),
    ).resolves.toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('calls the resolver once a branch IS suspended, and refuses on what it returns', async () => {
    // Non-vacuity for the test above (rule 12): without this, a resolver that was never called for
    // the WRONG reason — a gate that ignores scope entirely — would also pass it.
    const resolver = vi.fn(() =>
      Promise.resolve({ insuranceLineId: MOTOR, officeInsuranceLineId: null }),
    );
    await expect(
      motorSuspended().assertMayPractise(
        'PLACE_POLICY',
        resolver,
        d('2026-07-01'),
      ),
    ).rejects.toThrow(/art\. 21\/b\/5/);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('matches an office-added branch on its own column, never across the two', async () => {
    const officeLineSuspended = gate([
      { insuranceLineId: null, officeInsuranceLineId: MOTOR },
    ]);
    // Same id, other column: a DIFFERENT branch, and permitted. Without the `std:`/`off:` prefix
    // these two would collide whenever a standard line and an office line shared an id.
    await expect(
      officeLineSuspended.assertMayPractise(
        'PLACE_POLICY',
        { insuranceLineId: MOTOR, officeInsuranceLineId: null },
        d('2026-07-01'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      officeLineSuspended.assertMayPractise(
        'PLACE_POLICY',
        { insuranceLineId: null, officeInsuranceLineId: MOTOR },
        d('2026-07-01'),
      ),
    ).rejects.toThrow(/art\. 21\/b\/5/);
  });

  it('still refuses office-wide when the act names no branch at all', async () => {
    // Zero scope lines means the whole licence: the behaviour every act recorded before this table
    // existed must keep. The refusal is the OFFICE-WIDE one, citing art. 21/a/9.
    await expect(
      gate([]).assertMayPractise(
        'PLACE_POLICY',
        { insuranceLineId: MEDICAL, officeInsuranceLineId: null },
        d('2026-07-01'),
      ),
    ).rejects.toThrow(/art\. 21\/a\/9/);
  });
});
