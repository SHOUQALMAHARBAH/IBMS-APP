import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import {
  compareMoney,
  formatMoney,
  quantizeMoney,
  toMoney,
  MONEY_ROUNDING,
  type MoneyInput,
} from '../../common/money.util';

/**
 * Process 13 — Quotation Management (backlog Part C #13, Domain B). The
 * pure, deterministic core of capturing an insurer's quote: take the raw
 * quote terms, quantize every monetary field to fils precision
 * (ibms-brain/meta/lex/money-decimal-jod.md — never a raw Decimal op, never
 * a JS number), range-check the numeric ones, and hand back a
 * fully-normalized term set the repository persists verbatim.
 *
 * `capture` (a version-1 row) and `revise` (a new version linked to its
 * predecessor) persist the *identical* term set — only the chain linkage
 * (`previousVersionId` / `versionNumber` / `isCurrentVersion`) differs — so
 * both funnel their DTO through `normalizeQuotationTerms` here.
 */

/** The Business Interruption indemnity period an insurer can quote, in
 * months. Lower bound 1 (a zero-month BI period is not a quote); upper
 * bound 120 (10 years) is a generous sanity ceiling, not a sourced
 * underwriting limit — a `/brain-gap` candidate if a real maximum surfaces. */
export const MIN_BI_PERIOD_MONTHS = 1;
export const MAX_BI_PERIOD_MONTHS = 120;

/** A commission rate is a percentage — 0..100, at most 2 decimal places
 * (the `@db.Decimal(5, 2)` column). This is the rate the insurer *quoted*,
 * captured verbatim; applying it to a premium (Part 3.6) is Finance's job
 * (#31+), not this module's. */
export const MAX_COMMISSION_RATE_PERCENT = 100;

/** ISO-4217-ish: three uppercase letters. The book is JOD-first but the
 * schema (and money.util.ts) allow a foreign-currency quote to be captured
 * as sent and converted downstream. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

export interface QuotationTermsInput {
  premium: MoneyInput;
  currency?: string | null;
  deductible?: MoneyInput | null;
  limits?: Record<string, unknown> | null;
  biPeriodMonths?: number | null;
  liabilityLimit?: MoneyInput | null;
  exclusions?: string | null;
  conditions?: string | null;
  commissionRatePercent?: MoneyInput | null;
}

/** Every field normalized and ready to persist: money as `Prisma.Decimal`
 * (fils-quantized), text trimmed-or-null, `limits` as an object-or-null. */
export interface NormalizedQuotationTerms {
  premium: Prisma.Decimal;
  currency: string;
  deductible: Prisma.Decimal | null;
  limits: Record<string, unknown> | null;
  biPeriodMonths: number | null;
  liabilityLimit: Prisma.Decimal | null;
  exclusions: string | null;
  conditions: string | null;
  commissionRatePercent: Prisma.Decimal | null;
}

function requireNonNegativeMoney(
  value: MoneyInput,
  field: string,
): Prisma.Decimal {
  const amount = quantizeMoney(value);
  if (compareMoney(amount, 0) < 0) {
    throw new UnprocessableEntityException(`${field} cannot be negative`);
  }
  return amount;
}

function optionalNonNegativeMoney(
  value: MoneyInput | null | undefined,
  field: string,
): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  return requireNonNegativeMoney(value, field);
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalizes the quote terms an insurer sent, or throws a 422 naming the
 * offending field. Pure: the same input always yields the same output (and
 * the same rejection).
 */
