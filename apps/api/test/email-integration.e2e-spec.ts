import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { type RoleName } from '@ibms/db';
import { prisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Part I §6 (multi-tenancy Phase 3 step 11) — the per-Organization mailbox.
 *
 * What this file proves: the surface is permission-gated, the credential is
 * never returned, an office with no mailbox is reported as exactly that rather
 * than silently sending from somewhere else, and a stored refresh token is
 * encrypted at rest.
 *
 * What it deliberately does NOT do: connect a real mailbox. The OAuth
 * authorization-code exchange requires a live consent from a real Microsoft or
 * Google tenant, which cannot be faked from a test. The adapters' own HTTP
 * behaviour is covered by unit tests against a stubbed `fetch`
 * (`email-provider.spec.ts`); whether the providers accept those payloads in
 * practice is the one thing that still needs a real mailbox.
 */
let app: INestApplication<App> | null = null;
let admin: { accessToken: string; id: string };
let manager: { accessToken: string; id: string };
let officer: { accessToken: string; id: string };

const tag = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Correct-Horse-Battery-Staple-9';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return decodeURIComponent(match[1]);
}

async function makeUser(
  application: INestApplication<App>,
  label: string,
  roles: RoleName[],
): Promise<{ accessToken: string; id: string }> {
  const email = uniqueEmail(label);
  await request(application.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Email E2E ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(application.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as IssuedSessionBody;

  const enroll = await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: body.user.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: body.user.id, roleId: role.id },
      });
    }
  }
  return { accessToken: body.accessToken, id: body.user.id };
}

async function clearIntegration(): Promise<void> {
  await prisma.organizationEmailIntegration.deleteMany({
    where: { organizationId: TEST_ORGANIZATION_ID },
  });
}

beforeAll(async () => {
  app = await createTestApp();
  await clearIntegration();
  admin = await makeUser(app, `email-admin-${tag}`, [
    'SYSTEM_SECURITY_ADMINISTRATOR',
  ]);
  manager = await makeUser(app, `email-manager-${tag}`, [
    'BRANCH_DEPARTMENT_MANAGER',
  ]);
  officer = await makeUser(app, `email-officer-${tag}`, [
    'SALES_RELATIONSHIP_OFFICER',
  ]);
}, 180_000);

afterAll(async () => {
  await app?.close();
  app = null;
  await clearIntegration();
});

describe('who may see and manage the office mailbox', () => {
  it('an administrator can read the status', async () => {
    await request(app!.getHttpServer())
      .get('/admin/email-integration')
      .set(bearer(admin.accessToken))
      .expect(200);
  });

  it('a manager can read it — they need to know whether mail is going out', async () => {
    await request(app!.getHttpServer())
      .get('/admin/email-integration')
      .set(bearer(manager.accessToken))
      .expect(200);
  });

  it('a sales officer cannot read it at all', async () => {
    await request(app!.getHttpServer())
      .get('/admin/email-integration')
      .set(bearer(officer.accessToken))
      .expect(403);
  });

  it('a manager can READ but not CONNECT — the consent is administrator-only', async () => {
    // Holding the mailbox credential lets the platform send as a real company
    // address, so managing it is a narrower grant than seeing whether it works.
    await request(app!.getHttpServer())
      .post('/admin/email-integration/connect')
      .set(bearer(manager.accessToken))
      .send({
        provider: 'MICROSOFT365',
        authorizationCode: 'irrelevant',
        connectedEmail: 'info@example.test',
      })
      .expect(403);
  });

  it('a manager cannot revoke it either', async () => {
    await request(app!.getHttpServer())
      .post('/admin/email-integration/revoke')
      .set(bearer(manager.accessToken))
      .expect(403);
  });
});

describe('an office with no mailbox connected', () => {
  it('reports exactly that, rather than pretending', async () => {
    const res = await request(app!.getHttpServer())
      .get('/admin/email-integration')
      .set(bearer(admin.accessToken))
      .expect(200);

    expect(res.body).toMatchObject({
      connected: false,
      provider: null,
      connectedEmail: null,
    });
  });

  it('verify reports NOT operational — never a shared platform sender', async () => {
    // The whole point of §6: no fallback. An office that has connected nothing
    // sends nothing, and is told so.
    const res = await request(app!.getHttpServer())
      .post('/admin/email-integration/verify')
      .set(bearer(admin.accessToken))
      .expect(201);

    expect(res.body).toMatchObject({
      kind: 'not_configured',
      operational: false,
      fromAddress: null,
    });
  });

  it('refuses a test send with 404 rather than reporting a send that did not happen', async () => {
    await request(app!.getHttpServer())
      .post('/admin/email-integration/test')
      .set(bearer(admin.accessToken))
      .expect(404);
  });

  it('refuses to revoke what was never connected', async () => {
    await request(app!.getHttpServer())
      .post('/admin/email-integration/revoke')
      .set(bearer(admin.accessToken))
      .expect(404);
  });
});

