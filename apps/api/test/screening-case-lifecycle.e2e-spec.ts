import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * Part B §16 — the screening case lifecycle, end to end.
 *
 *   MATCH -> CASE -> ASSIGN -> UNDER_REVIEW -> FALSE_POSITIVE -> CLOSED
 *   MATCH -> CASE -> ASSIGN -> UNDER_REVIEW -> CONFIRMED      -> CLOSED
 *
 * plus escalation, invalid transitions, RBAC and the audit trail.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface CaseBody {
  id: string;
  caseStatus: string;
  status: string;
  assignedToUserId: string | null;
  escalatedToUserId: string | null;
  escalationReason: string | null;
  closedAt: string | null;
  reviewReason: string | null;
  notes: { id: string; note: string; authorUserId: string }[];
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

let caseSeq = 0;
/** A pending match with an OPEN case — what detection produces. */
async function makeCase(subject = 'Case Lifecycle Subject'): Promise<string> {
  caseSeq += 1;
  const customer = await prisma.customer.create({
    data: {
      customerType: 'INDIVIDUAL',
      legalName: subject,
      ownerUserId: 'case-lifecycle-test',
    },
  });
  const kyc = await prisma.kYCRecord.create({
    data: { customerId: customer.id, createdByUserId: 'case-lifecycle-test' },
  });
  const match = await prisma.screeningMatch.create({
    data: {
      kycRecordId: kyc.id,
      entrySource: 'OFAC_SDN',
      entryFullName: 'Zzz Fictional Screening Fixture',
      subjectName: subject,
      subjectCanonical: `${subject.toLowerCase()}-${caseSeq}`,
      matchType: 'exact',
      listType: 'SANCTIONS',
      status: 'pending',
    },
  });
  return match.id;
}

describe('Part B §16 — MATCH -> ASSIGN -> UNDER_REVIEW -> FALSE_POSITIVE -> CLOSED', () => {
  it('walks the whole path and records who did each step', async () => {
    const application = await boot();
    const officer = await makeUser(
      application,
      'case-fp',
      'COMPLIANCE_OFFICER',
    );
    const id = await makeCase();

    // A new match is an OPEN case owned by nobody.
    const initial = await request(application.getHttpServer())
      .get(`/screening/matches/${id}/case`)
      .set(bearer(officer.accessToken))
      .expect(200);
    expect((initial.body as CaseBody).caseStatus).toBe('OPEN');
    expect((initial.body as CaseBody).assignedToUserId).toBeNull();

    // ASSIGN
    const assigned = await request(application.getHttpServer())
      .post(`/screening/matches/${id}/assign`)
      .set(bearer(officer.accessToken))
      .send({ assigneeUserId: officer.id })
      .expect(201);
    expect((assigned.body as CaseBody).caseStatus).toBe('ASSIGNED');

    // A working note before any decision — the evidence trail.
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/notes`)
      .set(bearer(officer.accessToken))
      .send({
        note: 'Checked the passport scan against the SDN entry: different date of birth and nationality.',
      })
      .expect(201);

    // UNDER_REVIEW
    const started = await request(application.getHttpServer())
      .post(`/screening/matches/${id}/start-review`)
      .set(bearer(officer.accessToken))
      .expect(201);
    expect((started.body as CaseBody).caseStatus).toBe('UNDER_REVIEW');

    // FALSE POSITIVE -> CLOSED
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/review`)
      .set(bearer(officer.accessToken))
      .send({
        decision: 'cleared',
        reviewReason:
          'Different date of birth and nationality; not the listed person.',
      })
      .expect(201);

    const closed = await request(application.getHttpServer())
      .get(`/screening/matches/${id}/case`)
      .set(bearer(officer.accessToken))
      .expect(200);
    const body = closed.body as CaseBody;
    expect(body.caseStatus).toBe('CLOSED');
    expect(body.status).toBe('cleared');
    expect(body.closedAt).not.toBeNull();
    expect(body.reviewReason).toContain('not the listed person');
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].authorUserId).toBe(officer.id);

    // The audit trail carries every step, by identifier — never the subject.
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'ScreeningMatch', entityId: id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audit)).not.toContain('Case Lifecycle Subject');
  });
});

