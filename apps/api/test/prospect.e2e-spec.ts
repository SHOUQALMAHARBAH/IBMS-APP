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
  status: string;
}
interface ProspectBody {
  id: string;
  leadId: string;
  companyName: string;
  sector: string | null;
  productsOfInterest: string[];
  expectedPremium: string | null;
  salesOwnerUserId: string;
  status: string;
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
    .send({ fullName: 'Prospect Test User', email, password: PASSWORD })
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

async function createLead(
  app: INestApplication<App>,
  accessToken: string,
  fullName: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/leads')
    .set(bearer(accessToken))
    .send({ fullName, source: 'referral', marketingConsentGranted: false })
    .expect(201);
  return (res.body as LeadBody).id;
}

async function qualifyLead(
  app: INestApplication<App>,
  accessToken: string,
  leadId: string,
): Promise<void> {
  for (const toStatus of ['CONTACTED', 'QUALIFIED']) {
    await request(app.getHttpServer())
      .post(`/leads/${leadId}/transition`)
      .set(bearer(accessToken))
      .send({ toStatus })
      .expect(201);
  }
}

describe('Prospect management (e2e) — backlog Part C #2', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('POST /prospects', () => {
    it('is forbidden without prospect.capture (e.g. a Claims Officer)', async () => {
      const app = await boot();
      const claims = await makeUser(app, 'prospect-claims', 'CLAIMS_OFFICER');
      await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(claims.accessToken))
        .send({ leadId: 'does-not-matter', companyName: 'Rejected Co.' })
        .expect(403);
    });

    it("rejects converting another officer's lead with the same 404 as a nonexistent one", async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'prospect-owner-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const other = await makeUser(
        app,
        'prospect-other-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const leadId = await createLead(app, owner.accessToken, 'Not Yours');

      await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(other.accessToken))
        .send({ leadId, companyName: 'Should Not Convert' })
        .expect(404);
    });

    it('rejects converting a lead that is not yet QUALIFIED', async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'prospect-owner-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const leadId = await createLead(app, owner.accessToken, 'Too Early');

      await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(owner.accessToken))
        .send({ leadId, companyName: 'Too Early Co.' })
        .expect(422);
    });

    it('converts a QUALIFIED lead into an owned Prospect, capturing the qualification profile', async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'prospect-owner-c',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const leadId = await createLead(app, owner.accessToken, 'Ready Lead');
      await qualifyLead(app, owner.accessToken, leadId);

      const res = await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(owner.accessToken))
        .send({
          leadId,
          companyName: 'Ready Trading Co.',
          sector: 'Manufacturing',
          employeeCount: 42,
          productsOfInterest: ['Medical', 'Motor'],
          expectedPremium: '1250.500',
        })
        .expect(201);

      const prospect = res.body as ProspectBody;
      expect(prospect.leadId).toBe(leadId);
      expect(prospect.companyName).toBe('Ready Trading Co.');
      expect(prospect.sector).toBe('Manufacturing');
      expect(prospect.productsOfInterest).toEqual(['Medical', 'Motor']);
      // Prisma.Decimal's JSON serialization normalizes trailing zeros
      // ("1250.500" -> "1250.5") — same value, no fils precision actually
      // lost (money.util.ts's fixed-3dp `formatMoney` is documented as "for
      // persistence/logging, not display", so the API isn't expected to
      // force it back on here).
      expect(Number(prospect.expectedPremium)).toBe(1250.5);
      expect(prospect.salesOwnerUserId).toBe(owner.userId);
      expect(prospect.status).toBe('qualifying');

      // The Lead itself is now terminal.
      const leadsRes = await request(app.getHttpServer())
        .get('/leads')
        .set(bearer(owner.accessToken))
        .expect(200);
      const lead = (leadsRes.body as LeadBody[]).find((l) => l.id === leadId);
      expect(lead?.status).toBe('CONVERTED_TO_PROSPECT');
    });

    it('rejects converting the same lead twice', async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'prospect-owner-d',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const leadId = await createLead(app, owner.accessToken, 'Twice Lead');
      await qualifyLead(app, owner.accessToken, leadId);

      await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(owner.accessToken))
        .send({ leadId, companyName: 'First Convert' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(owner.accessToken))
        .send({ leadId, companyName: 'Second Convert' })
        .expect(422);
    });
  });

  describe('GET /prospects', () => {
    it('is forbidden without prospect.read', async () => {
      const app = await boot();
      const claims = await makeUser(
        app,
        'prospect-list-claims',
        'CLAIMS_OFFICER',
      );
      await request(app.getHttpServer())
        .get('/prospects')
        .set(bearer(claims.accessToken))
        .expect(403);
    });

    it("scopes a Sales Officer to their own prospects even when asking for another owner's", async () => {
      const app = await boot();
      const officerA = await makeUser(
        app,
        'prospect-owner-e',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const officerB = await makeUser(
        app,
        'prospect-owner-f',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const leadA = await createLead(app, officerA.accessToken, 'A Lead');
      await qualifyLead(app, officerA.accessToken, leadA);
      await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(officerA.accessToken))
        .send({ leadId: leadA, companyName: 'Owned By A' })
        .expect(201);
      const leadB = await createLead(app, officerB.accessToken, 'B Lead');
      await qualifyLead(app, officerB.accessToken, leadB);
      await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(officerB.accessToken))
        .send({ leadId: leadB, companyName: 'Owned By B' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/prospects')
        .query({ salesOwnerUserId: officerB.userId })
        .set(bearer(officerA.accessToken))
        .expect(200);

      const prospects = res.body as ProspectBody[];
      expect(
        prospects.every((p) => p.salesOwnerUserId === officerA.userId),
      ).toBe(true);
      expect(prospects.some((p) => p.companyName === 'Owned By B')).toBe(
        false,
      );
    });
  });

  describe('GET /prospects/:id', () => {
    it("hides another officer's prospect behind a 404", async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'prospect-owner-g',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const other = await makeUser(
        app,
        'prospect-other-g',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const leadId = await createLead(app, owner.accessToken, 'Profile Lead');
      await qualifyLead(app, owner.accessToken, leadId);
      const created = await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(owner.accessToken))
        .send({ leadId, companyName: 'Profile Co.' })
        .expect(201);
      const prospectId = (created.body as ProspectBody).id;

      await request(app.getHttpServer())
        .get(`/prospects/${prospectId}`)
        .set(bearer(other.accessToken))
        .expect(404);
    });

    it('lets a Branch/Department Manager read any prospect profile', async () => {
      const app = await boot();
      const owner = await makeUser(
        app,
        'prospect-owner-h',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'prospect-manager-h',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const leadId = await createLead(
        app,
        owner.accessToken,
        'Manager View Lead',
      );
      await qualifyLead(app, owner.accessToken, leadId);
      const created = await request(app.getHttpServer())
        .post('/prospects')
        .set(bearer(owner.accessToken))
        .send({ leadId, companyName: 'Manager View Co.' })
        .expect(201);
      const prospectId = (created.body as ProspectBody).id;

      const res = await request(app.getHttpServer())
        .get(`/prospects/${prospectId}`)
        .set(bearer(manager.accessToken))
        .expect(200);
      expect((res.body as ProspectBody).companyName).toBe(
        'Manager View Co.',
      );
    });
  });
});
