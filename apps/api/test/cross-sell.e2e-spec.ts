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
interface OpportunityBody {
  id: string;
  status: string;
  gapLine: string;
  dismissReason: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
}
interface DetectBody {
  customerId: string;
  heldLines: string[];
  gapLines: string[];
  benchmarkLines: string[];
  newlyFlagged: OpportunityBody[];
  openOpportunities: OpportunityBody[];
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
    .send({ fullName: 'Cross-Sell Test User', email, password: PASSWORD })
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

describe('Cross-Selling (e2e) — backlog Part C #8', () => {
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
        legalName: 'Cross-Sell Subject',
        nationalId: '9905050000',
        contactPhone: '+962-7-9000-1234',
        contactEmail: 'xs-subject@example.test',
        languagePreference: 'EN',
      })
      .expect(201);
    return (res.body as IdBody).id;
  }

  /** Directly seeds an in-force Policy for a customer (no Policy module
   * exists — Domain B). Creates the Insurer + Opportunity it needs. */
  async function seedActivePolicy(
    customerId: string,
    insuranceLine: string,
  ): Promise<void> {
    const insurer = await prisma.insurer.create({
      data: { name: `XS Test Insurer ${Math.random().toString(36).slice(2)}` },
    });
    const opportunity = await prisma.opportunity.create({
      data: { customerId },
    });
    await prisma.policy.create({
      data: {
        opportunityId: opportunity.id,
        customerId,
        insurerId: insurer.id,
        insuranceLine,
        requestedPremium: '1000.000',
        status: 'ACTIVE',
      },
    });
  }

  async function seedOpportunity(
    customerId: string,
    gapLine: string,
  ): Promise<string> {
    const row = await prisma.crossSellOpportunity.create({
      data: { customerId, gapLine, detectedByUserId: null },
    });
    return row.id;
  }

  describe('detection scan', () => {
    it('flags every benchmark line the customer holds no in-force policy for, and is idempotent', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'xs-detect-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      await seedActivePolicy(customerId, 'Property All Risks');

      const first = await request(app.getHttpServer())
        .post('/cross-sell-opportunities/detect')
        .set(bearer(sales.accessToken))
        .send({ customerId })
        .expect(201);
      const firstBody = first.body as DetectBody;

      expect(firstBody.heldLines).toEqual(['Property All Risks']);
      expect(firstBody.newlyFlagged.map((o) => o.gapLine).sort()).toEqual(
        [
          'Business Interruption',
          'Public Liability',
          'Workers Compensation',
        ].sort(),
      );
      expect(firstBody.newlyFlagged.every((o) => o.status === 'OPEN')).toBe(
        true,
      );

      // Re-run: same gaps, nothing new created.
      const second = await request(app.getHttpServer())
        .post('/cross-sell-opportunities/detect')
        .set(bearer(sales.accessToken))
        .send({ customerId })
        .expect(201);
      const secondBody = second.body as DetectBody;
      expect(secondBody.newlyFlagged).toEqual([]);
      expect(secondBody.openOpportunities.length).toBe(3);
    });

    it('flags nothing for a customer with no in-force policies (not a cross-sell target)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'xs-nopol-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);

      const res = await request(app.getHttpServer())
        .post('/cross-sell-opportunities/detect')
        .set(bearer(sales.accessToken))
        .send({ customerId })
        .expect(201);
      const body = res.body as DetectBody;
      expect(body.heldLines).toEqual([]);
      expect(body.newlyFlagged).toEqual([]);
    });

    it('two concurrent scans for one customer flag each gap exactly once (DB unique index)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'xs-race-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      await seedActivePolicy(customerId, 'Property All Risks');

      await Promise.all([
        request(app.getHttpServer())
          .post('/cross-sell-opportunities/detect')
          .set(bearer(sales.accessToken))
          .send({ customerId }),
        request(app.getHttpServer())
          .post('/cross-sell-opportunities/detect')
          .set(bearer(sales.accessToken))
          .send({ customerId }),
      ]);

      const list = await request(app.getHttpServer())
        .get(`/cross-sell-opportunities?customerId=${customerId}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((list.body as OpportunityBody[]).length).toBe(3);
    });
  });

  describe('convert / dismiss', () => {
    it('converts an OPEN opportunity (OPEN -> CONVERTED, terminal)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'xs-conv-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const oppId = await seedOpportunity(customerId, 'Public Liability');

      await request(app.getHttpServer())
        .post(`/cross-sell-opportunities/${oppId}/convert`)
        .set(bearer(sales.accessToken))
        .expect(201)
        .expect((r) => {
          const body = r.body as OpportunityBody;
          expect(body.status).toBe('CONVERTED');
          // The resolver stamp rides the same conditional write as the status.
          expect(body.resolvedByUserId).toBe(sales.userId);
          expect(body.resolvedAt).not.toBeNull();
        });

      // Terminal — a second convert (or a dismiss) is refused by the engine.
      await request(app.getHttpServer())
        .post(`/cross-sell-opportunities/${oppId}/dismiss`)
        .set(bearer(sales.accessToken))
        .send({ reason: 'changed my mind' })
        .expect(422);
    });

    it('dismisses an OPEN opportunity with a reason, and rejects a dismiss with no reason', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'xs-dis-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const oppId = await seedOpportunity(customerId, 'Workers Compensation');

      await request(app.getHttpServer())
        .post(`/cross-sell-opportunities/${oppId}/dismiss`)
        .set(bearer(sales.accessToken))
        .send({})
        .expect(400);

      await request(app.getHttpServer())
        .post(`/cross-sell-opportunities/${oppId}/dismiss`)
        .set(bearer(sales.accessToken))
        .send({ reason: 'Covered under a group policy elsewhere' })
        .expect(201)
        .expect((r) => {
          const body = r.body as OpportunityBody;
          expect(body.status).toBe('DISMISSED');
          expect(body.dismissReason).toBe(
            'Covered under a group policy elsewhere',
          );
        });
    });
  });

  describe('permissions & visibility', () => {
    it('rejects convert without cross-sell.convert (a Placement Officer)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'xs-perm-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const placement = await makeUser(
        app,
        'xs-perm-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const oppId = await seedOpportunity(customerId, 'Public Liability');

      await request(app.getHttpServer())
        .post(`/cross-sell-opportunities/${oppId}/convert`)
        .set(bearer(placement.accessToken))
        .expect(403);
    });

    it("hides another Sales Officer's opportunity (404), owner and Manager can see it", async () => {
      const app = await boot();
      const salesA = await makeUser(
        app,
        'xs-vis-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const salesB = await makeUser(
        app,
        'xs-vis-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'xs-vis-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const customerId = await createCustomer(salesA.accessToken);
      const oppId = await seedOpportunity(customerId, 'Business Interruption');

      await request(app.getHttpServer())
        .get(`/cross-sell-opportunities/${oppId}`)
        .set(bearer(salesB.accessToken))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/cross-sell-opportunities/${oppId}`)
        .set(bearer(salesA.accessToken))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/cross-sell-opportunities?customerId=${customerId}`)
        .set(bearer(manager.accessToken))
        .expect(200)
        .expect((r) => expect((r.body as OpportunityBody[]).length).toBe(1));
    });
  });
});
