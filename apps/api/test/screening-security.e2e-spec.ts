import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * Part B §34 — the security surface of screening, tested deliberately rather
 * than assumed from the permission decorators.
 *
 * Ten categories, each with its own test:
 *
 *   1  provider configuration authorization
 *   2  provider capability authorization
 *   3  dataset publication authorization
 *   4  dataset rollback authorization
 *   5  case assignment authorization
 *   6  case decision authorization
 *   7  hold release authorization
 *   8  cross-owner isolation
 *   9  secret leakage
 *  10  sensitive-data leakage in audit rows
 *
 * On (8): this system has no "office" concept. Its isolation boundary is
 * per-customer OWNERSHIP — a Sales Officer sees the files they captured, and a
 * cross-owner role (manager, auditor) sees the book. That is the boundary
 * tested here, and it is enforced with 404 rather than 403 so a response
 * cannot be used as an existence oracle for another officer's customer.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const SECRET_LOOKING = 'sk-live-DO-NOT-LEAK-0123456789';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
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
  return decodeURIComponent(match[1]);
}

let app: INestApplication<App> | null = null;
async function boot(): Promise<INestApplication<App>> {
  app ??= await createTestApp();
  return app;
}
afterAll(async () => {
  await app?.close();
  app = null;
});

async function makeUser(
  application: INestApplication<App>,
  label: string,
  role: RoleName,
): Promise<{ accessToken: string; id: string }> {
  const email = uniqueEmail(label);
  await request(application.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `E2E ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(application.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as IssuedSessionBody;

  const enroll = await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  const roleRow = await prisma.role.upsert({
    where: { name: role },
    update: {},
    create: { name: role },
  });
  const existing = await prisma.userRoleAssignment.findFirst({
    where: { userId: body.user.id, roleId: roleRow.id, revokedAt: null },
  });
  if (!existing) {
    await prisma.userRoleAssignment.create({
      data: { userId: body.user.id, roleId: roleRow.id },
    });
  }
  return { accessToken: body.accessToken, id: body.user.id };
}

let seq = 0;
async function makeKycFile(ownerUserId: string, legalName: string) {
  seq += 1;
  const customer = await prisma.customer.create({
    data: { customerType: 'INDIVIDUAL', legalName, ownerUserId },
  });
  const kyc = await prisma.kYCRecord.create({
    data: { customerId: customer.id, createdByUserId: ownerUserId },
  });
  return { customerId: customer.id, kycId: kyc.id };
}

async function makeMatch(kycRecordId: string, subject: string) {
  seq += 1;
  const match = await prisma.screeningMatch.create({
    data: {
      kycRecordId,
      entrySource: 'OFAC_SDN',
      entryFullName: 'Zzz Fictional Screening Fixture',
      subjectName: subject,
      subjectCanonical: `${subject.toLowerCase()}-${seq}`,
      matchType: 'exact',
      listType: 'SANCTIONS',
      status: 'pending',
    },
  });
  return match.id;
}

describe('Part B §34 — screening authorization', () => {
  it('1. provider CONFIGURATION is not readable without sanctions-pep.screen', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'sec-cfg-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'sec-cfg-compliance',
      'COMPLIANCE_OFFICER',
    );

    await request(application.getHttpServer())
      .get('/screening/providers/config')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(application.getHttpServer())
      .get('/screening/providers/config')
      .set(bearer(compliance.accessToken))
      .expect(200);
  });

  it('2. provider CAPABILITIES are not readable without the permission', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'sec-cap-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(application.getHttpServer())
      .get('/screening/providers/health')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(application.getHttpServer())
      .get('/screening/overview')
      .set(bearer(sales.accessToken))
      .expect(403);
  });

  it('3. dataset PUBLICATION (running a sync) requires the permission', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'sec-pub-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(application.getHttpServer())
      .post('/watchlist-sync/run')
      .set(bearer(sales.accessToken))
      .expect(403);
    await request(application.getHttpServer())
      .get('/watchlist-sync/datasets')
      .set(bearer(sales.accessToken))
      .expect(403);
  });

  it('4. dataset ROLLBACK requires the permission, and a reason', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'sec-rb-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'sec-rb-compliance',
      'COMPLIANCE_OFFICER',
    );

    await request(application.getHttpServer())
      .post('/watchlist-sync/datasets/any-id/rollback')
      .set(bearer(sales.accessToken))
      .send({ reason: 'attempting without permission at all' })
      .expect(403);

    // With the permission but no reason: still refused. A rollback decides
    // that the newest sanctions list is NOT the one screening runs against.
    await request(application.getHttpServer())
      .post('/watchlist-sync/datasets/any-id/rollback')
      .set(bearer(compliance.accessToken))
      .send({})
      .expect(400);
  });

  it('5. case ASSIGNMENT requires the permission', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'sec-assign-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'sec-assign-compliance',
      'COMPLIANCE_OFFICER',
    );
    const { kycId } = await makeKycFile(
      compliance.id,
      'Security Assign Subject',
    );
    const matchId = await makeMatch(kycId, 'Security Assign Subject');

    await request(application.getHttpServer())
      .post(`/screening/matches/${matchId}/assign`)
      .set(bearer(sales.accessToken))
      .send({ assigneeUserId: compliance.id })
      .expect(403);
  });

  it('6. case DECISION requires the permission', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'sec-decide-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'sec-decide-compliance',
      'COMPLIANCE_OFFICER',
    );
    const { kycId } = await makeKycFile(
      compliance.id,
      'Security Decide Subject',
    );
    const matchId = await makeMatch(kycId, 'Security Decide Subject');

    await request(application.getHttpServer())
      .post(`/screening/matches/${matchId}/review`)
      .set(bearer(sales.accessToken))
      .send({
        decision: 'cleared',
        reviewReason: 'attempting a decision without the permission',
      })
      .expect(403);

    const row = await prisma.screeningMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    expect(row.status).toBe('pending');
  });

  it('7. HOLD RELEASE requires kyc.approve — capture alone cannot waive a hold', async () => {
    // The officer who captured the file must not be able to accept the
    // screening finding on it. That is the maker/checker split, and a hold
    // release is the single most consequential thing a person can do to a
    // held file.
    const application = await boot();
    const sales = await makeUser(
      application,
      'sec-hold-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const { kycId } = await makeKycFile(sales.id, 'Security Hold Subject');

    await request(application.getHttpServer())
      .post(`/kyc-records/${kycId}/approve`)
      .set(bearer(sales.accessToken))
      .send({ screeningHoldReason: 'trying to waive my own file' })
      .expect(403);
  });

  it("8. cross-owner isolation: one officer cannot read another officer's hold", async () => {
    const application = await boot();
    const owner = await makeUser(
      application,
      'sec-iso-owner',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const other = await makeUser(
      application,
      'sec-iso-other',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const { kycId } = await makeKycFile(owner.id, 'Isolated Subject');

    // 404, not 403: a response must not be usable as an existence oracle for
    // another officer's customer.
    await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(other.accessToken))
      .expect(404);

    // The owner reads it fine.
    await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(owner.accessToken))
      .expect(200);
  });

  it('8b. a cross-owner role DOES reach the whole book', async () => {
    const application = await boot();
    const owner = await makeUser(
      application,
      'sec-iso-owner2',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const manager = await makeUser(
      application,
      'sec-iso-manager',
      'COMPLIANCE_OFFICER',
    );
    const { kycId } = await makeKycFile(owner.id, 'Book Wide Subject');

    await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(manager.accessToken))
      .expect(200);
  });
});

describe('Part B §34 — leakage', () => {
  it('9. the provider API key is never returned, in any form', async () => {
    const application = await boot();
    const compliance = await makeUser(
      application,
      'sec-secret',
      'COMPLIANCE_OFFICER',
    );

    for (const path of [
      '/screening/providers/config',
      '/screening/providers/health',
      '/screening/overview',
    ]) {
      const res = await request(application.getHttpServer())
        .get(path)
        .set(bearer(compliance.accessToken))
        .expect(200);
      const serialized = JSON.stringify(res.body);

      // Not the value, and not a masked tail either — there is deliberately no
      // code path that returns any part of it.
      expect(serialized).not.toContain(SECRET_LOOKING);
      expect(serialized).not.toMatch(/sk-live/);
      expect(serialized).not.toMatch(/"apiKey"\s*:/);
      // Presence is reported as a boolean, which is what an operator needs.
      if (path === '/screening/providers/config') {
        expect(res.body).toHaveProperty('apiKeyConfigured');
        expect(
          typeof (res.body as { apiKeyConfigured: unknown }).apiKeyConfigured,
        ).toBe('boolean');
      }
    }
  });

  it('10. a case decision does not copy the subject or the reason into the audit row', async () => {
    // The reviewer's free text is the one place on a sanctions path where
    // somebody writes "our client is not the <name> on the SDN list" — a PII
    // capture point by construction. It is retained on the match row, which is
    // where a reviewer and a regulator both read it, and deliberately not
    // duplicated into a second retention regime.
    const application = await boot();
    const officer = await makeUser(
      application,
      'sec-audit',
      'COMPLIANCE_OFFICER',
    );
    const subject = 'Audit Leakage Distinctive Subject';
    const { kycId } = await makeKycFile(officer.id, subject);
    const matchId = await makeMatch(kycId, subject);
    const reason =
      'Different date of birth from the listed person; passport reviewed.';

    await request(application.getHttpServer())
      .post(`/screening/matches/${matchId}/assign`)
      .set(bearer(officer.accessToken))
      .send({ assigneeUserId: officer.id })
      .expect(201);
    await request(application.getHttpServer())
      .post(`/screening/matches/${matchId}/start-review`)
      .set(bearer(officer.accessToken))
      .expect(201);
    await request(application.getHttpServer())
      .post(`/screening/matches/${matchId}/notes`)
      .set(bearer(officer.accessToken))
      .send({ note: `Working note mentioning ${subject} explicitly.` })
      .expect(201);
    await request(application.getHttpServer())
      .post(`/screening/matches/${matchId}/review`)
      .set(bearer(officer.accessToken))
      .send({ decision: 'cleared', reviewReason: reason })
      .expect(201);

    const audit = await prisma.auditLogEntry.findMany({
      where: {
        entityType: { in: ['ScreeningMatch', 'ScreeningCaseNote'] },
        entityId: { in: [matchId] },
      },
    });
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(subject);
    expect(serialized).not.toContain(reason);

    // But the substance IS retained where it belongs.
    const row = await prisma.screeningMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    expect(row.reviewReason).toBe(reason);
  });

  it('10b. the hold view and the operations view carry no subject PII', async () => {
    const application = await boot();
    const officer = await makeUser(
      application,
      'sec-pii',
      'COMPLIANCE_OFFICER',
    );
    const subject = 'Operations Leakage Distinctive Subject';
    const { kycId } = await makeKycFile(officer.id, subject);
    await makeMatch(kycId, subject);

    const hold = await request(application.getHttpServer())
      .get(`/kyc-records/${kycId}/screening-hold`)
      .set(bearer(officer.accessToken))
      .expect(200);
    expect(JSON.stringify(hold.body)).not.toContain('Distinctive');

    const overview = await request(application.getHttpServer())
      .get('/screening/overview')
      .set(bearer(officer.accessToken))
      .expect(200);
    expect(JSON.stringify(overview.body)).not.toContain('Distinctive');
  });
});
