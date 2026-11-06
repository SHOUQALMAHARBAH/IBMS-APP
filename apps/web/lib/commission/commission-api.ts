// Process 35 — Commission Calculation (backlog Part C #35, Domain D). Reads
// apps/api's /commission endpoints: the governed CommissionAgreement rate table
// (by insurer + line) and the CommissionLedgerEntry ledger — apply the governed
// rate (commission.calculate), raise a manual override with a mandatory reason
// (commission-override.raise), and the separate approval
// (commission-override.approve).

import { apiGet, apiPost } from '../auth/api-client';
import type { CombinedDutyActOnRecord } from '../../components/ui/CombinedDutyOnRecord';

export interface CommissionAgreement {
  id: string;
  insurerId: string;
  insurerName: string;
  insuranceLine: string;
  ratePercent: string;
  vatRatePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isOpen: boolean;
}

/**
 * `CommissionLedgerEntry.status` — a HAND-WRITTEN COPY of the api's
 * `COMMISSION_ENTRY_STATUSES` (`apps/api/src/modules/commission/commission.config.ts`), because the
 * web has no import path into an api module. Added 2026-11-06 (module 0-c batch 6).
 *
 * It was `status: string`, and that bare type is the whole reason row 72 could happen: the screen's
 * label map was `Record<string, TranslationKey>` over FOUR keys, of which `calculated` and
 * `approved` ARE NOT MEMBERS AT ALL (they cannot occur), while `reversed` — which can — was absent
 * and fell through to a `commissionStatusDraft` default. So of the three statuses that really
 * exist, TWO rendered as «مسوَّدة» / "Draft": a posted-not-collected entry, and a fully clawed-back
 * one. A reversed commission reading "Draft" is the dangerous half.
 *
 * Declared in the same `as const` array shape as the api's so that
 * `packages/db/prisma/commission-status-parity.spec.ts` can read BOTH files with one pattern — a
 * fourth status added in the api alone is otherwise invisible here: the lookup would return
 * `undefined`, `t(undefined)` renders nothing, and the status cell would silently go blank.
 */
export const COMMISSION_ENTRY_STATUSES = [
  'outstanding',
  'paid',
  'reversed',
] as const;
export type CommissionEntryStatus = (typeof COMMISSION_ENTRY_STATUSES)[number];

export interface CommissionEntry {
  id: string;
  policyId: string;
  commissionAgreementId: string | null;
  amount: string;
  vatRatePercent: string;
  vatAmount: string;
  grossAmount: string;
  overrideAmount: string | null;
  effectiveAmount: string;
  status: CommissionEntryStatus;
  isManualOverride: boolean;
  overrideReason: string | null;
  overrideRequestedByUserId: string | null;
  overrideApprovedByUserId: string | null;
  /**
   * Set when ONE person both requested and approved this override, in an office that declared COMBINED
   * duty segregation and stated why. Null on every ordinary override.
   *
   * This screen already renders the override reason and the REQUESTER, and prints '(approved)' — so
   * without this field a self-approved override reads as a two-person one to anybody who does not know
   * the approver is missing. Showing half of a two-person control is worse than showing none of it.
   */
  combinedDutyAct: CombinedDutyActOnRecord | null;
  overridePending: boolean;
  paidAmount: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  reversedAmount: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
}

export interface Insurer {
  id: string;
  name: string;
}

export function listCommissionAgreements(
  opts: { insurerId?: string; insuranceLine?: string } = {},
): Promise<CommissionAgreement[]> {
  const params = new URLSearchParams();
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.insuranceLine) params.set('insuranceLine', opts.insuranceLine);
  const qs = params.toString();
  return apiGet(`/commission/agreements${qs ? `?${qs}` : ''}`);
}

export function listCommissionInsurers(): Promise<Insurer[]> {
  return apiGet('/commission/insurers');
}

export function createCommissionAgreement(body: {
  insurerId: string;
  insuranceLine: string;
  ratePercent: string;
  vatRatePercent?: string;
  effectiveFrom?: string;
}): Promise<CommissionAgreement> {
  return apiPost('/commission/agreements', body);
}

export function listCommissionEntriesForPolicy(
  policyId: string,
): Promise<CommissionEntry[]> {
  return apiGet(`/commission/entries?policyId=${encodeURIComponent(policyId)}`);
}

export function calculateCommission(policyId: string): Promise<CommissionEntry> {
  return apiPost('/commission/entries', { policyId });
}

export function raiseCommissionOverride(
  entryId: string,
  body: { overrideAmount: string; reason: string },
): Promise<CommissionEntry> {
  return apiPost(`/commission/entries/${entryId}/override`, body);
}

export function approveCommissionOverride(

  entryId: string,
  /**
   * Part 4 — sent only when the approver IS the maker and the office has declared COMBINED mode. Omitted on
   * every ordinary two-person approval, which sends the same body it always did.
   */
  combinedDutyReason?: string,
): Promise<CommissionEntry> {
  return apiPost(`/commission/entries/${entryId}/override/approve`, combinedDutyReason ? { combinedDutyReason } : {});
}

/** Process 36 — reconcile the entry against an insurer statement and mark it
 * paid (`commission.reconcile` / Finance). */
export function settleCommission(
  entryId: string,
  body: { statementAmount: string; paymentReference: string },
): Promise<CommissionEntry> {
  return apiPost(`/commission/entries/${entryId}/settle`, body);
}
