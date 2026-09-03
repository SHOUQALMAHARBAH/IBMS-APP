import { Injectable } from '@nestjs/common';
import type {
  ClientFundsLedgerEntry,
  Invoice,
  Prisma,
  Receipt,
  Remittance,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  AR_AGEING_INVOICE_LIMIT,
  INSURER_PAYABLES_ROW_LIMIT,
  NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
  type InsurerObligationRow,
  type InsurerRemittanceRow,
  type OutstandingInvoiceRow,
} from '../modules/finance/finance.config';

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

/** Process 32 — an `Invoice` with its collection cycle (the receipt + its
 * remittance), the shape every cycle read / write returns. */
const INVOICE_CYCLE_INCLUDE = {
  receipts: {
    orderBy: { receivedAt: 'asc' },
    include: { remittance: true },
  },
} as const;

export type InvoiceWithCycle = Prisma.InvoiceGetPayload<{
  include: typeof INVOICE_CYCLE_INCLUDE;
}>;

/**
 * Process 31–32 — Premium Billing + Collection (backlog Part C #31–32, Domain
 * D). Owns the `Invoice` aggregate and its collection-cycle children
 * (`Receipt`, `Remittance`) plus the `ClientFundsLedgerEntry` rows each cycle
 * step books, wrapping `PrismaService` (services depend on repositories in
 * this codebase, never on Prisma directly).
 *
 * `Invoice` IS a `WorkflowTransitionService` entity
 * (`WORKFLOW_TRANSITIONS.Invoice`) — its `status` moves ONLY through the
 * engine. #31 creates it at the schema `@default(INVOICED)`; #32 drives
 * `INVOICED → COLLECTED → RECONCILED → REMITTED` from `CollectionService`,
 * with the `Receipt` / `Remittance` / ledger artefacts written here.
 *
 * "One receipt per invoice" / "one remittance per receipt" are DB
 * constraints, not read-then-create checks: `Receipt.invoiceId @unique`
 * (migration `20260902220000`) and `Remittance.receiptId @unique`. `P2002` on
 * either → the service resumes (byte-identical race) or 409s.
 */
