/**
 * THE ARCHIVED (BLOCKED) STATE — decision 29's phase two, and its four conditions.
 *
 * While the retention clock runs after a contract has ended, the records sit BLOCKED (الحجب). The
 * adviser's four conditions are what make that a legal block rather than a label:
 *
 *   1. LOCKED — the record enters no ongoing processing of any kind.
 *   2. Not visible to ordinary employees.
 *   3. Retrievable ONLY on a judicial request or an official CBJ audit — a recorded basis naming
 *      which of the two, and its own permission.
 *   4. ERASURE IS REFUSED IN THIS PHASE EVEN IF THE CUSTOMER ASKS, and the data-subject-request
 *      path gives that refusal WITH ITS ARTICLES — PDPL art 10/b and art 6/a — not a generic
 *      denial.
 *
 * ## THE STATE IS DERIVED, NOT STORED — and it is the state 7b's notice already reports
 *
 * A record is BLOCKED when its retention period has ELAPSED and it is neither HELD nor EXTENDED.
 * That is exactly what `RetentionNoticeRepository` already computes for the notice, so there is no
 * new column, no new table for the state itself, and no second answer to "is this record past its
 * period". The precedent is decision 71: a licence's standing is derived from its term and never
 * stored, because a stored copy is free to disagree with the dates it was derived from.
 *
 * **HELD AND EXTENDED RECORDS ARE NOT BLOCKED, and that is load-bearing.** A `where` clause that
 * excluded everything past the cutoff would silently stop processing records the office is
 * legally required to keep in ordinary retention — the failure direction that looks like the
 * control working. So the predicate is elapsed AND NOT held AND NOT extended, read through the one
 * place that computes it.
 *
 * ## WHAT CAN ENTER THIS STATE — AND THE CUSTOMER FILE CANNOT
 *
 * Only categories in `CATEGORY_RESOLUTIONS` have a computable clock, so only they can be blocked.
 * MEASURED, and it is the finding rather than a footnote: all four are FINANCIAL records under the
 * ten-year commercial floor, and **not one of them carries any personal identity** — no name, no
 * national id, no customer foreign key. They reach a person only transitively.
 *
 * **The categories that hold the customer's own personal data cannot enter this state at all**,
 * because art. 17/أ counts from "completing the transaction OR ending the relationship, whichever
 * is longer" and this system records no date for a relationship ending (register entry 88). So
 * `KYCRecord` and `Customer` have no clock, and therefore no blocked phase.
 *
 * That is stated on the screen rather than left to be discovered, per the brief's own instruction:
 * *"This state applies only to categories in the resolution table of (2). For the rest, say so
 * rather than implying a protection that is not running."*
 *
 * ## CONDITION 1 — WHAT "NO ONGOING PROCESSING" WAS MEASURED TO MEAN HERE
 *
 * Every read and write of the four models was enumerated and classified one at a time, the method
 * `docs/discard.md` § 3 established. The distinction that fell out is NOT register-versus-view; it
 * is **unbounded versus period-bounded**, and it came from reading each `where` clause:
 *
 * **THREE UNBOUNDED READS — a blocked record LEAVES these.** Each is an ongoing business or
 * compliance computation with no lower date bound, so an eleven-year-old record participates in
 * today's answer forever:
 *   - `TransactionMonitoringAlertRepository.findReceiptsForSweep()` — every `Receipt` ever, feeding
 *     today's AML pattern detection. The sharpest of the three: a scheduled sweep reading a record
 *     past both the five-year AML floor and the ten-year commercial one is literally ongoing
 *     processing, and the method's own comment already admits it is unpaginated.
 *   - `FinancialReportRepository.loadCommissionRollupEntries()` — the whole commission book, with
 *     no `createdAt` filter at all.
 *   - `InvoiceRepository.loadInsurerRemittances()` — upper-bounded by `asOfExclusiveUpper` and
 *     lower-bounded by nothing.
 *
 * **FOUR PERIOD-BOUNDED READS — a blocked record STAYS in these, and the limit is DECLARED.**
 * `KpiDashboardRepository.sumCommissionSince`, `SalesDashboardRepository.sumCommission`,
 * `EmployeePerformanceRepository.sumCommissionEarned` all carry `createdAt: { gte … }`, so a
 * blocked record can only appear in a report whose window explicitly reaches back into its own era.
 * Excluding it there would make a report covering 2015 under-state 2015 — a false figure about a
 * period the office is legally required to be able to evidence, which is the confidently-wrong-
 * number failure this repository has paid for three times. Whether such a report must instead
 * exclude them AND REPORT THE EXCLUDED COUNT is a collision between two obligations and is
 * reported, not decided here (register entry 91).
 *
 * **ONE ARITHMETIC GUARD MUST NOT CHANGE.** `InvoiceRepository`'s `priorReceipts` read is scoped to
 * a single invoice inside the receipt-recording transaction and is what stops an invoice being
 * over-collected. Excluding a blocked receipt from that sum would let the office collect the same
 * premium twice. It is not a view; it is a constraint.
 *
 * **AND EIGHT OF THE TEN WRITE SITES ALREADY REFUSE A BLOCKED RECORD STRUCTURALLY**, which is the
 * measurement that made this condition small. The four `create` sites cannot reach one by
 * definition. Three of the four commission `updateMany` calls re-assert `status: 'outstanding'`,
 * and a blocked entry has `paidAt` set — so its status is `paid` or `reversed` and the existing
 * `where` already turns the write away. `ClaimRepository.confirmSettlementPayment` re-asserts
 * `clientPaymentConfirmedAt: null`, which is exactly the column a blocked settlement has filled.
 * Only two are reachable and only two are refused:
 *   - reversing a paid commission entry (`CommissionRepository.recordReversal`);
 *   - second-approving a settlement whose client payment was confirmed
 *     (`ClaimRepository.recordSettlementSecondApproval`).
 * `retention-archive.inventory.spec.ts` asserts the eight, so "already refused" is proven rather
 * than claimed — a structural refusal somebody loosens later would otherwise go unnoticed.
 */

