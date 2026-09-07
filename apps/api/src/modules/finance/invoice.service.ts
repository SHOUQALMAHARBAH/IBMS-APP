import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { Invoice } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { InvoiceRepository } from '../../repositories/invoice.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { RecommendationRepository } from '../../repositories/recommendation.repository';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  compareMoney,
  formatMoney,
  quantizeMoney,
} from '../../common/money.util';
import { MAX_COMMISSION_RATE_PERCENT } from '../quotation/quotation.config';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import {
  computeInvoiceFigures,
  deriveInvoiceView,
  invoiceAuditSnapshot,
  invoiceFiguresMatch,
  INVOICE_MAX_DUE_DAYS_AHEAD,
  NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
  type InvoiceView,
} from './finance.config';

const DAY_MS = 24 * 60 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/** Parses a `YYYY-MM-DD` due date to a UTC-midnight instant. Only rejects a
 * string that is not a real calendar date (e.g. `2026-02-30`, which the DTO
 * regex lets through) — a malformed date is never a valid idempotent resume,
 * so this runs before the write-once check. The today / +365d window is a
 * separate `assertDueDateInWindow` that runs only on the new-invoice path. */
function parseDueDateInstant(dueDate: string): Date {
  const parsed = new Date(`${dueDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new UnprocessableEntityException(
      `dueDate ${dueDate} is not a valid calendar date.`,
    );
  }
  return parsed;
}

/** Bounds a parsed due date: not before today, at most
 * {@link INVOICE_MAX_DUE_DAYS_AHEAD} days ahead. Only applied when raising a
 * NEW invoice — a byte-identical resume of an already-created invoice must not
 * start failing once its (originally future) due date has elapsed. */
function assertDueDateInWindow(parsed: Date, raw: string): void {
  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (parsed.getTime() < todayUtc) {
    throw new UnprocessableEntityException(
      `dueDate ${raw} is in the past — an invoice is due today or later.`,
    );
  }
  if (parsed.getTime() > todayUtc + INVOICE_MAX_DUE_DAYS_AHEAD * DAY_MS) {
    throw new UnprocessableEntityException(
      `dueDate ${raw} is more than ${INVOICE_MAX_DUE_DAYS_AHEAD} days ahead — check the date.`,
    );
  }
}

/**
 * Process 31 — Premium Billing (backlog Part C #31, Domain D). Raises the
 * new-business premium `Invoice` against an issued policy: premium carried
 * from `Policy.issuedPremium`, commission auto-derived from the placed
 * quotation's rate, tax + fees supplied by Finance, `totalAmount` =
 * `premium + tax + fees - commissionDeducted` computed server-side.
 *
 * Book-wide: `invoice.create` / `client-accounting.read` are Finance / cross-
 * book reporting permissions — there is no per-owner visibility filter (same
 * as `claims-analytics.view`).
 *
 * `Invoice` IS a workflow entity but #31 only creates it at the schema
 * `@default(INVOICED)` (no engine transition — the `INVOICED -> COLLECTED`
 * cycle is Process 32). No maker/checker — raising a bill is single-actor
 * Finance work (`maker-checker-segregation.md` § "what does NOT trigger this
 * rule"; the second actor in Finance is at refund approval / commission
 * override).
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly policies: PolicyRepository,
    private readonly recommendations: RecommendationRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateInvoiceDto,
    actor: AuthenticatedUser,
  ): Promise<InvoiceView> {
    const policy = await this.policies.findById(dto.policyId);
    if (!policy) {
      throw new NotFoundException(`Policy ${dto.policyId} not found.`);
    }
    if (policy.issuedPremium == null) {
      throw new UnprocessableEntityException(
        `Policy ${dto.policyId} has no issued premium yet — issue the policy (Process 19) before billing it.`,
      );
    }
    // The gate is "premium issued", not "policy still ACTIVE": a policy that
    // was ISSUED and later CANCELLED / EXPIRED is still billable for its
    // new-business premium (the mid-term return is a separate #22 Refund) —
    // ibms-brain/meta/context/finance-lifecycle.md.
    const premiumAmount = quantizeMoney(policy.issuedPremium);

    // Commission is auto-derived from the rate the policy was placed at
    // (Recommendation.recommendedQuotation.commissionRatePercent) — the same
    // path #22 uses. A policy whose quotation captured no rate cannot be
    // billed "net of commission". NOTE (tracked, README § Known gaps #31):
    // there is no Policy -> Quotation link, so a post-recommendation
    // negotiation round (#15) that produced a newer quotation version with a
    // different rate would leave this netting the recommended-quote's rate;
    // Process 35's CommissionAgreement (by insurer + line) replaces this.
    const recommendation = await this.recommendations.findByOpportunityId(
      policy.opportunityId,
    );
    const commissionRatePercent =
      recommendation?.recommendedQuotation.commissionRatePercent;
    if (commissionRatePercent == null) {
      throw new UnprocessableEntityException(
        "This policy's quotation captured no commission rate — the invoice cannot be netted of commission. Capture the rate on the quotation first (Process 13).",
      );
    }

    const dueDateInstant = parseDueDateInstant(dto.dueDate);
    const taxAmount = quantizeMoney(dto.taxAmount);
    const feesAmount = quantizeMoney(dto.feesAmount ?? '0');
    const figures = computeInvoiceFigures({
      premiumAmount,
      commissionRatePercent,
      taxAmount,
      feesAmount,
    });

    // Write-once: at most one new-business premium invoice per policy (the
    // partial UNIQUE index is the race backstop). A byte-identical re-post
    // resumes / returns it; any different figure or due date is a 409. This
    // gate runs BEFORE the input-bound checks below (the #28 recordSettlement
    // ordering) so a genuine idempotent retry is not rejected by a bound that
    // only matters when raising a NEW invoice (e.g. an elapsed due date).
    const existing = await this.invoices.findNewBusinessPremiumInvoice(
      dto.policyId,
    );
    if (existing) {
      if (
        !invoiceFiguresMatch(existing, { ...figures, dueDate: dueDateInstant })
      ) {
        throw new ConflictException(
          `A premium invoice already exists for policy ${dto.policyId} (total ${formatMoney(
            existing.totalAmount,
          )}, due ${existing.dueDate.toISOString().slice(0, 10)}). Invoice figures are recorded once — a correction is not yet supported.`,
        );
      }
      return deriveInvoiceView(existing);
    }

    // --- new-invoice path: enforce every input bound here -------------------
    assertDueDateInWindow(dueDateInstant, dto.dueDate);
    if (taxAmount.lessThan(0)) {
      throw new UnprocessableEntityException('taxAmount cannot be negative.');
    }
    if (feesAmount.lessThan(0)) {
      throw new UnprocessableEntityException('feesAmount cannot be negative.');
    }
    if (compareMoney(taxAmount, premiumAmount) > 0) {
      throw new UnprocessableEntityException(
        `taxAmount (${formatMoney(taxAmount)}) exceeds the premium (${formatMoney(premiumAmount)}) — check the figure.`,
      );
    }
    if (compareMoney(feesAmount, premiumAmount) > 0) {
      throw new UnprocessableEntityException(
        `feesAmount (${formatMoney(feesAmount)}) exceeds the premium (${formatMoney(premiumAmount)}) — check the figure.`,
      );
    }
    // Billing-time backstop on the commission rate — the quotation-capture
    // validator (quotation.config.ts) is the primary 0..100 guard; this
    // re-checks it at the point the rate becomes a client-billed figure, and
    // is what actually guarantees `totalAmount >= 0` (premium + tax + fees −
    // premium × rate% ≥ tax + fees ≥ 0 iff rate ≤ 100).
    if (
      commissionRatePercent.lessThan(0) ||
      commissionRatePercent.greaterThan(MAX_COMMISSION_RATE_PERCENT)
    ) {
      throw new UnprocessableEntityException(
        `The placed commission rate (${commissionRatePercent.toFixed(2)}%) is outside 0..${MAX_COMMISSION_RATE_PERCENT} — the invoice cannot be composed.`,
      );
    }
    if (figures.totalAmount.lessThan(0)) {
      throw new UnprocessableEntityException(
        `The invoice total would be negative (${formatMoney(figures.totalAmount)}) — check the commission rate and the figures.`,
      );
    }

    const dueDate = dueDateInstant;

    let invoice: Invoice;
    try {
      invoice = await this.invoices.create({
        policyId: dto.policyId,
        customerId: policy.customerId,
        invoiceType: NEW_BUSINESS_PREMIUM_INVOICE_TYPE,
        premiumAmount: figures.premiumAmount,
        taxAmount: figures.taxAmount,
        feesAmount: figures.feesAmount,
        commissionDeducted: figures.commissionDeducted,
        totalAmount: figures.totalAmount,
        currency: policy.currency,
        dueDate,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A premium invoice already exists for policy ${dto.policyId} (created concurrently).`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Invoice',
      entityId: invoice.id,
      afterValue: invoiceAuditSnapshot({
        invoiceId: invoice.id,
        policyId: invoice.policyId,
        customerId: invoice.customerId,
        invoiceType: invoice.invoiceType,
        premiumAmount: invoice.premiumAmount,
        taxAmount: invoice.taxAmount,
        feesAmount: invoice.feesAmount,
        commissionDeducted: invoice.commissionDeducted,
        totalAmount: invoice.totalAmount,
        commissionRatePercent: commissionRatePercent.toFixed(2),
        currency: invoice.currency,
        dueDate: invoice.dueDate,
        status: invoice.status,
      }),
    });

    return deriveInvoiceView(invoice);
  }

  async get(id: string): Promise<InvoiceView> {
    const invoice = await this.invoices.findById(id);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found.`);
    }
    return deriveInvoiceView(invoice);
  }

  async list(query: ListInvoicesQueryDto): Promise<InvoiceView[]> {
    if (!query.policyId && !query.customerId) {
      throw new BadRequestException(
        'Scope the read with policyId or customerId (a book-wide invoice list is the Process 33 ageing report).',
      );
    }
    const rows = query.policyId
      ? await this.invoices.findManyByPolicyId(query.policyId)
      : await this.invoices.findManyByCustomerId(query.customerId as string);
    return rows.map(deriveInvoiceView);
  }

  /** Audit failures never fail the request — the write has already committed
   * (same pattern as `PolicyService.safeAudit` / `ClaimService.safeAudit`). */
  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Invoice audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed: ${(err as Error).message}`,
      );
    }
  }
}
