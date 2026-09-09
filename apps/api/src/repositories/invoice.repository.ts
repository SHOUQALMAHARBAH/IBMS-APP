import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type {
  ClientFundsLedgerEntry,
  Invoice,
  Receipt,
  Remittance,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import {
  addMoney,
  compareMoney,
  subtractMoney,
  sumMoney,
} from '../common/money.util';
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
   * that existed by then (`createdAt <` it) whose receipts recorded by then
   * do not yet sum to its `totalAmount`.
   *
   * Since partial payments landed this is a SUM, not an existence test. The
   * old `receipts: { none: ... }` filter dropped an invoice from the ageing
   * report the moment its FIRST instalment landed — a half-paid invoice
   * disappeared entirely and the report understated receivables by the unpaid
   * half. `outstandingAmount` now carries the remaining balance, and a
   * fully-settled invoice is the only one excluded.
   *
   * **This is raw SQL because the cap has to be applied to OUTSTANDING rows.**
   * Prisma cannot express a cross-row aggregate in `where`, so the obvious
   * translation — fetch, then drop settled invoices in JS — silently moves
   * `LIMIT` to the wrong side of the filter: on a book with 5,900 settled and
   * 100 outstanding invoices, `orderBy createdAt asc` + `take 5000` returns
   * 5,000 mostly-settled rows, nearly all of which are then discarded, and the
   * report understates receivables just as badly as the bug above. The
   * `HAVING` clause keeps the cap where it belongs. (This is also the
   * direction `IMPROVEMENTS.md` §6.1 wants every reporting read to move.)
   *
   * The receipt-time filter is what makes the outstanding *set* point-in-time
   * correct — an invoice paid AFTER the reference date is still outstanding as
   * at that date; `Invoice.dueDate` is write-once at #31, so nothing else
   * needs reconstructing. Book-wide (`client-accounting.read` is a cross-book
   * reporting permission), optionally narrowed to one customer. Capped at
   * {@link AR_AGEING_INVOICE_LIMIT} (`orderBy createdAt asc` — oldest first);
   * `ClientAccountingService` warns on truncation.
   *
   * `insuranceLine` / `insurerId` / `ownerUserIds` are Part E Financial
   * Dashboard (backlog #64) additions — narrowed via the invoice's OPTIONAL
   * `policy` relation (`Invoice.policyId` is nullable), so an invoice with no
   * linked policy is excluded whenever any of these three is given: a filter
   * on the underlying policy's line/insurer/branch cannot include a
   * receivable with no policy to check it against. `#33`'s own callers
   * (`ClientAccountingService`) never pass them.
   */
  async loadOutstandingReceivables(scope: {
    customerId?: string;
    insuranceLine?: string;
    insurerId?: string;
    ownerUserIds?: string[];
    asOfExclusiveUpper: Date;
  }): Promise<OutstandingInvoiceRow[]> {
    // Every fragment below is a parameterised `Prisma.sql` template — no
    // caller value is ever interpolated into the statement text.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`i."createdAt" < ${scope.asOfExclusiveUpper}`,
    ];
    if (scope.customerId) {
      conditions.push(Prisma.sql`i."customerId" = ${scope.customerId}`);
    }
    if (scope.insuranceLine) {
      conditions.push(Prisma.sql`p."insuranceLine" = ${scope.insuranceLine}`);
    }
    if (scope.insurerId) {
      conditions.push(Prisma.sql`p."insurerId" = ${scope.insurerId}`);
    }
    if (scope.ownerUserIds) {
      // An empty list must match nothing, not everything — `= ANY('{}')` is
      // false for every row, which is the behaviour we want.
      conditions.push(
        Prisma.sql`p."placedByUserId" = ANY(${scope.ownerUserIds})`,
      );
    }

    const rows = await this.prisma.client.$queryRaw<
      {
        id: string;
        customerId: string;
        customerLegalName: string;
        totalAmount: Prisma.Decimal;
        collected: Prisma.Decimal;
        currency: string;
        dueDate: Date;
      }[]
    >(Prisma.sql`
      SELECT
        i.id,
        i."customerId",
        c."legalName" AS "customerLegalName",
        i."totalAmount",
        COALESCE(SUM(r.amount), 0) AS collected,
        i.currency,
        i."dueDate"
      FROM "Invoice" i
      JOIN "Customer" c ON c.id = i."customerId"
      -- The receipt-time predicate lives in the JOIN, not the WHERE: a WHERE
      -- on a LEFT JOIN's right-hand side would turn it into an inner join and
      -- silently drop every never-paid invoice — the ones that matter most here.
      LEFT JOIN "Receipt" r
        ON r."invoiceId" = i.id
       AND r."receivedAt" < ${scope.asOfExclusiveUpper}
      -- LEFT JOIN, but any p.* condition above makes it behave as an inner
      -- join: an invoice with no policy cannot satisfy a filter on the
      -- underlying policy, which is the documented behaviour.
      LEFT JOIN "Policy" p ON p.id = i."policyId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      -- i.id and c.id are primary keys, so every other selected i.*/c.* column
      -- is functionally dependent on them and needs no explicit grouping.
      GROUP BY i.id, c.id
      HAVING COALESCE(SUM(r.amount), 0) < i."totalAmount"
      ORDER BY i."createdAt" ASC
      LIMIT ${AR_AGEING_INVOICE_LIMIT}
    `);

    return rows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customerLegalName: r.customerLegalName,
      totalAmount: r.totalAmount,
      // The HAVING clause already guarantees this is > 0.
      outstandingAmount: subtractMoney(r.totalAmount, r.collected),
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
   * AFTER the reference date is still an obligation as at that date).
   *
   * Since partial payments landed, "the client's premium was received" means
   * the instalments recorded by then SUM to `totalAmount` — a half-collected
   * invoice is not yet an obligation to the insurer, and treating one as
   * fully owed would overstate payables (and, acted on, would remit the
   * broker's own money). That sum is applied in the mapper below, because
   * Prisma cannot express a cross-row aggregate in `where`. Non-policy
   * invoices are skipped (`policyId != null` — no insurer to owe). Book-wide
   * (`insurer-accounting.read` is a cross-book reporting permission),
   * optionally narrowed to one insurer. Capped at
   * {@link INSURER_PAYABLES_ROW_LIMIT}.
   *
   * Raw SQL for the same reason `loadOutstandingReceivables` is: the
   * "collected IN FULL" test is a cross-row aggregate, so filtering it in JS
   * would apply `LIMIT` before the filter. Here the rows that would pollute
   * the cap are PART-PAID, unremitted invoices — and those are not transient:
   * an invoice part-paid by a client who then stops paying sits in that set
   * permanently. `HAVING` keeps the cap on rows that are genuinely owed.
   *
   * `insuranceLine` / `ownerUserIds` are Part E Financial Dashboard (backlog
   * #64) additions, narrowed the same way `insurerId` already was — via the
   * (guaranteed-present here) `policy` relation. `#34`'s own caller
   * (`InsurerAccountingService`) never passes them.
   */
  async loadInsurerObligations(scope: {
    insurerId?: string;
    insuranceLine?: string;
    ownerUserIds?: string[];
    asOfExclusiveUpper: Date;
  }): Promise<InsurerObligationRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`i."policyId" IS NOT NULL`,
      // No Remittance had discharged it by the reference date. The receipt
      // side is covered by the HAVING clause below.
      Prisma.sql`NOT EXISTS (
        SELECT 1 FROM "Receipt" r2
        JOIN "Remittance" rem ON rem."receiptId" = r2.id
        WHERE r2."invoiceId" = i.id
          AND rem."remittedAt" < ${scope.asOfExclusiveUpper}
      )`,
    ];
    if (scope.insurerId) {
      conditions.push(Prisma.sql`p."insurerId" = ${scope.insurerId}`);
    }
    if (scope.insuranceLine) {
      conditions.push(Prisma.sql`p."insuranceLine" = ${scope.insuranceLine}`);
    }
    if (scope.ownerUserIds) {
      conditions.push(
        Prisma.sql`p."placedByUserId" = ANY(${scope.ownerUserIds})`,
      );
    }

    const rows = await this.prisma.client.$queryRaw<
      {
        invoiceId: string;
        insurerId: string;
        insurerName: string;
        premiumAmount: Prisma.Decimal;
        commissionDeducted: Prisma.Decimal;
        collectedAt: Date;
      }[]
    >(Prisma.sql`
      SELECT
        i.id AS "invoiceId",
        p."insurerId",
        ins.name AS "insurerName",
        i."premiumAmount",
        i."commissionDeducted",
        -- The instalment that COMPLETED collection starts the clock: the
        -- broker owes nothing onward until the premium is whole.
        MAX(r."receivedAt") AS "collectedAt"
      FROM "Invoice" i
      -- INNER joins: the WHERE already requires a policy, and an insurer is
      -- mandatory on one.
      JOIN "Policy" p ON p.id = i."policyId"
      JOIN "Insurer" ins ON ins.id = p."insurerId"
      JOIN "Receipt" r
        ON r."invoiceId" = i.id
       AND r."receivedAt" < ${scope.asOfExclusiveUpper}
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY i.id, p.id, ins.id
      -- The obligation to the insurer arises only once the client's premium
      -- has been collected IN FULL.
      HAVING SUM(r.amount) >= i."totalAmount"
      ORDER BY i."createdAt" ASC
      LIMIT ${INSURER_PAYABLES_ROW_LIMIT}
    `);

    return rows.map((r) => ({
      invoiceId: r.invoiceId,
      insurerId: r.insurerId,
      insurerName: r.insurerName,
      premiumAmount: r.premiumAmount,
      commissionDeducted: r.commissionDeducted,
      collectedAt: r.collectedAt,
    }));
  }

  /**
   * Process 34 — every `Remittance` actually paid to an insurer as at
   * `asOfExclusiveUpper` (`remittedAt <` it; the `{ lt }` excludes the
   * still-null ones). Book-wide, optionally narrowed to one insurer. Capped at
   * {@link INSURER_PAYABLES_ROW_LIMIT}.
   *
   * **Deliberately has no `insuranceLine` / `ownerUserIds` filter** — the
   * Part E Financial Dashboard's cross-cutting rule does not apply here: a
   * `Remittance` is a lump payment against one insurer (potentially covering
   * many invoices/policies across several lines/branches at once), with no
   * `Policy` relation of its own to narrow by. `insurerId` already covers the
   * only dimension a remittance genuinely has.
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
  /**
   * Process 32 — record ONE instalment receipt plus its `in`
   * `ClientFundsLedgerEntry`, in one `$transaction` so a money movement can
   * never exist without its ledger row (Part 7.3).
   *
   * Since partial payments landed, `Receipt.invoiceId` is no longer `@unique`,
   * so the old "let `P2002` catch the double-book" backstop is gone. Its
   * replacement is the `SELECT ... FOR UPDATE` on the parent `Invoice` at the
   * top: it serialises every concurrent instalment for THIS invoice, so the
   * running-total check below is re-asserted under the lock rather than being
   * a check-then-act read (`race-safe-invariants.md`). Two concurrent
   * instalments that would jointly overshoot the invoiced total can no longer
   * both succeed — the second sees the first's committed row.
   *
   * Returns a discriminated result rather than throwing, so the service owns
   * the HTTP mapping (422 for an overshoot) and the pure figures stay here.
   */
  recordReceiptWithLedger(input: {
    invoiceId: string;
    customerId: string;
    amount: Prisma.Decimal;
    method: string | null;
    reference: string | null;
    paymentChannelId: string | null;
    receivedAt: Date;
    ledgerReference: string;
  }): Promise<
    | {
        outcome: 'recorded';
        receipt: Receipt;
        ledgerEntry: ClientFundsLedgerEntry;
        collectedAfter: Prisma.Decimal;
        fullyCollected: boolean;
      }
    | {
        outcome: 'exceeds_total';
        collectedBefore: Prisma.Decimal;
        totalAmount: Prisma.Decimal;
      }
  > {
    return this.prisma.client.$transaction(async (tx) => {
      // Serialise concurrent instalments against this invoice. Postgres holds
      // the row lock for the rest of the transaction.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`;

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
        select: { totalAmount: true },
      });
      const priorReceipts = await tx.receipt.findMany({
        where: { invoiceId: input.invoiceId },
        select: { amount: true },
      });
      const collectedBefore = sumMoney(priorReceipts.map((r) => r.amount));
      const collectedAfter = addMoney(collectedBefore, input.amount);

      if (compareMoney(collectedAfter, invoice.totalAmount) > 0) {
        return {
          outcome: 'exceeds_total' as const,
          collectedBefore,
          totalAmount: invoice.totalAmount,
        };
      }

      const receipt = await tx.receipt.create({
        data: {
          invoiceId: input.invoiceId,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
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
      return {
        outcome: 'recorded' as const,
        receipt,
        ledgerEntry,
        collectedAfter,
        fullyCollected: compareMoney(collectedAfter, invoice.totalAmount) === 0,
      };
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
