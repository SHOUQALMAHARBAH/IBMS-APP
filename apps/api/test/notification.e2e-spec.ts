import { describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/*
 * `GET /notifications` — the derived notification centre.
 *
 * The route takes no permission on purpose, so the thing worth proving end to
 * end is that the CONTENT is still gated: a reader is only told about work
 * they could already open, and a source they lack the permission for is
 * absent from the payload entirely rather than merely hidden by the client.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface FeedBody {
  items: { kind: string; count: number; severity: string; href: string }[];
  total: number;
}

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Notification E2E User', email, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await ensureRole(roleName);
    const activeGrant = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!activeGrant) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

async function feedFor(
  app: INestApplication<App>,
  token: string,
): Promise<FeedBody> {
  const res = await request(app.getHttpServer())
    .get('/notifications')
    .set(bearer(token))
    .expect(200);
  return res.body as FeedBody;
}

describe('Notifications (e2e) — the derived notification centre', () => {
  it('answers every signed-in reader, and gates the CONTENT by permission', async () => {
    const app = await boot();

    // A Sales Officer holds none of the book-wide permissions.
    const sales = await makeUser(
      app,
      'notif-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const salesFeed = await feedFor(app, sales.accessToken);
    const salesKinds = salesFeed.items.map((i) => i.kind);

    // Not a 403: a notification centre that refuses most roles is not one.
    // But nothing book-wide is in it — an AML count is itself a signal about
    // the book, so its ABSENCE is the assertion, not a client-side filter.
    expect(salesKinds).not.toContain('aml_alert');
    expect(salesKinds).not.toContain('screening_match');
    expect(salesKinds).not.toContain('claim_followup');

    // A Compliance Officer holds aml.monitor and sanctions-pep.screen, so
    // those sources become reachable. Whether they have a non-zero count
    // depends on the accumulated test database, so this asserts the SHAPE
    // rather than a number that another spec's fixtures could change.
    const compliance = await makeUser(app, 'notif-comp', 'COMPLIANCE_OFFICER');
    const compFeed = await feedFor(app, compliance.accessToken);
    for (const item of compFeed.items) {
      expect(Object.keys(item).sort()).toEqual([
        'count',
        'href',
        'kind',
        'severity',
      ]);
      // Counts only. No customer name, no claim narrative, no row id — this
      // payload renders on every page load and must not be a
      // sensitive-data-access event.
      expect(item.count).toBeGreaterThan(0);
      expect(item.href.startsWith('/')).toBe(true);
    }

    // `total` is the work, not the number of sources.
    expect(compFeed.total).toBe(
      compFeed.items.reduce((sum, i) => sum + i.count, 0),
    );
  });

  it('refuses an unauthenticated caller', async () => {
    const app = await boot();
    await request(app.getHttpServer()).get('/notifications').expect(401);
  });
});
