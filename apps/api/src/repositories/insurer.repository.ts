import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { INSURER_IDENTITY_SELECT } from './insurer-identity';
import {
  INSURANCE_LINE_SELECT,
  OFFICE_INSURANCE_LINE_SELECT,
} from './insurance-line.repository';
import { IN_FORCE_POLICY_STATUSES } from './cross-sell-opportunity.repository';

/**
 * Insurer management — the office's OWN insurer records.
 *
 * Distinct from `InsurerMasterRepository`, which reads the global catalogue: every
 * model here carries `organizationId`, so `tenantScopeExtension` filters each
 * query and an RLS policy backs it. That is why no method below takes an
 * organization id and no create passes one — the extension stamps it, and a call
 * site that supplied its own would be the one place a caller could write into
 * another office (`tenant-scope.extension.ts`: "no call site passes
 * `organizationId`").
 *
 * The practical consequence for reads: another office's insurer id is ABSENT, not
 * forbidden. The service turns that into a 404 rather than a 403, which is what
 * keeps an id from being an oracle for what other offices deal with.
 */

/**
 * What a management read needs on top of the shared identity select.
 *
 * Built by spreading `INSURER_IDENTITY_SELECT` rather than restating it: that
 * constant exists because five private copies of the name join once drifted, and
 * a sixth copy here would be the same mistake with a different name.
 */
export const INSURER_RECORD_SELECT = {
  ...INSURER_IDENTITY_SELECT,
  // Selected as well as the joined master, so the view can say WHICH registration
  // path this row took without inferring it from whether a join came back.
  insurerMasterId: true,
  // Conventional / takaful / takaful window — a COMPANY fact, so directory-visible.
  structure: true,
  /**
   * What the company OFFERS, pointing at the managed vocabulary rather than at free
   * text. Replaced a `linesOffered String[]` that nothing ever wrote.
   *
   * Not ordered here: a row points at either a standard line or an office addition,
   * and Postgres cannot order one result set by a column from whichever of two
   * joined tables happens to be present. The view sorts them — standard lines in
   * market order first, then the office's own — which is the same order the picker
   * uses.
   */
  offeredLines: {
    select: {
      insuranceLine: { select: INSURANCE_LINE_SELECT },
      officeInsuranceLine: { select: OFFICE_INSURANCE_LINE_SELECT },
    },
  },
  // COMPANY-level — the switchboard, the general mailbox, the site, the address
  // formal paperwork goes to. Safe to show across offices; see the schema.
  companyPhone: true,
  companyEmail: true,
  companyWebsite: true,
  companyCorrespondenceAddress: true,
  // RELATIONSHIP-level — the named people who answer THIS office. Never leaves it.
  rfqContactName: true,
  rfqContactEmail: true,
  rfqContactPhone: true,
  claimsContactName: true,
  claimsContactEmail: true,
  underwriterContact: true,
  creditTermsDays: true,
  createdAt: true,
} as const satisfies Prisma.InsurerSelect;

export type InsurerRecord = Prisma.InsurerGetPayload<{
  select: typeof INSURER_RECORD_SELECT;
}>;

export interface InsurerListFilter {
  /** Undefined means BOTH — a management list has to show what the office
   *  deactivated, or it cannot offer to reactivate it. */
  isActive?: boolean;
  search?: string;
}

/**
 * COMPANY-level fields a caller may set.
 *
 * Separate from `InsurerRelationshipFields` below for a reason that is not stylistic:
 * the directory shows this group across offices and must never show the other, so
 * "which interface does this field belong to" is the same question as "may a
 * competing brokerage see it". Two types means a field cannot drift across that line
 * by being appended to the wrong list.
 */
export interface InsurerCompanyFields {
  /** Conventional / takaful / takaful window — a company fact, so it belongs in this
   *  group and not beside the credit terms. */
  structure?: 'CONVENTIONAL' | 'TAKAFUL' | 'TAKAFUL_WINDOW';
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  companyCorrespondenceAddress?: string;
}

/** The relationship fields a caller may set. Deliberately not `Prisma.InsurerUpdateInput`:
 *  that would accept `organizationId`, `insurerMasterId` and `isActive`, which are
 *  respectively the tenant boundary, the identity and a workflow of its own. */
export interface InsurerRelationshipFields {
  rfqContactName?: string | null;
  rfqContactEmail?: string | null;
  rfqContactPhone?: string | null;
  claimsContactName?: string | null;
  claimsContactEmail?: string | null;
  underwriterContact?: string | null;
  creditTermsDays?: number | null;
  financialStrengthRating?: string | null;
}

