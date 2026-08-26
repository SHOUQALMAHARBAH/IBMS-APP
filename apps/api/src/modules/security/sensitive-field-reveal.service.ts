import { BadRequestException, Injectable } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { AuditService } from '../audit/audit.service';
import { maskTrailing } from '../../common/masking.util';

/** A reveal justification shorter than this is not a real justification. */
const MIN_REASON_LENGTH = 10;

export interface RevealFieldInput {
  userId: string;
  entityType: string;
  entityId: string;
  field: string;
  encryptedValue: string;
  /** Why this specific drill-down is happening — required, logged, never
   * inferred. */
  reason: string;
}

/**
 * Part 10.6 — "never displayed unmasked outside a justified drill-down"
 * (ibms-brain/meta/lex/sensitive-data-handling.md). List views should call
 * `mask()` on an already-known masked/short value where possible; this
 * service exists for the one case that needs the real plaintext (a
 * drill-down), and makes that path impossible to use without a recorded
 * reason.
 *
 * `EncryptionService.decrypt()` already logs a key-use AuditLogEntry
 * (`ENCRYPTION_KEY_USED`, `isSensitiveDataAccess: true`) for every call —
 * that entry never carries the reason. This service adds a second, explicit
 * `READ` entry carrying the justification (never the plaintext itself — see
 * `meta/lex/sensitive-data-handling.md` "never logged") so a reviewer can
 * see *why* a Highly Confidential field was revealed, not just that it was.
 */
@Injectable()
export class SensitiveFieldRevealService {
  constructor(
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
  ) {}

  /** Masks an already-plaintext value for list-view display — no decrypt,
   * no audit entry, since nothing beyond the masked characters is exposed. */
  mask(plaintext: string): string {
    return maskTrailing(plaintext);
  }

  /** Decrypts `encryptedValue` and returns the real plaintext, after
   * recording who asked and why. Throws if `reason` is missing or too
   * short to be a real justification, before any decryption happens. */
  async reveal(input: RevealFieldInput): Promise<string> {
    if (!input.reason || input.reason.trim().length < MIN_REASON_LENGTH) {
      throw new BadRequestException(
        `A drill-down reveal of ${input.field} requires a written justification of at least ${MIN_REASON_LENGTH} characters (Part 10.6)`,
      );
    }
    const plaintext = await this.encryption.decrypt(
      'pii',
      input.encryptedValue,
      {
        userId: input.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
      },
    );
    await this.audit.record({
      userId: input.userId,
      action: 'READ',
      entityType: input.entityType,
      entityId: input.entityId,
      afterValue: {
        field: input.field,
        reason: input.reason,
        drillDown: true,
      },
      isSensitiveDataAccess: true,
    });
    return plaintext;
  }
}
