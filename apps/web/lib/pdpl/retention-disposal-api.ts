// M06 — Data Retention & Secure Disposal (backlog Part D §5.1, Process #52).
// Reads/writes apps/api's /retention-schedule, /legal-holds, and
// /disposal-batches endpoints. retention-schedule.manage (Compliance/DPO)
// gates the schedule table; legal-hold.manage (DPO) gates holds;
// retention.dispose.nominate (Manager, maker) / retention.dispose.approve
// (DPO, checker) gate the dual-control disposal workflow.

import { apiGet, apiPatch, apiPost } from '../auth/api-client';
import type { CombinedDutyActOnRecord } from '../../components/ui/CombinedDutyOnRecord';

export const DISPOSAL_METHODS = [
  'certified_secure_wipe_nist_800_88',
  'physical_destruction',
  'certified_shredding',
] as const;

export type DisposalBatchStatus =
  | 'NOMINATED'
  | 'MANAGER_APPROVED'
  | 'DPO_APPROVED'
  | 'EXECUTED'
  | 'CLOSED';

/**
 * TEN — the minimum length of a declaration's written reason, mirroring the api's single home for
 * that figure (`apps/api/src/common/declaration-reason.ts`).
 *
 * A hand-copied constant over an HTTP boundary is exactly the drift class this repo has paid for,
 * so the api REPORTS it: every `NO_FLOOR_DECLARATION_REQUIRED` body carries `reasonMinLength`, and
 * an api e2e asserts that the reported figure equals this one. The constant is the screen's default
 * so a disabled button does not depend on a round trip.
 */
export const NO_FLOOR_REASON_MIN_LENGTH = 10;

/** The office's declaration for a category this system knows no statutory minimum for. */
export interface NoFloorDeclarationInput {
  /** The sentence as RENDERED — carried so the record says what the office was actually shown. */
  noticeShown: string;
  reason: string;
  acknowledged: true;
}

export interface RetentionScheduleItem {
  id: string;
  recordCategory: string;
  /**
   * NULL where a statutory floor governs the category and the office has not set its own period —
   * the shipped template's deliberate state (decisions 32 and 33). The screen shows the ARTICLE and
   * the FLOOR in its place rather than an em dash: "no period yet, and here is the minimum the law
   * sets" is actionable where a blank is not.
   */
  retentionPeriodMonths: number | null;
  /**
   * The statute setting a minimum for this category, or null.
   *
   * The screen shows this WHERE the period would be when none is set, which is the whole point of
   * carrying it: "no period set" alone is not actionable, and "no period set, this article requires
   * at least N months" is.
   */
  floor: {
    instrument: string;
    article: string;
    operativeText: string;
    floorMonths: number;
  } | null;
  legalBasis: string | null;
  confirmedByLegalCounselAt: string | null;
  isConfirmed: boolean;
  /**
   * THE SIXTEENTH PAIR'S ACT, ON THE RECORD. Null for every ordinary two-person confirmation,
   * which is nearly all of them — `CombinedDutyOnRecord` renders nothing in that case.
   */
  combinedDutyAct: CombinedDutyActOnRecord | null;
  /**
   * The no-floor declaration, if this category ever needed one. Carries the SENTENCE the office was
   * shown, not the word "acknowledged" — a year from now the question is what they saw.
   */
  noFloorDeclaration: {
    noticeShown: string;
    reason: string;
    acknowledgedAt: string;
    acknowledgedByUserId: string;
    acknowledgedMonths: number;
  } | null;
}

/** A retention notice — one row per category the office has set a period for. */
export interface RetentionNotice {
  recordCategory: string;
  retentionPeriodMonths: number | null;
  /**
   * CAN THE SYSTEM ACT ON THIS CATEGORY AT ALL — a period is set AND a lawyer has confirmed it.
   *
   * Distinct from `resolvable`, and the two answer different questions: `resolvable: false` means
   * this category can NEVER produce a notice because no date marks the end of its purpose, and
   * nothing the office does changes that; `actionable: false` means not YET, and the office knows
   * what to do — set the period, or get it confirmed.
   */
  actionable: boolean;
  /** Why it is not actionable, in the server's own words. Null when it is. */
  inertReason: string | null;
  /** False means no notice is possible for this category, ever — `unresolvableReason` says why. */
  resolvable: boolean;
  unresolvableReason: string | null;
  elapsedCount: number;
  /** The ids, so an extension can NAME the records it covers. Capped at 500 by the api. */
  elapsedRecordIds: string[];
  heldCount: number;
  extendedCount: number;
  floor: { instrument: string; article: string; operativeText: string } | null;
  countedFrom: string | null;
  noLegalHoldStatement: string;
}