/**
 * What was still outstanding with an insurer at the moment its status changed.
 *
 * Every figure is a LIVE count taken at that moment, not a stored total: the record
 * has to say what was true when the decision was made, and a number recomputed later
 * answers a different question.
 *
 * Each definition below reuses the one this codebase already has, rather than coining
 * a second meaning for the same word — which is why two of them are narrower than they
 * might look.
 */
export interface InsurerStatusImpact {
  /** Policies in force, by this codebase's own definition: `IN_FORCE_POLICY_STATUSES`,
   *  which is `ACTIVE` alone. Deliberately the shared constant — see the note in the
   *  repository method about what it therefore excludes. */
  policiesInForce: number;
  /** Renewal cases still moving — anything not RENEWED, LAPSED or CANCELLED. Reached
   *  through the policy, which is the only link `RenewalCase` has to an insurer. */
  openRenewalCases: number;
  /** Submissions this insurer has not answered: SENT or VIEWED. QUOTED, DECLINED and
   *  NO_RESPONSE are all resolved outcomes, whatever the answer was. */
  pendingRfqSubmissions: number;
  /** Invoices not yet REMITTED — the hop that discharges the broker's obligation to
   *  the insurer (`finance.config.ts`, Process 34). */
  unsettledInvoices: number;
}

