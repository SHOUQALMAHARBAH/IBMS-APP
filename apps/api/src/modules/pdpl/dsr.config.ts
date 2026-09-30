import { DsrType } from '@ibms/db';
import type { CombinedDutyAct } from '@ibms/db';
import {
  combinedDutyActView,
  type CombinedDutyActView,
} from '../../common/duty-segregation.view';
import type { DsrStatus, Prisma } from '@ibms/db';
import {
  applyDuration,
  type SlaDuration,
} from '../../common/business-days.util';

export const DSR_TYPES = Object.values(DsrType);

/**
 * M04 — Data Subject Request Management (backlog Part D, bundled under
 * Process #52 "Data Protection Compliance"). The pure, deterministic core:
 * SLA-workflow selection, the extension re-basing math, and the view /
 * audit-snapshot builders.
 *
 * `DataSubjectRequest` (Part 4.1 core entity / Part 6.2) pre-existed with
 * every field the Access/Correction/Deletion/Objection workflow needs except
 * the maker/checker closure pair — see the migration
 * (`20260905120000_add_dsr_widening`) for the two columns it adds.
 * `WORKFLOW_TRANSITIONS.DataSubjectRequest` (RECEIVED -> IDENTITY_VERIFIED ->
 * IN_PROGRESS -> {FULFILLED, PARTIALLY_FULFILLED, REJECTED} -> CLOSED, with
 * REJECTED also reachable from RECEIVED/IDENTITY_VERIFIED) and
 * `SLA_REGISTRY`'s two DSR entries (`dsr_access_deletion` 15 business days,
 * `dsr_correction_objection` 10 business days, both with the DPO-then-
 * General-Manager two-stage escalation) also pre-existed — this module is
 * their first real consumer.
 *
 * Governing documents (`pcms-privacy-modules.md`'s table): `PRIV-STD-01`
 * §6.4, `PRIV-SOP-05`, `PRIV-FRM-01/02/03`.
 *
 * `ibms-brain/meta/context/data-subject-requests.md`.
 */

/** ACCESS/DELETION get the 15-business-day SLA (with the Access-only
 * extension); CORRECTION/OBJECTION get 10 — the model's own doc comment,
 * cross-checked against `pdpl-sla-timers.md`'s two DSR rows. */
export function dsrSlaWorkflowFor(type: DsrType): string {
  return type === 'ACCESS' || type === 'DELETION'
    ? 'dsr_access_deletion'
    : 'dsr_correction_objection';
}

/** The one +15-business-day extension is ACCESS-only (`pdpl-sla-timers.md`
 * row "DSR — Access / Deletion (M04)": "one +15 extension, Access only,
 * reason logged"). A DELETION request's own retention-flag mechanism
 * (`partiallyFulfil`) is the tool for "we cannot finish on time because
 * data must be retained" — the model comment does not offer DELETION an
 * extension too, only ACCESS. */
export function canApplyDsrExtension(type: DsrType): boolean {
  return type === 'ACCESS';
}

const DSR_EXTENSION_DURATION: SlaDuration = {
  value: 15,
  unit: 'businessDays',
};

/** Re-bases the SLA deadline forward by the one allowed extension — additive
 * to the EXISTING `slaDueAt`, not restarted from `now()`: the point of an
 * extension is to push the same deadline further out, not open a fresh
 * 15-day window from whenever staff happen to invoke it. */
export function applyDsrExtension(currentSlaDueAt: Date): Date {
  return applyDuration(currentSlaDueAt, DSR_EXTENSION_DURATION);
}

/** `receivedAt` is never caller-suppliable (unlike the #10/#12/#44/#45
 * `parseHistoricalInstant`-backdatable convention) — it is always
 * `new Date()` at the moment `create()` runs, whichever channel (phone,
 * email, in-person, portal) funnelled the request there. This guarantees
 * only that staff cannot BACKDATE a late log to disguise it as a prompt
 * one — it does not, by itself, guarantee the backlog's actual "logged the
 * same business day" intent, since nothing stops staff from receiving a
 * DSR by phone on Monday and not calling `POST /dsr` until Friday
 * (`receivedAt` then honestly, if unhelpfully, shows Friday). Closing that
 * residual gap would need an operational control (a logging-SLA of its
 * own) outside this code, not a field. */
export const DSR_RECEIVED_AT_IS_ALWAYS_NOW = true;

export const DSR_TERMINAL_STATUSES: readonly DsrStatus[] = ['CLOSED'];
export const DSR_PROCESSED_STATUSES: readonly DsrStatus[] = [
  'FULFILLED',
  'PARTIALLY_FULFILLED',
  'REJECTED',
];

