import type { Prisma } from '@ibms/db';

/**
 * Cross-Border Transfer (backlog Part D §5.1, Process #52). The schema's own
 * doc comment cites "Part 6.2" only — this backlog item does NOT map onto
 * any single named module in the M01-M12 PCMS list
 * (`meta/context/pcms-privacy-modules.md`): M05 is already "Data Collection
 * & Access Governance" (minimum-field templates, access provisioning/
 * review — see `pdpl-sla-timers.md`'s own M05 rows), a different system
 * entirely. Cited here by Part 6.2 alone rather than an invented M-number.
 * Blocks any transfer of personal data outside Jordan unless exactly
 * one of three recognized legal bases is recorded on the
 * `CrossBorderTransferRecord` row itself — `legalBasis` is a real DB column,
 * not a checklist a caller ticks separately, so "recorded" means "this
 * field is one of the three values," enforced by `@IsIn` at the DTO layer
 * against this file's own `CROSS_BORDER_LEGAL_BASES` (the single source of
 * truth for the 3-value set, matching the model's own doc comment).
 *
 * `cross-border-transfer.approve` is the ONLY pre-seeded permission for
 * this process (DPO-only) — there is no separate "request"/"log"
 * permission, so `create()` IS the approval: a DPO logging a transfer here
 * is the same act as approving it (the #74 KnowledgeBaseArticle
 * "creation IS publishing" shape, reused). `approvedByUserId` is therefore
 * always stamped to the caller's own id at create time — never left null,
 * never set by a separate action.
 *
 * The record is append-only: no update/delete endpoint exists, matching
 * `Interaction`'s "no edit/delete of a logged interaction" precedent — a
 * cross-border transfer log is a historical compliance fact, not an
 * editable draft. `transferredAt` is never caller-suppliable (always
 * `new Date()` at creation), the same anti-backdating discipline
 * `DataSubjectRequest.receivedAt` uses.
 */
export const CROSS_BORDER_LEGAL_BASES = [
  'statutory_exception',
  'standard_contractual_clauses',
  'explicit_consent',
] as const;
export type CrossBorderLegalBasis = (typeof CROSS_BORDER_LEGAL_BASES)[number];

export interface CrossBorderTransferRecordRow {
  id: string;
  description: string;
  destinationCountry: string;
  legalBasis: string;
  legalBasisEvidenceRef: string | null;
  approvedByUserId: string | null;
  transferredAt: Date;
}

export interface CrossBorderTransferRecordView {
  id: string;
  description: string;
  destinationCountry: string;
  legalBasis: string;
  legalBasisEvidenceRef: string | null;
  approvedByUserId: string | null;
  transferredAt: string;
}

export function deriveCrossBorderTransferView(
  row: CrossBorderTransferRecordRow,
): CrossBorderTransferRecordView {
  return {
    id: row.id,
    description: row.description,
    destinationCountry: row.destinationCountry,
    legalBasis: row.legalBasis,
    legalBasisEvidenceRef: row.legalBasisEvidenceRef,
    approvedByUserId: row.approvedByUserId,
    transferredAt: row.transferredAt.toISOString(),
  };
}

/** Staff-authored, operational free text describing what is being
 * transferred and why — the DSR precedent for what belongs in an audit
 * snapshot (contrasted with a data subject's own subjective words). */
export function crossBorderTransferAuditSnapshot(
  row: CrossBorderTransferRecordRow,
): Prisma.InputJsonObject {
  return {
    crossBorderTransferRecordId: row.id,
    description: row.description,
    destinationCountry: row.destinationCountry,
    legalBasis: row.legalBasis,
  };
}
