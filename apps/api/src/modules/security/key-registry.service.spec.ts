import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { KeyRegistryService } from './key-registry.service';

function key32(): string {
  return randomBytes(32).toString('base64');
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.PII_ENCRYPTION_KEYS;
  delete process.env.PII_ENCRYPTION_ACTIVE_KEY_ID;
});

describe('KeyRegistryService', () => {
  it('throws if PII_ENCRYPTION_KEYS is unset', () => {
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    expect(() => new KeyRegistryService()).toThrow(/PII_ENCRYPTION_KEYS/);
  });

  it('throws if PII_ENCRYPTION_ACTIVE_KEY_ID is unset', () => {
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    expect(() => new KeyRegistryService()).toThrow(
      /PII_ENCRYPTION_ACTIVE_KEY_ID/,
    );
  });

  it('throws on a key that does not base64-decode to 32 bytes', () => {
    process.env.PII_ENCRYPTION_KEYS = 'v1:dG9vLXNob3J0'; // "too-short"
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    expect(() => new KeyRegistryService()).toThrow(/32 bytes/);
  });

  it('throws if the active key id is not among the configured keys', () => {
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v2';
    expect(() => new KeyRegistryService()).toThrow(/not present/);
  });

  it('exposes the active key by id', () => {
    const v1 = key32();
    process.env.PII_ENCRYPTION_KEYS = `v1:${v1}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const registry = new KeyRegistryService();
    const active = registry.getActiveKey();
    expect(active.keyId).toBe('v1');
    expect(active.key.toString('base64')).toBe(v1);
  });

  it('supports rotation: a retired key is still resolvable for decrypt while a new key becomes active', () => {
    const v1 = key32();
    const v2 = key32();
    process.env.PII_ENCRYPTION_KEYS = `v1:${v1},v2:${v2}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v2';
    const registry = new KeyRegistryService();
    expect(registry.getActiveKey().keyId).toBe('v2');
    expect(registry.getKey('v1').toString('base64')).toBe(v1);
    expect(registry.getKey('v2').toString('base64')).toBe(v2);
  });

  it('throws when asked for a key id it does not know', () => {
    process.env.PII_ENCRYPTION_KEYS = `v1:${key32()}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v1';
    const registry = new KeyRegistryService();
    expect(() => registry.getKey('v99')).toThrow(/Unknown encryption key/);
  });

  it('lists key metadata (id + active flag) without exposing key material', () => {
    const v1 = key32();
    const v2 = key32();
    process.env.PII_ENCRYPTION_KEYS = `v1:${v1},v2:${v2}`;
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'v2';
    const registry = new KeyRegistryService();
    const metadata = registry.listKeyMetadata();
    expect(metadata).toEqual(
      expect.arrayContaining([
        { keyId: 'v1', active: false },
        { keyId: 'v2', active: true },
      ]),
    );
    expect(JSON.stringify(metadata)).not.toContain(v1);
    expect(JSON.stringify(metadata)).not.toContain(v2);
  });
});
