import { randomUUID } from 'node:crypto';
import {
  Injectable,
  NotFoundException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CustomerRepository } from '../../repositories/customer.repository';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { AuditService } from '../audit/audit.service';
import { LegacyImportBatchRepository } from '../../repositories/legacy-import-batch.repository';
import { validateLegacyRow } from './legacy-import.validation';
import type { LegacyImportIssueKind } from '@ibms/db';
import { EncryptionService } from '../security/encryption.service';
import { encryptEntityFields } from '../security/encrypted-fields';
import { ScreeningService } from './screening.service';
import {
  LEGACY_IMPORT_MAX_BYTES,
  mapRows,
  parseCsv,
  type LegacyImportResult,
  type LegacyImportRow,
} from './legacy-import.config';

/**
 * Part III §7 — the legacy customer bulk import.
 *
 * Four properties the spec asks for, and how each is actually obtained rather
 * than merely intended:
 *
 * 1. **Per-office column mapping.** Supplied with the upload, because each
 *    office's export has different headings. It is not persisted: a reusable
 *    saved mapping would be a new tenant-scoped table (and its RLS policy) for
 *    a tool an office runs once when it joins.
 *
 * 2. **Batch screening at import time.** Every imported row is screened
 *    through the SAME `ScreeningService.run` the intake flow uses — not a
 *    private copy with its own idea of what counts as a hit. A row whose
 *    screening throws is still imported and is reported as unscreened; the
 *    alternative is abandoning a 400-row load over one transient failure, and
 *    the recurring 4-hourly batch re-screens everybody anyway.
 *
 * 3. **Never mistaken for a KYC-approved customer.** `source = LEGACY_IMPORT`,
 *    the customer left at its default `PENDING_KYC`, and a `DRAFT` KYCRecord.
 *    Three independent statements, none of which can be read as approved.
 *
 * 4. **One audit row for the batch**, naming the actor, the file, and the row
 *    counts — separate from the per-customer CREATE rows the writes emit.
 *
 * Tenancy needs no special handling for the WRITES and that is the point: every one goes through the
 * tenant-scoped client, so the job can only ever write into the caller's own Organization.
 *
 * ONE READ IS DIFFERENT and takes the office id explicitly — the duplicate lookup, which is
 * `$queryRaw` because both canonical keys are SQL functions, and a raw query does not pass through
 * `tenantScopeExtension`. That is the only `organizationId` in this file, and it is a parameter rather
 * than something derived here so it cannot be derived differently from the writes.
 */
@Injectable()
export class LegacyImportService {
  private readonly logger = new Logger(LegacyImportService.name);

  constructor(
    private readonly customers: CustomerRepository,
    private readonly kycRecords: KycRecordRepository,
    private readonly screening: ScreeningService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly importBatches: LegacyImportBatchRepository,
  ) {}

