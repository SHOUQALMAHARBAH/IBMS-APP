import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  ProviderOfficeStateRepository,
  type ProviderOfficeStateRow,
} from '../../repositories/provider-office-state.repository';
import {
  isBrokerLicenseCurrentlyLapsed,
  renewalApplicationDueBy,
  renewalFiledOnTime,
} from './broker-license.config';
import { OrganizationRepository } from '../../repositories/organization.repository';

/**
 * MODULE 0 ITEM (j) — THE PROVIDER DASHBOARD.
 *
 * A cross-office read of OFFICE STATE: identity, status, the current licence's number / expiry /
 * standing, how many licensed branches carry no business, user counts, and when each office was
 * last used.
 *
 * ## The disclosure, stated here as well as in the migration
 *
 * This reads facts about OTHER brokerage offices, who are each other's competitors. What bounds it
 * is the view's column list — no customer, policy, premium, commission or personal data, asserted
 * by the migration AND by the repository — and the single permission code
 * `provider.office-state.read`, granted to one seeded role.
 *
 * This product has no platform-operator concept: every user belongs to an Organization. So "only
 * the provider may read this" is not expressible today, and an office granted that code sees every
 * office. That is a real limitation rather than an oversight, it is in README § Known gaps, and it
 * is why no column may be added to the view without making the argument again.
 *
 * ## The lapse rule is APPLIED here, not copied into SQL
 *
 * The view returns `status`, `expiresAt` and `renewalRequestedAt` raw. The regulatory answer —
 * manual lapse first, then inside the term, then the renewal-pending rule — comes
 * from `isBrokerLicenseCurrentlyLapsed`, the same function `PolicyService.place()` uses. A copy of
 * that rule in SQL would be a second home for a rule whose CHECK ORDER is load-bearing, and the
 * copy is the one that drifts. A provider dashboard calling an office lapsed when the application
 * lets it place business would be worse than no dashboard.
 *
 * ## Reading it is audited, and the row records COUNTS
 *
 * Who looked at the platform-wide picture is worth recording. WHAT they saw is not copied into the
 * audit row: the `/internal-controls` precedent — a lookup that writes the contents of what it read
 * into the log pollutes the thing being searched, and here it would also duplicate other offices'
 * state into an append-only table in the reader's own office.
 */

