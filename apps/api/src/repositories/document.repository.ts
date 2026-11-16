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

  /**
   * 🔴 OWNER DECISION 142 — STORE AN ISSUED INSURANCE CERTIFICATE: the row AND its bytes, in one
   * transaction.
   *
   * «كل شهادة تأمين تصدر تُحفَظ ملفاً في النظام بسطر في جدول الملفات.»
   *
   * ## WHY ONE TRANSACTION AND NOT TWO WRITES
   *
   * The two halves mean nothing apart. A `Document` with no `DocumentContent` is exactly what
   * every row in this product already is — a pointer with nothing behind it — so a half-written
   * certificate would be indistinguishable from an uploaded one, and the screen would offer a
   * download that 404s. `DocumentContent` is append-only by trigger, so the failed half cannot be
   * repaired afterwards either: there is no UPDATE path to fill the bytes in later.
   *
   * ## THE STAMP IS PASSED IN, NEVER DERIVED HERE
   *
   * OWNER DECISION 128 + 136 §6. `issuedUnderStudyLicenseId` is decided ONCE, by the licence gate,
   * at the instant the act was permitted — see `LicenseGateService.assertMayPractise`. Deriving it
   * here would read the licence at a second instant, and an office whose new certificate landed
   * between the two reads would store a certificate stamped with a term it was no longer under.
   *
   * ## `storageRef` CARRIES THE ROW'S OWN ID, AND THAT IS NOT A PLACEHOLDER
   *
   * The column is NOT NULL and is an object-storage key supplied by the uploader everywhere else.
   * Nothing uploaded this, so there is no key. It carries `db:documentContent/<id>` — which says
   * truthfully where the bytes are, and is the string a storage migration (§3) will rewrite when
   * the hosting decision lands. ⛔ An empty string would have read as «uploaded, key unknown».
   */
  async storeIssuedCertificate(input: {
    policyId: string;
    fileName: string;
    uploadedByUserId: string;
    bytes: Buffer;
    contentType: string;
    sha256: string;
    issuedUnderStudyLicenseId: string | null;
  }): Promise<Document> {
    return this.prisma.client.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          policyId: input.policyId,
          category: 'CERTIFICATE_OF_INSURANCE',
          /*
           * A certificate names the customer, the insurer, the line and the sums insured. It is
           * handed to a third party on purpose, which is NOT the same as being public: the stored
           * copy sits in the office's own file. CONFIDENTIAL is the same level the policy
           * documents beside it carry, and `sensitive-data-handling.md` is what forbids reaching
           * lower.
           */
          classification: 'CONFIDENTIAL',
          fileName: input.fileName,
          storageRef: 'db:documentContent/pending',
          uploadedByUserId: input.uploadedByUserId,
          /* ⛔ NOT set to false anywhere. Decision 142 §5 criterion 5 — no route deletes a
           * certificate — and retention is module 11's question (§4), unanswered, so nothing is
           * destroyed until she rules. The column defaults to true; it is stated here because a
           * default is a fact about the schema and this is a fact about the decision. */
          deletionLocked: true,
          issuedUnderStudyLicenseId: input.issuedUnderStudyLicenseId,
        },
      });
      await tx.documentContent.create({
        data: {
          documentId: document.id,
          /*
           * ⚠️ `Uint8Array`, NOT `Buffer`. Prisma maps `Bytes` to `Uint8Array`, and a `Buffer`
           * is only structurally assignable when its backing store is an `ArrayBuffer` — the
           * compiler refuses it because a `Buffer` may sit on a `SharedArrayBuffer`. Copying the
           * view is also the honest thing here: the row must not alias a pooled buffer the
           * renderer may reuse.
           */
          bytes: new Uint8Array(input.bytes),
          byteSize: input.bytes.byteLength,
          contentType: input.contentType,
          sha256: input.sha256,
        },
      });
      return tx.document.update({
        where: { id: document.id },
        data: { storageRef: `db:documentContent/${document.id}` },
      });
    });
  }

  /**
   * 🔴 OWNER DECISION 142 criterion 1 — «ويُقرأ كما صدر». The bytes back, with their digest.
   *
   * Returned together DELIBERATELY: the digest is only evidence if it travels with the bytes it
   * was taken over. A caller handed the bytes from here and the digest from a second read could
   * compare two different moments and call it proof.
   */
  async findStoredContent(documentId: string): Promise<{
    bytes: Buffer;
    contentType: string;
    sha256: string;
    byteSize: number;
  } | null> {
    const row = await this.prisma.client.documentContent.findUnique({
      where: { documentId },
      select: { bytes: true, contentType: true, sha256: true, byteSize: true },
    });
    if (row === null) return null;
    return { ...row, bytes: Buffer.from(row.bytes) };
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

  /**
   * THE DOCUMENT PICKER's source — owner decision 41, module 0-ب's screen pass.
   *
   * Matches on `fileName` alone, which is the only human-readable field on the model. `take` is a
   * REQUIRED argument rather than defaulted, on the established picker shape: a bound that a caller can
   * forget is a bound that eventually returns the register.
   *
   * The select is deliberately narrow — an id, the name, and the two facts that tell two matches apart.
   * `storageRef`, `classification` and the uploader are NOT returned: a chooser is a way to name a
   * record, and `GET /documents/:id` is where its contents are read under the same permission.
   */
  searchForPicker(
    term: string,
    take: number,
  ): Promise<
    {
      id: string;
      fileName: string;
      category: DocumentCategory;
      versionNumber: number;
    }[]
  > {
    return this.prisma.client.document.findMany({
      where: { fileName: { contains: term, mode: 'insensitive' } },
      select: {
        id: true,
        fileName: true,
        category: true,
        versionNumber: true,
      },
      // A TOTAL order — `fileName` is far from unique here (forty policies carry a "policy.pdf"), so it
      // cannot carry one alone and the row id is the tie-break. The `findActiveUserIdsWithPermission`
      // lesson: a consumer reading the first row imposes an ordering requirement nothing type-checks.
      orderBy: [{ fileName: 'asc' }, { id: 'asc' }],
      take,
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
