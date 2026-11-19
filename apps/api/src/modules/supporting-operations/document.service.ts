import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { Document } from '@ibms/db';
import {
  DocumentRepository,
  type DocumentFilter,
} from '../../repositories/document.repository';
import { PolicyRepository } from '../../repositories/policy.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import {
  documentAuditSnapshot,
  highestClassification,
  type DocumentPickerResult,
  type PolicyFileClassificationView,
} from './document.config';
import type { CreateDocumentVersionDto } from './dto/create-document-version.dto';
import type { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import type { SearchDocumentsDto } from '../../common/picker-search.dto';
import { PICKER_MAX_RESULTS } from '../../common/picker-search.config';

const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/** Process 70 — the `Document` version-control / deletion-override / "highest
 * classification present" writer. See `document.config.ts`'s header comment
 * for the full design (the dormant fields this activates, and why deletion
 * is a single-actor override, not the M06 disposal-batch dual control). */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly documents: DocumentRepository,
    private readonly policies: PolicyRepository,
    private readonly audit: AuditService,
  ) {}

  list(query: ListDocumentsQueryDto): Promise<Document[]> {
    const filter: DocumentFilter = {
      policyId: query.policyId,
      customerId: query.customerId,
      category: query.category,
      classification: query.classification,
    };
    return this.documents.findMany(filter);
  }

  async get(id: string): Promise<Document> {
    const document = await this.documents.findById(id);
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  /**
   * 🔴 OWNER DECISION 142 criterion 1 — «ويُقرأ كما صدر». The stored bytes, back.
   *
   * ## WHY THIS 404s RATHER THAN RETURNING EMPTY
   *
   * Almost every `Document` row in this product is a POINTER: `storageRef` is an object-storage
   * key supplied by the uploader, and no service here writes object storage. So «this document
   * has no bytes in the database» is the ordinary case, not an error state of the row — and a
   * caller handed an empty body could not tell it from a zero-length file.
   *
   * ⛔ THE DIGEST TRAVELS WITH THE BYTES. It is taken from the same row in the same read, so a
   * caller can hash what it received and compare. A digest fetched separately would be evidence
   * about a different moment.
   */
  async content(id: string): Promise<{
    bytes: Buffer;
    contentType: string;
    sha256: string;
    byteSize: number;
    fileName: string;
  }> {
    const document = await this.documents.findById(id);
    if (!document) throw new NotFoundException('Document not found');
    const stored = await this.documents.findStoredContent(id);
    if (stored === null) {
      throw new NotFoundException(
        'This document has no stored content. Its bytes live wherever its storageRef points, ' +
          'which this system does not write — only a document it ISSUED carries its own bytes.',
      );
    }
    return { ...stored, fileName: document.fileName };
  }

  /**
   * OWNER DECISION 41 — the document chooser's source, so `/audit-trail`'s document-history field can
   * be filled by picking a NAME instead of pasting a uuid.
   *
   * Gated on `document.read` ALONE, which is a departure from the picker rule and is argued in
   * `common/picker-search.config.ts`: adding `document-history.read` would hand a read-only auditor a
   * name search over every document in the office. The EXTERNAL_AUDITOR therefore has no chooser and
   * keeps the typed field — asserted, not worked around.
   *
   * The audit row is NOT `safeAudit`: the record of who searched the document register for what IS the
   * control, so a failure to write it fails the request. Its `entityId` is the ACTOR, not a document —
   * this row is about a person searching and there is no single document it happened to, which is the
   * shape the customer, employee and policy searches already use.
   */
  async searchForPicker(
    dto: SearchDocumentsDto,
    actorUserId: string,
  ): Promise<DocumentPickerResult[]> {
    const rows = await this.documents.searchForPicker(
      dto.q,
      PICKER_MAX_RESULTS.document,
    );

    await this.audit.record({
      userId: actorUserId,
      action: 'READ',
      entityType: 'DocumentSearch',
      entityId: actorUserId,
      afterValue: {
        term: dto.q,
        matchedDocumentIds: rows.map((r) => r.id),
        matchCount: rows.length,
        // A silently cut list reads as a complete answer — "these are the only three files on this
        // policy" when there are forty.
        truncated: rows.length === PICKER_MAX_RESULTS.document,
      },
      isSensitiveDataAccess: true,
    });

    return rows;
  }

  /** Creates version N+1 of the chain `id` currently leads. `id` must be the
   * chain's own current (leaf) version — a superseded id 422s, the
   * `QuotationService.revise` precedent, rather than silently resolving to
   * the real leaf. A genuine concurrent double-version loses the DB's own
   * `previousVersionId @unique` race and 409s. */
  async createVersion(
    id: string,
    dto: CreateDocumentVersionDto,
    actorUserId: string,
  ): Promise<Document> {
    const current = await this.documents.findById(id);
    if (!current) throw new NotFoundException('Document not found');

    if (await this.documents.hasSuccessor(id)) {
      throw new UnprocessableEntityException(
        `Document ${id} has already been superseded — create a new version from its own latest version instead.`,
      );
    }

    let next: Document;
    try {
      next = await this.documents.createVersion({
        policyId: current.policyId,
        customerId: current.customerId,
        category: current.category,
        classification: dto.classification,
        fileName: dto.fileName,
        storageRef: dto.storageRef,
        versionNumber: current.versionNumber + 1,
        previousVersionId: current.id,
        uploadedByUserId: actorUserId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `Document ${id} was versioned concurrently — reload and version its new latest version.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'Document',
      entityId: next.id,
      afterValue: documentAuditSnapshot(next),
      isSensitiveDataAccess:
        next.classification === 'CONFIDENTIAL' ||
        next.classification === 'HIGHLY_CONFIDENTIAL',
    });

    return next;
  }

  /** Unlocks `deletionLocked` and stamps `deletionOverrideByUserId` — a
   * status-conditional write, so a second concurrent override 409s instead
   * of silently overwriting who is on record for it.
   *
   * 🔴 OWNER DECISION 142 §٥ CRITERION 5 — «لا مسار يحذف الشهادة». A document whose FILE this
   * system holds cannot be unlocked at all, and that is checked FIRST, for two reasons that are
   * each sufficient:
   *
   *   - It refuses BEFORE anything is written. Measured 2026-11-18 on db-test: this route used
   *     to answer 201 on a stored certificate, commit `deletionLocked = false` and stamp
   *     `deletionOverrideByUserId`, and only the delete AFTER it failed — with a 500, from
   *     `DocumentContent_documentId_fkey`'s `ON DELETE RESTRICT` (SQLSTATE 23001). The
   *     certificate survived, but the office was left holding an unlocked certificate and a
   *     named person on record as having unlocked it.
   *   - It refuses before it AUDITS. The audit row is an UPDATE claiming the lock moved, and a
   *     register that records a change which did not happen is worse than one that records
   *     nothing: `audit-trail`'s whole value is that a reader may take it literally.
   *
   * ⛔ The test is `hasStoredContent`, not `category === 'CERTIFICATE_OF_INSURANCE'` — see that
   * method's own comment. Retention is module 11's question (decision 142 §٤) and is NOT
   * answered here; until she rules, nothing stored is destroyed. */
  async overrideDeletionLock(
    id: string,
    actorUserId: string,
  ): Promise<Document> {
    const existing = await this.documents.findById(id);
    if (!existing) throw new NotFoundException('Document not found');

    if (await this.documents.hasStoredContent(id)) {
      throw new ConflictException(
        `Document ${id} holds a file stored in this system and cannot be unlocked for deletion.`,
      );
    }

    const updated = await this.documents.setDeletionOverride(id, actorUserId);
    if (!updated) {
      throw new ConflictException(
        `Document ${id} is already unlocked for deletion.`,
      );
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Document',
      entityId: id,
      beforeValue: { deletionLocked: true },
      afterValue: {
        deletionLocked: false,
        deletionOverrideByUserId: actorUserId,
      },
      isSensitiveDataAccess: true,
    });

    return updated;
  }

  /** Deletes `id` — only once it is unlocked (`overrideDeletionLock` first),
   * only if it is the chain's own leaf (a successor would be silently
   * orphaned by `Document_previousVersionId_fkey`'s `ON DELETE SET NULL`,
   * not blocked by it — an application-level guard, not a DB one; see
   * `document.repository.ts`), and only if no `ClaimDocument` still links to
   * it (the DB's own `ON DELETE RESTRICT` backstops this one). */
  async remove(id: string, actorUserId: string): Promise<void> {
    const existing = await this.documents.findById(id);
    if (!existing) throw new NotFoundException('Document not found');

    if (existing.deletionLocked) {
      throw new ConflictException(
        `Document ${id} is locked — call the deletion-override endpoint first.`,
      );
    }
    if (await this.documents.hasSuccessor(id)) {
      throw new ConflictException(
        `Document ${id} has a newer version — delete forward from the chain's latest version instead.`,
      );
    }
    if (await this.documents.hasClaimLink(id)) {
      throw new ConflictException(
        `Document ${id} is attached to a claim's documentation and cannot be deleted.`,
      );
    }

    const removed = await this.documents.deleteIfUnlocked(id);
    if (!removed) {
      throw new ConflictException(
        `Document ${id} could not be deleted — it may have been re-locked or already removed.`,
      );
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'DELETE',
      entityType: 'Document',
      entityId: id,
      beforeValue: documentAuditSnapshot(existing),
      isSensitiveDataAccess: true,
    });
  }

  /** PRIV-STD-02 §6.7 — the highest classification present across a
   * Policy's electronic Insurance File. */
  async policyFileClassification(
    policyId: string,
    actorUserId: string,
  ): Promise<PolicyFileClassificationView> {
    const policy = await this.policies.findById(policyId);
    if (!policy) throw new NotFoundException('Policy not found');

    const rows = await this.documents.classificationsByPolicyId(policyId);
    const classifications = rows.map((r) => r.classification);
    const highest = highestClassification(classifications);

    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'Document',
      entityId: policyId,
      afterValue: { policyId, documentCount: rows.length },
      isSensitiveDataAccess:
        highest === 'CONFIDENTIAL' || highest === 'HIGHLY_CONFIDENTIAL',
    });

    return {
      policyId,
      documentCount: rows.length,
      highestClassification: highest,
    };
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Document audit (${input.action} ${input.entityId}) failed: ${(err as Error).message}`,
      );
    }
  }
}
