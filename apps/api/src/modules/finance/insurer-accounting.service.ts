import { Injectable, Logger } from '@nestjs/common';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import {
  buildInsurerPayables,
  INSURER_PAYABLES_ROW_LIMIT,
  type InsurerPayablesReport,
} from './finance.config';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InsurerPayablesQuery {
  insurerId?: string;
  /** `YYYY-MM-DD`, today or earlier. Default: today. */
  asOf?: string;
}

/**
 * Process 34 (backlog Part C #34, Domain D) — Insurer Accounting. The
 * accounts-payable / remittance-obligations report per insurer, computed on the
 * fly from the current `Invoice` / `Receipt` / `Remittance` rows (no stored
 * aggregate — the same shape as #33 Client Accounting).
 *
 * An **outstanding** obligation is an invoice whose premium the broker has
 * collected (#32's `Receipt`) but not yet remitted to the insurer (no #32
 * `Remittance`) — the broker is holding the insurer's share of client money
 * (Part 7.3). The amount owed is `premiumAmount − commissionDeducted`, exactly
 * #32's `Remittance.amount`. The **remitted** side is straight from the
 * `Remittance` rows. `asOf` (default today) makes both sides point-in-time
 * correct: a `Receipt` counts as collected when `receivedAt < asOf+1d`, a
 * `Remittance` as remitted when `remittedAt < asOf+1d`.
 *
 * Book-wide — `insurer-accounting.read` is a Finance / cross-book reporting
 * permission (`[FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER,
 * EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`), so there is no per-owner
 * visibility filter; an optional `insurerId` just narrows to one insurer. No
 * maker/checker (a read). **Not audit-logged** — a remittance amount is
 * Confidential, not Highly Confidential (the #31 / #33 decision; `GET /invoices`
 * is likewise not audited).
 */
@Injectable()
export class InsurerAccountingService {
  private readonly logger = new Logger(InsurerAccountingService.name);

  constructor(private readonly invoices: InvoiceRepository) {}

  async payables(query: InsurerPayablesQuery): Promise<InsurerPayablesReport> {
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
    const asOfExclusiveUpper = new Date(asOfMidnight.getTime() + DAY_MS);

    // The two reads are independent — fire them together.
    const [obligations, remittances] = await Promise.all([
      this.invoices.loadInsurerObligations({
        insurerId: query.insurerId,
        asOfExclusiveUpper,
      }),
      this.invoices.loadInsurerRemittances({
        insurerId: query.insurerId,
        asOfExclusiveUpper,
      }),
    ]);

    // `obligations` only ever shrinks below the DB `take` on the orphan branch
    // `loadInsurerObligations` documents as impossible (a `Receipt` cannot
    // exist without its `Invoice.policy`), so `.length` here equals the row
    // count and `>=` the cap is an exact truncation test.
    if (
      obligations.length >= INSURER_PAYABLES_ROW_LIMIT ||
      remittances.length >= INSURER_PAYABLES_ROW_LIMIT
    ) {
      this.logger.warn(
        `Insurer-accounting payables report truncated at ${INSURER_PAYABLES_ROW_LIMIT} rows` +
          `${query.insurerId ? ` (insurer ${query.insurerId})` : ''} — the figures are partial; move the aggregation into the query.`,
      );
    }

    return buildInsurerPayables({
      asOf: asOfMidnight,
      obligations,
      remittances,
    });
  }
}
