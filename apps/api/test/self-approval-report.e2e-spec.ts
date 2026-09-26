import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * PART 4 STEP 6 — THE SELF-APPROVAL REPORT, which is the shipping gate for COMBINED mode.
 *
 * ## Proven by CONTENT, because that is what the requirement says
 *
 * "A test that only asserts the endpoint returns 200, or that one row exists, would pass against a report that
 * cannot order itself." So the decisive test below puts TWO acts in the office — a self-review of ACCESS and a
 * self-approved REFUND, with the refund deliberately NEWER — and asserts that the access one comes FIRST while
 * both are present. Newer-on-purpose is the whole point: a report sorted by date alone would pass a test that
 * only checked "the access row is in there somewhere".
 *
 * ## Why the acts are inserted directly
 *
 * `AccessRecertificationItem` is deliberately unwired (its constraint fires on an INSERT, so wiring it changes
 * nothing for the single-operator office the condition is about — `docs/decision-reviewing-your-own-access.md`
 * puts the three options to the owner). The REPORT does not care how an act came to exist, and holding its
 * proof hostage to that decision would leave the gate unmet for a reason that has nothing to do with the
 * report. So the acts are written with raw Prisma inside a COMBINED-mode window, which is also the only way to
 * construct the access-self-review row at all today.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 8);

let app: INestApplication<App> | null = null;
const createdRoleIds: string[] = [];
const createdActIds: string[] = [];

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface ReportRow {
  id: string;
  actorName: string | null;
  pair: string;
  reason: string;
  roles: string[];
  hatAmbiguous: boolean;
  accessSelfReview: boolean;
  at: string;
}
interface ReportBody {
  office: {
    mode: string;
    declaredAt: string | null;
    declaredByName: string | null;
  };
  rows: ReportRow[];
  accessSelfReviewCount: number;
  totalCount: number;
  truncated: boolean;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function actorHolding(
  label: string,
  codes: string[],
): Promise<{ accessToken: string; userId: string }> {
  const server = (app as INestApplication<App>).getHttpServer();
  const org = await prisma.organization.findFirstOrThrow({
    orderBy: { id: 'asc' },
  });
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());

