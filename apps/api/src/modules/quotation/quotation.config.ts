import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import {
  compareMoney,
  formatMoney,
  quantizeMoney,
  subtractMoney,
  toMoney,
  MONEY_CURRENCY,
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

/**
 * ISO-4217-ish: three uppercase letters. Shape only — `MONEY_CURRENCY` decides which code is
 * accepted.
 *
 * **CORRECTED 2026-11-06 (module 0-c batch 6). This said: *"The book is JOD-first but the schema
 * (and money.util.ts) allow a foreign-currency quote to be captured as sent and converted
 * downstream."*** The first half was true and is now deliberately false; **the second half was
 * never true at all, and it is the sentence that made the gap feel safe.** Nothing downstream
 * converts anything: measured 2026-11-06, no `exchangeRate` / `fxRate` / `currencyRate` field
 * exists in `schema.prisma` and no service computes a rate. A foreign-currency quote was captured
 * as sent, copied onto its Policy by `PlacePolicyDto`, and then added to JOD premiums by plain
 * `_sum` under a heading reading 'JOD'.
 *
 * Corrected rather than deleted because what it was reaching for is real and still owed: capturing
 * an insurer's quote in the currency it was sent in IS the right behaviour the day there is a rate
 * to convert it with. There is not one, so the honest state is a refusal naming the reason.
 */
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
  /** Backlog Part C #15 — the broker's rationale for this negotiation round.
   * Only ever supplied by `revise` (a version-1 capture is an insurer's
   * opening quote, not a negotiation round); `capture`'s DTO has no such
   * field, so this is `undefined` there and normalizes to `null`. */
  negotiationNotes?: string | null;
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
  negotiationNotes: string | null;
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

  const currency = (input.currency ?? MONEY_CURRENCY).toUpperCase();
  if (!CURRENCY_CODE.test(currency)) {
    throw new UnprocessableEntityException(
      'currency must be a 3-letter code, e.g. "JOD"',
    );
  }
  // THE DOOR. Added 2026-11-06 (module 0-c batch 6): this accepted any well-formed 3-letter code
  // and stored it, and `PlacePolicyDto` takes the Policy's currency FROM the accepted quotation —
  // so a USD quotation became a USD policy whose `issuedPremium` was then summed, with no currency
  // split and no conversion, into totals headed 'JOD' on the KPI, portfolio, policy and
  // employee-performance dashboards. See `MONEY_CURRENCY` in `money.util.ts` for why there is no
  // conversion to fall back on and what lifting this guard would require first.
  //
  // This is the ONE client-supplied currency that reaches a premium aggregate. Measured
  // 2026-11-06: every Quotation, Policy and Invoice row on the dev database is already 'JOD'
  // (89 / 74 / 60), so this refuses nothing that exists — it closes a path, it does not change a
  // stored figure.
  if (currency !== MONEY_CURRENCY) {
    throw new UnprocessableEntityException(
      `currency must be ${MONEY_CURRENCY} — this system holds and totals money in ${MONEY_CURRENCY} fils only, and has no exchange-rate mechanism, so a quotation in ${currency} could not be summed into any premium figure without being silently wrong`,
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
    negotiationNotes: trimOrNull(input.negotiationNotes),
  };
}

/**
 * The structural + monetary metadata of a quotation row, for an
 * `AuditLogEntry.afterValue`. Deliberately excludes the free-text
 * `exclusions` / `conditions` / `negotiationNotes` (insurer policy wording
 * and commercial negotiation correspondence, Confidential — Part 6.1;
 * carried as presence booleans instead) and the `limits` blob, same
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
  negotiationNotes: string | null;
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
    hasNegotiationNotes: row.negotiationNotes !== null,
  };
}

/** The subset of a `Quotation` row `buildNegotiationHistory` reads — every
 * versioned term plus the chain-linkage / provenance scalars. */
export interface QuotationVersionLike {
  id: string;
  versionNumber: number;
  isCurrentVersion: boolean;
  previousVersionId: string | null;
  receivedAt: Date;
  capturedByUserId: string | null;
  negotiationNotes: string | null;
  premium: Prisma.Decimal;
  currency: string;
  deductible: Prisma.Decimal | null;
  limits: unknown;
  biPeriodMonths: number | null;
  liabilityLimit: Prisma.Decimal | null;
  exclusions: string | null;
  conditions: string | null;
  commissionRatePercent: Prisma.Decimal | null;
}

/** One entry in a version chain's negotiation history. */
export interface NegotiationRound {
  /** 0 = the insurer's opening quote (version 1); 1..n = negotiation rounds. */
  round: number;
  versionNumber: number;
  isCurrentVersion: boolean;
  receivedAt: Date;
  capturedByUserId: string | null;
  /** Fixed 3dp string, this version's premium. */
  premium: string;
  /** `this.premium - previous.premium`, fixed 3dp, sign preserved (negative =
   * the round brought the premium down). `null` for round 0, and for any
   * round that changed `currency` (a cross-currency delta is meaningless). */
  premiumDeltaFromPrevious: string | null;
  /** Which versioned term fields differ from the previous version. Empty for
   * round 0 (nothing to compare against). */
  changedTermFields: string[];
  /** The broker's documented rationale for this round, verbatim — `null`
   * when none was recorded (always the case for round 0: `capture` has no
   * such field). */
  negotiationNotes: string | null;
}

/** The versioned term fields `buildNegotiationHistory` diffs round-to-round.
 * `negotiationNotes` is deliberately excluded — it is the rationale *for* a
 * round, not one of the quoted terms. */
const DIFFED_TERM_FIELDS = [
  'premium',
  'currency',
  'deductible',
  'limits',
  'biPeriodMonths',
  'liabilityLimit',
  'exclusions',
  'conditions',
  'commissionRatePercent',
] as const;

function moneyEqual(
  a: Prisma.Decimal | null,
  b: Prisma.Decimal | null,
): boolean {
  if (a === null || b === null) return a === b;
  return compareMoney(a, b) === 0;
}

function termFieldChanged(
  field: (typeof DIFFED_TERM_FIELDS)[number],
  prev: QuotationVersionLike,
  cur: QuotationVersionLike,
): boolean {
  switch (field) {
    case 'premium':
      return !moneyEqual(prev.premium, cur.premium);
    case 'deductible':
      return !moneyEqual(prev.deductible, cur.deductible);
    case 'liabilityLimit':
      return !moneyEqual(prev.liabilityLimit, cur.liabilityLimit);
    case 'commissionRatePercent':
      return !moneyEqual(prev.commissionRatePercent, cur.commissionRatePercent);
    case 'limits':
      // Stored verbatim as the DTO sent it; a stringify compare is a display
      // aid, not a semantic diff (key reordering would read as a change).
      return (
        JSON.stringify(prev.limits ?? null) !==
        JSON.stringify(cur.limits ?? null)
      );
    default:
      return prev[field] !== cur[field];
  }
}

/**
 * Process 15 — Negotiation (backlog Part C #15). Turns one insurer's version
 * chain into a round-by-round history: round 0 is the opening quote (version
 * 1), each subsequent version is a negotiation round carrying the premium
 * delta from the round before it and the list of term fields that moved.
 * Pure and deterministic — no I/O, same input always yields the same
 * history (same shape as `planComparison` / `buildCustomerTimeline`).
 *
 * `versions` may arrive in any order; it is sorted by `versionNumber`
 * ascending here. Each round is diffed against the row its `previousVersionId`
 * names (the real chain linkage), falling back to the version-adjacent row if
 * that predecessor is not in the set. A single-version chain yields exactly
 * one round-0 entry.
 *
 * `premiumDeltaFromPrevious` is only meaningful within one currency — if a
 * round changes `currency`, the delta is `null` (the currency move is still
 * reported in `changedTermFields`).
 */
export function buildNegotiationHistory(
  versions: QuotationVersionLike[],
): NegotiationRound[] {
  const ordered = [...versions].sort(
    (a, b) => a.versionNumber - b.versionNumber,
  );
  const byId = new Map(ordered.map((v) => [v.id, v]));
  return ordered.map((version, index) => {
    const previous =
      (version.previousVersionId != null
        ? byId.get(version.previousVersionId)
        : undefined) ?? (index === 0 ? null : ordered[index - 1]);
    const sameCurrency =
      previous !== null && previous.currency === version.currency;
    return {
      round: index,
      versionNumber: version.versionNumber,
      isCurrentVersion: version.isCurrentVersion,
      receivedAt: version.receivedAt,
      capturedByUserId: version.capturedByUserId,
      premium: formatMoney(version.premium),
      premiumDeltaFromPrevious:
        previous === null || !sameCurrency
          ? null
          : formatMoney(subtractMoney(version.premium, previous.premium)),
      changedTermFields:
        previous === null
          ? []
          : DIFFED_TERM_FIELDS.filter((field) =>
              termFieldChanged(field, previous, version),
            ),
      negotiationNotes: version.negotiationNotes,
    };
  });
}