describe('Part B §16 — MATCH -> ASSIGN -> UNDER_REVIEW -> CONFIRMED -> CLOSED', () => {
  it('walks the confirming path', async () => {
    const application = await boot();
    const officer = await makeUser(
      application,
      'case-confirm',
      'COMPLIANCE_OFFICER',
    );
    const id = await makeCase('Confirmed Path Subject');

    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/assign`)
      .set(bearer(officer.accessToken))
      .send({ assigneeUserId: officer.id })
      .expect(201);
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/start-review`)
      .set(bearer(officer.accessToken))
      .expect(201);
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/review`)
      .set(bearer(officer.accessToken))
      .send({
        decision: 'confirmed',
        reviewReason:
          'Name, date of birth and national identifier all agree with the published entry.',
      })
      .expect(201);

    const row = await prisma.screeningMatch.findUniqueOrThrow({
      where: { id },
    });
    expect(row.caseStatus).toBe('CLOSED');
    expect(row.status).toBe('confirmed');
    expect(row.closedByUserId).toBe(officer.id);
  });
});

describe('Part B §16 — escalation', () => {
  it('raises the case to a named person with a written reason, who then decides it', async () => {
    const application = await boot();
    const officer = await makeUser(
      application,
      'case-esc-officer',
      'COMPLIANCE_OFFICER',
    );
    const manager = await makeUser(
      application,
      'case-esc-manager',
      'COMPLIANCE_OFFICER',
    );
    const id = await makeCase('Escalated Subject');

    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/assign`)
      .set(bearer(officer.accessToken))
      .send({ assigneeUserId: officer.id })
      .expect(201);
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/start-review`)
      .set(bearer(officer.accessToken))
      .expect(201);

    // Escalating with no reason is refused.
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/escalate`)
      .set(bearer(officer.accessToken))
      .send({ toUserId: manager.id })
      .expect(400);

    // Escalating to yourself records a handover that did not happen.
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/escalate`)
      .set(bearer(officer.accessToken))
      .send({
        toUserId: officer.id,
        reason: 'Trying to escalate to myself, which is not a handover.',
      })
      .expect(422);

    const escalated = await request(application.getHttpServer())
      .post(`/screening/matches/${id}/escalate`)
      .set(bearer(officer.accessToken))
      .send({
        toUserId: manager.id,
        reason:
          'Partial identifier agreement; needs a second opinion before clearing.',
      })
      .expect(201);
    expect((escalated.body as CaseBody).caseStatus).toBe('ESCALATED');

    // The recipient can decide it directly from ESCALATED.
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/review`)
      .set(bearer(manager.accessToken))
      .send({
        decision: 'confirmed',
        reviewReason:
          'Reviewed the identifiers with the officer; this is the listed person.',
      })
      .expect(201);

    const row = await prisma.screeningMatch.findUniqueOrThrow({
      where: { id },
    });
    expect(row.caseStatus).toBe('CLOSED');
    expect(row.escalatedToUserId).toBe(manager.id);
    expect(row.escalationReason).toContain('second opinion');
    expect(row.closedByUserId).toBe(manager.id);
  });
});

