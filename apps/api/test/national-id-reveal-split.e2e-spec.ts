import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Office-scoped custom RBAC, PHASE 3 workstream E — revealing a national ID stops
 * riding on the permission that lets you read the record.
 *
 * Part 10.2 classifies a national ID Highly Confidential. Three of the four
 * controls around it already worked before this: the column is encrypted at rest,
 * every reveal requires a >=10-character written justification, and every reveal
 * writes an audited READ flagged `isSensitiveDataAccess`. The GATE was the part
 * that did not distinguish "open this record" from "read this person's national
 * identity number".
 *
 * ## The two splits differ, deliberately
 *
 * EMPLOYEE — per ROUTE. `RevealEmployeeFieldDto` accepts only `nationalId`, so
 * the route gate is the field gate. `employee.manage` became `employee.read`
 * (a rename in place, so nobody lost the ability to read an employee) plus
 * `employee.create`, `employee.update`, and `employee.national-id.reveal` for
 * Compliance alone.
 *
 * CUSTOMER — per FIELD. The same endpoint also reveals `contactPhone` and
 * `contactEmail`, which a Sales/Relationship Officer needs for ordinary work on a
 * customer they own. Moving the whole route to Compliance would have stopped an
 * officer phoning their own client, so `customer.360-view.read` still governs the
 * route and the contact fields, and `customer.national-id.reveal` is additionally
 * required for the national ID.
 *
 * The last test is the one this file exists to prove: the KYC path still works.
 * Splitting a Highly Confidential reveal away from the reading permission is
 * pointless if it stops Compliance verifying an identity document.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const REASON =
  'Verifying the identity document against the KYC file on record.';

let app: INestApplication<App> | null = null;
const tag = Math.random().toString(36).slice(2, 8);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}

async function makeUser(
  label: string,
  ...roleNames: string[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Reveal Split ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as { accessToken: string; user: { id: string } };

  const enroll = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  const secret = /[?&]secret=([^&]+)/.exec(enrollBody.otpAuthUri)![1];
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  for (const name of roleNames) {
    const role = await ensureRole(name);
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: body.user.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: body.user.id, roleId: role.id },
      });
    }
  }
  return { accessToken: body.accessToken, userId: body.user.id };
}

beforeAll(async () => {
  app = await createTestApp();
}, 240_000);

afterAll(async () => {
  await app?.close();
  app = null;
});

