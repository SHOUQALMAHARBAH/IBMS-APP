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
interface NeedsAssessmentBody {
  id: string;
  status: string;
  riskProfileId: string;
  createdByUserId: string;
  reviewedByUserId: string | null;
  approvedByUserId: string | null;
  recommendedCoverageLines: string[];
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
    .send({ fullName: 'Needs Assessment Test User', email, password: PASSWORD })
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

/** Every question answered — booleans as given (default false), employeeCount
 * as given (default 0). */
function fullAnswers(
  overrides: Record<string, boolean | number> = {},
): Record<string, boolean | number> {
  const base: Record<string, boolean | number> = {
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
  return { ...base, ...overrides };
}

describe('Needs Assessment (e2e) — backlog Part C #5', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  async function createCustomerAndRiskProfile(
    salesToken: string,
  ): Promise<{ customerId: string; riskProfileId: string }> {
    const customerRes = await request(app.getHttpServer())
      .post('/customers')
      .set(bearer(salesToken))
      .send({
        customerType: 'INDIVIDUAL',
        legalName: 'Needs Assessment Subject',
        nationalId: '9901019999',
        contactPhone: '+962-7-9000-1234',
        contactEmail: 'na-subject@example.test',
        languagePreference: 'EN',
      })
      .expect(201);
    const customerId = (customerRes.body as CustomerBody).id;

    const rpRes = await request(app.getHttpServer())
      .post('/risk-profiles')
      .set(bearer(salesToken))
      .send({ customerId, siteLabel: 'Head office' })
      .expect(201);
    return {
      customerId,
      riskProfileId: (rpRes.body as RiskProfileBody).id,
    };
  }

  describe('POST /risk-profiles', () => {
    it('is forbidden without risk-profile.create (e.g. a Claims Officer)', async () => {
      const app = await boot();
      const claims = await makeUser(app, 'na-rp-claims', 'CLAIMS_OFFICER');
      await request(app.getHttpServer())
        .post('/risk-profiles')
        .set(bearer(claims.accessToken))
        .send({ customerId: '00000000-0000-0000-0000-000000000000' })
        .expect(403);
    });
  });

  describe('POST /needs-assessments', () => {
    it('is forbidden for a role without needs-assessment.create (a Manager only approves)', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'na-create-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'na-create-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const { riskProfileId } = await createCustomerAndRiskProfile(
        sales.accessToken,
      );
      await request(app.getHttpServer())
        .post('/needs-assessments')
        .set(bearer(manager.accessToken))
        .send({ riskProfileId, questionnaireAnswers: fullAnswers() })
        .expect(403);
    });

    it('rejects an incomplete questionnaire', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'na-create-bad',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const { riskProfileId } = await createCustomerAndRiskProfile(
        sales.accessToken,
      );
      const incomplete = fullAnswers();
      delete incomplete.publicVisitsPremises;
      await request(app.getHttpServer())
        .post('/needs-assessments')
        .set(bearer(sales.accessToken))
        .send({ riskProfileId, questionnaireAnswers: incomplete })
        .expect(400);
    });

    it('derives the recommended coverage list from the answers and starts in DRAFT', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'na-create-ok',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const { riskProfileId } = await createCustomerAndRiskProfile(
        sales.accessToken,
      );
      const res = await request(app.getHttpServer())
        .post('/needs-assessments')
        .set(bearer(sales.accessToken))
        .send({
          riskProfileId,
          questionnaireAnswers: fullAnswers({
            ownsOrLeasesPremises: true,
            employeeCount: 20,
            operatesVehicleFleet: true,
          }),
        })
        .expect(201);
      const body = res.body as NeedsAssessmentBody;
      expect(body.status).toBe('DRAFT');
      expect(body.createdByUserId).toBe(sales.userId);
      expect(body.recommendedCoverageLines).toEqual([
        'Property All Risks (Fire)',
        'Workers Compensation',
        'Motor Fleet',
      ]);
    });
  });

  describe('review + approval flow', () => {
    it('submit -> review -> approve, stamping the reviewer then the approver', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'na-flow-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'na-flow-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const { riskProfileId } = await createCustomerAndRiskProfile(
        sales.accessToken,
      );
      const created = await request(app.getHttpServer())
        .post('/needs-assessments')
        .set(bearer(sales.accessToken))
        .send({
          riskProfileId,
          questionnaireAnswers: fullAnswers({
            providesProfessionalAdvice: true,
          }),
        })
        .expect(201);
      const id = (created.body as NeedsAssessmentBody).id;

      await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/submit`)
        .set(bearer(sales.accessToken))
        .expect(201)
        .expect((r) =>
          expect((r.body as NeedsAssessmentBody).status).toBe('PENDING_REVIEW'),
        );

      // A Sales Officer cannot review — no needs-assessment.approve.
      await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/review`)
        .set(bearer(sales.accessToken))
        .expect(403);

      const reviewed = await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/review`)
        .set(bearer(manager.accessToken))
        .expect(201);
      expect((reviewed.body as NeedsAssessmentBody).status).toBe('REVIEWED');
      expect((reviewed.body as NeedsAssessmentBody).reviewedByUserId).toBe(
        manager.userId,
      );

      const approved = await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/approve`)
        .set(bearer(manager.accessToken))
        .expect(201);
      expect((approved.body as NeedsAssessmentBody).status).toBe('APPROVED');
      expect((approved.body as NeedsAssessmentBody).approvedByUserId).toBe(
        manager.userId,
      );

      // APPROVED is terminal — a further move is rejected.
      await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/review`)
        .set(bearer(manager.accessToken))
        .expect(422);
    });

    it('enforces maker/checker: a dual-hatted user cannot review an assessment they captured', async () => {
      const app = await boot();
      const dual = await makeUser(
        app,
        'na-dual',
        'SALES_RELATIONSHIP_OFFICER',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const { riskProfileId } = await createCustomerAndRiskProfile(
        dual.accessToken,
      );
      const created = await request(app.getHttpServer())
        .post('/needs-assessments')
        .set(bearer(dual.accessToken))
        .send({ riskProfileId, questionnaireAnswers: fullAnswers() })
        .expect(201);
      const id = (created.body as NeedsAssessmentBody).id;

      await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/submit`)
        .set(bearer(dual.accessToken))
        .expect(201);

      // Holds needs-assessment.approve, so this is not a permission 403 —
      // it is the maker/checker guard rejecting self-review.
      await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/review`)
        .set(bearer(dual.accessToken))
        .expect(403);
    });

    it('returns an assessment to DRAFT with a mandatory reason, then it is editable again', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'na-return-sales',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'na-return-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const { riskProfileId } = await createCustomerAndRiskProfile(
        sales.accessToken,
      );
      const created = await request(app.getHttpServer())
        .post('/needs-assessments')
        .set(bearer(sales.accessToken))
        .send({ riskProfileId, questionnaireAnswers: fullAnswers() })
        .expect(201);
      const id = (created.body as NeedsAssessmentBody).id;

      await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/submit`)
        .set(bearer(sales.accessToken))
        .expect(201);

      // No reason -> 400.
      await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/return`)
        .set(bearer(manager.accessToken))
        .send({})
        .expect(400);

      const returned = await request(app.getHttpServer())
        .post(`/needs-assessments/${id}/return`)
        .set(bearer(manager.accessToken))
        .send({
          reason: 'Add the cyber question answer — client stores card data.',
        })
        .expect(201);
      expect((returned.body as NeedsAssessmentBody).status).toBe('DRAFT');
      expect(
        (returned.body as NeedsAssessmentBody).reviewedByUserId,
      ).toBeNull();

      // Editable again now it is back in DRAFT.
      const edited = await request(app.getHttpServer())
        .patch(`/needs-assessments/${id}`)
        .set(bearer(sales.accessToken))
        .send({
          questionnaireAnswers: fullAnswers({
            handlesPersonalOrPaymentData: true,
          }),
        })
        .expect(200);
      expect(
        (edited.body as NeedsAssessmentBody).recommendedCoverageLines,
      ).toEqual(['Cyber']);
    });
  });

  describe('visibility', () => {
    it("hides another Sales Officer's assessment (404) but a Manager sees the whole queue", async () => {
      const app = await boot();
      const salesA = await makeUser(
        app,
        'na-vis-a',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const salesB = await makeUser(
        app,
        'na-vis-b',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const manager = await makeUser(
        app,
        'na-vis-mgr',
        'BRANCH_DEPARTMENT_MANAGER',
      );
      const { riskProfileId } = await createCustomerAndRiskProfile(
        salesA.accessToken,
      );
      const created = await request(app.getHttpServer())
        .post('/needs-assessments')
        .set(bearer(salesA.accessToken))
        .send({ riskProfileId, questionnaireAnswers: fullAnswers() })
        .expect(201);
      const id = (created.body as NeedsAssessmentBody).id;

      await request(app.getHttpServer())
        .get(`/needs-assessments/${id}`)
        .set(bearer(salesB.accessToken))
        .expect(404);

      const managerList = await request(app.getHttpServer())
        .get('/needs-assessments')
        .set(bearer(manager.accessToken))
        .expect(200);
      expect(
        (managerList.body as NeedsAssessmentBody[]).some((a) => a.id === id),
      ).toBe(true);
    });
  });

  describe('GET /needs-assessments/questionnaire', () => {
    it('returns the fixed question set', async () => {
      const app = await boot();
      const sales = await makeUser(
        app,
        'na-questionnaire',
        'SALES_RELATIONSHIP_OFFICER',
      );
      const res = await request(app.getHttpServer())
        .get('/needs-assessments/questionnaire')
        .set(bearer(sales.accessToken))
        .expect(200);
      const body = res.body as {
        questions: Array<{ id: string; prompt: string; type: string }>;
        coverageLines: string[];
      };
      expect(body.questions.length).toBeGreaterThan(5);
      expect(body.questions.every((q) => q.id && q.prompt && q.type)).toBe(
        true,
      );
      expect(body.coverageLines).toContain('Cyber');
    });
  });
});
