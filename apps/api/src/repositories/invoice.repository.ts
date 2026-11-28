import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type {
  ClientFundsLedgerEntry,
  Invoice,
  Receipt,
  Remittance,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionArchiveRepository } from './retention-archive.repository';
import { notBlockedWhere } from '../modules/pdpl/retention-archive.config';
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
import {
  INSURER_IDENTITY_SELECT,
  insurerName,
  resolveInsurerNamePair,
} from './insurer-identity';

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
 * 🔴 THE LIST'S OWN INCLUDE — DECISION 167/13. `INVOICE_CYCLE_INCLUDE` IS LEFT ALONE.
 *
 * The finance invoice screen is a TABLE, and a table needs the customer's name, the policy number
 * and the insurer's name where `InvoiceView` carries `customerId` and `policyId` as bare uuids.
 *
 * ⛔ SO THIS IS A SECOND INCLUDE AND A SECOND VIEW, not a widening of the first — the
 * `findByIdWithNames` precedent (message 53 §1). `deriveInvoiceView` has FOUR callers across the
 * invoice and collection services and every one of them answers about ONE invoice already in hand:
 * `recordReceipt`, `reconcile`, `recordRemittance` and `get`. None of them renders a table, so
 * widening the shared row would add three joins to every write's return value to serve a screen
 * none of them is on.
 *
 * ⚠️ AND THE CUSTOMER'S NAME IS THE LATIN ONE ONLY. `legalNameAr` reaches 20 sites the owner has
 * ruled nothing about (message 50), so it stays off this payload; the INSURER's pair is resolved
 * because decision 150 ruled on insurer and line names specifically.
 */
const INVOICE_LIST_INCLUDE = {
  receipts: {
    orderBy: { receivedAt: 'asc' },
    include: { remittance: true },
  },
  customer: { select: { id: true, legalName: true } },
  policy: {
    select: {
      id: true,
      policyNumber: true,
      insurer: { select: INSURER_IDENTITY_SELECT },
    },
  },
} as const;

export type InvoiceWithNames = Prisma.InvoiceGetPayload<{
  include: typeof INVOICE_LIST_INCLUDE;
}>;

/**
 * «OPEN» — THE STATUSES A FINANCE OFFICER STILL HAS WORK ON, declared once.
 *
 * Everything except `REMITTED`: the cycle is `INVOICED → COLLECTED → RECONCILED → REMITTED`, and
 * the two EXCEPTION states are reconciliation positions a variance put the invoice into — which is
 * work outstanding, not work finished.
 *
 * ⛔ Declared HERE rather than in the DTO, so «which statuses are open» is a repository fact and
 * the query cannot disagree with a screen's idea of it.
 */
/** The scope a book-wide invoice read is narrowed by — decision 167/13. */
export interface InvoiceListFilter {
  insurerId?: string;
  openOnly: boolean;
  search?: string;
  skip: number;
  take: number;
}

/**
 * ONE `where`, BUILT ONCE AND USED BY BOTH THE PAGE AND THE COUNT.
 *
 * `buildPolicyListWhere`'s own shape, for its own reason: the two queries can never disagree about
 * what is being counted, because there is only one description of it. ⛔ That is what makes a
 * transaction unnecessary here — see `findPageWithNames`.
 *
 * ⚠️ AND THE FILTER IS WHAT DECIDES VISIBILITY, never the page size: every clause is part of the
 * query, so the window bounds the MATCHING rows rather than the rows scanned. That is the standing
 * rule from the `DpoWorkspaceService` defect.
 */
export function buildInvoiceListWhere(
  filter: InvoiceListFilter,
): Prisma.InvoiceWhereInput {
  return {
    ...(filter.openOnly ? { status: { in: [...OPEN_INVOICE_STATUSES] } } : {}),
    /*
     * THE INSURER GOES THROUGH THE POLICY. `Invoice` has no insurer column, so this is a nested
     * relation filter — and an invoice with `policyId: null` therefore matches no insurer, which is
     * correct: such an invoice has no insurer to remit to.
     */
    ...(filter.insurerId ? { policy: { insurerId: filter.insurerId } } : {}),
    /* `search` matches the policy number and the customer's legal name. ⛔ Not the invoice id: a
       uuid is not something anybody types from a piece of paper. */
    ...(filter.search
      ? {
          OR: [
            {
              policy: {
                policyNumber: {
                  contains: filter.search,
                  mode: 'insensitive' as const,
                },
              },
            },
            {
              customer: {
                legalName: {
                  contains: filter.search,
                  mode: 'insensitive' as const,
                },
              },
            },
          ],
        }
      : {}),
  };
}

