/**
 * MODULE 0 CLOSE — THE STATUTORY RETENTION FLOOR. A REFUSAL, not a warning.
 *
 * One of the owner's three standing refusals (the other two are a zero premium and erasing an
 * old screening result). An office sets its own retention period per record category and may set
 * it LONGER than the floor freely; a period BELOW the floor is refused, and the refusal carries
 * THE ARTICLE'S OWN OPERATIVE TEXT AND ITS NUMBER — never a paraphrase and never "policy says no".
 *
 * ## THE CONSTRAINT THAT MATTERS MORE THAN THE BUILD: NO INVENTED FLOOR
 *
 * A number picked by an engineer and displayed beside an article number is worse than no floor at
 * all — it is this system telling a broker that the law says something it does not. So exactly TWO
 * floors exist below, both decided and sourced by the owner, and a record category outside them
 * takes the office's own period with NO floor, NO refusal and no invented number.
 *
 * `retention-floors.inventory.spec.ts` is what keeps that true: it refuses a third floor whose
 * `source` is not an owner decision, and refuses a floor with no operative text.
 *
 * ## WHERE THE TEXT LIVES, AND WHY IT IS HARD-CODED HERE
 *
 * MEASURED before building: **the provider's legal-values table does not exist.** It is module 1's
 * work and is named as such in four places — `docs/deferred-register.md`'s deferral table, `docs/
 * module-1-preflight.md`, `schema.prisma:5703` and `seed-data/reference-tables.ts`, the last two
 * both saying module 1's legal-values table "becomes the ninth of the same family". So there is no
 * data home to read from yet.
 *
 * And every article citation in this product is hard-coded in the service or config that applies
 * it — `broker-license-scope.service.ts` carries art. 3/a's refusal as a string literal, `license-
 * standing.config.ts` carries art. 14/c, `policy.service.ts` carries art. 21/a/9. This file follows
 * that, which is the instruction: hard-coded today, so say so and do not change it in this batch.
 * When the legal-values table lands, these two entries are what it reads, and the FLOOR ARITHMETIC
 * below does not move — only where the text comes from.
 *
 * ## THE TEXT IS THE ARTICLE'S OPERATIVE REQUIREMENT, MARKED PROVISIONAL
 *
 * Nobody here has read the Official Gazette. What is below is each article's operative requirement
 * AS THE OWNER STATED IT, she being the approving source, carrying the same PROVISIONAL marker the
 * existing `AuditLogEntry` seed row already carries for the same two instruments. It is not a
 * transcription, and it does not claim to be — a claim of verbatim text nobody has checked against
 * the Gazette would be the same defect one layer up from an invented number.
 *
 * ## ENGLISH ONLY, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE
 *
 * No refusal in this api carries Arabic — measured across the sampled services, zero Arabic
 * characters inside any `ConflictException` or `UnprocessableEntityException` message — and the
 * screens render the SERVER's own sentence (decision 90). Art. 17/أ's own text is Arabic, so an
 * Arabic rendering of it is a server-message i18n MECHANISM this api does not have; building one
 * for one refusal, or writing Arabic statute text I have not read, are both worse than carrying the
 * operative requirement in the language every other refusal here already uses. Recorded, not
 * smuggled in.
 *
 * ## THE WEAKNESS, DECLARED: `recordCategory` IS FREE TEXT
 *
 * MEASURED: `recordCategory` is a `String` with `@Length(1, 200)`, typed into the screen by a
 * person, and NOTHING resolves it to a model — the one exact-string reader anywhere is
 * `audit.service.ts:165` looking for the literal `'AuditLogEntry'`. So a floor can only fire on a
 * category it RECOGNISES, and somebody who types "Client KYC files" instead of `KYCRecord` gets no
 * floor. That failure is silent and runs in the dangerous direction.
 *
 * Two things bound it rather than close it. Matching is on a NORMALISED comparison (case and
 * separators folded), so the realistic spelling variants of one name collapse together; and the
 * recognised names are declared below BY NAME so the list is arguable. Closing it properly means
 * making the category a vocabulary rather than free text, which changes what an office may enter
 * and is not this batch's decision.
 */

import { UnprocessableEntityException } from '@nestjs/common';

/** One year in months, so the two floors read as the statute states them rather than as 60 and 120. */
const MONTHS_PER_YEAR = 12;

export interface StatutoryRetentionFloor {
  /** Stable key — what a future legal-values row would be addressed by. */
  key: 'AML_CDD_FIVE_YEARS' | 'COMMERCIAL_TEN_YEARS';
  /** The minimum an office may set for a category this floor governs. */
  floorMonths: number;
  /** The instrument, named the way the rest of this product names instruments. */
  instrument: string;
  /** The article, in both the Latin form this repo uses and the Arabic designation it carries. */
  article: string;
  /**
   * The article's OPERATIVE REQUIREMENT, as the owner stated it. Carried into the refusal verbatim
   * so the person reading it sees what the law requires rather than what we concluded from it.
   */
  operativeText: string;
  /**
   * WHAT THE PERIOD IS COUNTED FROM. Part of the statute in both cases, and part of the refusal:
   * a floor without its trigger is a number somebody will count from the wrong day.
   */
  countedFrom: string;
  /** How the figure and the wording were approved, which the inventory guard checks. */
  source: string;
  /**
   * The record categories this floor governs, declared BY NAME so the list can be argued with.
   * Compared after `normaliseCategory`, so case and separators do not matter.
   */
  categories: readonly string[];
}

