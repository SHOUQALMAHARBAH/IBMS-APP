/**
 * MODULE 0-ب — THE SHIPPED RETENTION TEMPLATE. Decisions 32 and 33.
 *
 * THE SEED'S COPY of `apps/api/src/modules/pdpl/retention-template.config.ts`, and the duplication
 * is deliberate rather than an oversight: `packages/db` cannot import from `apps/api` (the seed is
 * typechecked by its own `tsconfig.seed.json` and the docker prune keeps only db's own workspace
 * dependencies — a cross-import typechecks on a laptop and fails inside the image, which this
 * repository has already paid for once).
 *
 * SO THE TWO ARE PINNED AGAINST EACH OTHER. `retention-template.config.spec.ts` asserts this file's
 * category names and periods equal the api's, by reading this file's own exported array — one fact,
 * two homes, and a test that fails the moment they disagree. That is the `NOTIFICATION_KINDS`
 * precedent: a list declared twice in two packages with nothing checking they agree is how a kind
 * added in one renders blank in the other.
 *
 * ## WHAT SHIPS, AND WHY THE PERIODS LOOK INCONSISTENT
 *
 * They are not inconsistent; they are one rule. A category governed by one of the two statutory
 * floors ships with NO PERIOD, because **a period shipped beside an article number reads as a legal
 * opinion from us and we do not have one.** A category with no floor ships with a DEFAULT, because
 * there a number claims nothing. We supply a number exactly where supplying one asserts nothing.
 *
 * ## A ROW WITH NO PERIOD IS INERT, NOT BROKEN
 *
 * Never measured, never alerted on, never proposed for disposal — `periodIsActionable` in the api,
 * read by the notice AND the disposal nomination. The office sets its period above the floor on its
 * own legal advice, a lawyer confirms it, and the row comes alive. Until then the screen shows the
 * ARTICLE and the FLOOR where the number would be.
 *
 * ## THIS FILE ADDS NO FLOOR
 *
 * Every floored row below is a name one of the two DECIDED floors already governs, in
 * `retention-floors.config.ts`'s own category list. The fourteen unsourced names from batch 5
 * group 5 are a question for the owner's lawyer, and a floor added on an engineer's reading is this
 * product telling a broker the law says something it does not.
 *
 * ## AND IT IS NOT A LOCK
 *
 * Decision 80: the office grants, edits and revokes freely. Nothing refuses a category this file
 * does not name, and nothing stops an office deleting one it does.
 */
export interface RetentionTemplateSeed {
  recordCategory: string;
  /** NULL where a statutory floor governs the category — see the header. */
  retentionPeriodMonths: number | null;
  legalBasis: string;
}

