import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  ProviderOfficeStateRepository,
  type ProviderOfficeStateRow,
} from '../../repositories/provider-office-state.repository';
import {
  renewalApplicationDueBy,
  renewalFiledOnTime,
} from './broker-license.config';
import {
  deriveLicenseStanding,
  type DerivedLicenseStanding,
  type DerivedLicenseStatus,
  type RegulatoryActRow,
} from './license-standing.config';
import { OrganizationRepository } from '../../repositories/organization.repository';
import type { LicenceLegalFigures } from './legal-figures.config';
import { LegalValueService } from './legal-value.service';

/**
 * ⛔ THE ACTS THIS SCREEN MAY NOT SEE — register entry 97, closed by the owner on 2026-10-21.
 *
 * `RegulatoryAction` carries `organizationId` and is tenant-scoped like everything else, so another
 * office's rows are unreachable by RLS — which is why `ProviderOfficeState` is a
 * `security_invoker = false` view in the first place. The owner's ruling is that the provider sees
 * ONE derived bit of that half, `mayNotIssue`, and nothing behind it.
 *
 * A NAMED CONSTANT rather than a bare `[]` at the call site, so the narrowing is a statement a
 * reader meets rather than an omission they have to notice. ⛔ Do not pass real acts here: that is
 * a cross-office disclosure decision, not a refactor, and the view's own migration requires the
 * argument to be made again before any column is added.
 */
const NO_ACTS_VISIBLE_HERE: readonly RegulatoryActRow[] = [];

/**
 * The two fields the provider is sent, out of the eight the derivation returns.
 *
 * ⛔ The other six stay behind: `standingActDecisionRef` is a CBJ decision reference, which the
 * migration bans by name; `deemedCancelledUnderArticle14C` and `blockedInsuranceBranchKeys` are
 * read off acts this screen cannot see, so they would be a confident `false`/`[]` about a question
 * nobody asked; and `renewalUnderStudy` carries the declaring employee's name and date on its
 * `UNDER_STUDY` branch. Narrowing HERE rather than at the call site keeps that argument in one
 * place and makes the payload's shape the type's own answer.
 */
