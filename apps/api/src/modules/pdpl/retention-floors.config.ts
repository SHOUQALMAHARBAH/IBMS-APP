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
import { DECLARATION_REASON_MIN_LENGTH } from '../../common/declaration-reason';

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

/* ===================================================================================================
 * THE SILENT CASE — batch 5 group 6. THE OWNER HAS RULED: IT DECLARES.
 *
 * ## WHAT WAS SILENT, MEASURED RATHER THAN SUPPOSED
 *
 * The header above declares this file's own limit: `recordCategory` is free text, so a floor fires
 * only on a name the list recognises. The consequence is concrete — `CustomerFile` takes the
 * five-year floor and `Customer` takes NOTHING, no refusal and no word, and `Customer` is one of the
 * fourteen names reported as unsourced. A refusal the owner made HARD is escaped by a spelling.
 *
 * ## HER RULING, AND WHY IT IS NOT A REFUSAL
 *
 * By her standing rule: the harm here is the OFFICE'S OWN regulatory exposure, not a third party's,
 * so it DECLARES AND LOGS. The save is accepted. No invented number, no blocking.
 *
 * ## THE SENTENCE NAMES BOTH FLOORS, AND THAT IS THE MECHANISM
 *
 * Not decoration: naming both known floors with their instruments and articles is how somebody who
 * is in fact saving due-diligence records under a different name RECOGNISES WHAT THEY ARE DOING.
 * That is the entire purpose of the declaration, and it is why the sentence is unconditional about
 * the two floors rather than tailored to the category.
 *
 * ## AND IT SAYS THE *SYSTEM* DOES NOT KNOW A MINIMUM — NEVER THAT THE LAW SETS NONE
 *
 * That distinction is the difference between an honest declaration and this product making a legal
 * claim it has no source for. The text is the owner's own, lives in the web dictionary in both
 * languages, and is stored VERBATIM AS RENDERED rather than paraphrased at any layer.
 *
 * ## ASKED ONCE PER CATEGORY PER OFFICE — THE ROW IS THE MECHANISM
 *
 * `RetentionScheduleItem` is already UNIQUE on (organizationId, recordCategory), so the row IS the
 * per-office per-category record and no second table is needed. `noFloorAcknowledgedMonths` is the
 * figure that decides re-asking:
 *
 *   * never acknowledged (null)        -> ASK. The office has not been shown the sentence.
 *   * same or LONGER than acknowledged -> do not ask. The exposure did not grow.
 *   * SHORTER than acknowledged        -> ASK AGAIN. The exposure changed.
 *
 * An unconditional line would appear on most saves — fourteen names have no floor and two families
 * do — and be learned-past within a week, which is the lesson the company-invitation line already
 * records: *a line shown on every invitation is noise a reader learns to skip.*
 * =================================================================================================== */

/**
 * The written reason's floor, and there is ONE of this number in the codebase.
 *
 * Measured rather than chosen: every DECLARATION-shaped reason in this api uses ten
 * (`COMBINED_DUTY_REASON_MIN_LENGTH`, the commission override's `reason`), while the
 * three-character minimums belong to notes rather than declarations. Writing `10` here a third time
 * would have satisfied the instruction's letter and broken its point, so both read
 * `DECLARATION_REASON_MIN_LENGTH` from `common/`.
 */
export const NO_FLOOR_REASON_MIN_LENGTH = DECLARATION_REASON_MIN_LENGTH;

/** The code the screen keys on to know it must show the sentence. */
export const NO_FLOOR_DECLARATION_REQUIRED = 'NO_FLOOR_DECLARATION_REQUIRED';

/** What the office sends back once it has read the sentence. */
export interface NoFloorDeclaration {
  /** The sentence AS RENDERED, carried from the client — see `noticeShown` below. */
  noticeShown: string;
  reason: string;
  acknowledged: boolean;
}

export interface NoFloorAskInput {
  recordCategory: string;
  requestedMonths: number;
  /** `null` means never acknowledged, which is not the same as acknowledged at zero. */
  acknowledgedMonths: number | null;
}

/**
 * Must the office be asked to declare, for this save?
 *
 * A PURE function taking the acknowledged figure rather than reading a row, so all three of the
 * decided behaviours are provable without a database — the floor's own three states had to be
 * proven that way for the same reason.
 */
export function noFloorDeclarationRequired({
  recordCategory,
  requestedMonths,
  acknowledgedMonths,
}: NoFloorAskInput): boolean {
  // A category that HAS a floor is already answered, in both directions: below it refuses with the
  // article, at or above it is accepted. A declaration there would be a third answer to a settled
  // question, and the sentence would be false — the system DOES know a minimum for that name.
  if (floorForCategory(recordCategory) !== null) return false;

  // Never asked. Not "acknowledged at zero": a row written before this existed, or one whose period
  // nobody has ever set through this gate, has not been shown the sentence. Comparing a request
  // against an invented baseline is how a control silently stops applying.
  if (acknowledgedMonths === null) return true;

  // The exposure only grows when the period SHORTENS.
  return requestedMonths < acknowledgedMonths;
}

/**
 * REFUSES the save until the declaration arrives — and the refusal is about the DECLARATION, never
 * about the period's value. The period is never rejected for being too short here; there is no known
 * minimum to reject it against, which is the whole fact being declared.
 *
 * Returns the declaration to store when one is required and well-formed, and `null` when none is
 * required — so a caller cannot write a declaration it was not asked for, and cannot forget one it
 * was.
 */
export function resolveNoFloorDeclaration(
  input: NoFloorAskInput,
  declaration: NoFloorDeclaration | undefined,
): NoFloorDeclaration | null {
  if (!noFloorDeclarationRequired(input)) return null;

  const notice = declaration?.noticeShown?.trim() ?? '';
  const reason = declaration?.reason?.trim() ?? '';

  if (!declaration || !declaration.acknowledged || !notice || !reason) {
    throw new UnprocessableEntityException({
      code: NO_FLOOR_DECLARATION_REQUIRED,
      message:
        `This system does not know a statutory minimum for a record category named ` +
        `"${input.recordCategory}". The period is accepted, and the office is asked to record why ` +
        `it chose it: read the notice shown on screen, write a reason of at least ` +
        `${NO_FLOOR_REASON_MIN_LENGTH} characters, and acknowledge that you have read it. ` +
        'Nothing here says the LAW sets no minimum for this category.',
      recordCategory: input.recordCategory,
      reasonMinLength: NO_FLOOR_REASON_MIN_LENGTH,
    });
  }

  if (reason.length < NO_FLOOR_REASON_MIN_LENGTH) {
    throw new UnprocessableEntityException({
      code: NO_FLOOR_DECLARATION_REQUIRED,
      message:
        `The reason for the retention period of "${input.recordCategory}" must be at least ` +
        `${NO_FLOOR_REASON_MIN_LENGTH} characters. A year from now the question is why this period ` +
        'was chosen, and a word does not answer it.',
      recordCategory: input.recordCategory,
      reasonMinLength: NO_FLOOR_REASON_MIN_LENGTH,
    });
  }

  // TRIMMED, because the stored sentence and reason are the record and leading whitespace is not
  // part of what anybody wrote or read.
  return { noticeShown: notice, reason, acknowledged: true };
}