  async import(input: {
    file: { originalname: string; size: number; buffer: Buffer };
    mapping: Record<string, string>;
    actorUserId: string;
    /**
     * Needed EXPLICITLY, and the header above says there is no `organizationId` in this file to get
     * wrong — which was true until the duplicate check arrived. The collision lookup is `$queryRaw`,
     * because both canonical keys are SQL functions with no Prisma equivalent, and a raw query does
     * NOT go through `tenantScopeExtension`. So the one read that bypasses the scoping is given the
     * office id by the caller rather than trusting a setting it cannot see.
     */
    organizationId: string;
  }): Promise<LegacyImportResult> {
    const { file, mapping, actorUserId, organizationId } = input;

    // Checked here as well as by the upload limit: the interceptor's cap is
    // configuration, and a control that only exists in configuration is one
    // deploy away from not existing.
    if (file.size > LEGACY_IMPORT_MAX_BYTES) {
      throw new UnprocessableEntityException(
        `The file is ${file.size} bytes; the limit is ${LEGACY_IMPORT_MAX_BYTES}.`,
      );
    }

    const table = parseCsv(file.buffer.toString('utf8'));
    const { rows, rejections } = mapRows(table, mapping);

    let imported = 0;
    let screened = 0;
    let screeningFlagged = 0;

    // Sequential on purpose. Each row does an encrypt, two writes and a
    // screening pass against the watchlist; running them in parallel would
    // multiply that against a database this system already wraps every query
    // in its own RLS transaction on.
    // Collected per row and persisted in one go below, so a report is one write rather than 2,000.
    const issues: {
      lineNumber: number;
      kind: LegacyImportIssueKind;
      detail: string;
      collidedWithCustomerId?: string;
    }[] = rejections.map((r) => ({
      lineNumber: r.lineNumber,
      // A parse refusal — the type could not be narrowed from free text — is BAD_DATA like any other.
      kind: 'BAD_DATA',
      detail: r.reason,
    }));
    let refusedDuplicates = 0;

    for (const row of rows) {
      // VALIDATED AGAINST THE INTAKE DTO, not against a copy of its rules. One source of truth; see
      // `legacy-import.validation.ts` for the four fields the legacy format structurally cannot carry
      // and why each is excluded rather than invented.
      const problems = validateLegacyRow(row);
      if (problems.length > 0) {
        issues.push({
          lineNumber: row.lineNumber,
          kind: 'BAD_DATA',
          // The validators' OWN messages, not a restatement — a restatement is a third copy.
          detail: problems.join('; '),
        });
        continue;
      }

      // THE DUPLICATE CHECK, keyed by the row's TYPE: the ordered person key for an individual, the
      // registration key for a company. `findCanonicalCollision` takes the type so it cannot be called
      // without choosing, because one test for both is the cousin mistake in a new place.
      //
      // A HARD REFUSAL here rather than the create screen's warning, and the asymmetry is deliberate:
      // on a 2,000-row import there is nobody to ask, so a refusal that is REPORTED beats a duplicate
      // that is not. The officer resolves the report afterwards.
      const collision = await this.customers.findCanonicalCollision(
        organizationId,
        row.customerType === 'INDIVIDUAL'
          ? { customerType: 'INDIVIDUAL', legalName: row.legalName }
          : {
              customerType: 'CORPORATE',
              registrationNumber: row.registrationNumber,
            },
      );
      if (collision) {
        refusedDuplicates += 1;
        issues.push({
          lineNumber: row.lineNumber,
          kind: 'DUPLICATE',
          // NAMES the row it collided with. "Duplicate" alone sends an officer looking; the name and
          // the id let them open it and decide.
          detail: `already in this office as "${collision.legalName}"`,
          collidedWithCustomerId: collision.id,
        });
        continue;
      }

      try {
        const kycRecordId = await this.importRow(row, actorUserId);
        imported += 1;
        try {
          const result = await this.screening.run(kycRecordId, actorUserId);
          screened += 1;
          // Counted as flagged when this run raised a hit OR when no populated
          // list could be consulted. The second case matters as much as the
          // first: an unscreenable row is not a clear one, and an importer
          // that reported it as clean would be the precise failure Part B
          // exists to prevent.
          if (result.newHit || !result.screenable) screeningFlagged += 1;
          if (result.matchesTruncated) {
            issues.push({
              lineNumber: row.lineNumber,
              // IMPORTED, so not a refusal: the customer IS in the book and folding this in with the
              // rejections would understate what was written.
              kind: 'IMPORTED_NEEDS_REVIEW',
              detail:
                'imported and screened, but the candidate queue was TRUNCATED — review is incomplete for this customer',
            });
          }
        } catch (err) {
          // Imported but unscreened. Reported, never silent: an unscreened
          // customer that nobody knows is unscreened is the exact failure the
          // whole screening subsystem exists to prevent.
          issues.push({
            lineNumber: row.lineNumber,
            kind: 'IMPORTED_NEEDS_REVIEW',
            detail: `imported, but screening failed: ${(err as Error).message}`,
          });
          this.logger.error(
            `Legacy import: customer from line ${row.lineNumber} was imported but NOT screened (${(err as Error).message}). It is PENDING_KYC and will be picked up by the recurring re-screen batch.`,
          );
        }
      } catch (err) {
        // A write that failed for any other reason. BAD_DATA rather than a fourth kind: from the
        // office's side it is a row that did not land and needs looking at, and inventing a kind with
        // one producer is the `UNENFORCED` shape.
        issues.push({
          lineNumber: row.lineNumber,
          kind: 'BAD_DATA',
          detail: (err as Error).message,
        });
      }
    }

    // SORTED BY LINE, because the response and the durable read must not disagree: the repository
    // orders the persisted issues by kind then line, while this array is in INSERTION order — parse
    // refusals are seeded before the loop runs, so line 4 could precede line 3. An office reading two
    // orderings of the same report has to work out which one is the report.
    issues.sort((a, b) => a.lineNumber - b.lineNumber);

    const needsReview = issues.filter(
      (i) => i.kind === 'IMPORTED_NEEDS_REVIEW',
    ).length;
    const refused = issues.length - needsReview;

    // THE DURABLE REPORT. One batch row and one issue row per line, written before the response is
    // built — an office importing 2,000 rows comes back to this list tomorrow, and forty refusals in
    // an HTTP response is a report nobody can act on an hour later.
    //
    // NOT best-effort, unlike the audit row below it. The report IS the deliverable of a refuse-and-
    // report import: if it cannot be written, the office has no way to learn which lines were refused,
    // and silently returning a body instead would be the silent-drop failure this design exists to
    // avoid.
    const batch = await this.importBatches.create({
      actorUserId,
      fileName: file.originalname,
      totalDataRows: rows.length + rejections.length,
      imported,
      refused,
      screened,
      needsReview,
      issues,
    });

    const result: LegacyImportResult = {
      batchId: batch.id,
      fileName: file.originalname,
      totalDataRows: rows.length + rejections.length,
      imported,
      rejected: refused,
      refusedDuplicates,
      screened,
      screeningFlagged,
      issues,
    };

    await this.safeAudit(actorUserId, result);
    return result;
  }

