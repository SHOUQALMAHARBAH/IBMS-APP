import { Injectable, Logger } from '@nestjs/common';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import {
  AR_AGEING_INVOICE_LIMIT,
  buildReceivablesAgeing,
  type ReceivablesAgeingReport,
} from './finance.config';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReceivablesAgeingQuery {
  customerId?: string;
  /** `YYYY-MM-DD`, today or earlier. Default: today. */
  asOf?: string;
}

/**
 * Process 33 (backlog Part C #33, Domain D) — Client Accounting. The
 * accounts-receivable / ageing report per customer, computed on the fly from
 * the current `Invoice` / `Receipt` rows (no stored aggregate — the same shape
 * as #30 Claims Analytics; `GET /invoices` unscoped 400s and points here).
 *
 * An invoice is **outstanding** when it has no collection `Receipt` as at the
 * report's reference date — #32 records exactly one `Receipt` per invoice for
 * the full total, so a receipt means paid in full (partial payments are a
 * deferred #32 refinement). The buckets age `Invoice.dueDate` against `asOf`
 * (default today); `dueDate` is write-once at #31, so an `asOf` in the past
 * yields a point-in-time-correct report without any history reconstruction.
 *
 * Book-wide — `client-accounting.read` is a Finance / cross-book reporting
 * permission (`[FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER,
 * EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`), so there is no per-owner
 * visibility filter; an optional `customerId` just narrows the report to one
 * client. No maker/checker (a read). **Not audit-logged** — an invoice total
 * is Confidential, not Highly Confidential: the #31 decision (`GET /invoices`
 * is likewise not audited, same tier as the `Policy` premium read); contrast
 * the #30 breakdown, which aggregates HIGHLY_CONFIDENTIAL `Claim` rows and so
 * does write a `READ` row.
 */
@Injectable()
export class ClientAccountingService {
  private readonly logger = new Logger(ClientAccountingService.name);

  constructor(private readonly invoices: InvoiceRepository) {}

  async receivablesAgeing(
    query: ReceivablesAgeingQuery,
  ): Promise<ReceivablesAgeingReport> {
    // `asOf` is the ageing reference date — a bare calendar date (the DTO's
    // @Matches keeps it `YYYY-MM-DD`), today or earlier. `parseHistoricalInstant`
    // gives UTC-midnight + the past-only guard in one; absent, default to now.
    const asOfRaw = query.asOf
      ? parseHistoricalInstant(query.asOf, 'asOf')
      : new Date();
    const asOfMidnight = new Date(
      Date.UTC(
        asOfRaw.getUTCFullYear(),
        asOfRaw.getUTCMonth(),
        asOfRaw.getUTCDate(),
      ),
    );
    // Load everything outstanding "as at end of the reference day" — the day
    // after `asOf` at UTC midnight is the exclusive upper bound on both an
    // invoice's `createdAt` and any receipt's `receivedAt`.
    const asOfExclusiveUpper = new Date(asOfMidnight.getTime() + DAY_MS);

    const invoices = await this.invoices.loadOutstandingReceivables({
      customerId: query.customerId,
      asOfExclusiveUpper,
    });

    if (invoices.length >= AR_AGEING_INVOICE_LIMIT) {
      this.logger.warn(
        `Client-accounting ageing report truncated at ${AR_AGEING_INVOICE_LIMIT} outstanding invoices` +
          `${query.customerId ? ` (customer ${query.customerId})` : ''} — the figures are partial; move the aggregation into the query.`,
      );
    }

    return buildReceivablesAgeing({ asOf: asOfMidnight, invoices });
  }
}
