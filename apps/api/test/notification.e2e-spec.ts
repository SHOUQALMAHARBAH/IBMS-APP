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

  it('DEFECT 2 — a KYC file awaiting a decision reaches whoever may DECIDE it', async () => {
    // `docs/kyc-path.md` defect 2, and the heavier half of the pair that left a customer NEVER
    // ACTIVATED. The only pending-KYC source was scoped to the customer's OWNER — the Sales officer who
    // captured the file — so a clean file waiting for approval announced itself to nobody who could
    // approve it, and the only thing that ever summoned a Compliance Officer was a match already
    // raised.
    const app = await boot();

    // The count BEFORE, read by the person the notification is for, so the assertion below can be a
    // delta. See it for why a floor could not tell this count from one over already-decided files.
    const compliance = await makeUser(
      app,
      'notif-kyc-comp',
      'COMPLIANCE_OFFICER',
    );
    const before =
      (await feedFor(app, compliance.accessToken)).items.find(
        (i) => i.kind === 'kyc_awaiting_decision',
      )?.count ?? 0;

    // A Sales Officer captures a customer and submits its KYC file for review. Through real HTTP, so
    // the count is derived from a record the application actually wrote.
    const sales = await makeUser(
      app,
      'notif-kyc-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const customer = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'INDIVIDUAL',
        givenName: 'Awaiting',
        familyName: 'Decision',
        nationalId: `${Date.now()}`.slice(0, 10),
        contactPhone: '+962-7-5550000',
        contactEmail: `awaiting-${Date.now()}@example.test`,
        languagePreference: 'AR',
      })
      .expect(201);

    const kyc = await request(app.getHttpServer())
      .post(`/customers/${(customer.body as { id: string }).id}/kyc`)
      .set(bearer(sales.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/kyc-records/${(kyc.body as { id: string }).id}/submit`)
      .set(bearer(sales.accessToken))
      .expect(201);

    // THE COMPLIANCE OFFICER IS TOLD, and by EXACTLY ONE MORE than before this file was submitted.
    //
    // A DELTA, not a floor. `>= 1` was the first version and it could not observe its own claim: db-test
    // is cumulative and already holds decided files, so a count switched to APPROVED/REJECTED still
    // satisfied it — the plant for exactly that change killed nothing, which is how the weakness
    // surfaced. A delta of one is true only for a count over the AWAITING set. Safe to measure this way
    // because api e2e specs share one database and do not run concurrently.
    const compFeed = await feedFor(app, compliance.accessToken);
    const awaiting = compFeed.items.find(
      (i) => i.kind === 'kyc_awaiting_decision',
    );
    expect(awaiting).toBeDefined();
    expect(awaiting!.count).toBe(before + 1);
    expect(awaiting!.href).toBe('/customers/kyc-queue');
    expect(awaiting!.severity).toBe('action');

    // AND THE SALES OFFICER IS NOT — not through this source. They keep the owner-scoped one, which
    // tells them something true about their own book; the two answer different questions and both
    // stand. Without this half, "add a notification" would pass by sending it to everybody.
    const salesFeed = await feedFor(app, sales.accessToken);
    const salesKinds = salesFeed.items.map((i) => i.kind);
    expect(salesKinds).not.toContain('kyc_awaiting_decision');
    // Anchored: the owner-scoped source IS in their feed, so the absence above is the permission gate
    // rather than an empty feed. The customer they just created is PENDING_KYC and owned by them.
    expect(salesKinds).toContain('customer_pending_kyc');
  });

  it('refuses an unauthenticated caller', async () => {
    const app = await boot();
    await request(app.getHttpServer()).get('/notifications').expect(401);
  });
});
