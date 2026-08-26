import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { randomBytes } from 'node:crypto';
import { EncryptionService } from './encryption.service';
import { KeyRegistryService } from './key-registry.service';
import type { AuditService } from '../audit/audit.service';

function key32(): string {
  return randomBytes(32).toString('base64');
}

const ctx = {
  userId: 'user-1',
  entityType: 'Customer',
  entityId: 'customer-1',
  field: 'nationalIdEnc',
};

function buildService(recordMock: Mock): EncryptionService {
  const audit = { record: recordMock } as unknown as AuditService;
  return new EncryptionService(new KeyRegistryService(), audit);
}

describe('EncryptionService', () => {
  let recordMock: Mock;

  beforeEach(() => {
    recordMock = vi.fn().mockResolvedValue(undefined);
  });

  it('round-trips a plaintext value under the active key', async () => {
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const service = buildService(recordMock);

    const encrypted = await service.encrypt('pii', '9871234567', ctx);
    expect(encrypted).not.toContain('9871234567');
    expect(encrypted.startsWith('v1:')).toBe(true);
    await expect(service.decrypt('pii', encrypted, ctx)).resolves.toBe(
      '9871234567',
    );
  });

  it('produces a different ciphertext each call (random IV)', async () => {
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const service = buildService(recordMock);

    const a = await service.encrypt('pii', 'same-secret', ctx);
    const b = await service.encrypt('pii', 'same-secret', ctx);
    expect(a).not.toBe(b);
  });

  it('rejects a tampered ciphertext', async () => {
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const service = buildService(recordMock);

    const encrypted = await service.encrypt('pii', '9871234567', ctx);
    const [keyId, iv, authTag, ciphertext] = encrypted.split(':');
    const tampered = Buffer.from(ciphertext, 'base64');
    tampered[0] ^= 0xff;
    const corrupted = [keyId, iv, authTag, tampered.toString('base64')].join(
      ':',
    );
    await expect(service.decrypt('pii', corrupted, ctx)).rejects.toThrow();
  });

  it('throws on a malformed value instead of silently returning garbage', async () => {
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const service = buildService(recordMock);

    await expect(
      service.decrypt('pii', 'not-a-valid-encoded-value', ctx),
    ).rejects.toThrow(/Malformed/);
  });

  it('decrypts data encrypted under a since-retired key after rotation', async () => {
    const v1 = key32();
    process.env.PII_ENCRYPTION_KEYS = `v1:${v1}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const v1Service = buildService(recordMock);
    const encryptedUnderV1 = await v1Service.encrypt('pii', 'old-secret', ctx);

    // Rotate: v2 becomes active, but v1 is retained so old data still decrypts.
    const v2 = key32();
    process.env.PII_ENCRYPTION_KEYS = `v1:${v1},v2:${v2}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v2';
    const rotatedService = buildService(recordMock);

    await expect(
      rotatedService.decrypt('pii', encryptedUnderV1, ctx),
    ).resolves.toBe('old-secret');
    const freshlyEncrypted = await rotatedService.encrypt(
      'pii',
      'new-secret',
      ctx,
    );
    expect(freshlyEncrypted.startsWith('v2:')).toBe(true);
  });

  it('logs a key-use audit entry on every encrypt/decrypt without ever including the plaintext or ciphertext', async () => {
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const service = buildService(recordMock);

    const encrypted = await service.encrypt('pii', '9871234567', ctx);
    await service.decrypt('pii', encrypted, ctx);

    expect(recordMock).toHaveBeenCalledTimes(2);
    const [encryptCall, decryptCall] = recordMock.mock.calls as Array<
      [Record<string, unknown>]
    >;

    expect(encryptCall[0]).toMatchObject({
      userId: 'user-1',
      action: 'ENCRYPTION_KEY_USED',
      entityType: 'Customer',
      entityId: 'customer-1',
      afterValue: {
        keyId: 'v1',
        purpose: 'pii',
        field: 'nationalIdEnc',
        operation: 'encrypt',
      },
      isSensitiveDataAccess: false,
    });
    expect(decryptCall[0]).toMatchObject({
      action: 'ENCRYPTION_KEY_USED',
      afterValue: {
        keyId: 'v1',
        purpose: 'pii',
        field: 'nationalIdEnc',
        operation: 'decrypt',
      },
      isSensitiveDataAccess: true,
    });

    const serialized = JSON.stringify(recordMock.mock.calls);
    expect(serialized).not.toContain('9871234567');
    expect(serialized).not.toContain(encrypted);
  });
});
