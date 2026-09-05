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
interface LeadBody {
  id: string;
  fullName: string;
  source: string;
  ownerUserId: string;
  status: string;
  marketingConsentGranted: boolean;
  firstContactAt: string;
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
    .send({ fullName: 'Lead Test User', email, password: PASSWORD })
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
  role?: RoleName,
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  const { accessToken, userId } = await signupAndLogin(app, email);
  await enrollMfa(app, accessToken);
  if (role) await grantRole(userId, role);
  return { accessToken, userId };
}

describe('Lead management (e2e) — backlog Part C #1', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('POST /leads', () => {
    it('is forbidden without lead.create (e.g. a Claims Officer)', async () => {
      const app = await boot();
      const claims = await makeUser(app, 'lead-claims', 'CLAIMS_OFFICER');
      await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(claims.accessToken))
        .send({
          fullName: 'Rejected Attempt',
          source: 'referral',
          marketingConsentGranted: false,
        })
        .expect(403);
    });

    it('rejects a source outside the acquisition-source list', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'lead-sales-badsource',
        'SALES_RELATIONSHIP_OFFICER',
      );
      await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(sales.accessToken))
        .send({
          fullName: 'Bad Source',
          source: 'not_a_real_source',
          marketingConsentGranted: false,
        })
        .expect(400);
    });

    it('creates a Lead owned by the creating Sales Officer, NEW by default, marketing consent unticked unless explicitly set', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'lead-sales-create',
        'SALES_RELATIONSHIP_OFFICER',
      );

      const res = await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(sales.accessToken))
        .send({
          fullName: 'Ahmad Al-Test',
          source: 'referral',
          contactPhone: '+962-7-0000-0000',
          marketingConsentGranted: false,
        })
        .expect(201);

      const lead = res.body as LeadBody;
      expect(lead.ownerUserId).toBe(sales.userId);
      expect(lead.status).toBe('NEW');
      expect(lead.marketingConsentGranted).toBe(false);
    });

    it('treats an empty-string optional contactEmail as not provided, not a validation error', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'lead-sales-emptyemail',
        'SALES_RELATIONSHIP_OFFICER',
      );

      await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(sales.accessToken))
        .send({
          fullName: 'Empty Email Field',
          source: 'referral',
          contactEmail: '',
          marketingConsentGranted: false,
        })
        .expect(201);
    });
  });

  describe('GET /leads', () => {
    it('is forbidden without lead.list.read', async () => {
      const app = await boot();
      const claims = await makeUser(app, 'lead-list-claims', 'CLAIMS_OFFICER');
      await request(app.getHttpServer())
        .get('/leads')
        .set(bearer(claims.accessToken))
        .expect(403);
    });

    it("scopes a Sales Officer to their own pipeline even when asking for another owner's leads", async () => {
      const app = await boot();
      const officerA = await makeUser(
        app,
        'lead-owner-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const officerB = await makeUser(
        app,
        'lead-owner-b',
        'SALES_RELATIONSHIP_OFFICER',
      );

      await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(officerA.accessToken))
        .send({
          fullName: 'Owned By A',
          source: 'website',
          marketingConsentGranted: false,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(officerB.accessToken))
        .send({
          fullName: 'Owned By B',
          source: 'website',
          marketingConsentGranted: false,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/leads')
        .query({ ownerUserId: officerB.userId })
        .set(bearer(officerA.accessToken))
        .expect(200);

      const leads = res.body as LeadBody[];
      expect(leads.every((l) => l.ownerUserId === officerA.userId)).toBe(true);
      expect(leads.some((l) => l.fullName === 'Owned By B')).toBe(false);
    });

    it('lets a Branch/Department Manager filter by any owner', async () => {
      const app = await boot();
      const officer = await makeUser(
        app,
        'lead-owner-c',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'lead-manager',
        'BRANCH_DEPARTMENT_MANAGER',
      );

      await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(officer.accessToken))
        .send({
          fullName: 'Manager Visible',
          source: 'campaign',
          marketingConsentGranted: false,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/leads')
        .query({ ownerUserId: officer.userId })
        .set(bearer(manager.accessToken))
        .expect(200);

      const leads = res.body as LeadBody[];
      expect(leads.some((l) => l.fullName === 'Manager Visible')).toBe(true);
    });

    it('treats an empty-string ownerUserId query value as not provided, not a validation error', async () => {
      const app = await boot();
      const manager = await makeUser(
        app,
        'lead-manager-emptyowner',
        'BRANCH_DEPARTMENT_MANAGER',
      );

      await request(app.getHttpServer())
        .get('/leads')
        .query({ ownerUserId: '' })
        .set(bearer(manager.accessToken))
        .expect(200);
    });
  });

  describe('POST /leads/:id/transition', () => {
    it('is forbidden without lead.transition', async () => {
      const app = await boot();
      const claims = await makeUser(
        app,
        'lead-transition-claims',
        'CLAIMS_OFFICER',
      );
      await request(app.getHttpServer())
        .post('/leads/does-not-matter/transition')
        .set(bearer(claims.accessToken))
        .send({ toStatus: 'CONTACTED' })
        .expect(403);
    });

    it("rejects transitioning another officer's lead with the same 404 as a nonexistent one (never 403, so it can't be used as an existence oracle)", async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'lead-owner-d',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const other = await makeUser(
        app,
        'lead-other',
        'SALES_RELATIONSHIP_OFFICER',
      );

      const created = await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(owner.accessToken))
        .send({
          fullName: 'Not Yours',
          source: 'tender',
          marketingConsentGranted: false,
        })
        .expect(201);
      const leadId = (created.body as LeadBody).id;

      await request(app.getHttpServer())
        .post(`/leads/${leadId}/transition`)
        .set(bearer(other.accessToken))
        .send({ toStatus: 'CONTACTED' })
        .expect(404);
    });

    it('rejects an illegal jump (NEW -> QUALIFIED, skipping CONTACTED)', async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'lead-owner-e',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const created = await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(owner.accessToken))
        .send({
          fullName: 'Skip Attempt',
          source: 'tender',
          marketingConsentGranted: false,
        })
        .expect(201);
      const leadId = (created.body as LeadBody).id;

      await request(app.getHttpServer())
        .post(`/leads/${leadId}/transition`)
        .set(bearer(owner.accessToken))
        .send({ toStatus: 'QUALIFIED' })
        .expect(422);
    });

    it('walks NEW -> CONTACTED -> QUALIFIED for the owning officer', async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'lead-owner-f',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const created = await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(owner.accessToken))
        .send({
          fullName: 'Full Pipeline',
          source: 'bank_partner',
          marketingConsentGranted: false,
        })
        .expect(201);
      const leadId = (created.body as LeadBody).id;

      for (const toStatus of ['CONTACTED', 'QUALIFIED']) {
        const res = await request(app.getHttpServer())
          .post(`/leads/${leadId}/transition`)
          .set(bearer(owner.accessToken))
          .send({ toStatus })
          .expect(201);
        expect((res.body as { status: string }).status).toBe(toStatus);
      }
    });

    // Backlog Part C #2 (Prospect Management) — CONVERTED_TO_PROSPECT must
    // also create the linked Prospect row, which this generic endpoint has
    // no way to do. See prospect.e2e-spec.ts for the real conversion path
    // (POST /prospects).
    it('rejects a direct move to CONVERTED_TO_PROSPECT even for a QUALIFIED lead — only POST /prospects may make that move', async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'lead-owner-h',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const created = await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(owner.accessToken))
        .send({
          fullName: 'Direct Convert Attempt',
          source: 'bank_partner',
          marketingConsentGranted: false,
        })
        .expect(201);
      const leadId = (created.body as LeadBody).id;

      for (const toStatus of ['CONTACTED', 'QUALIFIED']) {
        await request(app.getHttpServer())
          .post(`/leads/${leadId}/transition`)
          .set(bearer(owner.accessToken))
          .send({ toStatus })
          .expect(201);
      }

      await request(app.getHttpServer())
        .post(`/leads/${leadId}/transition`)
        .set(bearer(owner.accessToken))
        .send({ toStatus: 'CONVERTED_TO_PROSPECT' })
        .expect(422);
    });

    it('stamps firstContactAt with the actual contact date when a lead moves to CONTACTED, not the creation date', async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'lead-owner-g',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const created = await request(app.getHttpServer())
        .post('/leads')
        .set(bearer(owner.accessToken))
        .send({
          fullName: 'Timing Check',
          source: 'renewal',
          marketingConsentGranted: false,
        })
        .expect(201);
      const lead = created.body as LeadBody;
      const firstContactAtBeforeContact = lead.firstContactAt;

      await new Promise((resolve) => setTimeout(resolve, 5));
      await request(app.getHttpServer())
        .post(`/leads/${lead.id}/transition`)
        .set(bearer(owner.accessToken))
        .send({ toStatus: 'CONTACTED' })
        .expect(201);

      const listRes = await request(app.getHttpServer())
        .get('/leads')
        .set(bearer(owner.accessToken))
        .expect(200);
      const updated = (listRes.body as LeadBody[]).find(
        (l) => l.id === lead.id,
      );
      expect(updated?.firstContactAt).not.toBe(firstContactAtBeforeContact);
    });
  });
});
