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
 */
export interface RetentionScheduleSeed {
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string;
}

export const RETENTION_SCHEDULE: RetentionScheduleSeed[] = [
  {
    recordCategory: 'AuditLogEntry',
    retentionPeriodMonths: 120,
    legalBasis:
      'DRAFT, UNCONFIRMED — no specific figure is cited anywhere in ibms-brain/meta for AuditLogEntry. Seeded as the longer-side candidate between commonly-cited AML minimums (~5 years; cf. FATF Recommendation 11 / Jordan AML/CFT Law No. 46/2007 as amended) and typical CBJ/insurance-broker record-keeping practice (~10 years) in comparable regimes; PDPL No. 24/2023 sets no fixed figure for this record type. Needs a cited figure from Legal/Compliance/DPO before confirmedByLegalCounselAt can be set.',
  },
];
