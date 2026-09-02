import { Injectable } from '@nestjs/common';
import type { Invoice, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { NEW_BUSINESS_PREMIUM_INVOICE_TYPE } from '../modules/finance/finance.config';

export interface CreateInvoiceRow {
  policyId: string;
  customerId: string;
  invoiceType: string;
  premiumAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  feesAmount: Prisma.Decimal;
  commissionDeducted: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  currency: string;
  dueDate: Date;
}

/**
 * Process 31 — Premium Billing (backlog Part C #31, Domain D). Owns `Invoice`
 * reads / writes, wrapping `PrismaService` (services depend on repositories in
 * this codebase, never on Prisma directly).
 *
 * `Invoice` IS a `WorkflowTransitionService` entity
 * (`WORKFLOW_TRANSITIONS.Invoice`), but #31 only `create`s it at the schema
 * `@default(INVOICED)` — no `status` write here (the `INVOICED -> COLLECTED`
 * cycle is Process 32). Same shape as #23 creating a `Claim` at
 * `@default(NOTIFIED)`.
 */
@Injectable()
export class InvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateInvoiceRow): Promise<Invoice> {
    return this.prisma.client.invoice.create({ data: input });
  }

  findById(id: string): Promise<Invoice | null> {
    return this.prisma.client.invoice.findUnique({ where: { id } });
  }

  /** The one new-business premium invoice for a policy (or null) — the
   * write-once / idempotency check in `InvoiceService.create`. Mirrors the
   * partial UNIQUE index `Invoice_one_new_business_premium_per_policy`. */
  findNewBusinessPremiumInvoice(policyId: string): Promise<Invoice | null> {
    return this.prisma.client.invoice.findFirst({
      where: {
        policyId,
        invoiceType: NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
      },
    });
  }

  findManyByPolicyId(policyId: string): Promise<Invoice[]> {
    return this.prisma.client.invoice.findMany({
      where: { policyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  findManyByCustomerId(customerId: string): Promise<Invoice[]> {
    return this.prisma.client.invoice.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