export function isDsrClosed(status: DsrStatus): boolean {
  return (DSR_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isDsrProcessed(status: DsrStatus): boolean {
  return (DSR_PROCESSED_STATUSES as readonly string[]).includes(status);
}

export interface DataSubjectRequestRow {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  type: DsrType;
  status: DsrStatus;
  receivedAt: Date;
  identityVerifiedAt: Date | null;
  slaDueAt: Date;
  accessExtensionAppliedAt: Date | null;
  extensionReason: string | null;
  retentionScheduleReference: string | null;
  partialFulfilmentJustification: string | null;
  closedAt: Date | null;
  dpoHandlerUserId: string | null;
  processedByUserId: string | null;
  closedByUserId: string | null;
  /** The relation is `closureCombinedDutyAct` — each pair's escape column is named after the
   *  CONSTRAINT it excuses, not the table, because `NeedsAssessment` has two pairs and one shared
   *  column would let a declared combined REVIEW excuse a self-APPROVAL. */
  closureCombinedDutyAct: CombinedDutyAct | null;
  rejectionReason: string | null;
  noOpenRetentionHoldConfirmedAt: Date | null;
  createdAt: Date;
}

export interface DataSubjectRequestView {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  type: string;
  status: string;
  receivedAt: string;
  identityVerifiedAt: string | null;
  slaDueAt: string;
  accessExtensionAppliedAt: string | null;
  extensionReason: string | null;
  retentionScheduleReference: string | null;
  partialFulfilmentJustification: string | null;
  closedAt: string | null;
  dpoHandlerUserId: string | null;
  processedByUserId: string | null;
  closedByUserId: string | null;
  /**
   * Set when ONE person both logged and closed this request, in an office that declared COMBINED duty
   * segregation and stated why. Null on every ordinary closure.
   *
   * `DataSubjectRequest_maker_checker_distinct` normally forbids it. Here rather than only in the
   * report at `/internal-controls` because a statutory request closed by its own logger is exactly
   * what an auditor asks about, and `closedByUserId` alone cannot say it — Part 4 step 5.
   */
  combinedDutyAct: CombinedDutyActView | null;
  rejectionReason: string | null;
  noOpenRetentionHoldConfirmedAt: string | null;

  /* THE REQUEST'S OWN CLOCK STATE. A request carries SEVERAL `SlaTimer` rows — two
   * escalation stages, and a second pair once an extension re-bases the deadline — so
   * these are COUNTS rather than a boolean: "two of four paused" is a real state an
   * extension can produce, and a boolean would round it to "paused" or "running" and be
   * wrong about the rest. Present so the pause control on the request screen offers the
   * right action without a second request (IMPROVEMENTS § 1.61).
   *
   * OPTIONAL, and only on the DETAIL read. A list of requests has no use for it and
   * populating it there would be one timer query per row — an N+1 for a figure nobody
   * reads on a list. A caller that does not find it must treat the clock as unknown
   * rather than as running. */
  slaClock?: {
    open: number;
    paused: number;
    pauseReason: string | null;
    pausedAt: string | null;
  };
  /** Derived — `status` is not yet CLOSED/terminal and `slaDueAt` has
   * passed. The `Policy.issuanceComplete` / `ServiceRequest.sla.breached`
   * shape: a live-computed convenience so the UI shows "overdue" without
   * waiting for the nightly `SlaTimerScheduler` sweep to escalate. */
  isOverdue: boolean;
  createdAt: string;
}

export function deriveDsrView(
  row: DataSubjectRequestRow,
  now: Date,
): DataSubjectRequestView {
  return {
    id: row.id,
    customerId: row.customerId,
    insuredPersonId: row.insuredPersonId,
    type: row.type,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    identityVerifiedAt: row.identityVerifiedAt
      ? row.identityVerifiedAt.toISOString()
      : null,
    slaDueAt: row.slaDueAt.toISOString(),
    accessExtensionAppliedAt: row.accessExtensionAppliedAt
      ? row.accessExtensionAppliedAt.toISOString()
      : null,
    extensionReason: row.extensionReason,
    retentionScheduleReference: row.retentionScheduleReference,
    partialFulfilmentJustification: row.partialFulfilmentJustification,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    dpoHandlerUserId: row.dpoHandlerUserId,
    processedByUserId: row.processedByUserId,
    closedByUserId: row.closedByUserId,
    combinedDutyAct: combinedDutyActView(row.closureCombinedDutyAct),
    rejectionReason: row.rejectionReason,
    noOpenRetentionHoldConfirmedAt: row.noOpenRetentionHoldConfirmedAt
      ? row.noOpenRetentionHoldConfirmedAt.toISOString()
      : null,
    isOverdue:
      !isDsrClosed(row.status) && row.slaDueAt.getTime() < now.getTime(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** CREATE audit `afterValue` — ids + type + status + dates. No free text yet
 * (none exists before processing). */
export function dsrCreateAuditSnapshot(
  row: DataSubjectRequestRow,
): Prisma.InputJsonObject {
  return {
    dataSubjectRequestId: row.id,
    customerId: row.customerId,
    insuredPersonId: row.insuredPersonId,
    type: row.type,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    slaDueAt: row.slaDueAt.toISOString(),
  };
}

/** UPDATE audit `afterValue` for every subsequent action (verify-identity,
 * assign, apply-extension, fulfil, partially-fulfil, reject, close) — the
 * full current state including the staff-authored reason fields verbatim
 * (the #41 `outcomeNote` / #42 `resolution` precedent: an operational
 * business-action note, not a customer's own subjective text, so unlike
 * #45's `comments` it is not excluded here). Each field carries the shared
 * `NO_FULL_ACCOUNT_NUMBER` guard at the DTO layer, not here. */
export function dsrUpdateAuditSnapshot(
  row: DataSubjectRequestRow,
): Prisma.InputJsonObject {
  return {
    dataSubjectRequestId: row.id,
    status: row.status,
    identityVerifiedAt: row.identityVerifiedAt
      ? row.identityVerifiedAt.toISOString()
      : null,
    slaDueAt: row.slaDueAt.toISOString(),
    accessExtensionAppliedAt: row.accessExtensionAppliedAt
      ? row.accessExtensionAppliedAt.toISOString()
      : null,
    extensionReason: row.extensionReason,
    retentionScheduleReference: row.retentionScheduleReference,
    partialFulfilmentJustification: row.partialFulfilmentJustification,
    dpoHandlerUserId: row.dpoHandlerUserId,
    processedByUserId: row.processedByUserId,
    closedByUserId: row.closedByUserId,
    rejectionReason: row.rejectionReason,
    noOpenRetentionHoldConfirmedAt: row.noOpenRetentionHoldConfirmedAt
      ? row.noOpenRetentionHoldConfirmedAt.toISOString()
      : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}
