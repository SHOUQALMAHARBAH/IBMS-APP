import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
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
  certificateDocumentId: string;
  renewalRequestedAt: string | null;
  expiresAt: string;
}
/** Module 0 item (c): `GET /broker-license` answers the current term AND the series. */
interface BrokerLicenseSeriesBody {
  current: BrokerLicenseBody | null;
  terms: BrokerLicenseBody[];
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
    const role = await ensureRole(roleName);
    // Partial UNIQUE `UserRoleAssignment_one_active_per_user_role` (migration
    // 20260920140000) means a revoked grant is HISTORY and a new grant is a
    // new row — so this creates one only when no active grant exists, rather
    // than resurrecting a revoked one and erasing its audit trail.
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

describe('Regulatory Compliance (e2e) — backlog Part C #51', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('manages the office licence as a SERIES OF TERMS (renewal appends, certificate mandatory, filing date write-once), leaving an active term behind', async () => {
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

    // non-Compliance is forbidden on every route, including the new one
    await request(app.getHttpServer())
      .post('/broker-license')
      .set(bearer(other.accessToken))
      .send({ licenseNumber: 'X', expiresAt: FAR_FUTURE })
      .expect(403);
    await request(app.getHttpServer())
      .get('/broker-license')
      .set(bearer(other.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/broker-license/renewal-requested')
      .set(bearer(other.accessToken))
      .send({})
      .expect(403);

    const RUN = Date.now().toString(36);
    const certificate = {
      certificateFileName: 'cbj-licence-' + RUN + '.pdf',
      certificateStorageRef: 'licences/cbj-licence-' + RUN + '.pdf',
    };

    /*
     * EXPIRIES ARE DERIVED FROM WHAT ALREADY EXISTS, not pinned.
     *
     * db-test is cumulative and every run of this spec appends terms, so a fixed `expiresAt` is
     * wrong twice over: `@@unique([organizationId, licenseNumber, expiresAt])` would collide on a
     * re-run, and -- worse -- several terms sharing one expiry makes "the current term" the
     * arbitrary winner of an id tie-break, so the restore at the end could not guarantee it had
     * left an ACTIVE term current. Going past the existing maximum makes each appended term
     * unambiguously the latest.
     */
    const before = await request(app.getHttpServer())
      .get('/broker-license')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const beforeBody = before.body as BrokerLicenseSeriesBody;
    const highestYear = beforeBody.terms.reduce(
      (max, t) => Math.max(max, new Date(t.expiresAt).getUTCFullYear()),
      2030,
    );
    const expiryIn = (offset: number) => highestYear + offset + '-12-31';

    // The office already holds a term (the migration kept the pre-existing one; the seed gives a
    // fresh database one), so `create` is a 409 -- per OFFICE now, where the old 409 was
    // effectively per platform because the row was keyed by a global constant.
    await request(app.getHttpServer())
      .post('/broker-license')
      .set(bearer(compliance.accessToken))
      .send({
        licenseNumber: 'CBJ-' + RUN + '-X',
        expiresAt: expiryIn(1),
        ...certificate,
      })
      .expect(409);

    // THE CERTIFICATE IS MANDATORY. Asserted here as well as by the NOT NULL column, because this
    // is the refusal a caller actually sees -- a 400 naming the field rather than a 500 from a
    // constraint violation.
    await request(app.getHttpServer())
      .post('/broker-license/renew')
      .set(bearer(compliance.accessToken))
      .send({ licenseNumber: 'CBJ-' + RUN + '-NOCERT', expiresAt: expiryIn(1) })
      .expect(400);

    let testError: unknown = null;
    try {
      // RENEWAL APPENDS. The old implementation was an `updateMany` over one global row, so the
      // term being replaced was erased.
      const renewed = await request(app.getHttpServer())
        .post('/broker-license/renew')
        .set(bearer(compliance.accessToken))
        .send({
          licenseNumber: 'CBJ-' + RUN + '-A',
          scopeOfAuthorization: 'General insurance brokerage',
          issuedAt: '2026-01-01',
          expiresAt: expiryIn(1),
          ...certificate,
        })
        .expect(201);
      const renewedBody = renewed.body as BrokerLicenseBody;
      expect(renewedBody.licenseNumber).toBe('CBJ-' + RUN + '-A');
      expect(renewedBody.status).toBe('active');
      expect(renewedBody.isCurrentlyLapsed).toBe(false);
      // The certificate was filed and is pointed at -- not merely requested by the DTO.
      expect(renewedBody.certificateDocumentId).toBeTruthy();

      const got = await request(app.getHttpServer())
        .get('/broker-license')
        .set(bearer(compliance.accessToken))
        .expect(200);
      const series = got.body as BrokerLicenseSeriesBody;
      expect(series.current?.licenseNumber).toBe('CBJ-' + RUN + '-A');
      // THE PREVIOUS TERM SURVIVED. This is the claim the old overwrite could not satisfy, and the
      // reason an office can show a regulator what it held in an earlier period.
      expect(series.terms.length).toBeGreaterThan(beforeBody.terms.length);

      // THE FILING DATE IS WRITE-ONCE. Art. 11 measures lateness from it, so a second call must be
      // refused rather than allowed to move it.
      const filed = await request(app.getHttpServer())
        .post('/broker-license/renewal-requested')
        .set(bearer(compliance.accessToken))
        .send({ requestedAt: highestYear + 1 + '-11-01' })
        .expect(201);
      expect((filed.body as BrokerLicenseBody).renewalRequestedAt).toBe(
        highestYear + 1 + '-11-01T00:00:00.000Z',
      );
      await request(app.getHttpServer())
        .post('/broker-license/renewal-requested')
        .set(bearer(compliance.accessToken))
        .send({ requestedAt: highestYear + 1 + '-12-20' })
        .expect(409);

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

    /*
     * ALWAYS RESTORE -- and it matters MORE than it did before. A leftover lapsed current term used
     * to 422 every Policy `place()` in every later e2e file; since Module 0 item (c) an office with
     * NO usable term is refused too, so this is the only thing standing between this test and every
     * subsequent placement failing.
     *
     * Restores by APPENDING a later term rather than by editing the lapsed one, because that is
     * what a renewal now is. Its expiry is past everything above, so it is unambiguously current.
     *
     * No `finally` (ESLint `no-unsafe-finally`): a throw there would swallow a genuine assertion
     * failure from the try block.
     */
    const restored = await request(app.getHttpServer())
      .post('/broker-license/renew')
      .set(bearer(compliance.accessToken))
      .send({
        licenseNumber: 'CBJ-' + RUN + '-RESTORE',
        expiresAt: expiryIn(3),
        ...certificate,
      });
    if (restored.status !== 201) {
      throw new Error(
        'Broker license restore failed (status ' +
          restored.status +
          ': ' +
          JSON.stringify(restored.body) +
          ') -- every subsequent e2e file placing a Policy would now be blocked.' +
          (testError
            ? ' Also, the test body itself failed: ' +
              (testError as Error).message
            : ''),
      );
    }
    if ((restored.body as BrokerLicenseBody).isCurrentlyLapsed) {
      throw new Error(
        'Broker license restore did not clear isCurrentlyLapsed -- every subsequent e2e file placing a Policy would now be blocked.' +
          (testError
            ? ' Also, the test body itself failed: ' +
              (testError as Error).message
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