describe('the employee split is per route', () => {
  it('needs employee.national-id.reveal — and employee.read is not enough', async () => {
    // The administrator holds `employee.read`, `employee.create` and
    // `employee.update` after the rename, and does NOT hold the reveal. Before
    // this split it held all four through one code.
    const admin = await makeUser(
      `emp-admin-${tag}`,
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const created = await request(app!.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        givenName: 'Nadia',
        familyName: `Haddad ${tag}`,
        nationalId: '9881234567',
        hireDate: '2026-01-05',
      })
      .expect(201);
    const employeeId = (created.body as { id: string }).id;

    // Reading and correcting: allowed.
    await request(app!.getHttpServer())
      .get(`/employees/${employeeId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app!.getHttpServer())
      .patch(`/employees/${employeeId}`)
      .set(bearer(admin.accessToken))
      .send({ position: 'Senior Underwriter' })
      .expect(200);

    // Revealing the national ID: refused. THE reduction.
    await request(app!.getHttpServer())
      .post(`/employees/${employeeId}/reveal-field`)
      .set(bearer(admin.accessToken))
      .send({ field: 'nationalId', reason: REASON })
      .expect(403);

    // Compliance holds the reveal and nothing else changed for it.
    const compliance = await makeUser(
      `emp-compliance-${tag}`,
      'COMPLIANCE_OFFICER',
    );
    const revealed = await request(app!.getHttpServer())
      .post(`/employees/${employeeId}/reveal-field`)
      .set(bearer(compliance.accessToken))
      .send({ field: 'nationalId', reason: REASON })
      .expect(201);
    expect((revealed.body as { value: string }).value).toBe('9881234567');
  }, 300_000);

  it('still requires the justification and still writes an audited sensitive read', async () => {
    // The split must not disturb what already worked. A gate change that
    // accidentally bypassed the reason or the audit row would be a worse outcome
    // than the gap it closed.
    const admin = await makeUser(
      `emp-admin-audit-${tag}`,
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const compliance = await makeUser(
      `emp-compliance-audit-${tag}`,
      'COMPLIANCE_OFFICER',
    );
    const created = await request(app!.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        givenName: 'Omar',
        familyName: `Saleh ${tag}`,
        nationalId: '9887654321',
        hireDate: '2026-02-02',
      })
      .expect(201);
    const employeeId = (created.body as { id: string }).id;

    // Too short a reason is still a 400, at the DTO boundary.
    await request(app!.getHttpServer())
      .post(`/employees/${employeeId}/reveal-field`)
      .set(bearer(compliance.accessToken))
      .send({ field: 'nationalId', reason: 'because' })
      .expect(400);

    await request(app!.getHttpServer())
      .post(`/employees/${employeeId}/reveal-field`)
      .set(bearer(compliance.accessToken))
      .send({ field: 'nationalId', reason: REASON })
      .expect(201);

    const entry = await prisma.auditLogEntry.findFirst({
      where: {
        entityType: 'Employee',
        entityId: employeeId,
        action: 'READ',
        isSensitiveDataAccess: true,
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(
      entry,
      'the reveal must still be an audited sensitive read',
    ).not.toBeNull();
  }, 300_000);
});

describe('the customer split is per field', () => {
  it('refuses the national ID but still allows the contact fields', async () => {
    // The whole reason this one is per field. A Sales/Relationship Officer owns
    // their customers and needs a phone number to do their job; they have no
    // business reading a national identity number, and before this they could.
    const sales = await makeUser(
      `cust-sales-${tag}`,
      'SALES_RELATIONSHIP_OFFICER',
    );
    const created = await request(app!.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'INDIVIDUAL',
        givenName: 'Layla',
        familyName: `Mansour ${tag}`,
        nationalId: '9901010101',
        contactPhone: '+962-7-9111-2222',
        contactEmail: `layla-${tag}@example.test`,
        languagePreference: 'AR',
      })
      .expect(201);
    const customerId = (created.body as { id: string }).id;

    // Their own customer's phone and email: still theirs to see.
    const phone = await request(app!.getHttpServer())
      .post(`/customers/${customerId}/reveal-field`)
      .set(bearer(sales.accessToken))
      .send({ field: 'contactPhone', reason: REASON })
      .expect(201);
    expect((phone.body as { value: string }).value).toBe('+962-7-9111-2222');
    await request(app!.getHttpServer())
      .post(`/customers/${customerId}/reveal-field`)
      .set(bearer(sales.accessToken))
      .send({ field: 'contactEmail', reason: REASON })
      .expect(201);

    // The national ID on the SAME endpoint, same customer, same owner: refused.
    await request(app!.getHttpServer())
      .post(`/customers/${customerId}/reveal-field`)
      .set(bearer(sales.accessToken))
      .send({ field: 'nationalId', reason: REASON })
      .expect(403);
  }, 300_000);

  it('does not let the four other 360-view holders reveal a national ID either', async () => {
    // `customer.360-view.read` is held by five roles. Compliance keeps the reveal;
    // the Manager, the Executive and the External Auditor do not, and the Sales
    // Officer above did not.
    const sales = await makeUser(
      `cust-owner-${tag}`,
      'SALES_RELATIONSHIP_OFFICER',
    );
    const created = await request(app!.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'INDIVIDUAL',
        givenName: 'Rami',
        familyName: `Khoury ${tag}`,
        nationalId: '9902020202',
        contactPhone: '+962-7-9333-4444',
        contactEmail: `rami-${tag}@example.test`,
        languagePreference: 'AR',
      })
      .expect(201);
    const customerId = (created.body as { id: string }).id;

    for (const roleName of [
      'BRANCH_DEPARTMENT_MANAGER',
      'EXECUTIVE_MANAGEMENT',
      'EXTERNAL_AUDITOR',
    ]) {
      const actor = await makeUser(
        `cust-${roleName.slice(0, 10)}-${tag}`,
        roleName,
      );
      // They can still open the file — cross-owner visibility is untouched.
      await request(app!.getHttpServer())
        .get(`/customers/${customerId}`)
        .set(bearer(actor.accessToken))
        .expect(200);
      await request(app!.getHttpServer())
        .post(`/customers/${customerId}/reveal-field`)
        .set(bearer(actor.accessToken))
        .send({ field: 'nationalId', reason: REASON })
        .expect(403);
    }
  }, 300_000);

  it('KEEPS THE KYC PATH WORKING — Compliance reveals the national ID and reaches the file', async () => {
    // The test this file exists for. Splitting a Highly Confidential reveal away
    // from the reading permission is pointless if it stops Compliance verifying an
    // identity document, so the whole KYC chain is walked end to end afterwards
    // rather than just the reveal.
    const sales = await makeUser(
      `kyc-sales-${tag}`,
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      `kyc-compliance-${tag}`,
      'COMPLIANCE_OFFICER',
    );
    const created = await request(app!.getHttpServer())
      .post('/customers')
      .set(bearer(sales.accessToken))
      .send({
        customerType: 'INDIVIDUAL',
        givenName: 'Hana',
        familyName: `Darwish ${tag}`,
        nationalId: '9903030303',
        contactPhone: '+962-7-9555-6666',
        contactEmail: `hana-${tag}@example.test`,
        languagePreference: 'AR',
      })
      .expect(201);
    const customerId = (created.body as { id: string }).id;

    // Compliance reaches the customer cross-owner (`customer.all-owners.read`,
    // Phase 2) and can reveal the identity field it needs to verify.
    await request(app!.getHttpServer())
      .get(`/customers/${customerId}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const revealed = await request(app!.getHttpServer())
      .post(`/customers/${customerId}/reveal-field`)
      .set(bearer(compliance.accessToken))
      .send({ field: 'nationalId', reason: REASON })
      .expect(201);
    expect((revealed.body as { value: string }).value).toBe('9903030303');

    // And the KYC file it exists to serve is still reachable. The Sales Officer
    // who owns the customer opens the file; Compliance reads it cross-owner
    // (`kyc.approve`, unchanged by this phase) — so the reviewer who must verify
    // the identity document can both see the file and read the field it is
    // verified against, which is the whole capability the split had to preserve.
    const started = await request(app!.getHttpServer())
      .post(`/customers/${customerId}/kyc`)
      .set(bearer(sales.accessToken))
      .expect(201);
    const kycId = (started.body as { id: string }).id;

    await request(app!.getHttpServer())
      .get(`/kyc-records/${kycId}`)
      .set(bearer(compliance.accessToken))
      .expect(200);

    // And the reveal was audited as a sensitive read against the customer, which
    // is what ties the identity check to the file for an auditor.
    const entry = await prisma.auditLogEntry.findFirst({
      where: {
        entityType: 'Customer',
        entityId: customerId,
        action: 'READ',
        isSensitiveDataAccess: true,
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(
      entry,
      'the KYC reveal must be an audited sensitive read',
    ).not.toBeNull();
  }, 300_000);
});