export const OPEN_INVOICE_STATUSES = [
  'INVOICED',
  'COLLECTED',
  'RECONCILED',
  'EXCEPTION_RAISED',
  'EXCEPTION_RESOLVED',
] as const;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: RetentionArchiveRepository,
  ) {}

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
   * 🔴 THE OFFICE'S INVOICES, ONE PAGE AT A TIME — decision 167/13.
   *
   * ## ⛔ Paginated, and the count comes from the same `where`
   *
   * Its two scoped siblings above are unbounded because they are bounded by construction — one
   * policy, one customer. This one is not: a real office accumulates invoices without limit
   * (46 on dev today across two offices, which proves nothing about a year of trading).
   *
   * `$transaction` over the page and the count, so `total` cannot describe a different set from
   * `items` — and the FILTER is built ONCE and used by both, because a count over a different
   * `where` is the shape that tells a reader there are more pages than exist.
   *
   * ⚠️ AND THE FILTER IS WHAT DECIDES VISIBILITY, never the page size. That is the recorded
   * `DpoWorkspaceService` defect: a read that filters AFTER paging shows a caller a page whose
   * contents depend on how many rows they were allowed to see.
   *
   * ## The insurer filter goes through the POLICY
   *
   * `Invoice` has no insurer column. `policy: { insurerId }` is a nested relation filter, so an
   * invoice with `policyId: null` matches no insurer — correct, because such an invoice has no
   * insurer to remit to.
   *
   * ## `search` matches the policy number and the customer's legal name
   *
   * ⛔ Not the invoice id. A uuid is not something anybody types from a piece of paper, and the
   * whole point of decision 167/13 is that no id is typed or shown.
   */
  async findPageWithNames(filter: InvoiceListFilter): Promise<{
    rows: InvoiceWithNames[];
    total: number;
  }> {
    /*
     * 🔴 TWO CALLS OVER ONE `where` BUILDER — ⛔ NOT `$transaction`, AND CERTAINLY NOT ITS
     * ARRAY FORM.
     *
     * The first version of this read `$transaction([findMany, count])`, reasoning that the page and
     * its total had to be one atomic read. `tenant-scope.extension.ts` refuses that form BY NAME:
     *
     *   «The array form of $transaction is not supported under tenant isolation: its operations
     *    are built before the transaction opens, so app.current_org_id cannot be set for them.»
     *
     * ⚠️ WHICH IS NOT A STYLE RULE. Those operations would have run with NO tenant scope at all —
     * a cross-office read on a finance screen. The extension threw a 500 and CI's step 27 caught it;
     * ⛔ nothing was reached for to work around it.
     *
     * ⟶ `/policies` already answers this question and does NOT use a transaction either: it keeps
     *   `findManyForActor` and `countForActor` as two methods over `buildPolicyListWhere`, and its
     *   own comment states the guarantee — «counts on the SAME `where` the page query runs, so the
     *   two can never disagree about what is being counted». **The shared builder is what makes them
     *   agree, not atomicity.** A row inserted between the two calls can at worst make `total` one
     *   larger than the page proves, which a paginated list is already honest about.
     */
    const where = buildInvoiceListWhere(filter);
    const rows = await this.prisma.client.invoice.findMany({
      where,
      include: INVOICE_LIST_INCLUDE,
      // NEWEST FIRST, and `id` breaks the tie: `createdAt` is not unique, and an unstable
      // secondary order makes a row appear on two pages or on none — the under-specified
      // selection shape that took CI red in message 48 §3.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.skip,
      take: filter.take,
    });
    const total = await this.prisma.client.invoice.count({ where });
    return { rows, total };
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
        insurerNameAr: string | null;
        premiumAmount: Prisma.Decimal;
        commissionDeducted: Prisma.Decimal;
        collectedAt: Date;
      }[]
    >(Prisma.sql`
      SELECT
        i.id AS "invoiceId",
        p."insurerId",
        -- ONE SOURCE IS CHOSEN AND BOTH NAMES ARE READ FROM IT -- the rule
        -- resolveInsurerNamePair states, and the reason it exists. A per-field
        -- COALESCE on the Arabic half would fall through to the OFFICE's Arabic
        -- name for a master-linked insurer whose master has none, printing one
        -- company's Latin name beside another's Arabic one.
        --
        -- AND THE LATIN HALF IS UNCHANGED BY THIS, PROVABLY: it was
        -- COALESCE(im."legalName", ins."legalName"), and InsurerMaster."legalName"
        -- is NOT NULL in the schema -- so whenever im.id is present the COALESCE
        -- already took it, and whenever it is absent both forms take ins. The CASE
        -- says the same thing about the name and makes the SOURCE explicit, so the
        -- Arabic half can follow it instead of being coalesced separately.
        --
        -- An office-local insurer has no master row and carries its own names.
        -- See the LEFT JOIN below.
        -- (No backticks in this comment: it sits inside a template literal.)
        CASE WHEN im.id IS NOT NULL THEN im."legalName"
             ELSE ins."legalName" END AS "insurerName",
        -- Contents §أ row ١١ -- the Arabic name, from the SAME source.
        CASE WHEN im.id IS NOT NULL THEN im."legalNameAr"
             ELSE ins."legalNameAr" END AS "insurerNameAr",
        i."premiumAmount",
        i."commissionDeducted",
        -- The instalment that COMPLETED collection starts the clock: the
        -- broker owes nothing onward until the premium is whole.
        MAX(r."receivedAt") AS "collectedAt"
      FROM "Invoice" i
      -- These two stay INNER: the WHERE already requires a policy, and an
      -- insurer is mandatory on one. The InsurerMaster join below is not.
      JOIN "Policy" p ON p.id = i."policyId"
      JOIN "Insurer" ins ON ins.id = p."insurerId"
      -- LEFT join, and the reason is the worst failure shape available.
      --
      -- Part I §5 put the company's name on the GLOBAL InsurerMaster, and this
      -- was an INNER join because every Insurer row had a master (NOT NULL +
      -- FK). Insurer management removed that: an office can register a company
      -- that is in no catalogue, so insurerMasterId is nullable.
      --
      -- An INNER join would therefore silently DROP every invoice whose insurer
      -- is office-local -- a financial report quietly missing rows, with no
      -- error anywhere and nothing to notice. Hence LEFT, with the COALESCE
      -- above supplying the name from whichever source the row has.
      --
      -- im.id stays in the GROUP BY: it is NULL for a local insurer, and a NULL
      -- group is a group. (No backticks in this comment: it sits inside a
      -- template literal.)
      LEFT JOIN "InsurerMaster" im ON im.id = ins."insurerMasterId"
      JOIN "Receipt" r
        ON r."invoiceId" = i.id
       AND r."receivedAt" < ${scope.asOfExclusiveUpper}
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY i.id, p.id, ins.id, im.id
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
      insurerNameAr: r.insurerNameAr,
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
  async loadInsurerRemittances(
    scope: {
      insurerId?: string;
      asOfExclusiveUpper: Date;
    },
    now: Date = new Date(),
  ): Promise<InsurerRemittanceRow[]> {
    // EXCEPT THE BLOCKED ONES (batch 5 group 7c, condition 1). `asOfExclusiveUpper` bounds this read
    // from ABOVE and nothing bounds it from below, so a remittance made eleven years ago stays in
    // the insurer payables picture for good.
    const blocked = await this.archive.blockedExclusionForModel(
      'remittance',
      now,
    );
    const rows = await this.prisma.client.remittance.findMany({
      where: {
        ...notBlockedWhere('remittedAt', blocked),
        remittedAt: { lt: scope.asOfExclusiveUpper },
        ...(scope.insurerId ? { insurerId: scope.insurerId } : {}),
      },
      select: {
        id: true,
        insurerId: true,
        amount: true,
        remittedAt: true,
        insurer: { select: INSURER_IDENTITY_SELECT },
      },
      orderBy: { remittedAt: 'asc' },
      take: INSURER_PAYABLES_ROW_LIMIT,
    });
    return rows.map((r) => ({
      remittanceId: r.id,
      insurerId: r.insurerId,
      insurerName: insurerName(r.insurer),
      insurerNameAr: resolveInsurerNamePair(r.insurer).nameAr,
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
