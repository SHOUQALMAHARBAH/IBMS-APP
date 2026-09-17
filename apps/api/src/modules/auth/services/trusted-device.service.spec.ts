import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { RoleName } from '@ibms/db';
import { TrustedDeviceService } from './trusted-device.service';
import { MfaService } from './mfa.service';
import { authenticator } from 'otplib';
import {
  ALWAYS_MFA_ROLES,
  PRIVILEGED_ROLES,
  alwaysRequiresMfa,
} from '../auth.types';
import type { TrustedDeviceRepository } from '../../../repositories/trusted-device.repository';
import type { AuditService } from '../../audit/audit.service';

function build(overrides: Record<string, unknown> = {}) {
  // The plain mock object is returned alongside the cast repository: asserting
  // against a method read off a typed class trips `unbound-method`, and these
  // are `vi.fn()`s, not methods.
  const mocks = {
    findLiveForUser: vi.fn().mockResolvedValue(null),
    touchLastUsed: vi.fn().mockResolvedValue(undefined),
    grant: vi
      .fn()
      .mockImplementation((input: { expiresAt: Date }) =>
        Promise.resolve({ id: 'td-1', label: 'Chrome', ...input }),
      ),
    findById: vi.fn().mockResolvedValue(null),
    revoke: vi.fn().mockResolvedValue(1),
    revokeAllForUser: vi.fn().mockResolvedValue(2),
    listLiveForUser: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const devices = mocks as unknown as TrustedDeviceRepository;
  const auditMock = { record: vi.fn().mockResolvedValue(undefined) };
  const audit = auditMock as unknown as AuditService;
  return {
    service: new TrustedDeviceService(devices, audit),
    devices,
    mocks,
    auditMock,
  };
}

const STANDARD: RoleName[] = ['SALES_RELATIONSHIP_OFFICER'];

beforeAll(() => {
  // `MfaService` encrypts the TOTP secret with this key, same as the existing
  // mfa.service.spec.
  process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

describe('the always-MFA role set (Part II §4.4)', () => {
  it('is exactly the three roles the spec names', () => {
    expect([...ALWAYS_MFA_ROLES].sort()).toEqual([
      'COMPLIANCE_OFFICER',
      'DATA_PROTECTION_OFFICER',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    ]);
  });

  it('is NOT the privileged-role set, and that difference is deliberate', () => {
    // `PRIVILEGED_ROLES` drives step-up and the hardware-token fast-follow, and
    // is wider. Reusing it here would look stricter while quietly taking the
    // trusted-device convenience away from Executive Management and
    // Branch/Department Managers, whom §4.4 leaves as standard roles.
    expect(PRIVILEGED_ROLES).toContain('EXECUTIVE_MANAGEMENT');
    expect(PRIVILEGED_ROLES).toContain('BRANCH_DEPARTMENT_MANAGER');
    expect(ALWAYS_MFA_ROLES).not.toContain('EXECUTIVE_MANAGEMENT');
    expect(ALWAYS_MFA_ROLES).not.toContain('BRANCH_DEPARTMENT_MANAGER');
  });

  it('flags a user holding any one of them, among other roles', () => {
    expect(
      alwaysRequiresMfa(['SALES_RELATIONSHIP_OFFICER', 'COMPLIANCE_OFFICER']),
    ).toBe(true);
    expect(alwaysRequiresMfa(STANDARD)).toBe(false);
    expect(alwaysRequiresMfa([])).toBe(false);
  });
});

describe('TrustedDeviceService.maySkipMfa', () => {
  it('skips the prompt for a standard role on a live trusted device', async () => {
    const { service, mocks } = build({
      findLiveForUser: vi.fn().mockResolvedValue({ id: 'td-1' }),
    });
    await expect(
      service.maySkipMfa('u1', STANDARD, { fingerprint: 'abc' }),
    ).resolves.toBe(true);
    expect(mocks.touchLastUsed).toHaveBeenCalledWith('td-1');
  });

  it('NEVER skips for an always-MFA role, even with a live trust', async () => {
    const { service, mocks } = build({
      findLiveForUser: vi.fn().mockResolvedValue({ id: 'td-1' }),
    });
    for (const role of ALWAYS_MFA_ROLES) {
      await expect(
        service.maySkipMfa('u1', [role], { fingerprint: 'abc' }),
      ).resolves.toBe(false);
    }
    // It does not even look: the role decides before the device does.
    expect(mocks.findLiveForUser).not.toHaveBeenCalled();
  });

  it('does not skip when the request carried no fingerprint', async () => {
    // Absence is not trust.
    const { service } = build({
      findLiveForUser: vi.fn().mockResolvedValue({ id: 'td-1' }),
    });
    await expect(service.maySkipMfa('u1', STANDARD, {})).resolves.toBe(false);
  });

  it('does not skip when nothing live matches the fingerprint', async () => {
    const { service } = build();
    await expect(
      service.maySkipMfa('u1', STANDARD, { fingerprint: 'abc' }),
    ).resolves.toBe(false);
  });
});

describe('TrustedDeviceService.trust', () => {
  it('stores the fingerprint HASHED, never raw', async () => {
    // Raw, this table becomes a device-tracking log of every employee.
    const { service, mocks } = build();
    await service.trust('u1', STANDARD, { fingerprint: 'raw-value' });

    const call = mocks.grant.mock.calls[0][0] as {
      deviceFingerprintHash: string;
    };
    expect(call.deviceFingerprintHash).not.toBe('raw-value');
    expect(call.deviceFingerprintHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an always-MFA role server-side, whatever the client sent', async () => {
    // §4.4 says the checkbox must not render for them; a control that only
    // exists in the UI is not a control.
    const { service, mocks } = build();
    for (const role of ALWAYS_MFA_ROLES) {
      await expect(
        service.trust('u1', [role], { fingerprint: 'abc' }),
      ).resolves.toBeNull();
    }
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it('refuses when no fingerprint was supplied', async () => {
    const { service, mocks } = build();
    await expect(service.trust('u1', STANDARD, {})).resolves.toBeNull();
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it('audits the grant WITHOUT recording the fingerprint', async () => {
    const { service, auditMock } = build();
    await service.trust('u1', STANDARD, {
      fingerprint: 'raw-value',
      userAgent: 'Chrome',
    });

    const serialised = JSON.stringify(auditMock.record.mock.calls[0][0]);
    expect(serialised).not.toContain('raw-value');
    expect(serialised).not.toContain('deviceFingerprintHash');
  });

  it('expires the grant 30 days out by default', async () => {
    const { service, mocks } = build();
    const before = Date.now();
    await service.trust('u1', STANDARD, { fingerprint: 'abc' });

    const call = mocks.grant.mock.calls[0][0] as { expiresAt: Date };
    const days = (call.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});

describe('MfaService TOTP tolerance (Part II §4.3.2)', () => {
  const mfa = new MfaService();

  function codeAt(secret: string, offsetSeconds: number): string {
    return authenticator
      .clone({ epoch: Date.now() + offsetSeconds * 1000 })
      .generate(secret);
  }

  it('accepts the current code, and one step either side', () => {
    // A phone whose clock has drifted by a few seconds still works — the
    // "invalid code even though I set it up right" case this exists to fix.
    const secret = mfa.generateTotpSecret();
    const enc = mfa.encryptSecret(secret);

    expect(mfa.verifyCode(codeAt(secret, 0), enc)).toBe(true);
    expect(mfa.verifyCode(codeAt(secret, -30), enc)).toBe(true);
    expect(mfa.verifyCode(codeAt(secret, 30), enc)).toBe(true);
  });

  it('rejects a code 90+ seconds out in either direction', () => {
    const secret = mfa.generateTotpSecret();
    const enc = mfa.encryptSecret(secret);

    expect(mfa.verifyCode(codeAt(secret, -120), enc)).toBe(false);
    expect(mfa.verifyCode(codeAt(secret, 120), enc)).toBe(false);
  });

  it('rejects a code from a different secret', () => {
    const enc = mfa.encryptSecret(mfa.generateTotpSecret());
    expect(mfa.verifyCode(codeAt(mfa.generateTotpSecret(), 0), enc)).toBe(
      false,
    );
  });

  it('returns false rather than throwing on a malformed secret', () => {
    expect(mfa.verifyCode('123456', 'not-a-ciphertext')).toBe(false);
  });
});