function standingFrom(derived: DerivedLicenseStanding): {
  status: DerivedLicenseStatus;
  mayPractise: boolean;
} {
  return { status: derived.status, mayPractise: derived.mayPractise };
}

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
   * THE ONE REGULATORY FACT THE PROVIDER SEES: this office may not issue.
   *
   * TRUE when a suspension or a cancellation is standing today, by the recorded act series. FALSE —
   * never null — when none is, because "no regulator has barred this office" is a definite answer
   * and a null would make a reader guess whether it meant unknown.
   *
   * NOTHING BEHIND IT, and the omission is the decision: the reference, the basis, the dates, the
   * letter and the kind all stay with the office. `provider-office-state.e2e-spec.ts` asserts their
   * absence by an EXACT KEY SET.
   *
   * It is NOT `isCurrentlyLapsed`'s sibling and must not be folded into it. That field is the term
   * ARITHMETIC — is the latest recorded term past its expiry — and this is a REGULATOR'S ACT. A bar
   * on a licence whose dates are still valid is therefore distinguishable from an expiry here, which
   * the owner has accepted: awareness of a bar is the point.
   */
  mayNotIssue: boolean;
  /**
   * 🔴 THE SIX-STATE STANDING — THE SAME VALUE `/regulatory-compliance` PRINTS AND THE SAME
   * FUNCTION THE ISSUANCE GATE READS. The full walk §A item 10, decision 167/17.
   *
   * THIS REPLACED `isCurrentlyLapsed`, and the replacement is the fix rather than a rename. That
   * field was the DATE-ONLY lapse — past expiry it is `!renewalFiledOnTime` — and the screen
   * printed «ساري» for its negation. `false` there covers FOUR renewal states, three of which are
   * EXPIRED with `mayPractise: false`, so an office that filed on time and then stopped was called
   * «ساري»: the one word `compliance-risk.ts` reserves, in decision 128's words, for «a term INSIDE
   * its printed dates and nothing else». Measured on the owner's database 2026-11-28 —
   * `scripts/measurements/licence-standing-two-screens.ts`, one office disagreeing.
   *
   * ⛔ TWO STANDINGS ON ONE PAYLOAD IS THE DEFECT, NOT THE CURE, which is why the old field is
   * GONE rather than kept beside this one. `/regulatory-compliance`'s own standing cell records
   * what that cost there: it rendered a stored status and appended «(currently lapsed)» from a
   * live-derived boolean, so a reader saw two answers and could not tell which the system acts on.
   *
   * `null` when the office holds NO licence term — a third state rather than a missing value. The
   * derivation itself answers `NO_TERM_ON_RECORD` for that case, but the view cannot distinguish
   * «an office» from «an insurance company, which holds no broker licence by nature», and the
   * screen needs that distinction to print the right sentence.
   */
  standing: {
    status: DerivedLicenseStatus;
    /** What the GATE reads. `assertMayPractise` throws on `!mayPractise` and on nothing else, so
     *  this is the new-business block itself rather than a label for it. */
    mayPractise: boolean;
  } | null;
  /** Art. 11 — 45 calendar days before expiry. Null with no term. */
  renewalDueBy: string | null;
  /** Whether the renewal application was filed on time, when one has been filed at all. */
  renewalFiledOnTime: boolean | null;
  licensedBranches: number;
  dormantLicensedBranches: number;
  users: number;
  activeUsers: number;
  /**
   * 🔴 THE FULL WALK §A ITEM 11 — how many of this organization's accounts have ever been used.
   *
   * `/provider-offices` offered the first-administrator invite only while `users === 0`, and its own
   * comment called that the honest test «because the invite route itself refuses once the
   * organization has ANY account». That stopped being true when `resolveInvitationTarget` gained its
   * REINVITE branch: the route refuses once somebody has ENTERED. So an office whose only account was
   * created and never reached — the exact state a missing provider mailbox leaves — read «له حساب»
   * with no control, while the api would have accepted the act its own error message recommends.
   *
   * ⚠️ This is the ROUTE'S predicate, not a near-enough one. `lastActivityAt` is a session MAX and
   * is null for somebody who set their password through the invitation link and never signed in; a
   * screen keyed on that would offer a control the route answers 409.
   */
  enteredUsers: number;
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
  /** Art. 11's filing span, from `LegalValue` — read ONCE for the whole list by the caller, so two
   *  offices cannot be judged against two different figures any more than against two instants. */
  figures: LicenceLegalFigures,
): ProviderOfficeStateView {
  /*
   * THE TERM, NOW CARRYING DECISION 128's CONDITIONS 2 AND 3 — the full walk §A item 10.
   *
   * `LicenseTermRow`'s renewal fields are typed as the VALUES (a document id, a reference string, a
   * declaration row) and the provider holds only BITS, by the migration's argument. So each bit is
   * widened into the shape the shared function reads, with a value that carries no information:
   * a fixed sentinel for «on record» and `null` for «absent».
   *
   * ⚠️ THAT IS SOUND ONLY BECAUSE `deriveRenewalUnderStudy` TESTS PRESENCE AND NOTHING ELSE on
   * all three — `renewalProofDocumentId === null`, `(renewalReferenceNumber ?? '').trim() === ''`,
   * `renewalDeclaration === null`. It never reads the id, never parses the reference and never
   * prints the name. If that ever stops being true the compiler will not catch it, so the sentinels
   * are named for what they are and a unit test pins the three branches against real-shaped rows.
   */
  const ON_RECORD = 'on-record';
  const term =
    row.licenseExpiresAt === null
      ? null
      : {
          // Already on the view, and `LicenseTermRow` requires it: `foldActs` filters acts to those
          // effective since the term was issued. It changes nothing here, the act list being empty
          // by `NO_ACTS_VISIBLE_HERE` — but passing the real value keeps this object a faithful
          // term rather than one shaped to the call it happens to make today.
          issuedAt: row.licenseIssuedAt,
          expiresAt: row.licenseExpiresAt,
          renewalRequestedAt: row.renewalRequestedAt,
          renewalProofDocumentId: row.renewalProofOnRecord ? ON_RECORD : null,
          renewalReferenceNumber: row.renewalReferenceOnRecord
            ? ON_RECORD
            : null,
          /*
           * ⛔ THE NAME AND THE DATE ARE EMPTY ON PURPOSE AND ARE NEVER RENDERED. The provider is
           * not sent them (the migration bans both column names), and this object exists only to
           * answer «did anybody declare». `/regulatory-compliance` prints
           * «أقرّ به {who} في {when}» from the real row, to the office that owns it.
           */
          renewalDeclaration: row.renewalDeclarationOnRecord
            ? { actorNameShown: '', declaredAt: row.licenseExpiresAt }
            : null,
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
    /*
     * PASSED THROUGH, never re-derived. The view computed it because this service CANNOT: the acts
     * are tenant-scoped and this read crosses offices, which is register entry 97 in one sentence.
     *
     * And it is NOT merged into `isCurrentlyLapsed` below. Those answer different questions — a
     * regulator's act versus the term arithmetic — and collapsing them would make a suspension on a
     * perfectly current licence read as an expiry, which is a false statement about why the office
     * is stopped.
     */
    mayNotIssue: row.mayNotIssue,
    // THE SHARED DERIVATION — the SAME function `/regulatory-compliance` and the issuance gate
    // read, applied here to the facts the provider is allowed to hold. Never a comparison written
    // in this file, and no longer the date-only lapse: see `standing` on the type above for why
    // that was the defect rather than a narrower truth.
    //
    // ⚠️ AND THE ACTS ARE STILL INVISIBLE, which is register entry 97 unchanged. The empty array
    // below is NOT a convenience: `RegulatoryAction` is tenant-scoped and this read crosses
    // offices, so the rows are unreachable by RLS and the owner ruled on 2026-10-21 that the
    // provider sees ONE derived bit of that half — `mayNotIssue` — and nothing behind it.
    //
    // SO THE LIMIT IS NAMED AND ONE STATE IS STILL WRONG HERE: `ENDED_BY_ACT` — a deficiency
    // notice or a renewal refusal ending the under-study state — reads as `RENEWAL_PENDING` on
    // this screen where the office's own screen reads EXPIRED. A suspension or cancellation
    // likewise cannot reach `status`, and `mayNotIssue` is the bit that says so beside it.
    // Widening that is the same cross-office disclosure decision, and it is the owner's.
    standing:
      term === null
        ? null
        : standingFrom(
            deriveLicenseStanding(term, NO_ACTS_VISIBLE_HERE, now, figures),
          ),
    renewalDueBy:
      term === null
        ? null
        : // Takes the EXPIRY, not the term — copied from the signature rather than guessed.
          renewalApplicationDueBy(
            term.expiresAt,
            figures.renewalApplicationDueDaysBeforeExpiry,
          ).toISOString(),
    renewalFiledOnTime:
      term === null || term.renewalRequestedAt === null
        ? null
        : renewalFiledOnTime(term, figures),
    licensedBranches: row.licensedBranches,
    dormantLicensedBranches: row.dormantLicensedBranches,
    users: row.users,
    activeUsers: row.activeUsers,
    enteredUsers: row.enteredUsers,
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
    /** OWNER DECISION 123 — art. 11's figure is a row, not a constant. */
    private readonly legalValues: LegalValueService,
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

    // ONE `now` for the whole list, so two offices cannot be judged against different instants —
    // and ONE read of the legal figures at that instant, for the same reason.
    const now = new Date();
    const figures = await this.legalValues.licenceFigures(now);
    return rows.map((row) => toProviderOfficeStateView(row, now, figures));
  }
}
