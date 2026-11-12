import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { LegalValue } from '@ibms/db';

/**
 * THE LEGAL FIGURES THE LICENCE RULES READ — loaded from `LegalValue` rows, never declared here.
 *
 * OWNER DECISION 123, third form. Before module 1 these three figures were constants in source:
 * `CAPITAL_BANDS` (five figures), `RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY` and
 * `ARTICLE_14C_SUSPENSION_LIMIT_YEARS`. `check:legal-numbers` declared all three with their
 * reasons and its own message said to DELETE the declaration when the figure moved into the table.
 * This is that move.
 *
 * ## THE DERIVATIONS STAY PURE AND TAKE THE FIGURES AS A PARAMETER
 *
 * `isBrokerLicenseCurrentlyLapsed`, `deriveLicenseStanding` and `assessCapital` are pure functions
 * with large, documented test suites, and they are read by a provider dashboard whose whole point
 * is that it is cheap. Making them `async` to fetch a row would have put a database read inside
 * date arithmetic, so the figures are LOADED ONCE by the caller and handed down. The parameter is
 * REQUIRED in every signature — the same argument as `assertMayPractise`'s `branch`: a default
 * compiles at every call site and silently reinstates a hard-coded figure.
 *
 * ## A MISSING FIGURE IS A REFUSAL, NEVER A DEFAULT
 *
 * `licenceFiguresFrom` throws when a provider figure is absent, naming the code. That is the rule
 * OWNER DECISION 123 extends — the system never asserts a legal value it does not have — and it is
 * the opposite of the comfortable failure: a default of 45 days would make an office's renewal
 * deadline correct by coincidence and wrong the moment the regulation moved, with nothing saying so.
 *
 * It is NOT the same as criterion 6's dormant office value. A dormant office figure is an EXPECTED
 * null that nothing may rest on; a missing PROVIDER figure means the seed did not run or a row was
 * deleted, and every licence answer in the product depends on it.
 */

/**
 * The codes this module reads. Strings, so no figure is restated here — and
 * `packages/db/prisma/seed-data/legal-values.ts` is the catalogue they must match. The parity is
 * checked by `legal-values-parity.spec.ts` in `packages/db`, which can see both.
 */
export const LICENCE_LEGAL_VALUE_CODES = {
  renewalApplicationDueDays: 'RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY',
  article14cSuspensionLimitYears: 'ARTICLE_14C_SUSPENSION_LIMIT_YEARS',
  capitalBand1Amount: 'CAPITAL_MIN_JOD_BAND_1',
  capitalBand1MaxBranches: 'CAPITAL_MAX_BRANCHES_BAND_1',
  capitalBand2Amount: 'CAPITAL_MIN_JOD_BAND_2',
  capitalBand2MaxBranches: 'CAPITAL_MAX_BRANCHES_BAND_2',
  capitalBand3Amount: 'CAPITAL_MIN_JOD_BAND_3',
} as const;

/** One band of art. 4/a: the highest branch count it covers, and the capital it requires. */
export interface CapitalBand {
  upToBranches: number;
  requiredJod: Prisma.Decimal;
}

/** Every figure the licence rules need, as at one instant. */
export interface LicenceLegalFigures {
  renewalApplicationDueDaysBeforeExpiry: number;
  article14cSuspensionLimitYears: number;
  /** Ascending by branch count; the last band's `upToBranches` is `Infinity`, because art. 4/a's
   *  top band is «لما يزيد عن ١٢» and has no upper bound. */
  capitalBands: readonly CapitalBand[];
}

function requireRow(rows: readonly LegalValue[], code: string): LegalValue {
  const row = rows.find((r) => r.code === code);
  if (!row) {
    throw new UnprocessableEntityException(
      `The legal value "${code}" has no row in force. Every licence answer in this product reads ` +
        `it, and this system does not supply a legal figure it does not have. Run ` +
        `the seed, or check whether the row was superseded without a replacement.`,
    );
  }
  return row;
}

export function requireNumeric(
  rows: readonly LegalValue[],
  code: string,
): Prisma.Decimal {
  const row = requireRow(rows, code);
  if (row.numericValue === null) {
    throw new UnprocessableEntityException(
      `The legal value "${code}" is in force but carries no figure. For a provider row that is a ` +
        `data fault — a CHECK constraint refuses it — and for an office row it means DORMANT, ` +
        `which nothing may rest on.`,
    );
  }
  return row.numericValue;
}

/**
 * A count or a day-span as an integer.
 *
 * `numericValue` is `Decimal(18,3)` because a JOD amount may not be a binary float
 * (`money-decimal-jod.md`), and the same column therefore holds the counts. A count with a
 * fractional part is a data fault and is refused rather than truncated: 44.5 days silently
 * becoming 44 moves a statutory deadline by a day.
 */
export function requireWholeNumber(
  rows: readonly LegalValue[],
  code: string,
): number {
  const value = requireNumeric(rows, code);
  if (!value.isInteger()) {
    throw new UnprocessableEntityException(
      `The legal value "${code}" is ${value.toString()}, which is not a whole number. It is read ` +
        `as a count of days, years or branches, and truncating it would move a statutory ` +
        `threshold without saying so.`,
    );
  }
  return value.toNumber();
}

/**
 * Build the figures from rows already read at the right date.
 *
 * Pure, and takes the rows rather than the repository, so the rule is testable with no database —
 * the same split `license-standing.config.ts` keeps between its derivation and `LicenseGateService`.
 */
export function licenceFiguresFrom(
  rows: readonly LegalValue[],
): LicenceLegalFigures {
  const c = LICENCE_LEGAL_VALUE_CODES;

  const band1Max = requireWholeNumber(rows, c.capitalBand1MaxBranches);
  const band2Max = requireWholeNumber(rows, c.capitalBand2MaxBranches);
  if (band2Max <= band1Max) {
    throw new UnprocessableEntityException(
      `Art. 4/a's capital bands are out of order: the second boundary (${band2Max}) is not above ` +
        `the first (${band1Max}), so no branch count falls in the second band and every office ` +
        `above the first boundary would be assessed at the top requirement.`,
    );
  }

  return {
    renewalApplicationDueDaysBeforeExpiry: requireWholeNumber(
      rows,
      c.renewalApplicationDueDays,
    ),
    article14cSuspensionLimitYears: requireWholeNumber(
      rows,
      c.article14cSuspensionLimitYears,
    ),
    capitalBands: [
      {
        upToBranches: band1Max,
        requiredJod: requireNumeric(rows, c.capitalBand1Amount),
      },
      {
        upToBranches: band2Max,
        requiredJod: requireNumeric(rows, c.capitalBand2Amount),
      },
      {
        // Art. 4/a's top band is «لما يزيد عن ١٢» — no upper bound, so no row states one.
        upToBranches: Number.POSITIVE_INFINITY,
        requiredJod: requireNumeric(rows, c.capitalBand3Amount),
      },
    ],
  };
}