export function normalizeQuotationTerms(
  input: QuotationTermsInput,
): NormalizedQuotationTerms {
  const premium = requireNonNegativeMoney(input.premium, 'premium');
  if (compareMoney(premium, 0) === 0) {
    throw new UnprocessableEntityException(
      'premium must be greater than zero — a quotation with no premium is not a quote',
    );
  }

  const currency = (input.currency ?? 'JOD').toUpperCase();
  if (!CURRENCY_CODE.test(currency)) {
    throw new UnprocessableEntityException(
      'currency must be a 3-letter code, e.g. "JOD"',
    );
  }

  let biPeriodMonths: number | null = null;
  if (input.biPeriodMonths !== null && input.biPeriodMonths !== undefined) {
    if (
      !Number.isInteger(input.biPeriodMonths) ||
      input.biPeriodMonths < MIN_BI_PERIOD_MONTHS ||
      input.biPeriodMonths > MAX_BI_PERIOD_MONTHS
    ) {
      throw new UnprocessableEntityException(
        `biPeriodMonths must be a whole number of months between ${MIN_BI_PERIOD_MONTHS} and ${MAX_BI_PERIOD_MONTHS}`,
      );
    }
    biPeriodMonths = input.biPeriodMonths;
  }

  let commissionRatePercent: Prisma.Decimal | null = null;
  if (
    input.commissionRatePercent !== null &&
    input.commissionRatePercent !== undefined
  ) {
    const rate = toMoney(
      input.commissionRatePercent,
      'commissionRatePercent',
    ).toDecimalPlaces(2, MONEY_ROUNDING);
    if (
      compareMoney(rate, 0) < 0 ||
      compareMoney(rate, MAX_COMMISSION_RATE_PERCENT) > 0
    ) {
      throw new UnprocessableEntityException(
        `commissionRatePercent must be between 0 and ${MAX_COMMISSION_RATE_PERCENT}`,
      );
    }
    commissionRatePercent = rate;
  }

  // An empty `{}` is "no limits", not "limits are empty" — normalize it to
  // null so `hasLimits` in the audit snapshot stays honest.
  const limits =
    input.limits && Object.keys(input.limits).length > 0 ? input.limits : null;

  return {
    premium,
    currency,
    deductible: optionalNonNegativeMoney(input.deductible, 'deductible'),
    limits,
    biPeriodMonths,
    liabilityLimit: optionalNonNegativeMoney(
      input.liabilityLimit,
      'liabilityLimit',
    ),
    exclusions: trimOrNull(input.exclusions),
    conditions: trimOrNull(input.conditions),
    commissionRatePercent,
  };
}

/**
 * The structural + monetary metadata of a quotation row, for an
 * `AuditLogEntry.afterValue`. Deliberately excludes the free-text
 * `exclusions` / `conditions` (insurer policy wording, Confidential — Part
 * 6.1; carried as presence booleans instead) and the `limits` blob, same
 * "metadata not body" shape as the RFQ correspondence audit (#12). Premium
 * and the other amounts DO go in — money in an audit `afterValue` is an
 * established pattern here (up-sell logs `currentSumInsured` / `shortfall`).
 */
export function quotationAuditSnapshot(row: {
  rfqId: string;
  insurerId: string;
  versionNumber: number;
  isCurrentVersion: boolean;
  previousVersionId: string | null;
  premium: Prisma.Decimal;
  currency: string;
  deductible: Prisma.Decimal | null;
  liabilityLimit: Prisma.Decimal | null;
  commissionRatePercent: Prisma.Decimal | null;
  biPeriodMonths: number | null;
  exclusions: string | null;
  conditions: string | null;
  limits: unknown;
}): Prisma.InputJsonObject {
  return {
    rfqId: row.rfqId,
    insurerId: row.insurerId,
    versionNumber: row.versionNumber,
    isCurrentVersion: row.isCurrentVersion,
    previousVersionId: row.previousVersionId,
    premium: formatMoney(row.premium),
    currency: row.currency,
    deductible: row.deductible === null ? null : formatMoney(row.deductible),
    liabilityLimit:
      row.liabilityLimit === null ? null : formatMoney(row.liabilityLimit),
    commissionRatePercent:
      row.commissionRatePercent === null
        ? null
        : row.commissionRatePercent.toFixed(2),
    biPeriodMonths: row.biPeriodMonths,
    hasExclusions: row.exclusions !== null,
    hasConditions: row.conditions !== null,
    hasLimits: row.limits !== null && row.limits !== undefined,
  };
}
