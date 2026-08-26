import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KeyRegistryService } from './key-registry.service';
import { AuditService } from '../audit/audit.service';

const ALGORITHM = 'aes-256-gcm';

/** Only one purpose exists today (PII field-level encryption). Typed as a
 * union rather than a bare string so a future purpose (e.g. document
 * storage keys) is a deliberate addition here, not a typo anywhere it's
 * called from. */
export type EncryptionPurpose = 'pii';

export interface KeyUseContext {
  /** Acting user — required so key-use logging (below) attributes to
   * someone, same as every other AuditLogEntry (Part 10.3). */
  userId: string;
  entityType: string;
  entityId: string;
  field: string;
}

/**
 * Field-level encryption service for every schema field flagged `-- ENCRYPT`
 * (Part 10.2): Customer.nationalIdEnc/contactPhoneEnc/contactEmailEnc,
 * UltimateBeneficialOwner.nationalIdEnc, InsuredPerson.nationalIdEnc,
 * Employee.nationalIdEnc, ThirdPartyClaimant.contactDetailsEnc — see
 * encrypted-fields.ts for the field map and the entity-level helpers built
 * on top of this service.
 *
 * AES-256-GCM, random 12-byte IV per call, auth tag appended so tampering
 * is detected on decrypt rather than silently accepted. Ciphertext is
 * `keyId:iv:authTag:ciphertext` (base64) — the embedded key id is what
 * makes key rotation possible: a value encrypted under a retired key still
 * decrypts as long as KeyRegistryService still knows that id.
 *
 * Every call logs a key-use AuditLogEntry (centralized key management —
 * "logging of every key use") recording which key/purpose/field/operation
 * was involved, never the plaintext or ciphertext itself.
 */
@Injectable()
export class EncryptionService {
  constructor(
    private readonly keys: KeyRegistryService,
    private readonly audit: AuditService,
  ) {}

  async encrypt(
    purpose: EncryptionPurpose,
    plaintext: string,
    ctx: KeyUseContext,
  ): Promise<string> {
    const { keyId, key } = this.keys.getActiveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const encoded = [
      keyId,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
    await this.logKeyUse('encrypt', keyId, purpose, ctx);
    return encoded;
  }

  /** Reverses {@link encrypt}. Throws if the value was tampered with, is
   * malformed, or names a key id this process no longer holds. */
  async decrypt(
    purpose: EncryptionPurpose,
    encoded: string,
    ctx: KeyUseContext,
  ): Promise<string> {
    const [keyId, ivB64, authTagB64, ciphertextB64] = encoded.split(':');
    if (!keyId || !ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Malformed encrypted field value');
    }
    const key = this.keys.getKey(keyId);
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
    await this.logKeyUse('decrypt', keyId, purpose, ctx);
    return plaintext.toString('utf8');
  }

  private async logKeyUse(
    operation: 'encrypt' | 'decrypt',
    keyId: string,
    purpose: EncryptionPurpose,
    ctx: KeyUseContext,
  ): Promise<void> {
    await this.audit.record({
      userId: ctx.userId,
      action: 'ENCRYPTION_KEY_USED',
      entityType: ctx.entityType,
      entityId: ctx.entityId,
      afterValue: { keyId, purpose, field: ctx.field, operation },
      // A decrypt is a read of Highly Confidential/Confidential data —
      // Part 10.3 requires those specifically flagged, not just logged.
      isSensitiveDataAccess: operation === 'decrypt',
    });
  }
}
