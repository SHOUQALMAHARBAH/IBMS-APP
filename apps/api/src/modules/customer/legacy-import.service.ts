import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CustomerRepository } from '../../repositories/customer.repository';
import { KycRecordRepository } from '../../repositories/kyc-record.repository';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../security/encryption.service';
import { encryptEntityFields } from '../security/encrypted-fields';
import { ScreeningService } from './screening.service';
import {
  LEGACY_IMPORT_MAX_BYTES,
  mapRows,
  parseCsv,
  type LegacyImportRejection,
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
 * Tenancy needs no special handling and that is the point: every write goes
 * through the tenant-scoped client, so the job can only ever write into the
 * caller's own Organization. There is no `organizationId` in this file to get
 * wrong.
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
  ) {}

  async import(input: {
    file: { originalname: string; size: number; buffer: Buffer };
    mapping: Record<string, string>;
    actorUserId: string;
  }): Promise<LegacyImportResult> {
    const { file, mapping, actorUserId } = input;

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

    const failures: LegacyImportRejection[] = [];
    let imported = 0;
    let screened = 0;
    let screeningFlagged = 0;

    // Sequential on purpose. Each row does an encrypt, two writes and a
    // screening pass against the watchlist; running them in parallel would
    // multiply that against a database this system already wraps every query
    // in its own RLS transaction on.
    for (const row of rows) {
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
            failures.push({
              lineNumber: row.lineNumber,
              reason:
                'imported and screened, but the candidate queue was TRUNCATED — review is incomplete for this customer',
            });
          }
        } catch (err) {
          // Imported but unscreened. Reported, never silent: an unscreened
          // customer that nobody knows is unscreened is the exact failure the
          // whole screening subsystem exists to prevent.
          failures.push({
            lineNumber: row.lineNumber,
            reason: `imported, but screening failed: ${(err as Error).message}`,
          });
          this.logger.error(
            `Legacy import: customer from line ${row.lineNumber} was imported but NOT screened (${(err as Error).message}). It is PENDING_KYC and will be picked up by the recurring re-screen batch.`,
          );
        }
      } catch (err) {
        failures.push({
          lineNumber: row.lineNumber,
          reason: (err as Error).message,
        });
      }
    }

    const result: LegacyImportResult = {
      fileName: file.originalname,
      totalDataRows: rows.length + rejections.length,
      imported,
      rejected: rejections.length,
      screened,
      screeningFlagged,
      rejections,
      failures,
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
          failed: result.failures.length,
        },
      });
    } catch (err) {
      this.logger.error(
        `Legacy import audit row failed after the import already committed: ${(err as Error).message}`,
      );
    }
  }
}
