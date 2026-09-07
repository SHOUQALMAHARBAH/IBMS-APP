import type { Prisma } from '@ibms/db';

/** The exact 7 touchpoints from the model's own doc comment — the same 7
 * named in the backlog's Consent checklist item, though these are an
 * independent string set (a notice's `touchpoint` is not a `ConsentRecord.
 * purpose` value) since the two dimensions classify different things. */
export const PRIVACY_NOTICE_TOUCHPOINTS = [
  'lead_capture',
  'onboarding_kyc',
  'needs_risk_assessment',
  'rfq_market_placement',
  'claims',
  'group_medical_life_motor_fleet',
  'renewal_cross_sell',
] as const;
export type PrivacyNoticeTouchpoint =
  (typeof PRIVACY_NOTICE_TOUCHPOINTS)[number];

/**
 * Notices (backlog Part D §5.1, Process #52; Part 6.2 — the same section
 * `CrossBorderTransferRecord`'s own schema doc comment cites; this backlog
 * item likewise names no single M01-M12 PCMS module, so it is cited by
 * section number alone rather than an invented M-number — see
 * `cross-border-transfer.config.ts`'s header comment). "Bilingual,
 * version-controlled text displayed at every touchpoint." Unlike
 * `KnowledgeBaseArticle` (#74, bilingual OPTIONAL-per-article), `textAr`/
 * `textEn` are BOTH mandatory (`NOT NULL` in the schema) — the
 * `DocumentTemplate` mandatory-both shape, since a legally-reviewable
 * notice needs both languages published together, not one at a time.
 *
 * **Creation IS publishing** (the #74 shape again) — `privacy-notice.publish`
 * (DPO + Compliance) is the only pre-seeded permission and gates the whole
 * surface; `publishedAt` defaults to `now()` with no draft state.
 *
 * **Version-controlled means append-only, never edited** — publishing a new
 * version of a touchpoint's notice is a NEW row with `versionNumber` one
 * higher than the previous highest for that touchpoint, the `Quotation`
 * negotiation-round shape (immutable history), not a `Document`-style
 * `previousVersionId` chain (this model has no such column — a simpler
 * shape is faithful to what the schema actually provides). "The current
 * notice for a touchpoint" is simply the row with the highest
 * `versionNumber` for it. No update/delete endpoint exists on the text
 * itself; the ONLY mutation this module allows is stamping
 * `legallyReviewedAt` after the fact (legal review can lag drafting by a
 * few days in practice).
 */
export interface PrivacyNoticeRow {
  id: string;
  touchpoint: string;
  versionNumber: number;
  textAr: string;
  textEn: string;
  legallyReviewedAt: Date | null;
  publishedAt: Date;
}

export interface PrivacyNoticeView {
  id: string;
  touchpoint: string;
  versionNumber: number;
  textAr: string;
  textEn: string;
  legallyReviewedAt: string | null;
  publishedAt: string;
}

export function derivePrivacyNoticeView(
  row: PrivacyNoticeRow,
): PrivacyNoticeView {
  return {
    id: row.id,
    touchpoint: row.touchpoint,
    versionNumber: row.versionNumber,
    textAr: row.textAr,
    textEn: row.textEn,
    legallyReviewedAt: row.legallyReviewedAt
      ? row.legallyReviewedAt.toISOString()
      : null,
    publishedAt: row.publishedAt.toISOString(),
  };
}

/** Notice TEXT is deliberately excluded — the audit trail records that a
 * version was published and by whom, not a copy of the (potentially long,
 * legally-drafted) bilingual body; the row itself is the canonical text. */
export function privacyNoticeAuditSnapshot(
  row: PrivacyNoticeRow,
): Prisma.InputJsonObject {
  return {
    privacyNoticeId: row.id,
    touchpoint: row.touchpoint,
    versionNumber: row.versionNumber,
  };
}