@Injectable()
export class InsurerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The office's insurers, newest registration first.
   *
   * Ordered by `createdAt desc` like every other paged list here, NOT
   * alphabetically, and that is a limitation rather than a preference: an
   * insurer's name lives either on the joined `InsurerMaster` or on this row, so
   * a single SQL ordering over "the name" does not exist without a raw query, and
   * Arabic-aware ordering needs either an in-memory sort of the whole set (which
   * is what the two unpaginated pickers do) or a DB-level ICU collation. Neither
   * belongs in this commit. `search` is what makes finding a company by name work
   * meanwhile, and it is applied as a QUERY filter so the page bounds matching
   * rows rather than rows scanned.
   */
  findManyForOffice(
    filter: InsurerListFilter,
    window: { take: number; skip: number },
  ): Promise<InsurerRecord[]> {
    return this.prisma.client.insurer.findMany({
      where: this.whereFor(filter),
      select: INSURER_RECORD_SELECT,
      orderBy: { createdAt: 'desc' },
      take: window.take,
      skip: window.skip,
    });
  }

  countForOffice(filter: InsurerListFilter): Promise<number> {
    return this.prisma.client.insurer.count({ where: this.whereFor(filter) });
  }

  findById(id: string): Promise<InsurerRecord | null> {
    return this.prisma.client.insurer.findUnique({
      where: { id },
      select: INSURER_RECORD_SELECT,
    });
  }

  /**
   * Registers an insurer by EITHER path.
   *
   * `organizationId` is absent on purpose — see this file's header. `insurerMasterId`
   * and the local names are mutually exclusive, which the service decides and the
   * `Insurer_has_identity` CHECK enforces; this method is the narrow write.
   */
  create(input: {
    insurerMasterId: string | null;
    legalName: string | null;
    legalNameAr: string | null;
    company: InsurerCompanyFields;
    relationship: InsurerRelationshipFields;
  }): Promise<InsurerRecord> {
    return this.prisma.client.insurer.create({
      data: {
        insurerMasterId: input.insurerMasterId,
        legalName: input.legalName,
        legalNameAr: input.legalNameAr,
        ...input.company,
        ...input.relationship,
      },
      select: INSURER_RECORD_SELECT,
    });
  }

  /**
   * Flips whether the office still deals with this insurer.
   *
   * A narrow write of one column, not part of `update()`: deactivating is an act with
   * consequences somebody should see, and the edit DTO refuses `isActive` precisely so
   * it cannot ride along with a phone-number correction.
   */
  setActive(id: string, isActive: boolean): Promise<InsurerRecord> {
    return this.prisma.client.insurer.update({
      where: { id },
      data: { isActive },
      select: INSURER_RECORD_SELECT,
    });
  }

  /**
   * What is still outstanding with this insurer, right now.
   *
   * Four counts, run together. Nothing here BLOCKS anything — deactivation is
   * allow-and-record, because an office that has stopped dealing with a company still
   * owes what it already owes, and refusing the deactivation would not change that.
   * The counts exist so the record says what was outstanding at the moment of the
   * decision.
   *
   * `policiesInForce` uses the shared `IN_FORCE_POLICY_STATUSES` (`ACTIVE` alone).
   * That is narrower than "every obligation": a policy at PLACEMENT_CONFIRMED,
   * ISSUED, CHECKING_IN_PROGRESS, DISCREPANCY, VERIFIED or DELIVERED is live business
   * with this insurer and is NOT counted here. Reusing the constant is deliberate —
   * one definition of "in force" in the codebase beats a second one invented at this
   * call site — but the gap is real and is recorded in IMPROVEMENTS.md rather than
   * papered over.
   *
   * Renewals and invoices reach the insurer through `Policy`, which is the only link
   * either model has to one. Both are tenant-scoped, so both counts are already
   * confined to this office.
   */
  async countStatusImpact(insurerId: string): Promise<InsurerStatusImpact> {
    const [
      policiesInForce,
      openRenewalCases,
      pendingRfqSubmissions,
      unsettledInvoices,
    ] = await Promise.all([
      this.prisma.client.policy.count({
        where: { insurerId, status: { in: [...IN_FORCE_POLICY_STATUSES] } },
      }),
      this.prisma.client.renewalCase.count({
        where: {
          policy: { insurerId },
          status: { notIn: ['RENEWED', 'LAPSED', 'CANCELLED'] },
        },
      }),
      this.prisma.client.rFQInsurer.count({
        where: { insurerId, status: { in: ['SENT', 'VIEWED'] } },
      }),
      this.prisma.client.invoice.count({
        where: { policy: { insurerId }, status: { not: 'REMITTED' } },
      }),
    ]);
    return {
      policiesInForce,
      openRenewalCases,
      pendingRfqSubmissions,
      unsettledInvoices,
    };
  }

  /**
   * Replaces the whole set of lines an insurer offers.
   *
   * Replace, not merge, and in ONE transaction: the screen submits the set it wants,
   * so a partial apply would leave a company advertising a line the office just
   * unticked. The same reasoning `InsurerProduct`'s unique carries — "this insurer
   * offers this line, once" is a database invariant, and the delete-then-insert runs
   * inside a transaction so a concurrent read never sees an insurer with no lines at
   * all.
   *
   * Both id lists are already resolved against their tables by the service, so a row
   * here cannot point at a line that does not exist; the CHECK constraint is what
   * guarantees it points at exactly one.
   */
  async replaceOfferedLines(
    insurerId: string,
    lines: { standardIds: readonly string[]; officeIds: readonly string[] },
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.insurerOfferedLine.deleteMany({ where: { insurerId } });
      const rows = [
        ...lines.standardIds.map((id) => ({
          insurerId,
          insuranceLineId: id,
        })),
        ...lines.officeIds.map((id) => ({
          insurerId,
          officeInsuranceLineId: id,
        })),
      ];
      if (rows.length > 0) {
        await tx.insurerOfferedLine.createMany({ data: rows });
      }
    });
  }

  /**
   * Updates one of the office's own insurers.
   *
   * The `where` re-asserts nothing beyond the id because the tenant extension
   * already scopes it: an id from another office matches no row and Prisma raises
   * P2025, which the service has already turned into a 404 by loading the row
   * first.
   */
  update(
    id: string,
    patch: InsurerCompanyFields &
      InsurerRelationshipFields & {
        legalName?: string;
        legalNameAr?: string;
      },
  ): Promise<InsurerRecord> {
    return this.prisma.client.insurer.update({
      where: { id },
      data: patch,
      select: INSURER_RECORD_SELECT,
    });
  }

  /**
   * Both name sources, because a company registered locally by this office and one
   * it linked from the catalogue are the same company to whoever is searching.
   * `mode: 'insensitive'` is applied to the Latin columns only — it is a no-op on
   * Arabic, which has no case.
   */
  private whereFor(filter: InsurerListFilter): Prisma.InsurerWhereInput {
    const search = filter.search?.trim();
    return {
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      ...(search
        ? {
            OR: [
              { legalName: { contains: search, mode: 'insensitive' } },
              { legalNameAr: { contains: search } },
              {
                insurerMaster: {
                  legalName: { contains: search, mode: 'insensitive' },
                },
              },
              { insurerMaster: { legalNameAr: { contains: search } } },
            ],
          }
        : {}),
    };
  }
}
