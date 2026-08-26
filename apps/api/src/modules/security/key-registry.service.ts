import { Injectable } from '@nestjs/common';

export interface KeyMetadata {
  keyId: string;
  active: boolean;
}

/**
 * Part 10.2 — centralized key management for field-level PII encryption.
 * Loads every key version this process can still decrypt with, plus which
 * one is active for new writes, from env at construction (fail fast, same
 * gate as crypto.util.ts's MFA_ENCRYPTION_KEY — see that file for why MFA
 * secrets use a separate, single-purpose key pool rather than this
 * registry: blast-radius isolation between an auth-secret compromise and a
 * PII compromise, not an oversight).
 *
 * Rotation: add a new "keyId:base64key" entry to PII_ENCRYPTION_KEYS
 * alongside the old one, flip PII_ENCRYPTION_ACTIVE_KEY_ID to the new id —
 * existing ciphertext keeps decrypting via its embedded key id
 * (encryption.service.ts) until it's re-encrypted, at which point the old
 * id can be retired from the list.
 */
@Injectable()
export class KeyRegistryService {
  private readonly keys: Map<string, Buffer>;
  private readonly activeKeyId: string;

  constructor() {
    const raw = process.env.PII_ENCRYPTION_KEYS;
    const activeKeyId = process.env.PII_ENCRYPTION_ACTIVE_KEY_ID;
    if (!raw || !activeKeyId) {
      throw new Error(
        'PII_ENCRYPTION_KEYS and PII_ENCRYPTION_ACTIVE_KEY_ID must be set — ' +
          'required to encrypt/decrypt -- ENCRYPT fields (Part 10.2)',
      );
    }
    const keys = new Map<string, Buffer>();
    for (const entry of raw.split(',')) {
      const [keyId, base64Key] = entry.split(':');
      if (!keyId || !base64Key) {
        throw new Error(`Malformed PII_ENCRYPTION_KEYS entry: "${entry}"`);
      }
      const key = Buffer.from(base64Key, 'base64');
      if (key.length !== 32) {
        throw new Error(
          `PII_ENCRYPTION_KEYS entry "${keyId}" must base64-decode to exactly 32 bytes`,
        );
      }
      keys.set(keyId, key);
    }
    if (!keys.has(activeKeyId)) {
      throw new Error(
        `PII_ENCRYPTION_ACTIVE_KEY_ID "${activeKeyId}" is not present in PII_ENCRYPTION_KEYS`,
      );
    }
    this.keys = keys;
    this.activeKeyId = activeKeyId;
  }

  getActiveKey(): { keyId: string; key: Buffer } {
    return { keyId: this.activeKeyId, key: this.keys.get(this.activeKeyId)! };
  }

  /** Looks up a (possibly retired) key by id — decrypting old data must
   * keep working through a rotation, not just encrypting new data. */
  getKey(keyId: string): Buffer {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(
        `Unknown encryption key id "${keyId}" — it may have been retired ` +
          'from PII_ENCRYPTION_KEYS before all data encrypted under it was re-encrypted',
      );
    }
    return key;
  }

  /** Key-custodian view — ids and rotation status only, never key material. */
  listKeyMetadata(): KeyMetadata[] {
    return [...this.keys.keys()].map((keyId) => ({
      keyId,
      active: keyId === this.activeKeyId,
    }));
  }
}
