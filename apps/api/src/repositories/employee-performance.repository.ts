import { Injectable } from '@nestjs/common';
import type { EmployeePerformanceRecord, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface EmployeePerformanceRecordInput {
  newClients: number;
  premiumWritten: Prisma.Decimal;
  commissionEarned: Prisma.Decimal;
  renewalRatePercent: Prisma.Decimal | null;
  crossSellRatePercent: Prisma.Decimal | null;
}

export interface EmployeePerformanceRecordFilter {
  employeeId?: string;
  periodLabel?: string;
}

export interface OutcomeCount {
  total: number;
  succeeded: number;
}

/**
 * Process 61 — owns `EmployeePerformanceRecord` plus every raw query
 * `EmployeePerformanceService.computeRecordForEmployee` needs to derive the
 * five metrics live, for one employee's linked `User`, over one
 * `[periodStart, periodEnd)` window. No dependency on any other domain's
 * service — the `InsurerPerformanceRepository`/`SalesPerformanceRepository`
 * shape.
 */
@Injectable()
export class EmployeePerformanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every `Employee.id` <-> `User.id` pair for a user that has one —
   * `User.employeeId` is dormant elsewhere (no writer sets it), so this is
   * a real filter, not a formality. */
  listEmployeeUserPairs(): Promise<{ employeeId: string; userId: string }[]> {
    return this.prisma.client.user
      .findMany({
        where: { employeeId: { not: null } },
        select: { id: true, employeeId: true },
      })
      .then((rows) =>
        rows
          .filter(
            (r): r is { id: string; employeeId: string } =>
              r.employeeId !== null,
          )
          .map((r) => ({ employeeId: r.employeeId, userId: r.id })),
      );
  }

  /** `null` when this employee either doesn't exist or has no linked User
   * account — either way, nothing is computable for them. */
  async findUserIdForEmployee(employeeId: string): Promise<string | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { employeeId },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /** New `Customer` rows created in the window, attributable to this
   * employee via `Customer.prospectId -> Prospect.salesOwnerUserId` (a
   * Customer onboarded with no Prospect is not attributable to anyone —
   * the `SalesPerformanceRepository` precedent). */
  countNewClients(userId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.client.customer.count({
      where: {
        createdAt: { gte: from, lt: to },
        prospect: { salesOwnerUserId: userId },
      },
    });
  }

  /** Sum of `Policy.issuedPremium` for policies this employee PLACED
   * (`placedByUserId`), created in the window, that were eventually issued.
   * `Policy` carries no dedicated "issued at" timestamp (the ISSUED
   * transition only lives in `AuditLogEntry`), so `createdAt` (when
   * placement was recorded) is the period anchor instead — a documented
   * simplification, not an oversight. */
  sumPremiumWritten(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Prisma.Decimal | null> {
    return this.prisma.client.policy
      .aggregate({
        where: {
          placedByUserId: userId,
          createdAt: { gte: from, lt: to },
          issuedPremium: { not: null },
        },
        _sum: { issuedPremium: true },
      })
      .then((r) => r._sum.issuedPremium);
  }

  /** Sum of `CommissionLedgerEntry.amount` on policies this employee
   * placed — a plain gross figure, no netting against `reversedAmount`
   * (the `kpi-dashboard.md` `commissionThisMonthJod` precedent). */
  sumCommissionEarned(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Prisma.Decimal | null> {
    return this.prisma.client.commissionLedgerEntry
      .aggregate({
        where: {
          policy: { placedByUserId: userId },
          createdAt: { gte: from, lt: to },
        },
        _sum: { amount: true },
      })
      .then((r) => r._sum.amount);
  }

  /** `RenewalCase` rows for this employee's placed policies, TRIGGERED in
   * the window, that have reached a terminal outcome (RENEWED counts as
   * success; LAPSED/CANCELLED as a resolved non-renewal; IN_PROGRESS/etc.
   * are excluded — still open, no outcome yet). `RenewalCase` has no
   * writer anywhere in this codebase today (the renewal module isn't
   * built) — this will genuinely return `{total: 0, succeeded: 0}` for
   * every employee until that module lands; kept forward-compatible
   * rather than special-cased away (the #48/#56 dormant-feature
   * precedent). */
  async countRenewalOutcomes(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<OutcomeCount> {
    const [total, succeeded] = await Promise.all([
      this.prisma.client.renewalCase.count({
        where: {
          policy: { placedByUserId: userId },
          triggeredAt: { gte: from, lt: to },
          status: { in: ['RENEWED', 'LAPSED', 'CANCELLED'] },
        },
      }),
      this.prisma.client.renewalCase.count({
        where: {
          policy: { placedByUserId: userId },
          triggeredAt: { gte: from, lt: to },
          status: 'RENEWED',
        },
      }),
    ]);
    return { total, succeeded };
  }

  /** `CrossSellOpportunity` rows for customers this employee OWNS
   * (`Customer.ownerUserId`), DETECTED in the window, that have been
   * RESOLVED one way or the other (CONVERTED counts as success; DISMISSED
   * as a resolved non-conversion; a still-OPEN one is excluded — no
   * outcome decided yet). */
  async countCrossSellOutcomes(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<OutcomeCount> {
    const [total, succeeded] = await Promise.all([
      this.prisma.client.crossSellOpportunity.count({
        where: {
          customer: { ownerUserId: userId },
          detectedAt: { gte: from, lt: to },
          status: { in: ['CONVERTED', 'DISMISSED'] },
        },
      }),
      this.prisma.client.crossSellOpportunity.count({
        where: {
          customer: { ownerUserId: userId },
          detectedAt: { gte: from, lt: to },
          status: 'CONVERTED',
        },
      }),
    ]);
    return { total, succeeded };
  }

  /** Insert-or-replace this employee's record for this period —
   * `@@unique([employeeId, periodLabel])` is the upsert key. */
  async upsertRecord(
    employeeId: string,
    periodLabel: string,
    data: EmployeePerformanceRecordInput,
  ): Promise<{ row: EmployeePerformanceRecord; wasCreated: boolean }> {
    const existing =
      await this.prisma.client.employeePerformanceRecord.findUnique({
        where: { employeeId_periodLabel: { employeeId, periodLabel } },
      });
    const row = await this.prisma.client.employeePerformanceRecord.upsert({
      where: { employeeId_periodLabel: { employeeId, periodLabel } },
      create: { employeeId, periodLabel, ...data },
      update: { ...data },
    });
    return { row, wasCreated: !existing };
  }

  findMany(
    filter: EmployeePerformanceRecordFilter,
  ): Promise<EmployeePerformanceRecord[]> {
    return this.prisma.client.employeePerformanceRecord.findMany({
      where: {
        employeeId: filter.employeeId,
        periodLabel: filter.periodLabel,
      },
      orderBy: { periodLabel: 'desc' },
    });
  }

  findLatest(employeeId: string): Promise<EmployeePerformanceRecord | null> {
    return this.prisma.client.employeePerformanceRecord.findFirst({
      where: { employeeId },
      orderBy: { periodLabel: 'desc' },
    });
  }
}