export interface ExtendRetentionInput {
  recordCategory: string;
  recordIds: string[];
  months: number;
  basis: 'LEGISLATIVE_PROVISION' | 'LEGAL_HOLD_OR_DISPUTE' | 'CUSTOMER_EXPLICIT_CONSENT';
  note: string;
  instrument?: string;
  article?: string;
  legalHoldId?: string;
}

export function listRetentionNotices(): Promise<RetentionNotice[]> {
  return apiGet('/retention-notices');
}

export function extendRetention(
  body: ExtendRetentionInput,
): Promise<{ extended: number; extendedUntil: string }> {
  return apiPost('/retention-notices/extend', body);
}

/**
 * ONE ROW PER EXTENSION — `GET /retention-notices/register`, owner decision 43.
 *
 * NOT the notice list. `listRetentionNotices` returns records whose period has ELAPSED, and an
 * extended record LEAVES that list by design — that is what an extension does. So this is the only
 * place an extension is readable, and until this function existed an office could extend retention
 * and nobody, a regulator included, could ask what was extended and why.
 *
 * `recordId` is returned and is NOT rendered (register entry 94): of the four blockable models only
 * `Receipt.reference` and `CommissionLedgerEntry.paymentReference` carry anything a person could
 * recognise, so there is no readable handle to show and inventing one is the display fix rule 2
 * refuses. The id stays in the payload and in the row's own test hook.
 */
/**
 * HOW A RECORD IS NAMED TO A PERSON — owner decision 44, resolved by the api per category.
 *
 * FOUR STATES AS ONE DISCRIMINATED FIELD, because they are four different answers and a reader needs
 * them apart. `NOT_RECORDED` is a gap in the office's own bookkeeping and somebody could still go and
 * find the reference; `CATEGORY_HAS_NO_REFERENCE` is a property of the system and nobody ever will.
 * A `string | null` plus a reason beside it would be two fields free to disagree.
 *
 * `description` says what the value IS — a client bank reference, a commission payment reference —
 * and is the api's, not this screen's: the four categories name four different kinds of thing and a
 * single column heading cannot say which.
 */
export type RecordHandleState =
  | { state: 'RECORDED'; value: string; description: string }
  | { state: 'NOT_RECORDED'; description: string }
  | { state: 'RECORD_NO_LONGER_PRESENT' }
  | { state: 'CATEGORY_HAS_NO_REFERENCE'; reason: string };

export interface RetentionExtensionRegisterRow {
  id: string;
  recordCategory: string;
  recordId: string;
  /**
   * WHICH RECORD, in words — owner decision 44, closing the half of group 7b's rule that register
   * entry 94 recorded as open. `recordId` above is still the id and is still NOT RENDERED.
   */
  recordHandle: RecordHandleState;
  /** When the EXTENDED clock elapses — the date the same notice comes back with the same choices. */
  extendedUntil: string;
  basis: ExtendRetentionInput['basis'];
  /** Free text that ACCOMPANIES the basis. NOT NULL on the api side: the basis says which kind of
   *  cover was claimed, this says what the office is actually relying on. */
  note: string;
  legislativeInstrument: string | null;
  legislativeArticle: string | null;
  legalHold: { id: string; scope: string; reason: string } | null;
  consentRecordId: string | null;
  consentDuration: string | null;
  consentPurpose: string | null;
  extendedByUserId: string;
  /** Resolved by the api, the same way the retrieval register resolves its own actor. A uuid
   *  identifies nobody to the person reading the register. */
  extendedByName: string | null;
  extendedAt: string;
}

export function listRetentionExtensions(): Promise<
  RetentionExtensionRegisterRow[]
> {
  return apiGet('/retention-notices/register');
}

