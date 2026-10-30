import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
/* `INSURER_IDENTITY_SELECT` and `insurerName` were imported here and are GONE — `no-unused-vars`
 * named them the moment `findInsurerNames` moved to `InsurerRepository`, which is also the proof
 * that nothing else in this file used either. */

export interface LineOrInsurerGroup {
  key: string;
  policyCount: number;
  totalIssuedPremium: Prisma.Decimal | null;
}

export interface PolicyForCrossTableGrouping {
  issuedPremium: Prisma.Decimal;
  customerType: string;
  ownerUserId: string;
}

/**
 * Process 62 — owns every raw query `PortfolioAnalysisService` needs. Only
 * ISSUED policies count toward the portfolio (`issuedPremium IS NOT NULL`),
 * the same inclusion rule `kpi-dashboard.md`'s `totalIssuedPremiumJod`
 * already uses. `insuranceLine`/`insurerId` live on `Policy` itself, so
 * those two breakdowns are genuine DB-side `groupBy` calls (the #58 shape,
 * no read-limit needed — a `groupBy` result size never scales with row
 * count). Client segment (`Customer.customerType`) and geography (via
 * `Customer.ownerUserId -> User.branchId -> Branch.name`) live on a JOINED
 * table Prisma's `groupBy` cannot cross, so those two are a capped
 * `findMany` reduced in this repository's caller — the
 * `SlaDashboardRepository`/`InternalControlsService` shape instead.
 */
@Injectable()
export class PortfolioAnalysisRepository {
  constructor(private readonly prisma: PrismaService) {}

  groupByLine(): Promise<LineOrInsurerGroup[]> {
    return this.prisma.client.policy
      .groupBy({
        by: ['insuranceLine'],
        where: { issuedPremium: { not: null } },
        _count: { _all: true },
        _sum: { issuedPremium: true },
      })
      .then((rows) =>
        rows.map((r) => ({
          key: r.insuranceLine,
          policyCount: r._count._all,
          totalIssuedPremium: r._sum.issuedPremium,
        })),
      );
  }

  groupByInsurerId(): Promise<LineOrInsurerGroup[]> {
    return this.prisma.client.policy
      .groupBy({
        by: ['insurerId'],
        where: { issuedPremium: { not: null } },
        _count: { _all: true },
        _sum: { issuedPremium: true },
      })
      .then((rows) =>
        rows.map((r) => ({
          key: r.insurerId,
          policyCount: r._count._all,
          totalIssuedPremium: r._sum.issuedPremium,
        })),
      );
  }

  /*
   * `findInsurerNames` WAS HERE AND IS GONE — moved to `InsurerRepository.namesForInsurerIds`,
   * which is the insurer's own repository and which resolves the name through
   * `resolveInsurerCompanyFacts` rather than through `insurerName`.
   *
   * THE REASON IS A SECOND PRECEDENCE, NOT TIDINESS. `insurerName` reads the catalogue and the
   * office's own row and NEVER `insuranceCompany`, so for an insurer linked to a registered company
   * it answers the CATALOGUE name while `/insurers` answers the COMPANY name — two answers to
   * "what is this insurer called", which is what decision 63 removed from the insurer VIEW and
   * which this report had kept. `deriveInsurerView`'s own comment says so in as many words.
   *
   * MEASURED 2026-10-24, and the measurement is why this is a move rather than an emergency: NO
   * `Insurer` row on either database carries an `insuranceCompanyId` (dev 0 of 19, db-test 0 of
   * 306), because linking an insurer to a registered company is one of the capabilities batch
   * five's triage recorded as unreachable from the product. So the two resolvers agree on every row
   * that exists today and the defect is LATENT — it goes live on the first link.
   *
   * `insurerName` still has THIRTEEN other call sites, including the invoice and
   * certificate-of-insurance documents, and they are NOT touched here: see register entry 132.
   */

  /** Every issued policy's premium + its customer's segment/owner, capped
   * at `limit` — the caller reduces this into a by-customerType breakdown
   * and (via `findBranchNamesForOwners`) a by-branch breakdown, since
   * neither field lives on `Policy` itself. */
  findPoliciesForCrossTableGrouping(
    limit: number,
  ): Promise<PolicyForCrossTableGrouping[]> {
    return this.prisma.client.policy
      .findMany({
        where: { issuedPremium: { not: null } },
        select: {
          issuedPremium: true,
          customer: { select: { customerType: true, ownerUserId: true } },
        },
        take: limit,
      })
      .then((rows) =>
        rows.map((r) => ({
          issuedPremium: r.issuedPremium!,
          customerType: r.customer.customerType,
          ownerUserId: r.customer.ownerUserId,
        })),
      );
  }

  /** Resolves a set of customer-owning Sales Officers to their branch name
   * — the broker's own operational geography, the only structured,
   * low-cardinality location-like field anywhere in this schema (a
   * customer's own `registeredAddress` is free text, unusable for a clean
   * group-by). A owner with no `branchId` resolves to `null` — the caller
   * buckets that as an explicit "Unassigned" group, never silently drops
   * it. */
  async findBranchNamesForOwners(
    ownerUserIds: string[],
  ): Promise<Map<string, string | null>> {
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: ownerUserIds } },
      select: { id: true, branchId: true },
    });
    const branchIds = [
      ...new Set(
        users.map((u) => u.branchId).filter((b): b is string => b !== null),
      ),
    ];
    const branches = await this.prisma.client.branch.findMany({
      where: { id: { in: branchIds } },
      select: { id: true, name: true },
    });
    const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

    const result = new Map<string, string | null>();
    for (const user of users) {
      result.set(
        user.id,
        user.branchId ? (branchNameById.get(user.branchId) ?? null) : null,
      );
    }
    return result;
  }
}
