import { randomUUID } from 'node:crypto';
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
function uniqueLabel(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
interface EmployeePerformanceRecordBody {
  id: string;
  employeeId: string;
  periodLabel: string;
  newClients: number | null;
  premiumWrittenJod: string | null;
  commissionEarnedJod: string | null;
  renewalRatePercent: string | null;
  crossSellRatePercent: string | null;
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
      fullName: 'Employee Performance E2E User',
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

describe('Employee Performance (e2e) — backlog Part C #61', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates every route behind employee-performance.view', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'ep-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const bogusId = randomUUID();

    await request(app.getHttpServer())
      .post('/employee-performance/compute')
      .set(bearer(outsider.accessToken))
      .send({ employeeId: bogusId })
      .expect(403);
    await request(app.getHttpServer())
      .get('/employee-performance')
      .set(bearer(outsider.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/employee-performance/${bogusId}/latest`)
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('rejects a partial period override', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'ep-manager-bad',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const employee = await prisma.employee.create({
      data: {
        fullName: uniqueLabel('Partial Period Employee'),
        nationalIdEnc: 'enc',
      },
    });

    await request(app.getHttpServer())
      .post('/employee-performance/compute')
      .set(bearer(manager.accessToken))
      .send({ employeeId: employee.id, periodLabel: 'x' })
      .expect(422);
  });

  it('404s an employee with no linked User account', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'ep-manager-orphan',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const orphanEmployee = await prisma.employee.create({
      data: { fullName: uniqueLabel('Orphan Employee'), nationalIdEnc: 'enc' },
    });

    await request(app.getHttpServer())
      .post('/employee-performance/compute')
      .set(bearer(manager.accessToken))
      .send({ employeeId: orphanEmployee.id })
      .expect(404);
  });

  it('resolves the default period to the previous UTC calendar month when no period override is given', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'ep-manager-default',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const employee = await prisma.employee.create({
      data: {
        fullName: uniqueLabel('Default Period Employee'),
        nationalIdEnc: 'enc',
      },
    });
    await prisma.user.create({
      data: {
        fullName: 'Default Period Scored User',
        email: uniqueEmail('ep-scored-default'),
        passwordHash: 'unused-scored-user',
        employeeId: employee.id,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/employee-performance/compute')
      .set(bearer(manager.accessToken))
      .send({ employeeId: employee.id })
      .expect(201);
    const body = res.body as EmployeePerformanceRecordBody;
    expect(body.periodLabel).toMatch(/^\d{4}-\d{2}$/);
    expect(body.employeeId).toBe(employee.id);
  });

  it('computes real metrics from real Customer/Policy/CommissionLedgerEntry/RenewalCase/CrossSellOpportunity data, and a recompute upserts rather than duplicating', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'ep-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    const employee = await prisma.employee.create({
      data: {
        fullName: uniqueLabel('Employee Performance E2E'),
        nationalIdEnc: 'enc',
      },
    });
    const scoredUser = await prisma.user.create({
      data: {
        fullName: 'Employee Performance E2E Scored User',
        email: uniqueEmail('ep-scored'),
        passwordHash: 'unused-scored-user',
        employeeId: employee.id,
      },
    });
    const insurer = await prisma.insurer.create({
      data: { name: uniqueLabel('Employee Performance E2E Insurer') },
    });

    const periodLabel = uniqueLabel('2020-06');
    const periodStart = '2020-06-01';
    const periodEnd = '2020-07-01';
    const inPeriod = new Date('2020-06-10T00:00:00.000Z');

    // New clients: one attributable Customer (via a Prospect this employee
    // owns), one NOT attributable (no Prospect at all) — the latter must
    // not be counted for anyone.
    const prospect = await prisma.prospect.create({
      data: {
        companyName: uniqueLabel('EP E2E Prospect'),
        salesOwnerUserId: scoredUser.id,
      },
    });
    const attributableCustomer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('EP E2E Attributable Co'),
        ownerUserId: scoredUser.id,
        prospectId: prospect.id,
        createdAt: inPeriod,
      },
    });
    await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('EP E2E Unattributable Co'),
        ownerUserId: scoredUser.id,
        createdAt: inPeriod,
      },
    });

    // Premium written + commission earned: one policy this employee placed,
    // issued, with a commission entry.
    const opportunity1 = await prisma.opportunity.create({
      data: { customerId: attributableCustomer.id },
    });
    const policy1 = await prisma.policy.create({
      data: {
        opportunityId: opportunity1.id,
        customerId: attributableCustomer.id,
        insurerId: insurer.id,
        insuranceLine: 'property',
        requestedPremium: '10000.000',
        issuedPremium: '10000.000',
        placedByUserId: scoredUser.id,
        createdAt: inPeriod,
      },
    });
    await prisma.commissionLedgerEntry.create({
      data: { policyId: policy1.id, amount: '1500.000', createdAt: inPeriod },
    });

    // Renewal rate: two more policies placed by the same employee, each
    // with a RenewalCase reaching a different terminal outcome (RenewalCase
    // has no application writer anywhere in this codebase today — seeded
    // directly to prove the query logic itself is correct and
    // forward-compatible, the #56 precedent).
    const opportunity2 = await prisma.opportunity.create({
      data: { customerId: attributableCustomer.id },
    });
    const policy2 = await prisma.policy.create({
      data: {
        opportunityId: opportunity2.id,
        customerId: attributableCustomer.id,
        insurerId: insurer.id,
        insuranceLine: 'motor',
        requestedPremium: '5000.000',
        placedByUserId: scoredUser.id,
        createdAt: inPeriod,
      },
    });
    await prisma.renewalCase.create({
      data: { policyId: policy2.id, status: 'RENEWED', triggeredAt: inPeriod },
    });
    const opportunity3 = await prisma.opportunity.create({
      data: { customerId: attributableCustomer.id },
    });
    const policy3 = await prisma.policy.create({
      data: {
        opportunityId: opportunity3.id,
        customerId: attributableCustomer.id,
        insurerId: insurer.id,
        insuranceLine: 'motor',
        requestedPremium: '5000.000',
        placedByUserId: scoredUser.id,
        createdAt: inPeriod,
      },
    });
    await prisma.renewalCase.create({
      data: { policyId: policy3.id, status: 'LAPSED', triggeredAt: inPeriod },
    });

    // Cross-sell rate: two resolved opportunities on this employee's
    // customer, one converted, one dismissed.
    await prisma.crossSellOpportunity.create({
      data: {
        customerId: attributableCustomer.id,
        gapLine: 'Public Liability',
        status: 'CONVERTED',
        detectedAt: inPeriod,
      },
    });
    await prisma.crossSellOpportunity.create({
      data: {
        customerId: attributableCustomer.id,
        gapLine: 'Business Interruption',
        status: 'DISMISSED',
        detectedAt: inPeriod,
      },
    });

    const compute1 = (
      await request(app.getHttpServer())
        .post('/employee-performance/compute')
        .set(bearer(manager.accessToken))
        .send({ employeeId: employee.id, periodLabel, periodStart, periodEnd })
        .expect(201)
    ).body as EmployeePerformanceRecordBody;
    expect(compute1.newClients).toBe(1);
    expect(compute1.premiumWrittenJod).toBe('10000.000');
    expect(compute1.commissionEarnedJod).toBe('1500.000');
    expect(compute1.renewalRatePercent).toBe('50.00');
    expect(compute1.crossSellRatePercent).toBe('50.00');

    const listed = (
      await request(app.getHttpServer())
        .get('/employee-performance')
        .query({ employeeId: employee.id, periodLabel })
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as EmployeePerformanceRecordBody[];
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(compute1.id);

    const latest = (
      await request(app.getHttpServer())
        .get(`/employee-performance/${employee.id}/latest`)
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as EmployeePerformanceRecordBody;
    expect(latest.periodLabel).toBe(periodLabel);

    // Recompute for the same employee+period must UPSERT, not duplicate.
    const compute2 = (
      await request(app.getHttpServer())
        .post('/employee-performance/compute')
        .set(bearer(manager.accessToken))
        .send({ employeeId: employee.id, periodLabel, periodStart, periodEnd })
        .expect(201)
    ).body as EmployeePerformanceRecordBody;
    expect(compute2.id).toBe(compute1.id);
    const afterRecompute = (
      await request(app.getHttpServer())
        .get('/employee-performance')
        .query({ employeeId: employee.id, periodLabel })
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as EmployeePerformanceRecordBody[];
    expect(afterRecompute).toHaveLength(1);
  });

  it("scopes the list to one branch via the employee's linked User.branchId — Part E Insurer & Employee Performance Dashboard addition", async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'ep-manager-branch',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const branch = await prisma.branch.create({
      data: { name: uniqueLabel('Employee Performance E2E Branch') },
    });
    const employee = await prisma.employee.create({
      data: {
        fullName: uniqueLabel('Branch-Scoped Employee'),
        nationalIdEnc: 'enc',
      },
    });
    await prisma.user.create({
      data: {
        fullName: 'Branch-Scoped Scored User',
        email: uniqueEmail('ep-branch-scored'),
        passwordHash: 'unused-scored-user',
        employeeId: employee.id,
        branchId: branch.id,
      },
    });
    const periodLabel = uniqueLabel('2020-07');

    await request(app.getHttpServer())
      .post('/employee-performance/compute')
      .set(bearer(manager.accessToken))
      .send({
        employeeId: employee.id,
        periodLabel,
        periodStart: '2020-07-01',
        periodEnd: '2020-08-01',
      })
      .expect(201);

    const scoped = (
      await request(app.getHttpServer())
        .get('/employee-performance')
        .query({ branchId: branch.id, periodLabel })
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as EmployeePerformanceRecordBody[];
    expect(scoped).toHaveLength(1);
    expect(scoped[0].employeeId).toBe(employee.id);

    const otherBranch = await prisma.branch.create({
      data: { name: uniqueLabel('Employee Performance E2E Other Branch') },
    });
    const emptyScoped = (
      await request(app.getHttpServer())
        .get('/employee-performance')
        .query({ branchId: otherBranch.id, periodLabel })
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as EmployeePerformanceRecordBody[];
    expect(emptyScoped).toHaveLength(0);
  });
});