/**
 * BATCH 5 GROUP 7c — a retrieval from the blocked phase.
 *
 * These interfaces are HAND-COPIED over HTTP and TypeScript cannot check them against the api's own
 * view, which is how the customer-import result panel once broke. When this shape changes, the
 * client, the screen and every Playwright mock move in the SAME commit.
 */
export type ArchiveRetrievalBasis =
  | 'JUDICIAL_REQUEST'
  | 'CBJ_AUDIT'
  | 'AMLU_REQUEST'
  | 'OTHER';

/**
 * WHICH BASES EXIST, FROM THE SERVER — `GET /retention-archive/bases`, owner decision 43.
 *
 * The screen used to carry its own copy of the closed two as a hardcoded pair of `<option>`s and a
 * `useState('JUDICIAL_REQUEST')` default, while this route existed so that *"the screen renders them
 * rather than restating them"* (its controller's own words) and reached no caller. Two homes for one
 * closed fact is the defect this codebase refuses everywhere else.
 *
 * `basis` IS A STRING AND NOT `ArchiveRetrievalBasis`, deliberately. The server owns this list; a
 * third basis added there must reach the screen rather than be typed out of existence, and the
 * label lookup falls back to rendering the member name — visibly unfinished, which is the same
 * decision the workflow-entity labels made for a member with no word.
 *
 * THE ROW CARRIES ONLY THE MEMBER, AND `meaning` IS GONE FROM THE WIRE — owner decision 45,
 * 2026-10-23. It was declared and unrendered under entry 122, on the honest grounds that the api
 * carried it in English only and shipping an English sentence into an Arabic screen as a placeholder
 * is worse than the gap. The owner has now written the meanings, and they are bilingual and have
 * THREE NAMED PARTS each (a selection condition, what goes in the box, and an example) plus one
 * shared line — so they live in `translations/pdpl.ts` keyed by member, where every other bilingual
 * string in this product lives and where this api cannot reach, having no message i18n at all.
 *
 * That keeps decision 43's property rather than trading it away: a FIFTH basis added server-side
 * still appears in this dropdown with no web change, rendering its own member name and no meaning
 * until somebody decides its words.
 */
export interface ArchiveRetrievalBasisDefinition {
  basis: string;
}

export function listArchiveRetrievalBases(): Promise<
  ArchiveRetrievalBasisDefinition[]
> {
  return apiGet('/retention-archive/bases');
}

export interface ArchiveRetrieval {
  id: string;
  recordCategory: string;
  recordId: string;
  /**
   * A STRING, for the same reason `ArchiveRetrievalBasisDefinition.basis` is: the server owns this
   * list, so a basis this build has never heard of must arrive and be rendered (as its own member
   * name, visibly unfinished) rather than be typed out of existence and silently mislabelled. The
   * table used to decide this with a ternary on one member, so every other basis rendered the
   * Central Bank audit label.
   */
  basis: string;
  note: string;
  retrievedAt: string;
  retrievedByUserId: string;
  retrievedByName: string | null;
}

export interface RetrieveBlockedRecordsInput {
  recordCategory: string;
  recordIds: string[];
  /**
   * A STRING, and the SERVER is the validator — `@IsIn(ARCHIVE_RETRIEVAL_BASES)` answers 400 on
   * anything it did not offer. The screen only ever sends a value the server itself named in
   * `GET /retention-archive/bases`, so narrowing this to the union would do nothing except stop a
   * third basis working until the web caught up.
   */
  basis: string;
  note: string;
}

export function listArchiveRetrievals(): Promise<ArchiveRetrieval[]> {
  return apiGet('/retention-archive/retrievals');
}

export function retrieveBlockedRecords(
  body: RetrieveBlockedRecordsInput,
): Promise<{ retrievals: ArchiveRetrieval[] }> {
  return apiPost('/retention-archive/retrievals', body);
}

export interface LegalHold {
  id: string;
  scope: string;
  reason: string;
  placedAt: string;
  nextReviewDueAt: string;
  releasedAt: string | null;
  retentionScheduleItemId: string | null;
  customerId: string | null;
  insuredPersonId: string | null;
  /** Batch six item 2 — the customer's own name, resolved by the api. Null when the hold names no
   *  customer, which `hasAtMostOneSubjectReference` allows. */
  customerName: string | null;
  isActive: boolean;
}

