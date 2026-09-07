import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';
import { UpSellDetectionScheduler } from '../src/modules/up-sell/up-sell-detection.scheduler';

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
interface RecommendationBody {
  id: string;
  status: string;
  currentSumInsured: string;
  currentAssetValue: string;
  dismissReason: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
}
interface DetectBody {
  customerId: string;
  currentSumInsured: string;
  currentAssetValue: string;
  shortfall: string;
  thresholdAmount: string;
  thresholdPercent: string;
  isUnderinsured: boolean;
  suppressedByPriorResolution: boolean;
  flagged: RecommendationBody | null;
  openRecommendation: RecommendationBody | null;
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
    .send({ fullName: 'Up-Sell Test User', email, password: PASSWORD })
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

const FULL_ANSWERS: Record<string, boolean | number> = {
  ownsOrLeasesPremises: false,
  holdsPhysicalStock: false,
  revenueDependsOnPremises: false,
  operatesSpecialisedMachinery: false,
  employeeCount: 0,
  publicVisitsPremises: false,
  manufacturesOrSuppliesProducts: false,
  providesProfessionalAdvice: false,
  operatesVehicleFleet: false,
  movesGoodsByTransport: false,
  handlesPersonalOrPaymentData: false,
  wantsStaffMedicalCover: false,
  wantsStaffLifeCover: false,
};

describe('Up-Selling (e2e) — backlog Part C #9', () => {
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
        legalName: 'Up-Sell Subject',
        nationalId: '9906060000',
        contactPhone: '+962-7-9000-5678',
        contactEmail: 'us-subject@example.test',
        languagePreference: 'EN',
      })
      .expect(201);
    return (res.body as IdBody).id;
  }

  async function createRiskProfile(
    salesToken: string,
    customerId: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/risk-profiles')
      .set(bearer(salesToken))
      .send({ customerId, siteLabel: 'Head office' })
      .expect(201);
    return (res.body as IdBody).id;
  }

  async function addBuilding(
    salesToken: string,
    riskProfileId: string,
    declaredValue: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/risk-profiles/${riskProfileId}/assets`)
      .set(bearer(salesToken))
      .send({ assetType: 'building', declaredValue })
      .expect(201);
  }

  async function assembleProgram(
    salesToken: string,
    managerToken: string,
    placementToken: string,
    riskProfileId: string,
  ): Promise<void> {
    const created = await request(app.getHttpServer())
      .post('/needs-assessments')
      .set(bearer(salesToken))
      .send({
        riskProfileId,
        questionnaireAnswers: { ...FULL_ANSWERS, ownsOrLeasesPremises: true },
      })
      .expect(201);
    const naId = (created.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/needs-assessments/${naId}/submit`)
      .set(bearer(salesToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/needs-assessments/${naId}/review`)
      .set(bearer(managerToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/needs-assessments/${naId}/approve`)
      .set(bearer(managerToken))
      .expect(201);
    await request(app.getHttpServer())
      .post('/insurance-programs')
      .set(bearer(placementToken))
      .send({ needsAssessmentId: naId })
      .expect(201);
  }

  function detect(token: string, customerId: string) {
    return request(app.getHttpServer())
      .post('/up-sell-recommendations/detect')
      .set(bearer(token))
      .send({ customerId });
  }

  describe('under-insurance scan', () => {
    it('flags when assets grow past the designed Sum Insured, is idempotent, dismisses, suppresses re-flag, then re-flags on further growth', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'us-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'us-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const placement = await makeUser(
        app,
        'us-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);

      // Program assembled while the building is worth 100000 -> Property line basis 100000.
      await addBuilding(sales.accessToken, rpId, '100000');
      await assembleProgram(
        sales.accessToken,
        manager.accessToken,
        placement.accessToken,
        rpId,
      );

      // Still adequately insured.
      await detect(sales.accessToken, customerId)
        .expect(201)
        .expect((r) => {
          const b = r.body as DetectBody;
          expect(b.currentSumInsured).toBe('100000.000');
          expect(b.currentAssetValue).toBe('100000.000');
          expect(b.isUnderinsured).toBe(false);
          expect(b.flagged).toBeNull();
        });

      // Add a second building worth 40000 -> asset value 140000 vs SI 100000 (40% over).
      await addBuilding(sales.accessToken, rpId, '40000');

      const flagged = await detect(sales.accessToken, customerId).expect(201);
      const flaggedBody = flagged.body as DetectBody;
      expect(flaggedBody.isUnderinsured).toBe(true);
      expect(flaggedBody.currentAssetValue).toBe('140000.000');
      expect(flaggedBody.shortfall).toBe('40000.000');
      expect(flaggedBody.flagged).not.toBeNull();
      const recId = flaggedBody.flagged!.id;

      // Re-scan: nothing new (partial UNIQUE — one OPEN per customer).
      await detect(sales.accessToken, customerId)
        .expect(201)
        .expect((r) => {
          const b = r.body as DetectBody;
          expect(b.flagged).toBeNull();
          expect(b.openRecommendation?.id).toBe(recId);
        });

      // Dismiss it.
      await request(app.getHttpServer())
        .post(`/up-sell-recommendations/${recId}/dismiss`)
        .set(bearer(sales.accessToken))
        .send({ reason: 'Client declined the increase for now' })
        .expect(201)
        .expect((r) =>
          expect((r.body as RecommendationBody).status).toBe('DISMISSED'),
        );

      // Re-scan: still under-insured, but suppressed — assets haven't grown since the dismiss.
      await detect(sales.accessToken, customerId)
        .expect(201)
        .expect((r) => {
          const b = r.body as DetectBody;
          expect(b.isUnderinsured).toBe(true);
          expect(b.suppressedByPriorResolution).toBe(true);
          expect(b.flagged).toBeNull();
        });

      // Assets grow further -> a fresh recommendation is allowed.
      await addBuilding(sales.accessToken, rpId, '50000'); // now 190000
      await detect(sales.accessToken, customerId)
        .expect(201)
        .expect((r) => {
          const b = r.body as DetectBody;
          expect(b.suppressedByPriorResolution).toBe(false);
          expect(b.flagged).not.toBeNull();
          expect(b.flagged!.id).not.toBe(recId);
        });
    });

    it('flags nothing for a customer with no live insurance programme', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'us-noprog-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);
      await addBuilding(sales.accessToken, rpId, '500000');

      await detect(sales.accessToken, customerId)
        .expect(201)
        .expect((r) => {
          const b = r.body as DetectBody;
          expect(b.currentSumInsured).toBe('0.000');
          expect(b.isUnderinsured).toBe(false);
          expect(b.flagged).toBeNull();
        });
    });

    it('the nightly sweep (real findCustomerIdsWithLiveProgram query) flags an under-insured customer', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'us-sweep-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'us-sweep-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const placement = await makeUser(
        app,
        'us-sweep-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);
      await addBuilding(sales.accessToken, rpId, '100000');
      await assembleProgram(
        sales.accessToken,
        manager.accessToken,
        placement.accessToken,
        rpId,
      );
      await addBuilding(sales.accessToken, rpId, '60000'); // 160000 vs 100000

      // Run the cron body directly — exercises the real
      // findCustomerIdsWithLiveProgram() query + the whole sweep path (the
      // scheduler spec mocks both).
      await app.get(UpSellDetectionScheduler).runSweep();

      const list = await request(app.getHttpServer())
        .get(`/up-sell-recommendations?customerId=${customerId}&status=OPEN`)
        .set(bearer(sales.accessToken))
        .expect(200);
      const rows = list.body as RecommendationBody[];
      expect(rows.length).toBe(1);
      // A persisted Prisma.Decimal serializes without trailing zeros
      // ("100000", not "100000.000") — compare numerically.
      expect(Number(rows[0].currentSumInsured)).toBe(100000);
      expect(Number(rows[0].currentAssetValue)).toBe(160000);
    });

    it('two concurrent scans flag a customer exactly once (partial UNIQUE index)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'us-race-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'us-race-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const placement = await makeUser(
        app,
        'us-race-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);
      await addBuilding(sales.accessToken, rpId, '100000');
      await assembleProgram(
        sales.accessToken,
        manager.accessToken,
        placement.accessToken,
        rpId,
      );
      await addBuilding(sales.accessToken, rpId, '100000'); // 200000 vs 100000

      await Promise.all([
        detect(sales.accessToken, customerId),
        detect(sales.accessToken, customerId),
      ]);

      const list = await request(app.getHttpServer())
        .get(`/up-sell-recommendations?customerId=${customerId}`)
        .set(bearer(sales.accessToken))
        .expect(200);
      expect((list.body as RecommendationBody[]).length).toBe(1);
    });
  });

  describe('convert / permissions / visibility', () => {
    async function seedRecommendation(customerId: string): Promise<string> {
      const row = await prisma.upSellRecommendation.create({
        data: {
          customerId,
          currentSumInsured: '100000.000',
          currentAssetValue: '150000.000',
          detectedByUserId: null,
        },
      });
      return row.id;
    }

    it('converts an OPEN recommendation and stamps the resolver (terminal)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'us-conv-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const recId = await seedRecommendation(customerId);

      await request(app.getHttpServer())
        .post(`/up-sell-recommendations/${recId}/convert`)
        .set(bearer(sales.accessToken))
        .expect(201)
        .expect((r) => {
          const b = r.body as RecommendationBody;
          expect(b.status).toBe('CONVERTED');
          expect(b.resolvedByUserId).toBe(sales.userId);
          expect(b.resolvedAt).not.toBeNull();
        });

      await request(app.getHttpServer())
        .post(`/up-sell-recommendations/${recId}/dismiss`)
        .set(bearer(sales.accessToken))
        .send({ reason: 'too late now' })
        .expect(422);
    });

    it('rejects a dismiss with no reason (400)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'us-noreason-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const recId = await seedRecommendation(customerId);

      await request(app.getHttpServer())
        .post(`/up-sell-recommendations/${recId}/dismiss`)
        .set(bearer(sales.accessToken))
        .send({})
        .expect(400);
    });

    it('rejects convert without up-sell.convert (a Placement Officer)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'us-perm-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const placement = await makeUser(
        app,
        'us-perm-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const recId = await seedRecommendation(customerId);

      await request(app.getHttpServer())
        .post(`/up-sell-recommendations/${recId}/convert`)
        .set(bearer(placement.accessToken))
        .expect(403);
    });

    it("hides another Sales Officer's recommendation (404); owner and Manager can see it", async () => {
      const app = await boot();
      const salesA = await makeUser(
        app,
        'us-vis-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const salesB = await makeUser(
        app,
        'us-vis-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'us-vis-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const customerId = await createCustomer(salesA.accessToken);
      const recId = await seedRecommendation(customerId);

      await request(app.getHttpServer())
        .get(`/up-sell-recommendations/${recId}`)
        .set(bearer(salesB.accessToken))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/up-sell-recommendations/${recId}`)
        .set(bearer(salesA.accessToken))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/up-sell-recommendations?customerId=${customerId}`)
        .set(bearer(manager.accessToken))
        .expect(200)
        .expect((r) => expect((r.body as RecommendationBody[]).length).toBe(1));
    });
  });
});
