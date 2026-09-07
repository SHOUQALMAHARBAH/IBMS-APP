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
interface CustomerBody {
  id: string;
}
interface RiskProfileBody {
  id: string;
  customerId: string;
}
interface AssetBody {
  id: string;
  assetType: string;
  declaredValue: string | null;
  annualGrossProfit: string | null;
  indemnityPeriodMonths: number | null;
  fleetVehicleCount: number | null;
}
interface SurveyBody {
  id: string;
  assets: AssetBody[];
  sumInsured: {
    propertySumInsured: string;
    businessInterruptionSumInsured: string;
    totalSumInsured: string;
    indemnityPeriodMonths: number | null;
    fleetVehicleCount: number;
    assetCount: number;
  };
}
interface ConsolidatedBody {
  customerId: string;
  sites: { riskProfileId: string; siteLabel: string | null }[];
  consolidated: {
    propertySumInsured: string;
    businessInterruptionSumInsured: string;
    totalSumInsured: string;
    indemnityPeriodMonths: number | null;
    fleetVehicleCount: number;
    siteCount: number;
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
    .send({ fullName: 'Risk Profile Test User', email, password: PASSWORD })
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

describe('Risk Assessment (e2e) — backlog Part C #6', () => {
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
        legalName: 'Risk Survey Subject',
        nationalId: '9901010000',
        contactPhone: '+962-7-9000-1234',
        contactEmail: 'rp-subject@example.test',
        languagePreference: 'EN',
      })
      .expect(201);
    return (res.body as CustomerBody).id;
  }

  async function createRiskProfile(
    salesToken: string,
    customerId: string,
    siteLabel: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/risk-profiles')
      .set(bearer(salesToken))
      .send({ customerId, siteLabel })
      .expect(201);
    return (res.body as RiskProfileBody).id;
  }

  describe('permissions', () => {
    it('rejects adding an asset without risk-profile.create (a Claims Officer)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'rp-perm-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const claims = await makeUser(app, 'rp-perm-claims', 'CLAIMS_OFFICER');
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId, 'HQ');
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(claims.accessToken))
        .send({ assetType: 'building', declaredValue: '100000' })
        .expect(403);
    });
  });

  describe('asset survey + Sum Insured derivation', () => {
    it('derives the property Sum Insured, BI Sum Insured, indemnity period and fleet count from the captured assets', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'rp-derive',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId, 'HQ');

      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({
          assetType: 'building',
          declaredValue: '500000',
          description: 'Main office',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'stock', declaredValue: '120000.500' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({
          assetType: 'building',
          annualGrossProfit: '480000',
          indemnityPeriodMonths: 18,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'vehicle', fleetVehicleCount: 9 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/risk-profiles/${rpId}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const body = res.body as SurveyBody;
      expect(body.assets).toHaveLength(4);
      expect(body.sumInsured.propertySumInsured).toBe('620000.500');
      expect(body.sumInsured.businessInterruptionSumInsured).toBe('480000.000');
      expect(body.sumInsured.totalSumInsured).toBe('1100000.500');
      expect(body.sumInsured.indemnityPeriodMonths).toBe(18);
      expect(body.sumInsured.fleetVehicleCount).toBe(9);
    });

    it('rejects an incoherent asset body', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'rp-coherence',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId, 'HQ');

      // vehicle carrying a declared value
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({
          assetType: 'vehicle',
          fleetVehicleCount: 4,
          declaredValue: '10000',
        })
        .expect(400);
      // non-vehicle with nothing quantitative
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'equipment', description: 'a lathe' })
        .expect(400);
      // indemnity period without a BI basis
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({
          assetType: 'building',
          declaredValue: '1000',
          indemnityPeriodMonths: 12,
        })
        .expect(400);
    });

    it('replaces an asset on PATCH and drops it on DELETE', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'rp-edit',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId, 'HQ');

      const created = await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'building', declaredValue: '100000' })
        .expect(201);
      const assetId = (created.body as AssetBody).id;

      await request(app.getHttpServer())
        .patch(`/risk-profiles/${rpId}/assets/${assetId}`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'stock', declaredValue: '250000' })
        .expect(200)
        .expect((r) => {
          const b = r.body as AssetBody;
          expect(b.assetType).toBe('stock');
          // Prisma.Decimal's JSON serialization normalizes trailing zeros.
          expect(Number(b.declaredValue)).toBe(250000);
        });

      await request(app.getHttpServer())
        .delete(`/risk-profiles/${rpId}/assets/${assetId}`)
        .set(bearer(sales.accessToken))
        .expect(204);

      const after = await request(app.getHttpServer())
        .get(`/risk-profiles/${rpId}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((after.body as SurveyBody).assets).toHaveLength(0);
    });
  });

  describe('multi-site consolidation', () => {
    it('consolidates the Sum Insured across every site of a multi-site client', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'rp-multisite',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const hq = await createRiskProfile(
        sales.accessToken,
        customerId,
        'Head office',
      );
      const aqaba = await createRiskProfile(
        sales.accessToken,
        customerId,
        'Aqaba warehouse',
      );

      await request(app.getHttpServer())
        .post(`/risk-profiles/${hq}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'building', declaredValue: '500000' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/risk-profiles/${aqaba}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'stock', declaredValue: '150000' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/risk-profiles/${aqaba}/assets`)
        .set(bearer(sales.accessToken))
        .send({
          assetType: 'stock',
          annualGrossProfit: '90000',
          indemnityPeriodMonths: 12,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/risk-profiles/consolidated?customerId=${customerId}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const body = res.body as ConsolidatedBody;
      expect(body.consolidated.propertySumInsured).toBe('650000.000');
      expect(body.consolidated.businessInterruptionSumInsured).toBe(
        '90000.000',
      );
      expect(body.consolidated.totalSumInsured).toBe('740000.000');
      expect(body.consolidated.siteCount).toBe(2);
    });
  });

  describe('visibility', () => {
    it("hides another Sales Officer's risk profile (404) but a Placement Officer can survey it", async () => {
      const app = await boot();
      const salesA = await makeUser(
        app,
        'rp-vis-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const salesB = await makeUser(
        app,
        'rp-vis-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const placement = await makeUser(
        app,
        'rp-vis-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(salesA.accessToken);
      const rpId = await createRiskProfile(
        salesA.accessToken,
        customerId,
        'HQ',
      );

      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(salesB.accessToken))
        .send({ assetType: 'building', declaredValue: '1000' })
        .expect(404);

      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(placement.accessToken))
        .send({ assetType: 'building', declaredValue: '1000' })
        .expect(201);
    });
  });
});
