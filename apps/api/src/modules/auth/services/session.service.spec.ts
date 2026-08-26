import { describe, expect, it, vi } from 'vitest';
import type { SecurityConfig, User, UserSession } from '@ibms/db';
import { SessionService } from './session.service';
import {
  AccessWindowExpiredException,
  SessionIdleTimeoutException,
  SessionRevokedException,
} from '../auth.exceptions';

function makeConfig(overrides: Partial<SecurityConfig> = {}): SecurityConfig {
  return {
    id: 'default',
    idleTimeoutMinutes: 15,
    hardLogoutAfterIdleMinutes: 30,
    accessTokenTtlMinutes: 15,
    refreshTokenTtlDays: 14,
    stepUpMaxAgeMinutes: 10,
    maxFailedLoginAttempts: 5,
    lockoutMinutes: 15,
    updatedByUserId: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    refreshTokenId: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    lastStepUpAt: null,
    expiresAt: new Date(Date.now() + 999_999),
    revokedAt: null,
    revokedReason: null,
    ipAddress: null,
    userAgent: null,
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    fullName: 'Test User',
    email: 'test@ibms.test',
    passwordHash: 'x',
    passwordUpdatedAt: new Date(),
    isActive: true,
    languagePreference: 'AR',
    branchId: null,
    employeeId: null,
    authProvider: 'LOCAL',
    mfaEnabled: false,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    accessValidFrom: null,
    accessValidUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(
  opts: {
    session?: UserSession | null;
    user?: User | null;
    config?: SecurityConfig;
  } = {},
) {
  const sessions = {
    findById: vi
      .fn()
      .mockResolvedValue('session' in opts ? opts.session : makeSession()),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
    touchActivity: vi.fn().mockResolvedValue(undefined),
    markSteppedUp: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    findByRefreshTokenId: vi.fn(),
    linkRefreshToken: vi.fn(),
    findActiveByUser: vi.fn(),
  };
  const users = {
    findById: vi
      .fn()
      .mockResolvedValue('user' in opts ? opts.user : makeUser()),
    getRoleNames: vi.fn().mockResolvedValue([]),
  };
  const securityConfig = {
    get: vi.fn().mockResolvedValue(opts.config ?? makeConfig()),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  // SessionService's constructor types expect the full repository/service
  // classes — the mocks above cover every method it actually calls.
  const service = new SessionService(
    sessions as never,
    users as never,
    securityConfig as never,
    audit as never,
  );
  return { service, sessions, users, securityConfig, audit };
}

describe('SessionService.validateAndTouch', () => {
  it('returns the authenticated user and touches activity on the happy path', async () => {
    const { service, sessions } = buildService();
    const result = await service.validateAndTouch('user-1', 'session-1');
    expect(result).toEqual({
      id: 'user-1',
      email: 'test@ibms.test',
      roles: [],
      sessionId: 'session-1',
    });
    expect(sessions.touchActivity).toHaveBeenCalledWith('session-1');
  });

  it('rejects when the session does not exist', async () => {
    const { service } = buildService({ session: null });
    await expect(
      service.validateAndTouch('user-1', 'session-1'),
    ).rejects.toBeInstanceOf(SessionRevokedException);
  });

  it('rejects when the session belongs to a different user', async () => {
    const { service } = buildService({
      session: makeSession({ userId: 'someone-else' }),
    });
    await expect(
      service.validateAndTouch('user-1', 'session-1'),
    ).rejects.toBeInstanceOf(SessionRevokedException);
  });

  it('rejects and revokes when the session is already revoked', async () => {
    const { service, sessions } = buildService({
      session: makeSession({ revokedAt: new Date() }),
    });
    await expect(
      service.validateAndTouch('user-1', 'session-1'),
    ).rejects.toBeInstanceOf(SessionRevokedException);
    expect(sessions.touchActivity).not.toHaveBeenCalled();
  });

  it('rejects and revokes when the user is inactive', async () => {
    const { service, sessions } = buildService({
      user: makeUser({ isActive: false }),
    });
    await expect(
      service.validateAndTouch('user-1', 'session-1'),
    ).rejects.toBeInstanceOf(SessionRevokedException);
    expect(sessions.revoke).toHaveBeenCalledWith('session-1', 'admin_revoked');
  });

  it('rejects, revokes, and audits once accessValidUntil has passed — Part 5.1 auditor time-box', async () => {
    const { service, sessions, audit } = buildService({
      user: makeUser({ accessValidUntil: new Date(Date.now() - 1000) }),
    });
    await expect(
      service.validateAndTouch('user-1', 'session-1'),
    ).rejects.toBeInstanceOf(AccessWindowExpiredException);
    expect(sessions.revoke).toHaveBeenCalledWith(
      'session-1',
      'access_window_expired',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'ACCESS_WINDOW_EXPIRED',
      }),
    );
  });

  it('does not reject when accessValidUntil is still in the future', async () => {
    const { service } = buildService({
      user: makeUser({ accessValidUntil: new Date(Date.now() + 999_999) }),
    });
    await expect(
      service.validateAndTouch('user-1', 'session-1'),
    ).resolves.toBeDefined();
  });

  it('rejects and revokes once idle-timeout minutes have elapsed since lastActivityAt', async () => {
    const { service, sessions } = buildService({
      session: makeSession({
        lastActivityAt: new Date(Date.now() - 16 * 60 * 1000),
      }),
      config: makeConfig({ idleTimeoutMinutes: 15 }),
    });
    await expect(
      service.validateAndTouch('user-1', 'session-1'),
    ).rejects.toBeInstanceOf(SessionIdleTimeoutException);
    expect(sessions.revoke).toHaveBeenCalledWith('session-1', 'idle_timeout');
  });

  it('does not reject when just under the idle-timeout boundary', async () => {
    const { service } = buildService({
      session: makeSession({
        lastActivityAt: new Date(Date.now() - 14 * 60 * 1000),
      }),
      config: makeConfig({ idleTimeoutMinutes: 15 }),
    });
    await expect(
      service.validateAndTouch('user-1', 'session-1'),
    ).resolves.toBeDefined();
  });
});

describe('SessionService.isStepUpFresh', () => {
  it('is false when the session has never stepped up', async () => {
    const { service } = buildService({
      session: makeSession({ lastStepUpAt: null }),
    });
    expect(await service.isStepUpFresh('session-1')).toBe(false);
  });

  it('is true within stepUpMaxAgeMinutes', async () => {
    const { service } = buildService({
      session: makeSession({
        lastStepUpAt: new Date(Date.now() - 5 * 60 * 1000),
      }),
      config: makeConfig({ stepUpMaxAgeMinutes: 10 }),
    });
    expect(await service.isStepUpFresh('session-1')).toBe(true);
  });

  it('is false once past stepUpMaxAgeMinutes', async () => {
    const { service } = buildService({
      session: makeSession({
        lastStepUpAt: new Date(Date.now() - 11 * 60 * 1000),
      }),
      config: makeConfig({ stepUpMaxAgeMinutes: 10 }),
    });
    expect(await service.isStepUpFresh('session-1')).toBe(false);
  });
});

describe('SessionService.requiresHardwareToken', () => {
  it('is true for a privileged role', () => {
    const { service } = buildService();
    expect(
      service.requiresHardwareToken(['SYSTEM_SECURITY_ADMINISTRATOR']),
    ).toBe(true);
    expect(service.requiresHardwareToken(['DATA_PROTECTION_OFFICER'])).toBe(
      true,
    );
  });

  it('is false for a non-privileged role and no roles', () => {
    const { service } = buildService();
    expect(service.requiresHardwareToken(['CLAIMS_OFFICER'])).toBe(false);
    expect(service.requiresHardwareToken([])).toBe(false);
  });
});