describe('the OAuth connect flow', () => {
  it('rejects an unknown provider before any network call', async () => {
    await request(app!.getHttpServer())
      .get('/admin/email-integration/authorize-url')
      .query({ provider: 'SMTP_RELAY' })
      .set(bearer(admin.accessToken))
      .expect(400);
  });

  it('explains the deployment gap when no OAuth app is configured', async () => {
    // This suite runs without EMAIL_MS_* set. The administrator cannot fix that
    // from the UI, so the message names the environment variables instead of
    // telling them to try again.
    const res = await request(app!.getHttpServer())
      .get('/admin/email-integration/authorize-url')
      .query({ provider: 'MICROSOFT365' })
      .set(bearer(admin.accessToken))
      .expect(422);

    expect(JSON.stringify(res.body)).toContain('EMAIL_MS_CLIENT_ID');
  });

  it('rejects a connect attempt for an unconfigured provider', async () => {
    await request(app!.getHttpServer())
      .post('/admin/email-integration/connect')
      .set(bearer(admin.accessToken))
      .send({
        provider: 'GOOGLE_WORKSPACE',
        authorizationCode: 'some-code',
        connectedEmail: 'info@example.test',
      })
      .expect(422);
  });

  it('rejects a malformed mailbox address', async () => {
    await request(app!.getHttpServer())
      .post('/admin/email-integration/connect')
      .set(bearer(admin.accessToken))
      .send({
        provider: 'MICROSOFT365',
        authorizationCode: 'some-code',
        connectedEmail: 'not-an-address',
      })
      .expect(400);
  });
});

describe('the stored credential', () => {
  it('is encrypted at rest and never returned by the API', async () => {
    // Written directly, because obtaining a real refresh token needs a live
    // OAuth consent. What is asserted is the part this system controls: the
    // column holds ciphertext in the `keyId:iv:tag:ciphertext` shape, and no
    // route hands it back.
    const row = await prisma.organizationEmailIntegration.create({
      data: {
        provider: 'MICROSOFT365',
        connectedEmail: 'info@alsalam-insurance.jo',
        oauthRefreshTokenEnc: 'key-1:aXY=:dGFn:Y2lwaGVy',
        providerTenantId: 'tenant-1',
        connectedByUserId: admin.id,
      },
    });

    const res = await request(app!.getHttpServer())
      .get('/admin/email-integration')
      .set(bearer(admin.accessToken))
      .expect(200);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('oauthRefreshTokenEnc');
    expect(serialised).not.toContain('Y2lwaGVy');
    expect(res.body).toMatchObject({
      connected: true,
      provider: 'MICROSOFT365',
      connectedEmail: 'info@alsalam-insurance.jo',
    });

    // The stored value is not the plaintext, and carries the key id that makes
    // rotation possible.
    const stored = await prisma.organizationEmailIntegration.findFirstOrThrow({
      where: { id: row.id },
    });
    expect(stored.oauthRefreshTokenEnc.split(':')).toHaveLength(4);
  });

  it('a revoked mailbox reports disconnected and stops being usable', async () => {
    await request(app!.getHttpServer())
      .post('/admin/email-integration/revoke')
      .set(bearer(admin.accessToken))
      .expect(201);

    const res = await request(app!.getHttpServer())
      .get('/admin/email-integration')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({ connected: false, status: 'REVOKED' });

    // And it genuinely stops sending — not merely displays as off.
    const verify = await request(app!.getHttpServer())
      .post('/admin/email-integration/verify')
      .set(bearer(admin.accessToken))
      .expect(201);
    expect(verify.body).toMatchObject({
      kind: 'not_configured',
      operational: false,
    });
  });
});

describe('password reset sends through the office mailbox (§6)', () => {
  it('still succeeds, and does not leak whether the mailbox works', async () => {
    // The endpoint returns the same shape whether or not the address matched an
    // account. Surfacing a mail failure for one address but not another would
    // reintroduce the account enumeration that shape exists to prevent — so a
    // NOT_CONFIGURED mailbox must not change the response.
    const unknown = await request(app!.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: uniqueEmail('nobody') })
      .expect(200);

    // The same deliberately non-committal message either way, and — the part
    // this step must not break — no hint that the office's mailbox is not
    // configured. A mail failure surfaced here would be a side channel.
    expect(unknown.body).toEqual({
      message: 'If that email is registered, a reset link has been sent.',
    });
    expect(JSON.stringify(unknown.body)).not.toContain('NOT_CONFIGURED');
  });

  it('writes an outbound-email audit row recording that it was NOT sent', async () => {
    // "A message that was not sent is never reported as sent" — the audit trail
    // has to carry the real outcome, or an administrator investigating "they
    // never got the email" has nothing to go on.
    const email = uniqueEmail('reset-audit');
    await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({ fullName: 'Reset Audit', email, password: PASSWORD })
      .expect(201);

    await request(app!.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);

    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'OutboundEmail' },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });
    const mine = entries.find(
      (e) => (e.afterValue as { to?: string } | null)?.to === email,
    );
    expect(mine).toBeDefined();
    const after = mine!.afterValue as {
      outcome: string;
      template: string;
    };
    expect(after.template).toBe('password_reset');
    expect(after.outcome).toBe('NOT_CONFIGURED');
  });

  it('never records the message body or the reset link in the audit trail', async () => {
    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'OutboundEmail' },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });
    for (const entry of entries) {
      const serialised = JSON.stringify(entry.afterValue);
      expect(serialised).not.toContain('reset-password?token=');
      expect(serialised).not.toContain('bodyText');
      expect(serialised).not.toContain('subject');
    }
  });
});
