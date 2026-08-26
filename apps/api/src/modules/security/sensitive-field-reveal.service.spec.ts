import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SensitiveFieldRevealService } from './sensitive-field-reveal.service';
import { EncryptionService } from './encryption.service';
import { KeyRegistryService } from './key-registry.service';
import type { AuditService } from '../audit/audit.service';

function key32(): string {
  return randomBytes(32).toString('base64');
}

const revealInput = {
  userId: 'user-1',
  entityType: 'Customer',
  entityId: 'customer-1',
  field: 'nationalIdEnc',
};

function buildService(recordMock: Mock): {
  service: SensitiveFieldRevealService;
  encryption: EncryptionService;
} {
  const audit = { record: recordMock } as unknown as AuditService;
  const encryption = new EncryptionService(new KeyRegistryService(), audit);
  return {
    service: new SensitiveFieldRevealService(encryption, audit),
    encryption,
  };
}

describe('SensitiveFieldRevealService', () => {
  let recordMock: Mock;

  beforeEach(() => {
    recordMock = vi.fn().mockResolvedValue(undefined);
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
  });

  describe('mask', () => {
    it('masks a plaintext value without decrypting or auditing anything', () => {
      const { service } = buildService(recordMock);
      expect(service.mask('9871234567')).toBe('******4567');
      expect(recordMock).not.toHaveBeenCalled();
    });
  });

  describe('reveal', () => {
    it('rejects a missing reason before any decryption happens', async () => {
      const { service } = buildService(recordMock);
      await expect(
        service.reveal({
          ...revealInput,
          encryptedValue: 'irrelevant',
          reason: '',
        }),
      ).rejects.toThrow(/requires a written justification/);
      expect(recordMock).not.toHaveBeenCalled();
    });

    it('rejects a too-short reason', async () => {
      const { service } = buildService(recordMock);
      await expect(
        service.reveal({
          ...revealInput,
          encryptedValue: 'irrelevant',
          reason: 'because',
        }),
      ).rejects.toThrow(/requires a written justification/);
    });

    it('decrypts and returns the plaintext when a real reason is given', async () => {
      const { service, encryption } = buildService(recordMock);
      const encrypted = await encryption.encrypt(
        'pii',
        '9871234567',
        revealInput,
      );
      recordMock.mockClear();

      const plaintext = await service.reveal({
        ...revealInput,
        encryptedValue: encrypted,
        reason: 'Customer disputed the ID on file during a support call',
      });

      expect(plaintext).toBe('9871234567');
    });

    it('records a READ audit entry with the reason but never the plaintext', async () => {
      const { service, encryption } = buildService(recordMock);
      const encrypted = await encryption.encrypt(
        'pii',
        '9871234567',
        revealInput,
      );
      recordMock.mockClear();

      await service.reveal({
        ...revealInput,
        encryptedValue: encrypted,
        reason: 'Customer disputed the ID on file during a support call',
      });

      const readCall = recordMock.mock.calls.find(
        (call) => (call[0] as Record<string, unknown>).action === 'READ',
      );
      expect(readCall).toBeDefined();
      expect(readCall![0]).toMatchObject({
        userId: 'user-1',
        action: 'READ',
        entityType: 'Customer',
        entityId: 'customer-1',
        isSensitiveDataAccess: true,
        afterValue: {
          field: 'nationalIdEnc',
          reason: 'Customer disputed the ID on file during a support call',
          drillDown: true,
        },
      });
      expect(JSON.stringify(recordMock.mock.calls)).not.toContain('9871234567');
    });
  });
});