/**
 * The two bases on which a blocked record may be retrieved. A closed list, the `EXTENSION_BASES`
 * precedent: free text may ACCOMPANY a basis and may never BE one.
 */
export const ARCHIVE_RETRIEVAL_BASES = [
  'JUDICIAL_REQUEST',
  'CBJ_AUDIT',
] as const;

export type ArchiveRetrievalBasis = (typeof ARCHIVE_RETRIEVAL_BASES)[number];

export interface ArchiveRetrievalBasisDefinition {
  basis: ArchiveRetrievalBasis;
  /** What the basis means, in the words a reader is shown. */
  meaning: string;
}

export const ARCHIVE_RETRIEVAL_BASIS_DEFINITIONS: readonly ArchiveRetrievalBasisDefinition[] =
  [
    {
      basis: 'JUDICIAL_REQUEST',
      meaning:
        'A request from a court or a judicial authority. Record which authority asked, and for what.',
    },
    {
      basis: 'CBJ_AUDIT',
      meaning:
        'An official audit by the Central Bank of Jordan. Record the audit it belongs to.',
    },
  ];

export function isArchiveRetrievalBasis(
  value: string,
): value is ArchiveRetrievalBasis {
  return (ARCHIVE_RETRIEVAL_BASES as readonly string[]).includes(value);
}

/**
 * CONDITION 4 — THE ERASURE REFUSAL, WITH ITS ARTICLES.
 *
 * The articles are the owner's own, supplied in her brief for this item: *"the data-subject-request
 * path gives that refusal WITH ITS ARTICLES — PDPL art 10/b and art 6/a — not a generic denial."*
 * They are recorded as hers rather than paraphrased, because the standing rule on this work is
 * that no legal source arrives from an engineer: MEASURED, neither article is cited anywhere else
 * in this tree (the only PDPL article citations are art. 23(b), art. 5, art. 6(B) and art. 27).
 *
 * THE SENTENCE NAMES WHAT CANNOT BE ERASED AND WHY, and it does NOT claim the whole request fails:
 * a DELETION request still gets everything else done, through partially-fulfil, which is the path
 * the Legal Hold refusal beside it already uses. A refusal that reads as a flat denial is how an
 * officer concludes the right does not apply at all.
 */
export const ERASURE_BLOCKED_ARTICLES = 'PDPL art 10/b and art 6/a';

export function erasureRefusedWhileBlocked(input: {
  dsrId: string;
  blocked: readonly { recordCategory: string; count: number }[];
}): string {
  const where = input.blocked
    .map((b) => `${b.recordCategory} (${b.count})`)
    .join(', ');
  return (
    `Data Subject Request ${input.dsrId} cannot be marked fully fulfilled — records naming this data ` +
    `subject are in the blocked retention phase, where erasure is refused even at the data subject's ` +
    `request: ${where}. ${ERASURE_BLOCKED_ARTICLES}. These records are kept, and not processed, ` +
    `until their statutory retention period ends; they are retrievable only on a judicial request or ` +
    `an official CBJ audit. Use partially-fulfil to record what was erased and that these were not.`
  );
}