@Injectable()
export class InvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateInvoiceRow): Promise<Invoice> {
    return this.prisma.client.invoice.create({ data: input });
  }

  findById(id: string): Promise<InvoiceWithCycle | null> {
    return this.prisma.client.invoice.findUnique({
      where: { id },
      include: INVOICE_CYCLE_INCLUDE,
    });
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

  findManyByPolicyId(policyId: string): Promise<InvoiceWithCycle[]> {
    return this.prisma.client.invoice.findMany({
      where: { policyId },
      include: INVOICE_CYCLE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  findManyByCustomerId(customerId: string): Promise<InvoiceWithCycle[]> {
    return this.prisma.client.invoice.findMany({
      where: { customerId },
      include: INVOICE_CYCLE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Process 33 — every outstanding receivable as at `asOfExclusiveUpper` (the
   * UTC midnight of the day AFTER the report's reference date): an `Invoice`
   * that existed by then (`createdAt <` it) and had no collection `Receipt`
   * recorded by then (`receipts` matching `receivedAt <` it is `none`). The
   * receipt-time filter is what makes the outstanding *set* point-in-time
   * correct — an invoice paid AFTER the reference date is still outstanding as
   * at that date; `Invoice.dueDate` is write-once at #31, so nothing else
   * needs reconstructing. Book-wide (`client-accounting.read` is a cross-book
   * reporting permission), optionally narrowed to one customer. Capped at
   * {@link AR_AGEING_INVOICE_LIMIT} (`orderBy createdAt asc` — oldest first);
   * `ClientAccountingService` warns on truncation.
   */
  async loadOutstandingReceivables(scope: {
    customerId?: string;
    asOfExclusiveUpper: Date;
  }): Promise<OutstandingInvoiceRow[]> {
    const rows = await this.prisma.client.invoice.findMany({
      where: {
        createdAt: { lt: scope.asOfExclusiveUpper },
        receipts: { none: { receivedAt: { lt: scope.asOfExclusiveUpper } } },
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
      },
      select: {
        id: true,
        customerId: true,
        totalAmount: true,
        currency: true,
        dueDate: true,
        customer: { select: { legalName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: AR_AGEING_INVOICE_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customerLegalName: r.customer.legalName,
      totalAmount: r.totalAmount,
      currency: r.currency,
      dueDate: r.dueDate,
    }));
  }

  /**
   * Process 34 — every collected-but-unremitted invoice as at
   * `asOfExclusiveUpper` (UTC midnight of the day AFTER the report's reference
   * date): the client's premium was received by then
   * (`receipts.some.receivedAt <` it) and no `Remittance` had discharged it by
   * then (`receipts.none.remittance.remittedAt <` it — so an invoice remitted
   * AFTER the reference date is still an obligation as at that date). The
   * `Receipt` / `Remittance` cycle is 1:1:1 (`Receipt.invoiceId @unique`,
   * `Remittance.receiptId @unique`), so `some` / `none` here each concern the
   * single receipt. Non-policy invoices are skipped (`policyId != null` — no
   * insurer to owe). Book-wide (`insurer-accounting.read` is a cross-book
   * reporting permission), optionally narrowed to one insurer. Capped at
   * {@link INSURER_PAYABLES_ROW_LIMIT}.
   */
  async loadInsurerObligations(scope: {
    insurerId?: string;
    asOfExclusiveUpper: Date;
  }): Promise<InsurerObligationRow[]> {
    const rows = await this.prisma.client.invoice.findMany({
      where: {
        policyId: { not: null },
        receipts: {
          some: { receivedAt: { lt: scope.asOfExclusiveUpper } },
          none: {
            remittance: { remittedAt: { lt: scope.asOfExclusiveUpper } },
          },
        },
        ...(scope.insurerId
          ? { policy: { is: { insurerId: scope.insurerId } } }
          : {}),
      },
      select: {
        id: true,
        premiumAmount: true,
        commissionDeducted: true,
        policy: {
          select: { insurerId: true, insurer: { select: { name: true } } },
        },
        receipts: {
          select: { receivedAt: true },
          orderBy: { receivedAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
      take: INSURER_PAYABLES_ROW_LIMIT,
    });
    return rows.flatMap((r) => {
      // `policyId != null` in the where means `policy` is always present; guard
      // for the type and skip an impossible orphan rather than throw.
      if (!r.policy || r.receipts.length === 0) return [];
      return [
        {
          invoiceId: r.id,
          insurerId: r.policy.insurerId,
          insurerName: r.policy.insurer.name,
          premiumAmount: r.premiumAmount,
          commissionDeducted: r.commissionDeducted,
          collectedAt: r.receipts[0].receivedAt,
        },
      ];
    });
  }

  /**
   * Process 34 — every `Remittance` actually paid to an insurer as at
   * `asOfExclusiveUpper` (`remittedAt <` it; the `{ lt }` excludes the
   * still-null ones). Book-wide, optionally narrowed to one insurer. Capped at
   * {@link INSURER_PAYABLES_ROW_LIMIT}.
   */
  async loadInsurerRemittances(scope: {
    insurerId?: string;
    asOfExclusiveUpper: Date;
  }): Promise<InsurerRemittanceRow[]> {
    const rows = await this.prisma.client.remittance.findMany({
      where: {
        remittedAt: { lt: scope.asOfExclusiveUpper },
        ...(scope.insurerId ? { insurerId: scope.insurerId } : {}),
      },
      select: {
        id: true,
        insurerId: true,
        amount: true,
        remittedAt: true,
        insurer: { select: { name: true } },
      },
      orderBy: { remittedAt: 'asc' },
      take: INSURER_PAYABLES_ROW_LIMIT,
    });
    return rows.map((r) => ({
      remittanceId: r.id,
      insurerId: r.insurerId,
      insurerName: r.insurer.name,
      amount: r.amount,
      // the `remittedAt: { lt: ... }` filter guarantees non-null
      remittedAt: r.remittedAt as Date,
    }));
  }

  /**
   * Process 32 — the collection receipt + its `in` client-funds ledger entry,
   * in ONE interactive transaction (a deliberate local exception to this
   * codebase's no-`$transaction` convention, same rationale as
   * `PolicyRepository.createIssuanceArtifacts`), so a crash between the two
   * cannot leave a `Receipt` with no matching client-money ledger row (Part
   * 7.3 — client funds must always be reconcilable). `Receipt.invoiceId
   * @unique` is the "one receipt per invoice" race gate — a concurrent create
   * (or a caller that lost the `INVOICED → COLLECTED` transition but reached
   * here first) rolls the whole transaction back on `P2002`.
   */
  recordReceiptWithLedger(input: {
    invoiceId: string;
    customerId: string;
    amount: Prisma.Decimal;
    method: string | null;
    paymentChannelId: string | null;
    receivedAt: Date;
    ledgerReference: string;
  }): Promise<{ receipt: Receipt; ledgerEntry: ClientFundsLedgerEntry }> {
    return this.prisma.client.$transaction(async (tx) => {
      const receipt = await tx.receipt.create({
        data: {
          invoiceId: input.invoiceId,
          amount: input.amount,
          method: input.method,
          paymentChannelId: input.paymentChannelId,
          receivedAt: input.receivedAt,
        },
      });
      const ledgerEntry = await tx.clientFundsLedgerEntry.create({
        data: {
          customerId: input.customerId,
          amount: input.amount,
          direction: 'in',
          reference: input.ledgerReference,
        },
      });
      return { receipt, ledgerEntry };
    });
  }

  /**
   * Process 32 — the insurer remittance + its `out` client-funds ledger
   * entry, in ONE interactive transaction (same rationale as above). Called
   * only after the `RECONCILED → REMITTED` engine transition has committed.
   * `receiptId @unique` on `Remittance` is the "one remittance per receipt"
   * race gate — a concurrent create rolls the whole transaction back on
   * `P2002`, mapped to a 409 by the caller.
   */
  recordRemittanceWithLedger(input: {
    receiptId: string;
    customerId: string;
    insurerId: string;
    amount: Prisma.Decimal;
    paymentChannelId: string | null;
    remittedAt: Date;
    ledgerReference: string;
  }): Promise<{ remittance: Remittance; ledgerEntry: ClientFundsLedgerEntry }> {
    return this.prisma.client.$transaction(async (tx) => {
      const remittance = await tx.remittance.create({
        data: {
          receiptId: input.receiptId,
          insurerId: input.insurerId,
          amount: input.amount,
          paymentChannelId: input.paymentChannelId,
          remittedAt: input.remittedAt,
        },
      });
      const ledgerEntry = await tx.clientFundsLedgerEntry.create({
        data: {
          customerId: input.customerId,
          amount: input.amount,
          direction: 'out',
          reference: input.ledgerReference,
        },
      });
      return { remittance, ledgerEntry };
    });
  }
}
