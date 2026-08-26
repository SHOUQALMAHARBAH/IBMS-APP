import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  decryptField,
  encryptField,
  generateOpaqueToken,
  hashToken,
} from './crypto.util';

beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

describe('encryptField / decryptField', () => {
  it('round-trips a plaintext value', () => {
    const encrypted = encryptField('JBSWY3DPEHPK3PXP');
    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptField(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encryptField('same-secret');
    const b = encryptField('same-secret');
    expect(a).not.toBe(b);
  });

  it('rejects a tampered ciphertext', () => {
    const encrypted = encryptField('JBSWY3DPEHPK3PXP');
    const [iv, authTag, ciphertext] = encrypted.split(':');
    const tamperedByte = Buffer.from(ciphertext, 'base64');
    tamperedByte[0] ^= 0xff;
    const tampered = [iv, authTag, tamperedByte.toString('base64')].join(':');
    expect(() => decryptField(tampered)).toThrow();
  });

  it('throws on a malformed value instead of silently returning garbage', () => {
    expect(() => decryptField('not-a-valid-encoded-value')).toThrow();
  });
});

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashToken('abc123')).toBe(hashToken('abc123'));
  });

  it('differs for different input', () => {
    expect(hashToken('abc123')).not.toBe(hashToken('abc124'));
  });

  it('never returns the raw input', () => {
    expect(hashToken('my-secret-token')).not.toContain('my-secret-token');
  });
});

describe('generateOpaqueToken', () => {
  it('generates a high-entropy, unique value each call', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(64);
  });
});