export interface DisposalBatch {
  id: string;
  retentionScheduleItemId: string | null;
  status: DisposalBatchStatus;
  nominatedByUserId: string;
  managerApprovedAt: string | null;
  dpoApprovedByUserId: string | null;
  /**
   * Set when ONE person both nominated this batch and approved it, in an office that declared COMBINED
   * duty segregation and stated why. Null on every ordinary approval.
   *
   * This pair authorises IRREVERSIBLE DESTRUCTION of personal data, so whether two people agreed is the
   * most load-bearing fact on the row — and the status column says DPO_APPROVED either way.
   */
  combinedDutyAct: CombinedDutyActOnRecord | null;
  dpoApprovedAt: string | null;
  method: string | null;
  executedAt: string | null;
  slaDueAt: string | null;
  createdAt: string;
  hasCertificateOfDestruction: boolean;
}

// --- Retention schedule -------------------------------------------

export function listRetentionSchedule(): Promise<RetentionScheduleItem[]> {
  return apiGet('/retention-schedule');
}

export function createRetentionScheduleItem(body: {
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis?: string;
  /** Sent only after the server has asked — the screen holds no copy of the floor list. */
  noFloorDeclaration?: NoFloorDeclarationInput;
}): Promise<RetentionScheduleItem> {
  return apiPost('/retention-schedule', body);
}

export function updateRetentionScheduleItem(
  id: string,
  body: {
    retentionPeriodMonths?: number;
    legalBasis?: string;
    noFloorDeclaration?: NoFloorDeclarationInput;
  },
): Promise<RetentionScheduleItem> {
  return apiPatch(`/retention-schedule/${id}`, body);
}

export function confirmRetentionScheduleItem(
  id: string,
): Promise<RetentionScheduleItem> {
  return apiPost(`/retention-schedule/${id}/confirm`, {});
}

// --- Legal holds -----------------------------------------------

export function listLegalHolds(
  opts: {
    retentionScheduleItemId?: string;
    active?: boolean;
    customerId?: string;
    insuredPersonId?: string;
  } = {},
): Promise<LegalHold[]> {
  const params = new URLSearchParams();
  if (opts.retentionScheduleItemId)
    params.set('retentionScheduleItemId', opts.retentionScheduleItemId);
  if (opts.active !== undefined) params.set('active', String(opts.active));
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.insuredPersonId) params.set('insuredPersonId', opts.insuredPersonId);
  const qs = params.toString();
  return apiGet(`/legal-holds${qs ? `?${qs}` : ''}`);
}

export function createLegalHold(body: {
  scope: string;
  reason: string;
  retentionScheduleItemId?: string;
  customerId?: string;
  insuredPersonId?: string;
}): Promise<LegalHold> {
  return apiPost('/legal-holds', body);
}

export function reviewLegalHold(id: string): Promise<LegalHold> {
  return apiPost(`/legal-holds/${id}/review`, {});
}

export function releaseLegalHold(id: string): Promise<LegalHold> {
  return apiPost(`/legal-holds/${id}/release`, {});
}

// --- Disposal batches --------------------------------------------

export function listDisposalBatches(
  opts: { retentionScheduleItemId?: string; status?: string } = {},
): Promise<DisposalBatch[]> {
  const params = new URLSearchParams();
  if (opts.retentionScheduleItemId)
    params.set('retentionScheduleItemId', opts.retentionScheduleItemId);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return apiGet(`/disposal-batches${qs ? `?${qs}` : ''}`);
}

export function nominateDisposalBatch(
  retentionScheduleItemId?: string,
): Promise<DisposalBatch> {
  return apiPost('/disposal-batches', { retentionScheduleItemId });
}

export function managerApproveDisposalBatch(
  id: string,
): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/manager-approve`, {});
}

export function dpoApproveDisposalBatch(
id: string,
  /**
   * Part 4 — sent only when the approver IS the maker and the office has declared COMBINED mode. Omitted on
   * every ordinary two-person approval, which sends the same body it always did.
   */
  combinedDutyReason?: string,
): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/dpo-approve`, combinedDutyReason ? { combinedDutyReason } : {});
}

export function executeDisposalBatch(
  id: string,
  method: string,
): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/execute`, { method });
}

export function issueCertificateOfDestruction(
  id: string,
): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/certificate`, {});
}

export function closeDisposalBatch(id: string): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/close`, {});
}
