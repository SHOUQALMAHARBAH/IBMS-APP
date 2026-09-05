import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface StatusCountRow {
  status: string;
  count: number;
}

/**
 * Process 58 — owns none of the tables it reads; a pure aggregation layer
 * over every domain built so far (Sales/CRM, Policy, Claims, Finance,
 * Customer Service, Compliance & Risk). Every method here is a DB-side
 * `count`/`groupBy`/`aggregate` call, never a `findMany` reduced in JS — the
 * result size is O(1) regardless of table size, so unlike `SlaDashboard
 * Repository` / `InternalControlsService` (which load rows into memory),
 * there is no read-limit/truncation-warning concern here at all.
 */
@Injectable()
export class KpiDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countCustomers(): Promise<number> {
    return this.prisma.client.customer.count();
  }

  async countByStatus(
    model:
      | 'lead'
      | 'prospect'
      | 'opportunity'
      | 'policy'
      | 'claim'
      | 'invoice'
      | 'complaint',
  ): Promise<StatusCountRow[]> {
    const delegate = this.prisma.client[model] as unknown as {
      groupBy(args: {
        by: ['status'];
        _count: { _all: true };
      }): Promise<Array<{ status: string; _count: { _all: number } }>>;
    };
    const rows = await delegate.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  async countOpenServiceRequests(): Promise<number> {
    return this.prisma.client.serviceRequest.count({
      where: { status: { in: ['open', 'in_progress'] } },
    });
  }

  async countOpenRiskRegisterItems(): Promise<number> {
    return this.prisma.client.riskRegisterItem.count({
      where: { status: 'open' },
    });
  }

  async countOpenIncidents(): Promise<number> {
    return this.prisma.client.incidentReport.count({
      where: { status: { not: 'CLOSED' } },
    });
  }

  async countOpenInternalAuditFindings(): Promise<number> {
    return this.prisma.client.internalAuditFinding.count({
      where: { status: 'open' },
    });
  }

  /** Sum of `Policy.issuedPremium` across every ISSUED-or-later policy
   * (`issuedPremium` is null before issuance). */
  async sumIssuedPremium(): Promise<Prisma.Decimal | null> {
    const result = await this.prisma.client.policy.aggregate({
      _sum: { issuedPremium: true },
    });
    return result._sum.issuedPremium;
  }

  /** Sum of `Invoice.totalAmount` for invoices still awaiting client
   * payment (`status = 'INVOICED'`) — the same "outstanding" definition
   * #33's accounts-receivable ageing report uses. */
  async sumOutstandingInvoiced(): Promise<Prisma.Decimal | null> {
    const result = await this.prisma.client.invoice.aggregate({
      where: { status: 'INVOICED' },
      _sum: { totalAmount: true },
    });
    return result._sum.totalAmount;
  }

  /** Sum of `CommissionLedgerEntry.amount` logged on or after `since`. */
  async sumCommissionSince(since: Date): Promise<Prisma.Decimal | null> {
    const result = await this.prisma.client.commissionLedgerEntry.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { amount: true },
    });
    return result._sum.amount;
  }
}