describe('Part B §16 — invalid transitions are refused', () => {
  it('a decision on a case nobody picked up is refused', async () => {
    // The rubber-stamp this queue exists to prevent: a cleared sanctions match
    // with nobody assigned, nobody having started, and no working record.
    const application = await boot();
    const officer = await makeUser(
      application,
      'case-invalid-1',
      'COMPLIANCE_OFFICER',
    );
    const id = await makeCase('Never Assigned Subject');

    const res = await request(application.getHttpServer())
      .post(`/screening/matches/${id}/review`)
      .set(bearer(officer.accessToken))
      .send({
        decision: 'cleared',
        reviewReason: 'Attempting to decide without picking the case up.',
      })
      .expect(422);
    expect((res.body as { message: string }).message).toContain('OPEN');

    const row = await prisma.screeningMatch.findUniqueOrThrow({
      where: { id },
    });
    expect(row.status).toBe('pending');
    expect(row.caseStatus).toBe('OPEN');
  });

  it('review cannot start on an unassigned case', async () => {
    const application = await boot();
    const officer = await makeUser(
      application,
      'case-invalid-2',
      'COMPLIANCE_OFFICER',
    );
    const id = await makeCase('Unassigned Start Subject');

    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/start-review`)
      .set(bearer(officer.accessToken))
      .expect(422);
  });

  it('a closed case is terminal — no notes, no re-decision, no re-assignment', async () => {
    const application = await boot();
    const officer = await makeUser(
      application,
      'case-terminal',
      'COMPLIANCE_OFFICER',
    );
    const id = await makeCase('Terminal Subject');

    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/assign`)
      .set(bearer(officer.accessToken))
      .send({ assigneeUserId: officer.id })
      .expect(201);
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/start-review`)
      .set(bearer(officer.accessToken))
      .expect(201);
    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/review`)
      .set(bearer(officer.accessToken))
      .send({
        decision: 'cleared',
        reviewReason: 'Not the listed person; identifiers differ.',
      })
      .expect(201);

    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/notes`)
      .set(bearer(officer.accessToken))
      .send({ note: 'Trying to append after closure.' })
      .expect(409);

    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/assign`)
      .set(bearer(officer.accessToken))
      .send({ assigneeUserId: officer.id })
      .expect(422);

    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/review`)
      .set(bearer(officer.accessToken))
      .send({ decision: 'confirmed', reviewReason: 'Trying to re-decide it.' })
      .expect(409);
  });

  it('a case cannot be assigned to a deactivated user', async () => {
    const application = await boot();
    const officer = await makeUser(
      application,
      'case-deactivated-actor',
      'COMPLIANCE_OFFICER',
    );
    const gone = await makeUser(
      application,
      'case-deactivated-target',
      'COMPLIANCE_OFFICER',
    );
    await prisma.user.update({
      where: { id: gone.id },
      data: { isActive: false },
    });
    const id = await makeCase('Deactivated Assign Subject');

    await request(application.getHttpServer())
      .post(`/screening/matches/${id}/assign`)
      .set(bearer(officer.accessToken))
      .send({ assigneeUserId: gone.id })
      .expect(422);
  });
});

describe('Part B §16 — RBAC', () => {
  it('a Sales Officer cannot touch any part of a case', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'case-rbac-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const officer = await makeUser(
      application,
      'case-rbac-officer',
      'COMPLIANCE_OFFICER',
    );
    const id = await makeCase('RBAC Subject');

    for (const [method, path, body] of [
      ['get', `/screening/matches/${id}/case`, undefined],
      [
        'post',
        `/screening/matches/${id}/assign`,
        { assigneeUserId: officer.id },
      ],
      ['post', `/screening/matches/${id}/start-review`, {}],
      [
        'post',
        `/screening/matches/${id}/escalate`,
        { toUserId: officer.id, reason: 'attempting without permission' },
      ],
      ['post', `/screening/matches/${id}/notes`, { note: 'no permission' }],
    ] as const) {
      const req =
        method === 'get'
          ? request(application.getHttpServer())
              .get(path)
              .set(bearer(sales.accessToken))
          : request(application.getHttpServer())
              .post(path)
              .set(bearer(sales.accessToken))
              .send(body ?? {});
      await req.expect(403);
    }
  });
});

describe('Part B §16 — the database enforces the case invariants', () => {
  beforeEach(async () => {
    // nothing to reset; each test makes its own case
  });

  it('a CLOSED case must carry a decision and a written reason', async () => {
    await boot();
    const id = await makeCase('DB Invariant Subject');
    await expect(
      prisma.screeningMatch.update({
        where: { id },
        data: { caseStatus: 'CLOSED', closedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it('a decided match cannot remain open work', async () => {
    // Without this, a confirmed sanctions match could show as untouched in the
    // queue while the screening hold already treated it as confirmed.
    await boot();
    const id = await makeCase('DB Decided Subject');
    await expect(
      prisma.screeningMatch.update({
        where: { id },
        data: {
          status: 'confirmed',
          reviewReason: 'x'.repeat(20),
          reviewedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('an ASSIGNED case must name its assignee', async () => {
    await boot();
    const id = await makeCase('DB Assignee Subject');
    await expect(
      prisma.screeningMatch.update({
        where: { id },
        data: { caseStatus: 'ASSIGNED' },
      }),
    ).rejects.toThrow();
  });

  it('an empty case note is refused', async () => {
    await boot();
    const id = await makeCase('DB Note Subject');
    await expect(
      prisma.screeningCaseNote.create({
        data: { screeningMatchId: id, note: '   ', authorUserId: 'u' },
      }),
    ).rejects.toThrow();
  });
});
