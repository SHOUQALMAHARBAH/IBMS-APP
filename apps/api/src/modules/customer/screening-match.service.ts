import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ScreeningMatchRepository,
  type ScreeningMatchWithContext,
} from '../../repositories/screening-match.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface ScreeningMatchView {
  id: string;
  kycRecordId: string;
  customerId: string;
  customerLegalName: string;
  customerStatus: string;
  kycStatus: string;
  isEdd: boolean;
  /** The name that matched — not always the customer's own, since screening
   * covers UBOs too. */
  subjectName: string;
  matchType: string;
  status: string;
  detectedAt: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  listSource: string;
  listEntryName: string;
  listEntryRemarks: string | null;
  /** The matched entry has since been removed from the source list. The
   * decision and its reason stand; the entry can no longer be re-checked. */
  listEntryDelisted: boolean;
}

/**
 * Process 49 — the sanctions match review queue.
 *
 * Fuzzy matching deliberately over-fires (see `watchlist-match.config.ts`),
 * which is only a defensible trade if a person actually adjudicates the
 * output. This service is that adjudication, and it is intentionally the ONLY
 * thing in the system that can resolve a match: nothing auto-clears on a
 * re-screen and nothing auto-blocks a customer.
 *
 * Two rules the endpoints enforce and the model comment records:
 *
 *  * **A reason is mandatory** on both outcomes. "Cleared" without a stated
 *    basis is indistinguishable from "ignored", and this is the record a
 *    regulator would ask to see.
 *  * **Clearing never unwinds the escalation.** `KYCRecord.isEdd` and a HIGH
 *    `RiskRating` only ever escalate in `ScreeningService` — a cleared false
 *    positive leaves that trail intact. Unwinding it is a separate, deliberate
 *    Compliance decision, not a side effect of closing a queue item.
 */
@Injectable()
export class ScreeningMatchService {
  private readonly logger = new Logger(ScreeningMatchService.name);

  constructor(
    private readonly matches: ScreeningMatchRepository,
    private readonly audit: AuditService,
  ) {}

  async list(
    filter: { status?: string; kycRecordId?: string },
    actor: AuthenticatedUser,
  ): Promise<ScreeningMatchView[]> {
    const rows = await this.matches.findMany(filter);

    // A queue row names a customer alongside a sanctions entry — Highly
    // Confidential by content, so the read itself is logged (the
    // `CrmService.get360View` / `ClaimService` precedent). Counts and filters
    // only: never a customer name or a list entry in the audit row.
    await this.safeAudit({
      userId: actor.id,
      action: 'READ',
      entityType: 'ScreeningMatch',
      entityId: filter.kycRecordId ?? 'queue',
      isSensitiveDataAccess: rows.length > 0,
      afterValue: {
        status: filter.status ?? 'all',
        kycRecordId: filter.kycRecordId ?? null,
        rowCount: rows.length,
      },
    });

    return rows.map(toView);
  }

  async pendingCount(): Promise<{ pending: number }> {
    return { pending: await this.matches.countPending() };
  }

  /** `cleared` = a false positive, the subject is not the sanctioned party.
   * `confirmed` = a true match; the customer stays escalated and Compliance
   * takes it forward outside this system (a filing decision is not automated
   * here). Both require a written reason. */
  async decide(
    id: string,
    decision: 'cleared' | 'confirmed',
    reviewReason: string,
    actor: AuthenticatedUser,
  ): Promise<ScreeningMatchView> {
    const existing = await this.matches.findById(id);
    if (!existing) {
      throw new NotFoundException(`Screening match ${id} not found.`);
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `Screening match ${id} was already ${existing.status} on ${existing.reviewedAt?.toISOString() ?? 'an earlier date'}. A recorded review decision is not overwritten — re-screen the customer if the position has changed.`,
      );
    }

    const updated = await this.matches.recordDecision({
      id,
      status: decision,
      reviewedByUserId: actor.id,
      reviewReason,
      reviewedAt: new Date(),
    });
    if (!updated) {
      // 0 rows — another reviewer decided it between our read and our write.
      throw new ConflictException(
        `Screening match ${id} was reviewed concurrently by another user.`,
      );
    }

    // The reason is the substance of the control, and it IS retained — on the
    // `ScreeningMatch` row itself, durably and first-class, which is where a
    // reviewer and a regulator both read it.
    //
    // It is deliberately NOT copied into the audit row as well. This is the
    // one free-text field on a sanctions path, so it is exactly where a
    // reviewer writes "our client is not the <name> on the SDN list" — i.e.
    // it is a PII capture point by construction. `refund.service.ts` already
    // states the same convention for the same reason ("never `reason` free
    // text"). The audit row records THAT a reason was given and points at the
    // entity holding it (`sensitive-data-handling.md` — log identifiers, not
    // the sensitive value).
    await this.safeAudit({
      userId: actor.id,
      action: decision === 'confirmed' ? 'APPROVE' : 'REJECT',
      entityType: 'ScreeningMatch',
      entityId: id,
      beforeValue: { status: 'pending' },
      afterValue: {
        status: decision,
        matchType: existing.matchType,
        watchlistEntryId: existing.watchlistEntryId,
        listSource: existing.entrySource,
        reviewReasonRecorded: true,
        reviewReasonLength: reviewReason.length,
        reviewedByUserId: actor.id,
      },
    });

    const refreshed = await this.matches.findById(id);
    return toView(refreshed ?? { ...existing, ...updated });
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Screening-match audit (${input.action} ${input.entityId}) failed after the operation already committed: ${(err as Error).message}`,
      );
    }
  }
}

function toView(row: ScreeningMatchWithContext): ScreeningMatchView {
  return {
    id: row.id,
    kycRecordId: row.kycRecordId,
    customerId: row.kycRecord.customerId,
    customerLegalName: row.kycRecord.customer.legalName,
    customerStatus: row.kycRecord.customer.status,
    kycStatus: row.kycRecord.status,
    isEdd: row.kycRecord.isEdd,
    subjectName: row.subjectName,
    matchType: row.matchType,
    status: row.status,
    detectedAt: row.detectedAt.toISOString(),
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewReason: row.reviewReason,
    // Read from the SNAPSHOT, never the relation. `pruneStale` deletes an
    // entry as soon as the subject drops off the source list, and the FK is
    // `SET NULL`, so a confirmed match rendered from the relation would decay
    // into "(deleted)" — the compliance record has to still say what was
    // matched and on which list.
    listSource: row.entryListProgram
      ? `${row.entrySource} (${row.entryListProgram})`
      : row.entrySource,
    listEntryName: row.entryFullName,
    // `remarks` is NOT snapshotted (free text, and only ever contextual), so
    // it is genuinely gone once the entry is pruned.
    listEntryRemarks: row.watchlistEntry?.remarks ?? null,
    /// True once the source list no longer carries this entry — the decision
    /// stands, but it can no longer be re-checked against the live list.
    listEntryDelisted: row.watchlistEntryId === null,
  };
}
