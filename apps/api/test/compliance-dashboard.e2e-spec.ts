import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function uniqueLabel(base: string): string {
  return `${base} ${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface ComplianceDashboardBody {
  kyc: { byStatus: Record<string, number> };
  complaints: {
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
  };
  complianceExceptions: {
    openAmlAlertsCount: number;
    amlByPatternType: Record<string, number>;
    lastSelfApprovalScan: { asOf: string; violationCount: number } | null;
  };
  regulatoryFilings: {
    totalCount: number;
    submittedCount: number;
    overdueCount: number;
    pendingCount: number;
  };
  dsr: { openCount: number; byStatus: Record<string, number> };
  breachRegister: { openCount: number; byStatus: Record<string, number> };
  dpiaBacklog: {
    pendingReviewCount: number;
    byOutcome: Record<string, number>;
  };
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
      fullName: 'Compliance Dashboard E2E User',
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

describe('Compliance Dashboard (e2e) — backlog Part E / Process #64', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind dashboard.compliance.view', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'cd-outsider',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/dashboards/compliance')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('scopes KYC/complaints/DSR/AML sections to one branch, but never regulatory filings/breach register/DPIA backlog (no owner relation on those)', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'cd-manager-branch',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const branch = await prisma.branch.create({
      data: { name: uniqueLabel('Compliance Dashboard E2E Branch') },
    });
    const officer = await makeUser(
      app,
      'cd-branch-officer',
      'COMPLIANCE_OFFICER',
    );
    await prisma.user.update({
      where: { id: officer.userId },
      data: { branchId: branch.id },
    });

    const customer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Compliance Dashboard E2E Co'),
        ownerUserId: officer.userId,
      },
    });

    await prisma.kYCRecord.create({
      data: {
        customerId: customer.id,
        status: 'PERIODIC_REVIEW_DUE',
        createdByUserId: officer.userId,
      },
    });
    await prisma.complaint.create({
      data: {
        customerId: customer.id,
        issue: 'Delayed policy issuance',
        category: 'delayed_issuance',
        status: 'IN_PROGRESS',
      },
    });
    await prisma.dataSubjectRequest.create({
      data: {
        customerId: customer.id,
        type: 'ACCESS',
        status: 'RECEIVED',
        slaDueAt: daysFromNow(15),
      },
    });
    await prisma.transactionMonitoringAlert.create({
      data: {
        customerId: customer.id,
        patternType: 'other',
        status: 'open',
        detailText: uniqueLabel('e2e alert'),
      },
    });

    const scoped = (
      await request(app.getHttpServer())
        .get(`/dashboards/compliance?branchId=${branch.id}`)
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as ComplianceDashboardBody;

    expect(scoped.kyc.byStatus.PERIODIC_REVIEW_DUE).toBe(1);
    expect(scoped.complaints.byStatus.IN_PROGRESS).toBe(1);
    expect(scoped.complaints.byCategory.delayed_issuance).toBe(1);
    expect(scoped.dsr.byStatus.RECEIVED).toBe(1);
    expect(scoped.dsr.openCount).toBe(1);
    expect(scoped.complianceExceptions.openAmlAlertsCount).toBe(1);
    expect(scoped.complianceExceptions.amlByPatternType.other).toBe(1);

    const otherBranch = await prisma.branch.create({
      data: { name: uniqueLabel('Compliance Dashboard E2E Other Branch') },
    });
    const emptyScoped = (
      await request(app.getHttpServer())
        .get(`/dashboards/compliance?branchId=${otherBranch.id}`)
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as ComplianceDashboardBody;
    expect(emptyScoped.kyc.byStatus.PERIODIC_REVIEW_DUE).toBe(0);
    expect(emptyScoped.dsr.openCount).toBe(0);
  });

  it('surfaces a fresh overdue filing, an open breach-register entry, and a pending DPIA screening as BEFORE/AFTER deltas (db-test is cumulative, and none of the three has a branch/owner dimension)', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'cd-compliance-delta',
      'COMPLIANCE_OFFICER',
    );

    const before = (
      await request(app.getHttpServer())
        .get('/dashboards/compliance')
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as ComplianceDashboardBody;

    await prisma.complianceCalendarItem.create({
      data: {
        obligationName: uniqueLabel('CBJ e2e overdue filing'),
        ownerUserId: compliance.userId,
        dueDate: daysAgo(30),
      },
    });
    await prisma.incidentReport.create({
      data: {
        title: uniqueLabel('E2E test incident'),
        description:
          'A synthetic incident for the Compliance Dashboard e2e walk.',
        severity: 'low',
        status: 'REPORTED',
      },
    });
    await prisma.dpiaScreening.create({
      data: {
        subjectDescription: uniqueLabel('E2E test DPIA subject'),
        qSensitiveData: true,
        qLargeScaleProcessing: false,
        qCrossBorderTransfer: false,
        qNewTechnologyMonitoring: false,
        qNewDigitalChannel: false,
        outcome: 'DPO_REVIEW_REQUIRED',
        dpoReviewDueAt: daysFromNow(5),
      },
    });

    const after = (
      await request(app.getHttpServer())
        .get('/dashboards/compliance')
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as ComplianceDashboardBody;

    expect(after.regulatoryFilings.overdueCount).toBe(
      before.regulatoryFilings.overdueCount + 1,
    );
    expect(after.regulatoryFilings.totalCount).toBe(
      before.regulatoryFilings.totalCount + 1,
    );
    expect(after.breachRegister.byStatus.REPORTED).toBe(
      (before.breachRegister.byStatus.REPORTED ?? 0) + 1,
    );
    expect(after.breachRegister.openCount).toBe(
      before.breachRegister.openCount + 1,
    );
    expect(after.dpiaBacklog.pendingReviewCount).toBe(
      before.dpiaBacklog.pendingReviewCount + 1,
    );
    expect(after.dpiaBacklog.byOutcome.DPO_REVIEW_REQUIRED).toBe(
      (before.dpiaBacklog.byOutcome.DPO_REVIEW_REQUIRED ?? 0) + 1,
    );
  });

  it('reads the most recent Internal Controls self-approval scan, not a live re-scan', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'cd-compliance-scan',
      'COMPLIANCE_OFFICER',
    );

    // A far-future occurredAt guarantees this row is the most recent one,
    // regardless of what internal-controls.e2e-spec.ts's own tests wrote in
    // this shared, cumulative db-test.
    await prisma.auditLogEntry.create({
      data: {
        userId: compliance.userId,
        action: 'READ',
        entityType: 'InternalControlsAuditReport',
        entityId: 'self-approval-audit',
        afterValue: {
          generatedAt: '2036-01-01T00:00:00.000Z',
          pairsScanned: 16,
          totalRowsChecked: 999,
          violationCount: 7,
        },
        occurredAt: daysFromNow(3650),
      },
    });

    const res = (
      await request(app.getHttpServer())
        .get('/dashboards/compliance')
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as ComplianceDashboardBody;

    expect(res.complianceExceptions.lastSelfApprovalScan).toEqual({
      asOf: '2036-01-01T00:00:00.000Z',
      violationCount: 7,
    });
  });
});
