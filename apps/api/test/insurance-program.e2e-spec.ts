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
interface NeedsAssessmentBody {
  id: string;
  status: string;
  recommendedCoverageLines: string[];
}
interface ProgramLineBody {
  id: string;
  insuranceLine: string;
  sumInsuredBasis: string | null;
}
interface ProgramBody {
  id: string;
  status: string;
  riskProfileId: string;
  needsAssessmentId: string | null;
  lines: ProgramLineBody[];
  context: {
    needsAssessmentId: string | null;
    needsAssessmentStatus: string | null;
    recommendedCoverageLines: string[];
    customerId: string | null;
    surveyComplete: boolean;
    sumInsured: { propertySumInsured: string; assetCount: number };
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
    .send({
      fullName: 'Insurance Program Test User',
      email,
      password: PASSWORD,
    })
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

describe('Product Recommendation / Program Design (e2e) — backlog Part C #7', () => {
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
        legalName: 'Program Subject',
        nationalId: '9902020000',
        contactPhone: '+962-7-9000-4321',
        contactEmail: 'ip-subject@example.test',
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

  /** A DRAFT needs assessment with the given answers, submitted, reviewed and
   * approved by `managerToken`. Returns the APPROVED assessment id. */
  async function approvedNeedsAssessment(
    salesToken: string,
    managerToken: string,
    riskProfileId: string,
    answers: Record<string, boolean | number>,
  ): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/needs-assessments')
      .set(bearer(salesToken))
      .send({ riskProfileId, questionnaireAnswers: answers })
      .expect(201);
    const id = (created.body as NeedsAssessmentBody).id;
    await request(app.getHttpServer())
      .post(`/needs-assessments/${id}/submit`)
      .set(bearer(salesToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/needs-assessments/${id}/review`)
      .set(bearer(managerToken))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/needs-assessments/${id}/approve`)
      .set(bearer(managerToken))
      .expect(201);
    return id;
  }

  describe('permissions', () => {
    it('rejects assembling a program without program.assemble (a Sales Officer)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'ip-perm-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'ip-perm-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);
      const naId = await approvedNeedsAssessment(
        sales.accessToken,
        manager.accessToken,
        rpId,
        { ...FULL_ANSWERS, ownsOrLeasesPremises: true },
      );

      await request(app.getHttpServer())
        .post('/insurance-programs')
        .set(bearer(sales.accessToken))
        .send({ needsAssessmentId: naId })
        .expect(403);
    });
  });

  describe('assembly', () => {
    it('assembles a multi-line program, seeding Property All Risks from the survey', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'ip-asm-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'ip-asm-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const placement = await makeUser(
        app,
        'ip-asm-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);

      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'building', declaredValue: '500000' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'stock', declaredValue: '120000.500' })
        .expect(201);

      const naId = await approvedNeedsAssessment(
        sales.accessToken,
        manager.accessToken,
        rpId,
        {
          ...FULL_ANSWERS,
          ownsOrLeasesPremises: true, // Property All Risks (Fire)
          holdsPhysicalStock: true, // + Burglary
          publicVisitsPremises: true, // Public Liability
        },
      );

      const res = await request(app.getHttpServer())
        .post('/insurance-programs')
        .set(bearer(placement.accessToken))
        .send({ needsAssessmentId: naId })
        .expect(201);
      const body = res.body as ProgramBody;

      expect(body.status).toBe('DRAFT');
      expect(body.riskProfileId).toBe(rpId);
      expect(body.context.customerId).toBe(customerId);
      expect(body.context.surveyComplete).toBe(true);
      expect(body.lines.map((l) => l.insuranceLine).sort()).toEqual(
        ['Burglary', 'Property All Risks', 'Public Liability'].sort(),
      );
      const property = body.lines.find(
        (l) => l.insuranceLine === 'Property All Risks',
      );
      // Prisma.Decimal's JSON serialization normalizes trailing zeros.
      expect(Number(property?.sumInsuredBasis)).toBe(620000.5);
      const publicLiability = body.lines.find(
        (l) => l.insuranceLine === 'Public Liability',
      );
      expect(publicLiability?.sumInsuredBasis).toBeNull();
    });

    it('refuses to assemble from a needs assessment that is not APPROVED', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'ip-notappr-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const placement = await makeUser(
        app,
        'ip-notappr-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);
      const created = await request(app.getHttpServer())
        .post('/needs-assessments')
        .set(bearer(sales.accessToken))
        .send({
          riskProfileId: rpId,
          questionnaireAnswers: { ...FULL_ANSWERS, ownsOrLeasesPremises: true },
        })
        .expect(201);
      const naId = (created.body as NeedsAssessmentBody).id;

      await request(app.getHttpServer())
        .post('/insurance-programs')
        .set(bearer(placement.accessToken))
        .send({ needsAssessmentId: naId })
        .expect(422);
    });

    it('refuses a second live program for the same risk profile (409)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'ip-dup-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'ip-dup-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const placement = await makeUser(
        app,
        'ip-dup-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);
      const naId = await approvedNeedsAssessment(
        sales.accessToken,
        manager.accessToken,
        rpId,
        { ...FULL_ANSWERS, ownsOrLeasesPremises: true },
      );

      await request(app.getHttpServer())
        .post('/insurance-programs')
        .set(bearer(placement.accessToken))
        .send({ needsAssessmentId: naId })
        .expect(201);
      await request(app.getHttpServer())
        .post('/insurance-programs')
        .set(bearer(placement.accessToken))
        .send({ needsAssessmentId: naId })
        .expect(409);
    });