/** One office as the dashboard shows it: the view's facts plus the derived licence answers. */
export interface ProviderOfficeStateView {
  organizationId: string;
  legalName: string;
  legalNameAr: string | null;
  subdomain: string;
  organizationType: string;
  brokerKind: string | null;
  organizationStatus: string;
  onboardedAt: string;
  licenseNumber: string | null;
  licenseIssuedAt: string | null;
  licenseExpiresAt: string | null;
  renewalRequestedAt: string | null;
  /**
   * DERIVED, never read from SQL. True when the office may not place new business.
   *
   * `null` when the office holds NO licence term, which is a third state rather than a missing
   * value: item (c) made absence BLOCK new business (art. 21/a/9), and an office with nothing on
   * record is further from compliant than one whose licence merely lapsed. Collapsing it into
   * `true` would tell a provider the licence lapsed, which is a different and wrong fact.
   */
  isCurrentlyLapsed: boolean | null;
  /** Art. 11 — 45 calendar days before expiry. Null with no term. */
  renewalDueBy: string | null;
  /** Whether the renewal application was filed on time, when one has been filed at all. */
  renewalFiledOnTime: boolean | null;
  licensedBranches: number;
  dormantLicensedBranches: number;
  users: number;
  activeUsers: number;
  lastActivityAt: string | null;
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * One view row from one database row — PURE, and taking `now` rather than reading the clock.
 *
 * Extracted from the service because three plants survived against it while it was a private
 * method: db-test's only office holds a term expiring far in the future, so a NAIVE
 * `expiresAt <= now` answers identically to the regulatory rule, and the `term === null` branch is
 * never reached at all. An e2e over one office simply cannot tell those apart.
 *
 * So the three licence states and the renewal-pending rule are proven HERE, where the input can be
 * chosen, and the e2e proves what only it can: that the view crosses offices, that the column list
 * holds, and that the route is gated.
 */
export function toProviderOfficeStateView(
  row: ProviderOfficeStateRow,
  now: Date,
): ProviderOfficeStateView {
  const term =
    row.licenseExpiresAt === null
      ? null
      : {
          expiresAt: row.licenseExpiresAt,
          renewalRequestedAt: row.renewalRequestedAt,
        };

  return {
    organizationId: row.organizationId,
    legalName: row.legalName,
    legalNameAr: row.legalNameAr,
    subdomain: row.subdomain,
    organizationType: row.organizationType,
    brokerKind: row.brokerKind,
    organizationStatus: row.organizationStatus,
    onboardedAt: row.onboardedAt.toISOString(),
    licenseNumber: row.licenseNumber,
    licenseIssuedAt: iso(row.licenseIssuedAt),
    licenseExpiresAt: iso(row.licenseExpiresAt),
    renewalRequestedAt: iso(row.renewalRequestedAt),
    // THE SHARED TERM ARITHMETIC, never a comparison written here — and this is now a DECLARED
    // LIMIT rather than the whole answer.
    //
    // `LicenseGateService` is the one answer to "may this office practise", and it folds the
    // office's recorded `RegulatoryAction` rows over the term arithmetic: a CBJ suspension outranks
    // a perfectly current term. This screen CANNOT ask it. It reads other offices through
    // `ProviderOfficeState`, a `security_invoker = false` view that exists because those rows are
    // unreachable by RLS, and `RegulatoryAction` is tenant-scoped like everything else.
    //
    // SO WHAT THIS FIELD MEANS IS NARROWER THAN ITS NAME: is this office's latest recorded term
    // past its expiry, renewal rule applied. An office the CBJ has suspended reads here as holding
    // a current term.
    //
    // It is left as it is on purpose. Putting a regulator decision into that view would disclose to
    // every holder of `provider.office-state.read` that a competitor has been sanctioned, and the
    // view's own migration requires that argument to be made again before any column is added. The
    // gap is in `docs/deferred-register.md`; the dashboard gates nothing, so nothing is decided on
    // this value.
    isCurrentlyLapsed:
      term === null ? null : isBrokerLicenseCurrentlyLapsed(term, now),
    renewalDueBy:
      term === null
        ? null
        : // Takes the EXPIRY, not the term — copied from the signature rather than guessed.
          renewalApplicationDueBy(term.expiresAt).toISOString(),
    renewalFiledOnTime:
      term === null || term.renewalRequestedAt === null
        ? null
        : renewalFiledOnTime(term),
    licensedBranches: row.licensedBranches,
    dormantLicensedBranches: row.dormantLicensedBranches,
    users: row.users,
    activeUsers: row.activeUsers,
    lastActivityAt: iso(row.lastActivityAt),
  };
}

@Injectable()
export class ProviderOfficeStateService {
  constructor(
    private readonly offices: ProviderOfficeStateRepository,
    private readonly audit: AuditService,
    // The caller's own organization TYPE. A shared repository across the module boundary, and the
    // compliance-risk module already provides it (item (e) needed it for `brokerKind`), so this
    // adds a dependency rather than a provider — verified rather than assumed, because item (e)'s
    // first wiring claimed a provider it did not have.
    private readonly organizations: OrganizationRepository,
  ) {}

  async list(
    actorUserId: string,
    organizationId: string,
  ): Promise<ProviderOfficeStateView[]> {
    /*
     * MODULE 0 ITEM (j)'s GAP CLOSURE — THE CALLER'S ORGANIZATION MUST BE THE PROVIDER.
     *
     * The permission alone is no longer the whole gate. `provider.office-state.read` is
     * PLATFORM-scoped, so `RoleAdminService.setPermissions` refuses granting it to a non-provider
     * office and the matrix never offers it — but a grant that predates this rule, or a row written
     * directly, would still carry the code. This is the layer that makes the boundary true rather
     * than merely tidy.
     *
     * A REFUSAL, NEVER AN EMPTY LIST. Returning `[]` would read as "no offices exist" — the silent
     * failure this project keeps removing (the empty holiday calendar, the screening result that
     * found nobody). It names the reason and the remedy, and says plainly that a permission grant is
     * not the remedy.
     */
    const org = await this.organizations.findById(organizationId);
    if (org?.type !== 'PROVIDER') {
      throw new ForbiddenException(
        'The provider dashboard reads every brokerage office on the platform, so it is served only ' +
          'to the platform operator organization. Your organization is ' +
          `${org?.type ?? 'of an unknown type'}, so this is refused — and NOT because the list is ` +
          'empty. A permission grant will not change it: `provider.office-state.read` is a ' +
          'PLATFORM-scoped code and cannot be granted to a brokerage office at all.',
      );
    }

    const rows = await this.offices.findAll();

    await this.audit.record({
      userId: actorUserId,
      action: 'READ',
      entityType: 'ProviderOfficeState',
      // No entity id: this is a read of the whole platform, not of one office. A row naming one
      // office would be false about what was seen.
      entityId: 'all-offices',
      afterValue: {
        // COUNTS ONLY. See the header: copying what was read into the log would duplicate other
        // offices' state into this office's own append-only table.
        officesReturned: rows.length,
      },
    });

    // ONE `now` for the whole list, so two offices cannot be judged against different instants.
    const now = new Date();
    return rows.map((row) => toProviderOfficeStateView(row, now));
  }
}
