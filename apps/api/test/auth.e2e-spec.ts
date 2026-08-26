import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string; email: string; mfaEnabled: boolean };
}
interface MfaChallengeBody {
  mfaRequired: true;
  mfaChallengeToken: string;
}
interface MeBody {
  email: string;
  mfaEnabled: boolean;
}
interface ForgotPasswordBody {
  devResetToken?: string;
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface SecurityConfigBody {
  idleTimeoutMinutes: number;
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}

async function signup(
  app: INestApplication<App>,
  email: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Test User', email, password: PASSWORD })
    .expect(201);
}

/** Signs up + logs in (no MFA) and returns a cookie-jar-backed agent plus the access token. */
async function signupAndLogin(app: INestApplication<App>, email: string) {
  await signup(app, email);
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = res.body as IssuedSessionBody;
  return { agent, accessToken: body.accessToken, userId: body.user.id };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Extracts the base32 TOTP secret embedded in an otpauth:// enrollment URI. */
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

/** Enrolls + verifies TOTP MFA for an already-authenticated user. */
async function enrollMfa(
  app: INestApplication<App>,
  accessToken: string,
): Promise<void> {
  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  const secret = secretFromOtpAuthUri(enrollBody.otpAuthUri);
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('signup → login → me → refresh → logout', () => {
    it('completes the full non-MFA session lifecycle', async () => {
      const app = await boot();
      const email = uniqueEmail('lifecycle');
      const { agent, accessToken } = await signupAndLogin(app, email);

      const me = await agent
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(200);
      const meBody = me.body as MeBody;
      expect(meBody.email).toBe(email);
      expect(meBody.mfaEnabled).toBe(false);

      const refreshed = await agent.post('/auth/refresh').expect(200);
      const refreshedBody = refreshed.body as { accessToken: string };
      expect(refreshedBody.accessToken).toBeTypeOf('string');
      // Not asserting the new JWT differs byte-for-byte from the old one:
      // with identical claims (sub, sid) and second-granularity `iat`, a
      // refresh issued within the same wall-clock second as login can be a
      // legitimately identical token — the rotated *refresh* token (opaque,
      // always fresh, verified by the reuse-detection test below) is the
      // real rotation guarantee.

      // the new access token works...
      await agent
        .get('/auth/me')
        .set(bearer(refreshedBody.accessToken))
        .expect(200);

      await agent
        .post('/auth/logout')
        .set(bearer(refreshedBody.accessToken))
        .expect(200);

      // ...and a refresh after logout is rejected (session revoked).
      await agent.post('/auth/refresh').expect(401);
    });

    it('rejects requests with no access token', async () => {
      const app = await boot();
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('rejects a rotated-out (reused) refresh token and kills the whole session', async () => {
      const app = await boot();
      const email = uniqueEmail('reuse');
      const server = app.getHttpServer();
      await signup(app, email);

      const loginRes = await request(server)
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const originalCookie = loginRes.headers[
        'set-cookie'
      ] as unknown as string[];
      expect(originalCookie).toBeDefined();

      // Rotate once using the original cookie — it becomes stale/revoked.
      const rotated = await request(server)
        .post('/auth/refresh')
        .set('Cookie', originalCookie)
        .expect(200);
      expect(rotated.headers['set-cookie']).toBeDefined();

      // Presenting the pre-rotation cookie again is refresh-token reuse —
      // must be rejected, and it should take the whole session down with it.
      await request(server)
        .post('/auth/refresh')
        .set('Cookie', originalCookie)
        .expect(401);
      const rotatedCookie = rotated.headers[
        'set-cookie'
      ] as unknown as string[];
      await request(server)
        .post('/auth/refresh')
        .set('Cookie', rotatedCookie)
        .expect(401);
    });
  });

  describe('password policy + account lockout', () => {
    it('rejects a weak password at signup', async () => {
      const app = await boot();
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          fullName: 'Weak Pass',
          email: uniqueEmail('weak'),
          password: 'short',
        })
        .expect(400);
    });

    it('rejects wrong credentials and locks the account after repeated failures', async () => {
      const app = await boot();
      const email = uniqueEmail('lockout');
      await signup(app, email);
      const config = await prisma.securityConfig.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default' },
      });

      for (let i = 0; i < config.maxFailedLoginAttempts; i += 1) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'definitely-wrong' })
          .expect(401);
      }

      // Now locked — even the correct password is rejected.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(403);
    });
  });

  describe('forgot / reset password', () => {
    it('issues a dev reset token and allows a one-time password reset', async () => {
      const app = await boot();
      const email = uniqueEmail('reset');
      await signup(app, email);

      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(200);
      const forgotBody = forgot.body as ForgotPasswordBody;
      expect(forgotBody.devResetToken).toBeTypeOf('string');
      const devResetToken = forgotBody.devResetToken as string;

      const newPassword = 'A-Brand-New-Passw0rd!';
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: devResetToken, newPassword })
        .expect(200);

      // Old password no longer works, new one does.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: newPassword })
        .expect(200);

      // The reset token is single-use.
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: devResetToken, newPassword: 'Another-Passw0rd!' })
        .expect(400);
    });

    it('returns the same shape for an unknown email (no account enumeration)', async () => {
      const app = await boot();
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: uniqueEmail('nonexistent') })
        .expect(200);
      expect((res.body as ForgotPasswordBody).devResetToken).toBeUndefined();
    });
  });

  describe('mandatory MFA enrollment + login challenge', () => {
    it('blocks MFA-gated routes until enrolled, then requires a code at login', async () => {
      const app = await boot();
      const email = uniqueEmail('mfa');
      const { agent, accessToken } = await signupAndLogin(app, email);

      // step-up is not exempt from MfaRequiredGuard — enforces "mandatory for everyone".
      await agent
        .post('/auth/step-up')
        .set(bearer(accessToken))
        .send({ password: PASSWORD })
        .expect(403);

      const enroll = await agent
        .post('/auth/mfa/totp/enroll')
        .set(bearer(accessToken))
        .expect(201);
      const enrollBody = enroll.body as MfaEnrollBody;
      const secret = secretFromOtpAuthUri(enrollBody.otpAuthUri);

      await agent
        .post('/auth/mfa/totp/enroll/verify')
        .set(bearer(accessToken))
        .send({
          credentialId: enrollBody.credentialId,
          code: authenticator.generate(secret),
        })
        .expect(200);

      const me = await agent
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(200);
      expect((me.body as MeBody).mfaEnabled).toBe(true);

      // Now previously-blocked routes work.
      await agent
        .post('/auth/step-up')
        .set(bearer(accessToken))
        .send({ password: PASSWORD, code: authenticator.generate(secret) })
        .expect(200);

      // A fresh login now requires the second factor.
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const loginBody = login.body as MfaChallengeBody;
      expect(loginBody.mfaRequired).toBe(true);
      expect(loginBody.mfaChallengeToken).toBeTypeOf('string');

      await request(app.getHttpServer())
        .post('/auth/mfa/totp/challenge/verify')
        .send({
          mfaChallengeToken: loginBody.mfaChallengeToken,
          code: '000000',
        })
        .expect(401);

      const completed = await request(app.getHttpServer())
        .post('/auth/mfa/totp/challenge/verify')
        .send({
          mfaChallengeToken: loginBody.mfaChallengeToken,
          code: authenticator.generate(secret),
        })
        .expect(200);
      expect((completed.body as IssuedSessionBody).accessToken).toBeTypeOf(
        'string',
      );
    });
  });

  describe('External Auditor time-boxed access (Part 5.1)', () => {
    it('revokes an already-active session the moment accessValidUntil passes', async () => {
      const app = await boot();
      const email = uniqueEmail('auditor');
      const { accessToken, userId } = await signupAndLogin(app, email);

      // Sanity check: works before the window closes.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(200);

      await prisma.user.update({
        where: { id: userId },
        data: { accessValidUntil: new Date(Date.now() - 1000) },
      });

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(401);
      expect((res.body as { code: string }).code).toBe('ACCESS_WINDOW_EXPIRED');

      const auditEntry = await prisma.auditLogEntry.findFirst({
        where: { userId, action: 'ACCESS_WINDOW_EXPIRED' },
      });
      expect(auditEntry).not.toBeNull();
    });
  });

  describe('RBAC — security config admin endpoint', () => {
    it('is forbidden for an ordinary user and allowed for SYSTEM_SECURITY_ADMINISTRATOR', async () => {
      const app = await boot();
      // Both users enroll MFA first — otherwise MfaRequiredGuard (which
      // runs before RolesGuard in the guard chain) would block them with
      // 403 MFA_ENROLLMENT_REQUIRED regardless of role, and this test
      // wouldn't actually be isolating RBAC behavior.
      const plainEmail = uniqueEmail('plain');
      const { accessToken: plainToken } = await signupAndLogin(app, plainEmail);
      await enrollMfa(app, plainToken);
      await request(app.getHttpServer())
        .get('/auth/security-config')
        .set(bearer(plainToken))
        .expect(403);

      const adminEmail = uniqueEmail('admin');
      const { accessToken: adminToken, userId: adminId } = await signupAndLogin(
        app,
        adminEmail,
      );
      await enrollMfa(app, adminToken);
      const role = await prisma.role.upsert({
        where: { name: 'SYSTEM_SECURITY_ADMINISTRATOR' },
        update: {},
        create: { name: 'SYSTEM_SECURITY_ADMINISTRATOR' },
      });
      await prisma.userRoleAssignment.create({
        data: { userId: adminId, roleId: role.id },
      });

      // Roles are read fresh from the DB on each request (see UserRepository.getRoleNames) —
      // no re-login needed for the new assignment to take effect.
      const res = await request(app.getHttpServer())
        .get('/auth/security-config')
        .set(bearer(adminToken))
        .expect(200);
      expect((res.body as SecurityConfigBody).idleTimeoutMinutes).toBeTypeOf(
        'number',
      );
    });
  });

  describe('SSO stub', () => {
    it('returns 501 for any provider — no IdP is configured', async () => {
      const app = await boot();
      await request(app.getHttpServer())
        .post('/auth/sso/azure-ad/callback')
        .send({})
        .expect(501);
    });
  });
});
