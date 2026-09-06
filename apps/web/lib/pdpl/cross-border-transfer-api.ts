// Cross-Border Transfer (backlog Part D §5.1, Process #52; Part 6.2 — no
// single M01-M12 PCMS module name applies to this checklist item).
// cross-border-transfer.approve (DPO) gates the whole surface — creating a
// record IS approving it.

import { apiGet, apiPost } from '../auth/api-client';

export const CROSS_BORDER_LEGAL_BASES = [
  'statutory_exception',
  'standard_contractual_clauses',
  'explicit_consent',
] as const;

export interface CrossBorderTransferRecord {
  id: string;
  description: string;
  destinationCountry: string;
  legalBasis: string;
  legalBasisEvidenceRef: string | null;
  approvedByUserId: string | null;
  transferredAt: string;
}

export function listCrossBorderTransfers(): Promise<CrossBorderTransferRecord[]> {
  return apiGet('/cross-border-transfers');
}

export function createCrossBorderTransfer(body: {
  description: string;
  destinationCountry: string;
  legalBasis: string;
  legalBasisEvidenceRef?: string;
}): Promise<CrossBorderTransferRecord> {
  return apiPost('/cross-border-transfers', body);
}