export const STATUTORY_RETENTION_FLOORS: readonly StatutoryRetentionFloor[] = [
  {
    key: 'AML_CDD_FIVE_YEARS',
    floorMonths: 5 * MONTHS_PER_YEAR,
    instrument:
      'Anti-Money Laundering and Counter-Terrorism Financing Law No. 20 of 2021',
    article: 'art. 17/a (المادة ١٧/أ)',
    operativeText:
      'customer due-diligence records and account files must be kept for at least five years',
    countedFrom:
      'counted from completing the transaction OR ending the relationship, WHICHEVER IS LONGER',
    source:
      'OWNER DECISION, module 0 batch 5 group 5 — the figure and the wording are hers. CITATION PROVISIONAL pending verification against the Official Gazette (No. 5743, 16 September 2021), the same marker `seed-data/retention-schedule.ts` already carries for this instrument. That law also settles that a broker is a subject entity: art. 14/a/1 item 4 names insurance agents and brokers.',
    categories: [
      // The Prisma model that IS the due-diligence record, plus the names a person would type for
      // the same thing. `KYCRecord` is the one this system's own screens and services call it.
      'KYCRecord',
      'KYC',
      'KYCRecords',
      'CDD',
      'CustomerDueDiligence',
      'CustomerDueDiligenceRecord',
      'CustomerDueDiligenceRecords',
      // "account files" is the article's own second limb — the customer's file.
      'CustomerFile',
      'CustomerFiles',
      'AccountFile',
      'AccountFiles',
    ],
  },
  {
    key: 'COMMERCIAL_TEN_YEARS',
    floorMonths: 10 * MONTHS_PER_YEAR,
    instrument: 'Commercial Law No. 12 of 1966',
    article: 'art. 19 (المادة ١٩)',
    operativeText:
      'financial and commercial records must be kept for ten years',
    countedFrom:
      'counted from the closing of the transaction — which the owner has defined for this system as the CLOSING DATE OF THE FINANCIAL TRANSACTION',
    source:
      'OWNER DECISION, module 0 batch 5 group 5 — the figure, the wording and the definition of "closing" are hers. CITATION PROVISIONAL pending verification against the Official Gazette.',
    categories: [
      // The generic names first, then this system's own records of a financial transaction. Each is
      // a record OF a transaction with a closing date, which is what the article and the owner's
      // definition of "closing" together describe. Listed by name so any one can be struck.
      'FinancialRecord',
      'FinancialRecords',
      'CommercialRecord',
      'CommercialRecords',
      'Invoice',
      'Receipt',
      'Payment',
      'Settlement',
      'Refund',
      'Remittance',
      'Collection',
      'CommissionLedgerEntry',
      'BankReconciliation',
    ],
  },
] as const;

/**
 * Case- and separator-insensitive. `KYC_Record`, `kyc record` and `KYCRecord` are one category;
 * "Client KYC files" is not, and that limit is declared in this file's header rather than hidden.
 */
export function normaliseCategory(recordCategory: string): string {
  return recordCategory.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The floor governing this category, or `null` — which means the office's own period stands. */
export function floorForCategory(
  recordCategory: string,
): StatutoryRetentionFloor | null {
  const needle = normaliseCategory(recordCategory);
  if (!needle) return null;
  for (const floor of STATUTORY_RETENTION_FLOORS) {
    if (floor.categories.some((c) => normaliseCategory(c) === needle)) {
      return floor;
    }
  }
  return null;
}

/**
 * The refusal's own sentence. Separate from the throw so it can be asserted directly, and so the
 * four parts are visible as four parts: what was asked for, the floor, the article's own text, and
 * what the period is counted from.
 */
export function statutoryFloorRefusal(
  floor: StatutoryRetentionFloor,
  recordCategory: string,
  requestedMonths: number,
): string {
  return (
    `A retention period of ${requestedMonths} month(s) for "${recordCategory}" is below the ` +
    `statutory minimum of ${floor.floorMonths} months. ${floor.instrument}, ${floor.article}: ` +
    `${floor.operativeText} — ${floor.countedFrom}. ` +
    'A longer period may be set freely; a shorter one may not.'
  );
}

/**
 * REFUSES a period below the floor, and returns the floor it checked against (or `null` where the
 * category has none) so a caller can record which rule it satisfied.
 *
 * Applied where the period is SET — create and update — and deliberately NOT at confirm. A refusal
 * at confirm would be unreachable today (measured: one row on each database, `AuditLogEntry` at 120
 * months, and no floor governs it), and a gate whose precondition cannot occur is IMPROVEMENTS
 * § 1.62's shape, shipped here twice already. Guarding both write paths is what makes a row below a
 * floor unrepresentable going forward.
 */
export function assertMeetsStatutoryFloor(
  recordCategory: string,
  retentionPeriodMonths: number,
): StatutoryRetentionFloor | null {
  const floor = floorForCategory(recordCategory);
  if (floor && retentionPeriodMonths < floor.floorMonths) {
    throw new UnprocessableEntityException(
      statutoryFloorRefusal(floor, recordCategory, retentionPeriodMonths),
    );
  }
  return floor;
}