  /** One customer + its DRAFT KYC file. Returns the KYCRecord id to screen. */
  private async importRow(
    row: LegacyImportRow,
    actorUserId: string,
  ): Promise<string> {
    const id = randomUUID();
    const encrypted = await encryptEntityFields(
      this.encryption,
      'Customer',
      {
        contactPhoneEnc: row.contactPhone,
        contactEmailEnc: row.contactEmail,
      },
      { userId: actorUserId, entityType: 'Customer', entityId: id },
    );

    const isIndividual = row.customerType === 'INDIVIDUAL';
    await this.customers.create({
      id,
      customerType: row.customerType,
      legalName: row.legalName,
      // A corporate registration number on an individual, or an individual's
      // nationality on a company, is the same field-shape rule the intake flow
      // applies — the importer does not get its own, looser version of it.
      registrationNumber: isIndividual ? undefined : row.registrationNumber,
      nationality: isIndividual ? row.nationality : undefined,
      registeredAddress: isIndividual ? undefined : row.registeredAddress,
      contactPhoneEnc: encrypted.contactPhoneEnc,
      contactEmailEnc: encrypted.contactEmailEnc,
      // The office picks a language per customer during proper intake; a
      // legacy file rarely carries one, so this takes the schema default (AR)
      // rather than inventing a preference the office never recorded.
      languagePreference: 'AR',
      ownerUserId: actorUserId,
      source: 'LEGACY_IMPORT',
    });

    const kyc = await this.kycRecords.create({
      customerId: id,
      createdByUserId: actorUserId,
    });
    return kyc.id;
  }

  /** The office's import history, newest first. Scoped by the tenant client, so no office id here. */
  listBatches() {
    return this.importBatches.listRecent(50);
  }

  /**
   * One batch with its issues, ordered by KIND then line.
   *
   * A missing id is a 404 rather than an empty object: a batch that does not exist and a batch with no
   * issues are different answers, and returning `null` for both would make a clean import look like a
   * broken link.
   */
  async getBatch(id: string) {
    const batch = await this.importBatches.findWithIssues(id);
    if (!batch) {
      throw new NotFoundException(`No import batch ${id} in this office.`);
    }
    return batch;
  }

  /** §7.4 — the batch as a single audit row, beside the per-customer CREATE
   * rows the writes already emit. Never the file's contents: the row records
   * that an import happened and how it went, not the personal data it carried
   * (`sensitive-data-handling.md`). */
  private async safeAudit(
    actorUserId: string,
    result: LegacyImportResult,
  ): Promise<void> {
    try {
      await this.audit.record({
        userId: actorUserId,
        action: 'CREATE',
        entityType: 'LegacyCustomerImport',
        entityId: randomUUID(),
        afterValue: {
          fileName: result.fileName,
          totalDataRows: result.totalDataRows,
          imported: result.imported,
          rejected: result.rejected,
          screened: result.screened,
          screeningFlagged: result.screeningFlagged,
          // By KIND, so the audit row says the same thing the report does. `failed: n` used to be the
          // only breakdown and it conflated a refusal with an imported-but-unscreened row.
          refusedDuplicates: result.refusedDuplicates,
          refusedBadData: result.rejected - result.refusedDuplicates,
          needsReview: result.issues.filter(
            (i) => i.kind === 'IMPORTED_NEEDS_REVIEW',
          ).length,
          // So the audit trail can reach the durable report rather than restating it. Never the lines
          // themselves: an audit row records that an import happened and how it went, not the personal
          // data it carried.
          batchId: result.batchId,
        },
      });
    } catch (err) {
      this.logger.error(
        `Legacy import audit row failed after the import already committed: ${(err as Error).message}`,
      );
    }
  }
}
