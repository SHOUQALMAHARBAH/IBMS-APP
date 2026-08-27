import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface IdBody {
  id: string;
}
interface InteractionBody {
  id: string;
  customerId: string;
  channel: string;
  summary: string;
  occurredAt: string;
  loggedByUserId: string;
}
interface Customer360Body {
  customer: { id: string; legalName: string; ownerUserId: string };
  interactions: InteractionBody[];
  policies: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  complaints: Array<Record<string, unknown>>;
  timeline: Array<{
    kind: string;
    refId: string;
    title: string;
    detail: string | null;
    status: string | null;
  }>;
  counts: {
    interactions: number;
    policies: number;
    claims: number;
    complaints: number;
  };
}

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

async function signupAndLogin(
  app: INestApplication<App>,
  email: string,
): Promise<{ accessToken: string; userId: string }> {
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'CRM Test User', email, password: PASSWORD })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = res.body as IssuedSessionBody;
  return { accessToken: body.accessToken, userId: body.user.id };
}

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

async function grantRole(userId: string, roleName: RoleName): Promise<void> {
  const role = await prisma.role.upsert({
    where: { name: roleName },
    update: {},
    create: { name: roleName },
  });
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: { revokedAt: null },
    create: { userId, roleId: role.id },
  });
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  const { accessToken, userId } = await signupAndLogin(app, email);
  await enrollMfa(app, accessToken);
  for (const role of roles) await grantRole(userId, role);
  return { accessToken, userId };
}