/**
 * WHAT A READ NEEDS IN ORDER TO LEAVE THE BLOCKED RECORDS OUT.
 *
 * `null` means nothing in this category can be blocked, so the read is unfiltered. Three ways to
 * get there, and the third is the one worth knowing: the category is not resolvable, or the office
 * set no period, or **an active legal hold covers the category** — `LegalHoldRepository.hasActiveHold`
 * answers per SCHEDULE ITEM, not per record, so a hold suspends the whole category's blocked phase.
 */
export interface BlockedExclusion {
  /** A record whose trigger date is at or before this has elapsed. */
  cutoff: Date;
  /**
   * Elapsed but NOT blocked, because an extension still covers them.
   *
   * MUTABLE `string[]`, not `readonly` — Prisma's `in` filter is typed `string[]` and refuses a
   * readonly array, which is how the first version of this failed to compile. Spreading a copy at
   * the call site would compile too and would put a defensive copy in a hot read for no gain.
   */
  extendedRecordIds: string[];
}

/**
 * The `where` fragment that keeps everything except the blocked records.
 *
 * ## IT IS WRITTEN AS A NEGATION, AND THAT IS WHAT MAKES IT CORRECT FOR ALL FOUR MODELS
 *
 * blocked = ELAPSED and NOT EXTENDED (a HELD category returns a `null` exclusion, so the whole
 * category is spared one level up). So the complement is `NOT (elapsed AND not-extended)`, which is
 * what this builds.
 *
 * The obvious spelling went the other way — keep what is NEWER than the cutoff, `{ [trigger]: { gt:
 * cutoff } }` — and it was wrong twice over:
 *
 *   - **It drops rows whose trigger is NULL.** In SQL and in Prisma, `gt` excludes NULL, and a NULL
 *     trigger is the ordinary state of a transaction that has not closed: an unremitted premium, an
 *     UNPAID commission entry. That spelling would have dropped every unpaid commission from the
 *     financial report and understated what the office is owed, with nothing failing — the
 *     confidently-wrong-figure class this repository has paid for three times.
 *   - **And patching it with an `OR { [trigger]: null }` branch does not compile for all four**,
 *     because MEASURED: `Receipt.receivedAt` is NOT NULL while `remittedAt`, `paidAt` and
 *     `clientPaymentConfirmedAt` are nullable. Prisma refuses `null` as a filter on a non-nullable
 *     column, so that shape needed two functions and a per-model fact to choose between them.
 *
 * `lte` has neither problem: `NULL <= x` is NULL, so a row whose clock never started is simply NOT
 * ELAPSED — which is the same reading `RetentionNoticeRepository.idsElapsedBefore` uses for its
 * count. The two now agree BY CONSTRUCTION rather than because both were reasoned about correctly.
 */
export function notBlockedWhere<K extends string>(
  trigger: K,
  exclusion: BlockedExclusion | null,
): {
  NOT:
    | { AND: (Record<K, { lte: Date }> | { id: { notIn: string[] } })[] }
    | undefined;
} {
  if (exclusion === null) {
    // `NOT: undefined` rather than `{}`, and this is not a style choice: a UNION return type
    // (`{} | { NOT: … }`) degrades Prisma's own inference on the `findMany` it is spread into, and
    // the row type silently loses its included relations — which is how the first version produced
    // "Property 'policy' does not exist" forty lines below the spread. One object shape keeps the
    // call site's types intact, and Prisma reads an undefined filter as no filter.
    return { NOT: undefined };
  }
  // `NOT: { AND: [a, b] }`, AND NOT `NOT: [a, b]` — MEASURED, by an e2e that caught the difference.
  //
  // Prisma reads a LIST under `NOT` as "negate each", i.e. `NOT a AND NOT b`. With an extension
  // in play that becomes `NOT elapsed AND id IN extended`, the INTERSECTION of two disjoint sets:
  // the roll-up went to ZERO rows. The first version carried a comment asserting the opposite —
  // that a list is AND-ed inside the negation — and the comment was simply wrong.
  //
  // The single-clause case was correct either way, which is exactly why the extension branch
  // needed its own assertion rather than being assumed to follow from the blocked one.
  //
  // The extension clause is OMITTED when there are no extensions rather than relying on Prisma's
  // empty-array semantics for `notIn`: a filter whose meaning depends on how a client special-cases
  // an empty list is a filter nobody can re-derive from the code.
  const elapsed = { [trigger]: { lte: exclusion.cutoff } } as Record<
    K,
    { lte: Date }
  >;
  return {
    NOT: {
      AND:
        exclusion.extendedRecordIds.length === 0
          ? [elapsed]
          : [elapsed, { id: { notIn: exclusion.extendedRecordIds } }],
    },
  };
}
