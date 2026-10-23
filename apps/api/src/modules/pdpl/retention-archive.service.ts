import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { UserRepository } from '../../repositories/user.repository';
import { RetentionArchiveRepository } from '../../repositories/retention-archive.repository';
import { resolutionFor } from './retention-resolution.config';
import {
  ARCHIVE_RETRIEVAL_BASIS_DEFINITIONS,
  type ArchiveRetrievalBasis,
} from './retention-archive.config';

export interface ArchiveRetrievalView {
  id: string;
  recordCategory: string;
  recordId: string;
  basis: ArchiveRetrievalBasis;
  note: string;
  retrievedAt: string;
  retrievedByUserId: string;
  retrievedByName: string | null;
}

/**
 * RETRIEVAL FROM THE BLOCKED PHASE — condition 3 of the archived state.
 *
 * ## THERE IS NO SECOND "WHAT IS BLOCKED" VIEW, DELIBERATELY
 *
 * The blocked records ARE the elapsed records the notice already lists, so `RetentionNoticeService`
 * is where an office sees them and this service does not re-answer that question. A second list
 * would be a second answer to "which records are past their period", free to disagree with the
 * first the moment a period changed — the same reason the state itself has no column.
 *
 * That also settles condition 2, "not visible to ordinary employees": the notice route is an ANY-OF
 * over the act codes, and the records themselves have left the three unbounded reads an ordinary
 * employee can reach. What remains visible is declared rather than hidden — a report whose window
 * explicitly covers a blocked record's own era still includes it, and the over-collection guard on
 * an invoice still counts its receipts, because excluding either would produce a wrong figure
 * instead of a protected one.
 *
 * ## RETRIEVING SOMETHING THAT IS NOT BLOCKED IS REFUSED
 *
 * Not a convenience check. A register row claiming a judicial basis for a record anybody could read
 * through an ordinary screen pollutes the one place that answers "why was this looked at" — and the
 * register is append-only, so a wrong row cannot be taken back out. The refusal names the record.
 */
@Injectable()
export class RetentionArchiveService {
  constructor(
    private readonly archive: RetentionArchiveRepository,
    private readonly audit: AuditService,
    private readonly users: UserRepository,
  ) {}

  /**
   * WHICH bases exist, for the screen to render rather than restate. The WORDS are the web's — see
   * `ARCHIVE_RETRIEVAL_BASES` — so this answers the one half the screen cannot answer for itself.
   */
  bases() {
    return ARCHIVE_RETRIEVAL_BASIS_DEFINITIONS;
  }

  /**
   * Record a retrieval and return what was retrieved.
   *
   * `now` is a parameter for the same reason it is everywhere else in this feature: the blocked
   * boundary is provable in a test without a clock.
   */
  async retrieve(
    input: {
      recordCategory: string;
      recordIds: string[];
      basis: ArchiveRetrievalBasis;
      note: string;
    },
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<{ retrievals: ArchiveRetrievalView[] }> {
    const resolution = resolutionFor(input.recordCategory);
    if (resolution === null) {
      throw new UnprocessableEntityException(
        `"${input.recordCategory}" has no retention clock in this system, so no record in it can be ` +
          `in the blocked phase and there is nothing to retrieve. See the retention and disposal ` +
          `screen for which categories this system can watch and why the others cannot be watched.`,
      );
    }

    const exclusion = await this.archive.blockedExclusionFor(
      input.recordCategory,
      now,
    );
    if (exclusion === null) {
      throw new UnprocessableEntityException(
        `No record in "${input.recordCategory}" is in the blocked phase right now — either no ` +
          `retention period is set for it, or an active legal hold covers the whole category, in ` +
          `which case the records are kept under that hold and not under a retention block.`,
      );
    }

    const blockedIds = await this.archive.blockedIdsIn(
      input.recordCategory,
      input.recordIds,
      now,
    );
    const notBlocked = input.recordIds.filter((id) => !blockedIds.includes(id));
    if (notBlocked.length > 0) {
      throw new UnprocessableEntityException(
        `These records are not in the blocked phase, so retrieving them on a judicial or audit ` +
          `basis would record a compulsion that did not apply: ${notBlocked.join(', ')}. The ` +
          `register is append-only and a row cannot be taken back out. Read them through their own ` +
          `screen instead.`,
      );
    }

    const retrievals: ArchiveRetrievalView[] = [];
    for (const recordId of input.recordIds) {
      const row = await this.archive.recordRetrieval({
        recordCategory: input.recordCategory,
        recordId,
        basis: input.basis,
        note: input.note,
        retrievedByUserId: actorUserId,
      });
      retrievals.push({
        id: row.id,
        recordCategory: input.recordCategory,
        recordId,
        basis: input.basis,
        note: input.note,
        retrievedAt: now.toISOString(),
        retrievedByUserId: actorUserId,
        retrievedByName: null,
      });
    }

    // AUDITED, AND NOT BEST-EFFORT. The register is the condition; the audit row is the record that
    // somebody exercised the capability at all, which is the question asked of a privileged read.
    // The basis and the note are carried, the record IDS are carried as a COUNT — the register
    // already names them, and copying a list of ids into the append-only audit table would put the
    // same fact in two places with no way to correct either.
    await this.audit.record({
      userId: actorUserId,
      action: 'READ',
      entityType: 'RetentionArchiveRetrieval',
      entityId: input.recordCategory,
      afterValue: {
        recordCategory: input.recordCategory,
        basis: input.basis,
        note: input.note,
        recordCount: input.recordIds.length,
      },
    });

    return { retrievals };
  }

  /** The register, newest first — "every retrieval can be justified from one place". */
  async list(recordCategory?: string): Promise<ArchiveRetrievalView[]> {
    const rows = await this.archive.listRetrievals(recordCategory);
    /*
     * OWNER DECISION 48 — the name comes from the HR record where the account is linked, through
     * the ONE resolver, rather than from raw `User.fullName`. This register exists to hold a PERSON
     * accountable for retrieving a blocked record; before this it could show «Compliance Officer»,
     * which is true of the account and names nobody. One query for the page, not one per row.
     */
    const names = await this.users.displayNamesForUserIds(
      rows.map((r) => r.retrievedByUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      recordCategory: r.recordCategory,
      recordId: r.recordId,
      basis: r.basis,
      note: r.note,
      retrievedAt: r.retrievedAt.toISOString(),
      retrievedByUserId: r.retrievedByUserId,
      retrievedByName: names.get(r.retrievedByUserId ?? '') ?? null,
    }));
  }
}