    it('two concurrent assemblies for one risk profile produce exactly one program (DB unique index)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'ip-race-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'ip-race-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const placement = await makeUser(
        app,
        'ip-race-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);
      const naId = await approvedNeedsAssessment(
        sales.accessToken,
        manager.accessToken,
        rpId,
        { ...FULL_ANSWERS, ownsOrLeasesPremises: true },
      );

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/insurance-programs')
          .set(bearer(placement.accessToken))
          .send({ needsAssessmentId: naId }),
        request(app.getHttpServer())
          .post('/insurance-programs')
          .set(bearer(placement.accessToken))
          .send({ needsAssessmentId: naId }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const list = await request(app.getHttpServer())
        .get(`/insurance-programs?customerId=${customerId}`)
        .set(bearer(placement.accessToken))
        .expect(200);
      expect((list.body as ProgramBody[]).length).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('assemble -> finalize -> reopen -> re-assemble', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'ip-life-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'ip-life-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const placement = await makeUser(
        app,
        'ip-life-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(sales.accessToken);
      const rpId = await createRiskProfile(sales.accessToken, customerId);
      const naId = await approvedNeedsAssessment(
        sales.accessToken,
        manager.accessToken,
        rpId,
        { ...FULL_ANSWERS, ownsOrLeasesPremises: true },
      );

      const assembled = await request(app.getHttpServer())
        .post('/insurance-programs')
        .set(bearer(placement.accessToken))
        .send({ needsAssessmentId: naId })
        .expect(201);
      const programId = (assembled.body as ProgramBody).id;

      await request(app.getHttpServer())
        .post(`/insurance-programs/${programId}/finalize`)
        .set(bearer(placement.accessToken))
        .expect(201)
        .expect((r) =>
          expect((r.body as ProgramBody).status).toBe('FINALIZED'),
        );

      // A FINALIZED program cannot be re-assembled in place.
      await request(app.getHttpServer())
        .post(`/insurance-programs/${programId}/reassemble`)
        .set(bearer(placement.accessToken))
        .expect(422);

      await request(app.getHttpServer())
        .post(`/insurance-programs/${programId}/reopen`)
        .set(bearer(placement.accessToken))
        .expect(201)
        .expect((r) => expect((r.body as ProgramBody).status).toBe('DRAFT'));

      // After adding an asset, a re-assembly updates the Property basis.
      await request(app.getHttpServer())
        .post(`/risk-profiles/${rpId}/assets`)
        .set(bearer(sales.accessToken))
        .send({ assetType: 'building', declaredValue: '1000000' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/insurance-programs/${programId}/reassemble`)
        .set(bearer(placement.accessToken))
        .expect(201)
        .expect((r) => {
          const line = (r.body as ProgramBody).lines.find(
            (l) => l.insuranceLine === 'Property All Risks',
          );
          expect(Number(line?.sumInsuredBasis)).toBe(1000000);
        });
    });
  });

  describe('visibility', () => {
    it("hides another Sales Officer's program (404) but the owner and a Placement Officer can read it", async () => {
      const app = await boot();
      const salesA = await makeUser(
        app,
        'ip-vis-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const salesB = await makeUser(
        app,
        'ip-vis-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'ip-vis-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const placement = await makeUser(
        app,
        'ip-vis-plc',
        'PLACEMENT_TECHNICAL_OFFICER',
      );
      const customerId = await createCustomer(salesA.accessToken);
      const rpId = await createRiskProfile(salesA.accessToken, customerId);
      const naId = await approvedNeedsAssessment(
        salesA.accessToken,
        manager.accessToken,
        rpId,
        { ...FULL_ANSWERS, ownsOrLeasesPremises: true },
      );
      const assembled = await request(app.getHttpServer())
        .post('/insurance-programs')
        .set(bearer(placement.accessToken))
        .send({ needsAssessmentId: naId })
        .expect(201);
      const programId = (assembled.body as ProgramBody).id;

      await request(app.getHttpServer())
        .get(`/insurance-programs/${programId}`)
        .set(bearer(salesB.accessToken))
        .expect(404);
      await request(app.getHttpServer())
        .get(`/insurance-programs/${programId}`)
        .set(bearer(salesA.accessToken))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/insurance-programs?customerId=${customerId}`)
        .set(bearer(placement.accessToken))
        .expect(200)
        .expect((r) => expect((r.body as ProgramBody[]).length).toBe(1));
    });
  });
});