export const RETENTION_TEMPLATE_SEED: RetentionTemplateSeed[] = [
  {
    recordCategory: "KYCRecord",
    retentionPeriodMonths: null,
    legalBasis:
      "A STATUTORY FLOOR GOVERNS THIS CATEGORY, so no period ships: Anti-Money Laundering and Counter-Terrorism Financing Law No. 20 of 2021, art. 17/a (المادة ١٧/أ) — customer due-diligence records and account files must be kept for at least five years, counted from completing the transaction OR ending the relationship, whichever is longer. The office sets its own period at or above sixty months on its own legal advice; the system refuses anything shorter. CITATION PROVISIONAL pending verification against the Official Gazette (No. 5743, 16 September 2021). NOTE: this category can never raise an elapsed notice — this system records no date for a relationship ending, so the longer-of-two trigger cannot be computed, and approximating it would start a five-year clock from the wrong day.",
  },
  {
    recordCategory: "CustomerFile",
    retentionPeriodMonths: null,
    legalBasis:
      "A STATUTORY FLOOR GOVERNS THIS CATEGORY, so no period ships: AML/CTF Law No. 20 of 2021, art. 17/a (المادة ١٧/أ) — the 'account files' limb of the same article, at least five years from the end of the relationship or the transaction, whichever is longer. The office sets its own period at or above sixty months. Same limit as KYCRecord: no date marks a relationship ending, so no notice is possible.",
  },
  {
    recordCategory: "Receipt",
    retentionPeriodMonths: null,
    legalBasis:
      "A STATUTORY FLOOR GOVERNS THIS CATEGORY, so no period ships: Commercial Law No. 12 of 1966, art. 19 (المادة ١٩) — financial and commercial records must be kept for ten years, counted from the closing of the transaction, which the owner has defined for this system as the closing date of the financial transaction. The office sets its own period at or above 120 months. This category IS watchable: the clock runs from the date the client payment was received.",
  },
  {
    recordCategory: "Remittance",
    retentionPeriodMonths: null,
    legalBasis:
      "A STATUTORY FLOOR GOVERNS THIS CATEGORY, so no period ships: Commercial Law No. 12 of 1966, art. 19 (المادة ١٩), ten years from the closing of the transaction. Watchable: the clock runs from the date the premium was remitted to the insurer. An unremitted premium has not closed its transaction and is never counted.",
  },
  {
    recordCategory: "CommissionLedgerEntry",
    retentionPeriodMonths: null,
    legalBasis:
      "A STATUTORY FLOOR GOVERNS THIS CATEGORY, so no period ships: Commercial Law No. 12 of 1966, art. 19 (المادة ١٩), ten years from the closing of the transaction. Watchable: the clock runs from the date the commission was paid. An unpaid commission has not closed and is never counted.",
  },
  {
    recordCategory: "Settlement",
    retentionPeriodMonths: null,
    legalBasis:
      "A STATUTORY FLOOR GOVERNS THIS CATEGORY, so no period ships: Commercial Law No. 12 of 1966, art. 19 (المادة ١٩), ten years from the closing of the transaction. Watchable: the clock runs from the date the client settlement payment was confirmed.",
  },
  {
    recordCategory: "Invoice",
    retentionPeriodMonths: null,
    legalBasis:
      "A STATUTORY FLOOR GOVERNS THIS CATEGORY, so no period ships: Commercial Law No. 12 of 1966, art. 19 (المادة ١٩), ten years from the closing of the transaction. NOTE: this category can never raise an elapsed notice. An invoice carries a due date and a creation date, and a DUE DATE IS NOT A CLOSING — an unpaid invoice has not closed, so counting from it would start the clock on a transaction still running. An invoice is closed by its Receipt, which is its own category and is watched.",
  },
  {
    recordCategory: "Quotation",
    retentionPeriodMonths: 1,
    legalBasis:
      "NO STATUTORY FLOOR IS DECIDED FOR THIS CATEGORY, so this one month is the office's own default rather than a minimum — set it shorter or longer freely. A quote requested and never bought. COUNTED FROM THE END OF THE PURPOSE, NOT FROM ARRIVAL: the clock runs from the date the client REFUSED, because a month counted from arrival would delete a quote the customer is still considering. A quote the client accepted, or has not answered, has no trigger and is never counted. The quote's own expiry is the other limb of that trigger and is NOT recorded anywhere in this system — Quotation carries no validity date — so it is not approximated.",
  },
  {
    recordCategory: "AuditLogEntry",
    retentionPeriodMonths: 120,
    legalBasis:
      "DRAFT, UNCONFIRMED — no specific figure is cited anywhere in ibms-brain/meta for AuditLogEntry, and no decided floor governs this category. 120 months (10 years) is the longer-side candidate against typical CBJ/insurance-broker record-keeping practice, not a figure any article supports; PDPL No. 24/2023 sets no fixed figure for this record type. It needs a cited figure from Legal/Compliance/DPO before confirmedByLegalCounselAt can be set, and until it is set this row is INERT: nothing is measured against it and no records are proposed. PRE-EXISTING row, kept with its own history — this is the one row the schedule held before the template shipped.",
  },
];
