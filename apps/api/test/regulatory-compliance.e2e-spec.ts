import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const FAR_FUTURE = '2099-01-01';

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
interface BrokerLicenseBody {
  id: string;
  licenseNumber: string;
  status: string;
  isCurrentlyLapsed: boolean;
}
interface ComplianceCalendarItemBody {
  id: string;
  obligationName: string;
  ownerUserId: string;
  dueDate: string;
  evidenceOfSubmissionRef: string | null;
  submittedAt: string | null;
  isSubmitted: boolean;
  isOverdue: boolean;
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
    .send({
      fullName: 'Regulatory Compliance E2E User',
      email,
      password: PASSWORD,
    })
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
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { revokedAt: null },
      create: { userId: user.id, roleId: role.id },
    });
  }
  return { accessToken, userId: user.id };
}

describe('Regulatory Compliance (e2e) — backlog Part C #51', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates and manages the broker license singleton (create/renew/mark-lapsed/get), restoring a safe state before finishing', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'rc-lic-compliance',
      'COMPLIANCE_OFFICER',
    );
    const other = await makeUser(
      app,
      'rc-lic-other',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // non-Compliance is forbidden on every route
    await request(app.getHttpServer())
      .post('/broker-license')
      .set(bearer(other.accessToken))
      .send({ licenseNumber: 'X', expiresAt: FAR_FUTURE })
      .expect(403);
    await request(app.getHttpServer())
      .get('/broker-license')
      .set(bearer(other.accessToken))
      .expect(403);

    // db-test is cumulative (project memory) — a prior run may already have
    // created the singleton, so setup tolerates a 409 rather than assuming
    // a clean slate.
    const created = await request(app.getHttpServer())
      .post('/broker-license')
      .set(bearer(compliance.accessToken))
      .send({
        licenseNumber: 'CBJ-RC-E2E-1',
        scopeOfAuthorization: 'General insurance brokerage',
        issuedAt: '2026-01-01',
        expiresAt: FAR_FUTURE,
      });
    expect([201, 409]).toContain(created.status);
    if (created.status === 409) {
      // a second create attempt is a 409 regardless — proves the guard
      // itself, not just that setup happened to collide with a prior run
      const secondAttempt = await request(app.getHttpServer())
        .post('/broker-license')
        .set(bearer(compliance.accessToken))
        .send({ licenseNumber: 'X', expiresAt: FAR_FUTURE })
        .expect(409);
      expect(secondAttempt.status).toBe(409);
    }

    // No `finally` here (ESLint's `no-unsafe-finally` — a `throw` inside
    // `finally` would silently swallow a genuine assertion failure from the
    // `try` block below it). Instead the restore runs unconditionally right
    // after the try/catch, and whichever failed — the test body, the
    // restore, or both — is what actually throws.
    let testError: unknown = null;
    try {
      const renewed = await request(app.getHttpServer())
        .post('/broker-license/renew')
        .set(bearer(compliance.accessToken))
        .send({
          licenseNumber: 'CBJ-RC-E2E-2',
          scopeOfAuthorization: 'General insurance brokerage',
          issuedAt: '2026-01-01',
          expiresAt: FAR_FUTURE,
        })
        .expect(201);
      const renewedBody = renewed.body as BrokerLicenseBody;
      expect(renewedBody.licenseNumber).toBe('CBJ-RC-E2E-2');
      expect(renewedBody.status).toBe('active');
      expect(renewedBody.isCurrentlyLapsed).toBe(false);

      const got = await request(app.getHttpServer())
        .get('/broker-license')
        .set(bearer(compliance.accessToken))
        .expect(200);
      expect((got.body as BrokerLicenseBody).licenseNumber).toBe(
        'CBJ-RC-E2E-2',
      );

      const lapsed = await request(app.getHttpServer())
        .post('/broker-license/mark-lapsed')
        .set(bearer(compliance.accessToken))
        .expect(201);
      expect((lapsed.body as BrokerLicenseBody).status).toBe('lapsed');
      expect((lapsed.body as BrokerLicenseBody).isCurrentlyLapsed).toBe(true);

      // idempotent re-mark
      const lapsedAgain = await request(app.getHttpServer())
        .post('/broker-license/mark-lapsed')
        .set(bearer(compliance.accessToken))
        .expect(201);
      expect((lapsedAgain.body as BrokerLicenseBody).status).toBe('lapsed');
    } catch (err) {
      testError = err;
    }

    // ALWAYS restore — a leftover lapsed singleton would 422 every Policy
    // `place()` call in every e2e file that runs afterward
    // (vitest-e2e.config.ts's fileParallelism: false makes this sufficient,
    // not just best-effort). A @code-reviewer MAJOR on the first pass: only
    // checking isCurrentlyLapsed when restored.status === 201 misses the
    // more likely failure mode (renew itself returning a non-201) — both
    // are asserted unconditionally now.
    const restored = await request(app.getHttpServer())
      .post('/broker-license/renew')
      .set(bearer(compliance.accessToken))
      .send({ licenseNumber: 'CBJ-RC-E2E-1', expiresAt: FAR_FUTURE });
    if (restored.status !== 201) {
      throw new Error(
        `Broker license restore failed (status ${restored.status}: ${JSON.stringify(restored.body)}) — every subsequent e2e file placing a Policy would now be blocked.` +
          (testError
            ? ` Also, the test body itself failed: ${(testError as Error).message}`
            : ''),
      );
    }
    if ((restored.body as BrokerLicenseBody).isCurrentlyLapsed) {
      throw new Error(
        'Broker license restore did not clear isCurrentlyLapsed — every subsequent e2e file placing a Policy would now be blocked.' +
          (testError
            ? ` Also, the test body itself failed: ${(testError as Error).message}`
            : ''),
      );
    }
    if (testError instanceof Error) throw testError;
    if (testError) throw new Error(JSON.stringify(testError));
  });

  it('logs, filters, and records submission on compliance calendar items', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'rc-cal-compliance',
      'COMPLIANCE_OFFICER',
    );
    const owner = await makeUser(app, 'rc-cal-owner', 'COMPLIANCE_OFFICER');
    const other = await makeUser(
      app,
      'rc-cal-other',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .post('/compliance-calendar')
      .set(bearer(other.accessToken))
      .send({
        obligationName: 'x',
        ownerUserId: owner.userId,
        dueDate: '2026-12-01',
      })
      .expect(403);

    // unknown owner -> 404
    await request(app.getHttpServer())
      .post('/compliance-calendar')
      .set(bearer(compliance.accessToken))
      .send({
        obligationName: 'Quarterly CBJ prudential return',
        ownerUserId: '00000000-0000-0000-0000-000000000000',
        dueDate: '2026-12-01',
      })
      .expect(404);

    // one item already overdue (unsubmitted, due in the past)
    const overdueCreated = await request(app.getHttpServer())
      .post('/compliance-calendar')
      .set(bearer(compliance.accessToken))
      .send({
        obligationName: 'Annual AML training attestation',
        ownerUserId: owner.userId,
        dueDate: '2020-01-01',
      })
      .expect(201);
    const overdueId = (overdueCreated.body as ComplianceCalendarItemBody).id;
    expect((overdueCreated.body as ComplianceCalendarItemBody).isOverdue).toBe(
      true,
    );

    // one item due in the future, not overdue
    const futureCreated = await request(app.getHttpServer())
      .post('/compliance-calendar')
      .set(bearer(compliance.accessToken))
      .send({
        obligationName: 'Quarterly CBJ prudential return',
        ownerUserId: owner.userId,
        dueDate: '2099-01-01',
      })
      .expect(201);
    const futureId = (futureCreated.body as ComplianceCalendarItemBody).id;
    expect((futureCreated.body as ComplianceCalendarItemBody).isOverdue).toBe(
      false,
    );

    // GET :id
    await request(app.getHttpServer())
      .get(`/compliance-calendar/${overdueId}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    await request(app.getHttpServer())
      .get('/compliance-calendar/00000000-0000-0000-0000-000000000000')
      .set(bearer(compliance.accessToken))
      .expect(404);

    // list filtered by this run's owner + overdueOnly returns exactly the
    // one overdue item (book-wide reads see every prior run's rows too, so
    // scope by this test's own owner, the established db-test-is-cumulative
    // pattern).
    const overdueList = await request(app.getHttpServer())
      .get(`/compliance-calendar?ownerUserId=${owner.userId}&overdueOnly=true`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const overdueBodies = overdueList.body as ComplianceCalendarItemBody[];
    expect(overdueBodies.map((b) => b.id)).toEqual([overdueId]);

    const ownerList = await request(app.getHttpServer())
      .get(`/compliance-calendar?ownerUserId=${owner.userId}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect(
      (ownerList.body as ComplianceCalendarItemBody[]).map((b) => b.id).sort(),
    ).toEqual([overdueId, futureId].sort());

    // record-submission clears isOverdue
    const submitted = await request(app.getHttpServer())
      .post(`/compliance-calendar/${overdueId}/record-submission`)
      .set(bearer(compliance.accessToken))
      .send({ evidenceOfSubmissionRef: 'doc://cbj-training-2026' })
      .expect(201);
    const submittedBody = submitted.body as ComplianceCalendarItemBody;
    expect(submittedBody.isSubmitted).toBe(true);
    expect(submittedBody.isOverdue).toBe(false);
    expect(submittedBody.evidenceOfSubmissionRef).toBe(
      'doc://cbj-training-2026',
    );

    // write-once — a second submission attempt 409s
    await request(app.getHttpServer())
      .post(`/compliance-calendar/${overdueId}/record-submission`)
      .set(bearer(compliance.accessToken))
      .send({ evidenceOfSubmissionRef: 'doc://second-attempt' })
      .expect(409);

    // a CREATE audit row per item + an UPDATE on the submission
    const createRows = await prisma.auditLogEntry.count({
      where: {
        entityType: 'ComplianceCalendarItem',
        entityId: { in: [overdueId, futureId] },
        action: 'CREATE',
      },
    });
    expect(createRows).toBe(2);
    const updateRows = await prisma.auditLogEntry.count({
      where: {
        entityType: 'ComplianceCalendarItem',
        entityId: overdueId,
        action: 'UPDATE',
      },
    });
    expect(updateRows).toBe(1);
  });
});