describe('Relationship Management / CRM (e2e) — backlog Part C #10', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  async function createCustomer(salesToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(salesToken))
      .send({
        customerType: 'INDIVIDUAL',
        legalName: 'CRM Subject',
        nationalId: '9907070000',
        contactPhone: '+962-7-9000-5678',
        contactEmail: 'crm-subject@example.test',
        languagePreference: 'EN',
      })
      .expect(201);
    return (res.body as IdBody).id;
  }

  /** Directly seeds a Policy + Claim + Complaint for a customer (no Policy /
   * Claim / Complaint module exists — Domains B / C / E). */
  async function seedBookOfBusiness(customerId: string): Promise<void> {
    const insurer = await prisma.insurer.create({
      data: { name: `CRM Test Insurer ${Math.random().toString(36).slice(2)}` },
    });
    const opportunity = await prisma.opportunity.create({
      data: { customerId },
    });
    const policy = await prisma.policy.create({
      data: {
        opportunityId: opportunity.id,
        customerId,
        insurerId: insurer.id,
        insuranceLine: 'Property All Risks',
        requestedPremium: '1200.000',
        status: 'ACTIVE',
        inceptionDate: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId,
        lossDate: new Date('2026-03-15T00:00:00Z'),
        lossLocation: 'Zarqa warehouse',
        causeOfLoss: 'Fire in the warehouse — CONFIDENTIAL detail',
        estimatedLoss: '45000.000',
        isLargeClaim: true,
        status: 'NOTIFIED',
      },
    });
    await prisma.complaint.create({
      data: {
        customerId,
        issue: 'Policy schedule arrived late',
        category: 'delayed_issuance',
        status: 'LOGGED',
      },
    });
  }

  describe('logging interactions', () => {
    it('logs an interaction and surfaces it (newest-first) on the 360° timeline', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'crm-log-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);

      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(sales.accessToken))
        .send({
          channel: 'CALL',
          summary: 'Older call',
          occurredAt: '2026-02-01T09:00:00.000Z',
        })
        .expect(201);

      const latest = await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(sales.accessToken))
        .send({ channel: 'MEETING', summary: 'Kickoff meeting' })
        .expect(201);
      expect((latest.body as InteractionBody).loggedByUserId).toBe(
        sales.userId,
      );

      const view = await request(app.getHttpServer())
        .get(`/customers/${customerId}/360-view`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const body = view.body as Customer360Body;

      expect(body.counts.interactions).toBe(2);
      expect(body.timeline.map((e) => e.title)).toEqual(['MEETING', 'CALL']);
      expect(body.timeline.every((e) => e.kind === 'INTERACTION')).toBe(true);
    });

    it('rejects a future occurredAt (422), an empty summary (400), and an unknown channel (400)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'crm-validate-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);

      const future = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(sales.accessToken))
        .send({
          channel: 'CALL',
          summary: 'From the future',
          occurredAt: future,
        })
        .expect(422);

      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(sales.accessToken))
        .send({ channel: 'CALL', summary: '   ' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(sales.accessToken))
        .send({ channel: 'CARRIER_PIGEON', summary: 'Nope' })
        .expect(400);

      // A datetime with no timezone offset would be parsed as server-local
      // time and silently shift the recorded instant — rejected 422.
      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(sales.accessToken))
        .send({
          channel: 'CALL',
          summary: 'Naive local time',
          occurredAt: '2026-02-01T09:00:00',
        })
        .expect(422);

      // A plain date (no time component) is unambiguous — accepted.
      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(sales.accessToken))
        .send({
          channel: 'CALL',
          summary: 'Met on the 1st',
          occurredAt: '2026-02-01',
        })
        .expect(201);
    });

    it('404s logging against a customer that does not exist', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'crm-404-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      await request(app.getHttpServer())
        .post(`/customers/00000000-0000-0000-0000-000000000000/interactions`)
        .set(bearer(sales.accessToken))
        .send({ channel: 'CALL', summary: 'Ghost' })
        .expect(404);
    });
  });

  describe('the 360° view', () => {
    it('aggregates policies + claims + complaints + interactions into one timeline, claim projection carrying no loss detail', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'crm-360-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      await seedBookOfBusiness(customerId);

      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(sales.accessToken))
        .send({
          channel: 'EMAIL',
          summary: 'Sent renewal terms',
          occurredAt: '2026-02-20T00:00:00.000Z',
        })
        .expect(201);

      const view = await request(app.getHttpServer())
        .get(`/customers/${customerId}/360-view`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const body = view.body as Customer360Body;

      expect(body.counts).toEqual({
        interactions: 1,
        policies: 1,
        claims: 1,
        complaints: 1,
      });
      // Reverse-chronological on each kind's representative instant:
      // complaint.createdAt (≈ now) > claim.lossDate (Mar 15) >
      // interaction.occurredAt (Feb 20) > policy.inceptionDate (Jan 1).
      expect(body.timeline.map((e) => e.kind)).toEqual([
        'COMPLAINT',
        'CLAIM',
        'INTERACTION',
        'POLICY',
      ]);
      // HIGHLY_CONFIDENTIAL — the claim projection must not leak loss detail,
      // money, or a money-derived flag (the seed sets all of these).
      const claim = body.claims[0];
      expect(claim).not.toHaveProperty('causeOfLoss');
      expect(claim).not.toHaveProperty('lossLocation');
      expect(claim).not.toHaveProperty('estimatedLoss');
      expect(claim).not.toHaveProperty('isLargeClaim');
      expect(claim).toHaveProperty('status', 'NOTIFIED');
      // ...and it is not surfaced as timeline detail either.
      const claimEvent = body.timeline.find((e) => e.kind === 'CLAIM');
      expect(claimEvent?.detail).toBeNull();
    });
  });

  describe('permissions & visibility', () => {
    it('lets a Claims Officer LOG against a customer they do not own, but 403s them on the 360° view', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'crm-xf-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const claims = await makeUser(app, 'crm-xf-claims', 'CLAIMS_OFFICER');
      const customerId = await createCustomer(sales.accessToken);

      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(claims.accessToken))
        .send({ channel: 'CLAIM', summary: 'Claim status call' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/customers/${customerId}/360-view`)
        .set(bearer(claims.accessToken))
        .expect(403);
    });

    it('403s an External Auditor trying to log (read-only role — no interaction.log grant)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'crm-perm-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const auditor = await makeUser(app, 'crm-perm-aud', 'EXTERNAL_AUDITOR');
      const customerId = await createCustomer(sales.accessToken);

      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(auditor.accessToken))
        .send({ channel: 'CALL', summary: 'should be blocked' })
        .expect(403);

      // ...but the same auditor CAN read the 360° view (it holds
      // customer.360-view.read).
      await request(app.getHttpServer())
        .get(`/customers/${customerId}/360-view`)
        .set(bearer(auditor.accessToken))
        .expect(200);
    });

    it("hides another Sales Officer's customer (404 on view + interactions), owner and Manager see it", async () => {
      const app = await boot();
      const salesA = await makeUser(
        app,
        'crm-vis-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const salesB = await makeUser(
        app,
        'crm-vis-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'crm-vis-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const customerId = await createCustomer(salesA.accessToken);
      await request(app.getHttpServer())
        .post(`/customers/${customerId}/interactions`)
        .set(bearer(salesA.accessToken))
        .send({ channel: 'VISIT', summary: 'Site visit' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/customers/${customerId}/360-view`)
        .set(bearer(salesB.accessToken))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/customers/${customerId}/interactions`)
        .set(bearer(salesB.accessToken))
        .expect(404);

      await request(app.getHttpServer())
        .get(`/customers/${customerId}/360-view`)
        .set(bearer(salesA.accessToken))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/customers/${customerId}/360-view`)
        .set(bearer(manager.accessToken))
        .expect(200)
        .expect((r) =>
          expect((r.body as Customer360Body).counts.interactions).toBe(1),
        );
    });
  });
});
