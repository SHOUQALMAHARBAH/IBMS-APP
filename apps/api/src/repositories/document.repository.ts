import { Injectable } from '@nestjs/common';
import type { DataClassification, Document, DocumentCategory } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateDocumentVersionInput {
  policyId: string | null;
  customerId: string | null;
  category: DocumentCategory;
  classification: DataClassification;
  fileName: string;
  storageRef: string;
  versionNumber: number;
  previousVersionId: string;
  uploadedByUserId: string;
}

export interface DocumentFilter {
  policyId?: string;
  customerId?: string;
  category?: DocumentCategory;
  classification?: DataClassification;
}

/**
 * Process 70 (backlog Part C #70, Domain H) — the standalone `Document`
 * module. `Document` (Part 4.2, the electronic Insurance File) pre-exists
 * with three prior writers (Policy issuance/attach, Claim documentation,
 * Customer onboarding) that each only ever create a version-1 row — none
 * creates a second version, unlocks the default deletion lock, or deletes a
 * row. This repository is that first real writer for those three actions.
 */
@Injectable()
export class DocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Document | null> {
    return this.prisma.client.document.findUnique({ where: { id } });
  }

  findMany(filter: DocumentFilter): Promise<Document[]> {
    return this.prisma.client.document.findMany({
      where: {
        policyId: filter.policyId,
        customerId: filter.customerId,
        category: filter.category,
        classification: filter.classification,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** A document has a successor once some row's `previousVersionId` points
   * at it — `previousVersionId` is `@unique`, so at most one exists. */
  async hasSuccessor(id: string): Promise<boolean> {
    const successor = await this.prisma.client.document.findFirst({
      where: { previousVersionId: id },
      select: { id: true },
    });
    return successor !== null;
  }

  /** `ClaimDocument.documentId` carries `ON DELETE RESTRICT` — this is a
   * pre-check for a clear 409 message; the DB constraint is the backstop if
   * a race slips past it. */
  async hasClaimLink(id: string): Promise<boolean> {
    const link = await this.prisma.client.claimDocument.findFirst({
      where: { documentId: id },
      select: { id: true },
    });
    return link !== null;
  }

  createVersion(input: CreateDocumentVersionInput): Promise<Document> {
    return this.prisma.client.document.create({ data: input });
  }

  /** Status-conditional: only flips a row that is still locked, so a
   * concurrent second override 0-matches instead of racing
   * (race-safe-invariants.md). Returns `null` when 0 rows matched. */
  async setDeletionOverride(
    id: string,
    actorUserId: string,
  ): Promise<Document | null> {
    const result = await this.prisma.client.document.updateMany({
      where: { id, deletionLocked: true },
      data: { deletionLocked: false, deletionOverrideByUserId: actorUserId },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  /** Status-conditional delete: only removes a row that is unlocked, so a
   * document re-locked (or never unlocked) concurrently is never deleted out
   * from under an in-flight override. Returns `true` iff a row was removed.
   *
   * `Document_previousVersionId_fkey` is `ON DELETE SET NULL`, not
   * `RESTRICT` — the DB will NOT stop a delete that orphans a successor.
   * `hasSuccessor` must be checked by the caller before calling this; that
   * application-level guard is the only defense here, a documented,
   * deliberate limitation (see `document-management.md`). */
  async deleteIfUnlocked(id: string): Promise<boolean> {
    const result = await this.prisma.client.document.deleteMany({
      where: { id, deletionLocked: false },
    });
    return result.count === 1;
  }

  classificationsByPolicyId(
    policyId: string,
  ): Promise<{ classification: DataClassification }[]> {
    return this.prisma.client.document.findMany({
      where: { policyId },
      select: { classification: true },
    });
  }
}
