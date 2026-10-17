/**
 * Part 6.2 (M06) — one row per record category in RetentionScheduleItem.
 *
 * IMPORTANT: `AuditLogEntry`'s entry below is a DRAFT, NOT a confirmed legal
 * figure. No file in ibms-brain/meta cites a specific CBJ, AML, or PDPL
 * record-retention period for AuditLogEntry — the A.4 backlog item only
 * states the *principle* ("the longer of CBJ, AML, and PDPL requirements").
 * 120 months (10 years) is seeded as the conservative longer-side candidate
 * pending an actual citation from Legal/Compliance/DPO — see the brain-gap
 * filed alongside this change. Do not treat this number as authoritative in
 * a PR or compliance conversation; `confirmedByLegalCounselAt` stays `null`
 * until someone with the authority to confirm it does so.
 *
 * ## 2026-10-13 — the AML citation was to a REPEALED law, and the five-year rule is NOT BUILT
 *
 * The row below used to cite "Jordan AML/CFT Law No. 46/2007 as amended". That law was
 * repealed by art. 44 of Anti-Money Laundering and Counter-Terrorism Financing Law No. 20
 * of 2021. The citation is corrected in place and marked provisional.
 *
 * TWO THINGS THAT CITATION IMPROVES, both moving from a decision to a statute: whether a
 * broker is a subject entity at all (art. 14/a/1 item 4 names insurance brokers, where CBJ
 * AML Instructions No. 2 of 2016 never use the word), and the retention floor itself
 * (art. 17/a).
 *
 * AND ONE THING IT DOES NOT CHANGE, stated because it would otherwise be assumed: art.
 * 17/a's five-years-from-the-later-of-two-triggers rule IS NOT IMPLEMENTED ANYWHERE. This
 * table holds exactly ONE row — the draft below — measured on dev. There is no AML
 * retention rule for customer due-diligence records, account files or transactions, so
 * there was nothing to re-cite. The rule needs building; correcting a citation is not
 * building it.
 */
export interface RetentionScheduleSeed {
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string;
}

export const RETENTION_SCHEDULE: RetentionScheduleSeed[] = [
  {
    recordCategory: "AuditLogEntry",
    retentionPeriodMonths: 120,
    legalBasis:
      "DRAFT, UNCONFIRMED — no specific figure is cited anywhere in ibms-brain/meta for AuditLogEntry. The AML floor now has a STATUTE rather than a comparison: Anti-Money Laundering and Counter-Terrorism Financing Law No. 20 of 2021 (Official Gazette No. 5743, 16 September 2021), art. 17/a — not less than five years from completing the transaction, and due-diligence records and account files at least five years from the end of the relationship or the transaction, whichever is longer. That law also settles that a broker is a subject entity: art. 14/a/1 item 4 names 'licensed insurance companies in the Kingdom and insurance agents and brokers'. CITATIONS PROVISIONAL pending verification against the Official Gazette. This REPLACES a citation of Law No. 46 of 2007, which art. 44 of Law No. 20 of 2021 repealed. 120 months (10 years) is still the seeded figure and still a GUESS — it is the longer-side candidate against typical CBJ/insurance-broker record-keeping practice, not a figure art. 17/a supports; PDPL No. 24/2023 sets no fixed figure for this record type. Needs a cited figure from Legal/Compliance/DPO before confirmedByLegalCounselAt can be set.",
  },
];
