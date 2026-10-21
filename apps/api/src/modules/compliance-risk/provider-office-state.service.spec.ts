import { describe, expect, it } from 'vitest';
import { toProviderOfficeStateView } from './provider-office-state.service';
import type { ProviderOfficeStateRow } from '../../repositories/provider-office-state.repository';

/**
 * MODULE 0 ITEM (j) — the three licence states, and why these tests exist at all.
 *
 * THREE PLANTS SURVIVED THE E2E before this file was written, and each survived for the same
 * reason: db-test holds ONE office whose seeded term expires far in the future, so
 *
 *   * a NAIVE `expiresAt <= now` answers identically to the regulatory rule,
 *   * the `no term on record` branch is never reached,
 *   * and the renewal-pending rule — the case where the two readings DISAGREE —
 *     cannot occur.
 *
 * An e2e over one office cannot tell those apart however it is written. So the states are proven
 * here, where the input is chosen, and the e2e proves what only it can: that the view crosses
 * offices, that the column list holds on the wire, and that the route is gated.
 */

const BASE: ProviderOfficeStateRow = {
  organizationId: 'org-1',
  legalName: 'Test Brokerage Office',
  legalNameAr: 'مكتب وساطة للاختبار',
  subdomain: 'test-office',
  organizationType: 'BROKERAGE_OFFICE',
  brokerKind: 'CORPORATE',
  organizationStatus: 'ACTIVE',
  onboardedAt: new Date('2024-01-01T00:00:00.000Z'),
  licenseNumber: 'CBJ-1',
  licenseIssuedAt: new Date('2024-01-01T00:00:00.000Z'),
  licenseExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
  renewalRequestedAt: null,
  licensedBranches: 4,
  dormantLicensedBranches: 1,
  users: 10,
  activeUsers: 8,
  lastActivityAt: new Date('2026-10-01T00:00:00.000Z'),
};

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('item (j): the three licence states', () => {
  it('NO TERM ON RECORD is null, not lapsed', () => {
    /*
     * The distinction a careless dashboard loses. Item (c) made ABSENCE block new business under
     * art. 21/a/9, and an office with nothing on record is further from compliant than one whose
     * licence merely ran out — so reporting it as "lapsed" would tell a provider a licence expired
     * when none was ever recorded, and would hide the worse of the two states behind the milder one.
     */
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        licenseNumber: null,
        licenseIssuedAt: null,
        licenseExpiresAt: null,
      },
      NOW,
    );
    expect(view.isCurrentlyLapsed).toBeNull();
    expect(view.renewalDueBy).toBeNull();
    expect(view.renewalFiledOnTime).toBeNull();
  });

  it('a term inside its period is NOT lapsed', () => {
    expect(toProviderOfficeStateView(BASE, NOW).isCurrentlyLapsed).toBe(false);
  });

  it('a term past its expiry with NO renewal filed IS lapsed', () => {
    const view = toProviderOfficeStateView(
      BASE,
      new Date('2027-02-01T00:00:00.000Z'),
    );
    expect(view.isCurrentlyLapsed).toBe(true);
  });

  it('A TERM PAST ITS EXPIRY WITH A TIMELY RENEWAL IS NOT LAPSED — the renewal-pending rule', () => {
    /*
     * THE CASE THAT DISTINGUISHES THE RULE FROM A COMPARISON, and the reason a naive
     * `expiresAt <= now` plant survived the e2e.
     *
     * After expiry, an office that applied for renewal on time stays valid pending the decision
     * until the CBJ's decision issues (item (d)). A comparison answers "lapsed"; the rule answers
     * "not lapsed". One of those tells a provider to chase an office that is compliant.
     */
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        // 45 calendar days before 2026-12-31 is 2026-11-16; filed well before that.
        renewalRequestedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      new Date('2027-02-01T00:00:00.000Z'),
    );
    expect(view.isCurrentlyLapsed).toBe(false);
    expect(view.renewalFiledOnTime).toBe(true);
  });

  it('a term past its expiry with a LATE renewal IS lapsed', () => {
    // The other side of the same edge: the extension is earned by filing ON TIME, so a late
    // filing does not buy it. Both sides are asserted, because a rule tested on one side is a rule
    // that passes against an implementation that always says yes.
    const view = toProviderOfficeStateView(
      {
        ...BASE,
        renewalRequestedAt: new Date('2026-12-20T00:00:00.000Z'),
      },
      new Date('2027-02-01T00:00:00.000Z'),
    );
    expect(view.isCurrentlyLapsed).toBe(true);
    expect(view.renewalFiledOnTime).toBe(false);
  });

  /*
   * RE-POINTED, not deleted. This asserted that a MANUAL LAPSE outranked a timely renewal filing —
   * `licenseStatus: 'lapsed'` with a filed renewal still reading `isCurrentlyLapsed: true` — and
   * its comment was right about why: *"a CBJ suspension is not cured by having applied for
   * renewal."*
   *
   * The column is gone (the third of three answers), so the view no longer carries it and this
   * dashboard no longer rebuilds a term object from it. The RULE moved to where a regulator's act
   * is modelled properly: `deriveLicenseStanding` folds `RegulatoryAction` before the term
   * arithmetic, and `license-standing.config.spec.ts` asserts exactly that ordering with a timely
   * filing in play.
   *
   * What this dashboard still owes is the half it can answer from a term alone, asserted above: a
   * term past its expiry with nothing filed reads lapsed.
   */

  it("art. 11's deadline is 45 days before expiry, derived not stored", () => {
    expect(toProviderOfficeStateView(BASE, NOW).renewalDueBy).toBe(
      '2026-11-16T00:00:00.000Z',
    );
  });
});

describe('item (j): the view carries office state and nothing else', () => {
  it('every field is office state — no key names a person, a customer or money', () => {
    // The same boundary the migration and the e2e assert, at the shape level: a field added to
    // `ProviderOfficeStateView` is caught here even before a migration exposes it.
    const view = toProviderOfficeStateView(BASE, NOW);
    for (const key of Object.keys(view)) {
      expect(
        /userId|email|phone|nationalId|customer|polic|premium|commission|capital|fullName/i.test(
          key,
        ),
        `ProviderOfficeStateView has a field named \`${key}\`, which looks like personal, customer or money data. This is a CROSS-OFFICE read.`,
      ).toBe(false);
    }
    // And it is not vacuous: the office-state fields really are there.
    expect(view.licensedBranches).toBe(4);
    expect(view.dormantLicensedBranches).toBe(1);
    expect(view.activeUsers).toBe(8);
    expect(view.lastActivityAt).toBe('2026-10-01T00:00:00.000Z');
  });
});