  const role = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: `${label.toUpperCase()}_${RUN}`,
      nameEn: label,
      nameAr: label,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      permissions: {
        create: permissions.map((p) => ({
          organizationId: org.id,
          permissionId: p.id,
        })),
      },
    },
    select: { id: true },
  });
  createdRoleIds.push(role.id);

  const email = `${label}-${RUN}@report.test`;
  await request(server)
    .post('/auth/signup')
    .send({ fullName: `Report ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(server)
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const eb = enroll.body as MfaEnrollBody;
  await request(server)
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: eb.credentialId,
      code: authenticator.generate(
        /[?&]secret=([^&]+)/.exec(eb.otpAuthUri)![1],
      ),
    })
    .expect(200);

  await prisma.userRoleAssignment.create({
    data: { userId: user.id, roleId: role.id },
  });
  return { accessToken, userId: user.id };
}

/**
 * Writes an act, which requires the office to be COMBINED for the duration — the trigger refuses otherwise,
 * which is the control working. The mode is put back immediately, so no other spec in the run ever observes
 * this office as anything but SEGREGATED.
 */
async function declaredAct(input: {
  actorUserId: string;
  constraintName: string;
  entity: string;
  entityId: string;
  reason: string;
  actedAt: Date;
  roles?: string[];
  multiple?: boolean;
}): Promise<string> {
  await rawPrisma.organization.update({
    where: { id: TEST_ORGANIZATION_ID },
    data: { dutySegregationMode: 'COMBINED' },
  });
  try {
    const act = await rawPrisma.combinedDutyAct.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        entity: input.entity,
        entityId: input.entityId,
        constraintName: input.constraintName,
        actorUserId: input.actorUserId,
        reason: input.reason,
        actedAt: input.actedAt,
        actorRoleIds: ['role-a'],
        grantingRoleIds: ['role-a'],
        grantingRoleNames: input.roles ?? ['OFFICE_ADMINISTRATOR'],
        multipleGrantingRoles: input.multiple ?? false,
      },
      select: { id: true },
    });
    createdActIds.push(act.id);
    return act.id;
  } finally {
    await rawPrisma.organization.update({
      where: { id: TEST_ORGANIZATION_ID },
      data: { dutySegregationMode: 'SEGREGATED' },
    });
  }
}

beforeAll(async () => {
  await rawPrisma.organization.update({
    where: { id: TEST_ORGANIZATION_ID },
    data: { dutySegregationMode: 'SEGREGATED' },
  });
  app = await createTestApp();
}, 300_000);

afterAll(async () => {
  await app?.close();
  await rawPrisma.organization.update({
    where: { id: TEST_ORGANIZATION_ID },
    data: {
      dutySegregationMode: 'SEGREGATED',
      dutySegregationModeDeclaredAt: null,
      dutySegregationModeDeclaredByUserId: null,
    },
  });
  // The acts this spec wrote are removed, because the ORDERING assertion below reads the office's whole page
  // and acts left behind would make a later run's expectations depend on run history.
  if (createdActIds.length > 0) {
    await rawPrisma.combinedDutyAct.deleteMany({
      where: { id: { in: createdActIds } },
    });
  }
  if (createdRoleIds.length > 0) {
    await prisma.userRoleAssignment.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: createdRoleIds } },
    });
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }
});

describe('the self-approval report (e2e)', () => {
  it('A SELF-REVIEW OF ACCESS SITS ABOVE A NEWER SELF-APPROVED REFUND, and both are present', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const reviewer = await actorHolding('report-reader', [
      'internal-controls.view',
    ]);
    const owner = await actorHolding('report-owner', [
      'customer.360-view.read',
    ]);

    // The refund act is deliberately NEWER. A report sorted by date alone would put it first and still contain
    // the access row — which is exactly the report this test has to be able to fail against.
    const accessActId = await declaredAct({
      actorUserId: owner.userId,
      constraintName: 'AccessRecertificationItem_maker_checker_distinct',
      entity: 'AccessRecertificationItem',
      entityId: `item-${RUN}`,
      reason: 'The only person in this office reviewed her own access.',
      actedAt: new Date('2026-03-01T09:00:00.000Z'),
      roles: ['OFFICE_ADMINISTRATOR', 'BRANCH_DEPARTMENT_MANAGER'],
      multiple: true,
    });
    const refundActId = await declaredAct({
      actorUserId: owner.userId,
      constraintName: 'Refund_maker_checker_distinct',
      entity: 'Refund',
      entityId: `refund-${RUN}`,
      reason: 'The owner raised and approved this refund herself.',
      actedAt: new Date('2026-09-20T09:00:00.000Z'),
    });

    const report = await request(server)
      .get('/internal-controls/combined-duty-acts')
      .set(bearer(reviewer.accessToken))
      .expect(200);
    const body = report.body as ReportBody;

    // BOTH PRESENT — asserted before the ordering, so "it is first" cannot be satisfied by the other row
    // being absent.
    const ids = body.rows.map((r) => r.id);
    expect(ids).toContain(accessActId);
    expect(ids).toContain(refundActId);

    // AND THE ACCESS ONE IS ABOVE THE REFUND, despite being six months older.
    expect(ids.indexOf(accessActId)).toBeLessThan(ids.indexOf(refundActId));
    // Flagged, not merely ordered: the screen renders from this, and "at the top" without a marker is a
    // position somebody re-sorts away.
    const accessRow = body.rows.find((r) => r.id === accessActId) as ReportRow;
    expect(accessRow.accessSelfReview).toBe(true);
    expect(body.accessSelfReviewCount).toBeGreaterThanOrEqual(1);
    const refundRow = body.rows.find((r) => r.id === refundActId) as ReportRow;
    expect(refundRow.accessSelfReview).toBe(false);

    // Every field the owner's spec names, on a real row.
    expect(accessRow.actorName).toBe('Report report-owner');
    expect(accessRow.pair).toBe(
      'AccessRecertificationItem_maker_checker_distinct',
    );
    expect(accessRow.reason).toContain('reviewed her own access');
    expect(accessRow.roles).toEqual([
      'OFFICE_ADMINISTRATOR',
      'BRANCH_DEPARTMENT_MANAGER',
    ]);
    // "We cannot tell which hat" surfaced as a fact rather than hidden behind a picked-first role.
    expect(accessRow.hatAmbiguous).toBe(true);

    // The office's own posture beside the acts — one without the other answers half the question.
    expect(body.office.mode).toBe('SEGREGATED');
  }, 600_000);

  it('the office has never declared a mode, and the report says which', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const reviewer = await actorHolding('report-reader-2', [
      'internal-controls.view',
    ]);
    const report = await request(server)
      .get('/internal-controls/combined-duty-acts')
      .set(bearer(reviewer.accessToken))
      .expect(200);
    const body = report.body as ReportBody;

    // NOT asserted here: that the report is empty. db-test is cumulative and `duty-segregation-combined`
    // deliberately leaves its acts behind as legitimate history, so "no acts in this office" is a state this
    // database cannot be in — an assertion on it would be a cross-spec coupling that breaks on run ORDER,
    // which this suite has been bitten by twice. The EMPTY state is a screen concern and is asserted in
    // `e2e/self-approval-report.spec.ts`, where the API is mocked and the state is constructible.
    //
    // What IS asserted is the distinction the report exists to carry: "segregated because nobody ever chose"
    // reads differently from "segregated because somebody decided on this date", and a reviewer needs to know
    // which one they are looking at.
    expect(body.office.mode).toBe('SEGREGATED');
    expect(body.office.declaredAt).toBeNull();
    expect(body.office.declaredByName).toBeNull();
    // And the page is honest about its own limit rather than letting "none shown" read as "none".
    expect(typeof body.truncated).toBe('boolean');
    expect(body.rows.length).toBeLessThanOrEqual(body.totalCount);
  }, 600_000);

  it('reading the report is itself audited — counts only, never a name', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const reviewer = await actorHolding('report-reader-3', [
      'internal-controls.view',
    ]);
    await request(server)
      .get('/internal-controls/combined-duty-acts')
      .set(bearer(reviewer.accessToken))
      .expect(200);

    const rows = await rawPrisma.auditLogEntry.findMany({
      where: {
        userId: reviewer.userId,
        action: 'READ',
        entityType: 'CombinedDutyAct',
      },
      select: { afterValue: true },
    });
    expect(rows.length).toBe(1);
    const payload = JSON.stringify(rows[0].afterValue);
    // Prove somebody looked; do not copy the report's contents into the log that the report is about.
    expect(payload).toContain('rows');
    expect(payload).not.toContain('Report report-owner');
  }, 600_000);

  it('without internal-controls.view there is no report', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    // The office administrator DECLARES the mode and does not review the acts it permits — so the person who
    // can turn this on cannot read the report about it, which is the separation the design rests on.
    const declarer = await actorHolding('report-declarer', [
      'duty-segregation.mode.declare',
    ]);
    await request(server)
      .get('/internal-controls/combined-duty-acts')
      .set(bearer(declarer.accessToken))
      .expect(403);
  }, 600_000);
});
