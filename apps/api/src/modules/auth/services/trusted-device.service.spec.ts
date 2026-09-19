import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { TrustedDeviceService } from './trusted-device.service';
import { MfaService } from './mfa.service';
import { authenticator } from 'otplib';
import {
  roleSecurityAttributes,
  type RoleSecurityAttributes,
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

/** What a Sales Officer's roles resolve to: neither obligation. */
const STANDARD: RoleSecurityAttributes = {
  requiresMfaAlways: false,
  requiresHardwareToken: false,
};

/** What an administrator's, Compliance Officer's or DPO's roles resolve to. */
const ALWAYS_MFA: RoleSecurityAttributes = {
  requiresMfaAlways: true,
  requiresHardwareToken: true,
};

/** Executive Management and Branch/Department Manager — privileged for the
 *  WebAuthn fast-follow, but §4.4 deliberately leaves them the trusted-device
 *  convenience. The one combination that proves the two flags are independent. */
const PRIVILEGED_ONLY: RoleSecurityAttributes = {
  requiresMfaAlways: false,
  requiresHardwareToken: true,
};

beforeAll(() => {
  // `MfaService` encrypts the TOTP secret with this key, same as the existing
  // mfa.service.spec.
  process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

describe('roleSecurityAttributes (Part II §4.4 / Part 10.1)', () => {
  // These used to be two hard-coded lists of role NAMES, which is why this
  // block used to assert their contents. The membership question now belongs to
  // the data: `packages/db/prisma/seed-data/roles.spec.ts` asserts the seed
  // agrees with the two specs, and
  // `apps/api/test/role-security-attributes.e2e-spec.ts` asserts the migrated
  // database does. What is left here is the resolution RULE.

  it('imposes an obligation carried by ANY role held', () => {
    // One strict role plus one relaxed role is strict. The alternative —
    // requiring every role to agree — would let an administrator weaken a
    // privileged account by granting it an extra ordinary role, which is
    // backwards.
    expect(roleSecurityAttributes([STANDARD, ALWAYS_MFA])).toEqual({
      requiresMfaAlways: true,
      requiresHardwareToken: true,
    });
    expect(roleSecurityAttributes([ALWAYS_MFA, STANDARD])).toEqual({
      requiresMfaAlways: true,
      requiresHardwareToken: true,
    });
  });

  it('keeps the two obligations independent', () => {
    // The Executive / Manager case. If these two flags were ever collapsed into
    // one, both roles would lose the trusted-device option and nothing else in
    // the suite would fail.
    expect(roleSecurityAttributes([PRIVILEGED_ONLY])).toEqual({
      requiresMfaAlways: false,
      requiresHardwareToken: true,
    });
  });

  it('imposes nothing when no role is held', () => {
    // Unchanged from the name-list behaviour, and safe for the same reason: an
    // account with no roles resolves no permissions either, so there is nothing
    // for a skipped prompt to reach.
    expect(roleSecurityAttributes([])).toEqual({
      requiresMfaAlways: false,
      requiresHardwareToken: false,
    });
  });

  it('resolves a role the code has never heard of as STRICT, because the column does', () => {
    // The fail-open bug, stated as a test. A role an office invents carries
    // `requiresMfaAlways: true` out of the database (the column default), so it
    // arrives here strict — where a name list would not have matched it at all.
    const custom: RoleSecurityAttributes = {
      requiresMfaAlways: true,
      requiresHardwareToken: true,
    };
    expect(roleSecurityAttributes([custom]).requiresMfaAlways).toBe(true);
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

  it('NEVER skips for an always-MFA caller, even with a live trust', async () => {
    const { service, mocks } = build({
      findLiveForUser: vi.fn().mockResolvedValue({ id: 'td-1' }),
    });
    await expect(
      service.maySkipMfa('u1', ALWAYS_MFA, { fingerprint: 'abc' }),
    ).resolves.toBe(false);
    // Only `requiresMfaAlways` decides — asserted separately so the two flags
    // cannot quietly become one.
    await expect(
      service.maySkipMfa(
        'u1',
        { requiresMfaAlways: true, requiresHardwareToken: false },
        { fingerprint: 'abc' },
      ),
    ).resolves.toBe(false);
    // It does not even look: the obligation decides before the device does.
    expect(mocks.findLiveForUser).not.toHaveBeenCalled();
  });

  it('DOES skip for a privileged-but-not-always-MFA caller', async () => {
    // Executive Management and Branch/Department Manager. This is the test that
    // fails if the hardware-token flag is ever used to answer the §4.4
    // question.
    const { service } = build({
      findLiveForUser: vi.fn().mockResolvedValue({ id: 'td-1' }),
    });
    await expect(
      service.maySkipMfa('u1', PRIVILEGED_ONLY, { fingerprint: 'abc' }),
    ).resolves.toBe(true);
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

  it('refuses an always-MFA caller server-side, whatever the client sent', async () => {
    // §4.4 says the checkbox must not render for them; a control that only
    // exists in the UI is not a control.
    const { service, mocks } = build();
    await expect(
      service.trust('u1', ALWAYS_MFA, { fingerprint: 'abc' }),
    ).resolves.toBeNull();
    await expect(
      service.trust(
        'u1',
        { requiresMfaAlways: true, requiresHardwareToken: false },
        { fingerprint: 'abc' },
      ),
    ).resolves.toBeNull();
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it('grants to a privileged-but-not-always-MFA caller', async () => {
    const { service, mocks } = build();
    await expect(
      service.trust('u1', PRIVILEGED_ONLY, { fingerprint: 'abc' }),
    ).resolves.not.toBeNull();
    expect(mocks.grant).toHaveBeenCalled();
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
