import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma, rawPrisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * MODULE 0 ITEMS (g) AND (f) — the CBJ approval marker, and the minimum-staff refusal, over REAL
 * HTTP.
 *
 * ## Why these are proven here and not only in unit tests
 *
 * Both rules are held by SERVICES and by nothing else:
 *
 *   - item (g)'s "a branch needs an approval to belong to", "exactly one catalogue" and "a date
 *     needs a status" live in `EmployeeCbjApprovalService`. The database backs the last one with a
 *     CHECK, but the message a writer sees comes from the service.
 *   - item (f)'s minimum-staff refusal lives in `BrokerLicenseScopeService` and reads a repository
 *     from ANOTHER module. A missing provider is a runtime DI failure TypeScript cannot see — item
 *     (e)'s first wiring had exactly that — so a 200/422 from the real route is the only thing that
 *     proves the dependency resolves.
 *
 * ## db-test is cumulative, so everything written here is restored
 *
 * The approval marker changes what item (f) allows for EVERY later spec in the run, so the two
 * employees borrowed below have their prior status recorded and put back, and the last test asserts
 * the office's approved-staff count is what it was at the start. An office left with two approvals
 * would make item (f) silently unprovable afterwards.
 *
 * Measured at the time of writing: db-test's only office records 0 employees with a CURRENT CBJ
 * approval and no termination date (its 7 migrated rows are all terminated staff), which is exactly
 * the state item (f)'s refusal needs and the reason the generalised form of that rule was wrong —
 * see the service.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}

/**
 * A RUN-UNIQUE family name, and this is not cosmetic.
 *
 * `POST /employees` pre-checks for an active person of the same canonical name and answers 409.
 * db-test is CUMULATIVE, so a fixed name makes this file pass once and then fail on every later run
 * with a duplicate-person conflict — which is exactly what happened, and it made three plants look
 * as though they killed three tests each when two of the three failures were the fixture.
 *
 * The lesson is already in this repository (a fixture with fixed values in a cumulative database is
 * not re-runnable), and deleting the rows afterwards is the WRONG fix: nothing here deletes an
 * `Employee`, and the approval FK is RESTRICT because the record of who was approved is evidence.
 */
function uniqueFamilyName(): string {
  return `الاختبار-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
interface ApprovalBody {
  status: string | null;
  approvalDate: string | null;
  types: string[];
  branches: { id: string; category: string; code: string | null }[];
  countsTowardMinimumStaff: boolean;
}
interface ScopeBody {
  brokerLicenseId: string;
  types: string[];
  staffing: {
    requiredApprovedStaff: number;
    currentApprovedStaff: number;
    meetsRequirement: boolean;
  };
  branches: { id: string; category: string; code: string | null }[];
}

let app: INestApplication<App> | null = null;

/** COPIED from `broker-license-scope.e2e-spec.ts`, not reconstructed — a paraphrased HTTP contract
 *  is a guess, and this helper's route names have already been invented wrong once. */
async function makeUser(
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const target = app as INestApplication<App>;
  const email = uniqueEmail(label);
  await request(target.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'CBJ Approval E2E User', email, password: PASSWORD })
    .expect(201);
  const login = await request(target.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(target.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(target.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await ensureRole(roleName);
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

beforeAll(async () => {
  app = await createTestApp();
}, 300_000);

afterAll(async () => {
  if (app) await app.close();
  app = null;
});

describe('CBJ approval marker (e2e) — Module 0 item (g)', () => {
  it('records an approval with its branches, refuses the half-written shapes, and withdraws cleanly', async () => {
    const target = app as INestApplication<App>;
    const hr = await makeUser('cbj-hr', 'OFFICE_ADMINISTRATOR');
    const other = await makeUser('cbj-other', 'SALES_RELATIONSHIP_OFFICER');

    // A person to approve. Created through the real route, so the employee exists exactly as the
    // application makes them.
    const createdPerson = await request(target.getHttpServer())
      .post('/employees')
      .set(bearer(hr.accessToken))
      .send({
        givenName: 'نور',
        familyName: uniqueFamilyName(),
        nationalId: `19${Date.now()}`.slice(0, 10),
        hireDate: '2024-03-04',
      })
      .expect(201);
    const employeeId = (createdPerson.body as { id: string }).id;

    const generalLine = await rawPrisma.insuranceLine.findFirstOrThrow({
      where: { category: 'GENERAL' },
      orderBy: { displayOrder: 'asc' },
    });
    const lifeLine = await rawPrisma.insuranceLine.findFirstOrThrow({
      where: { category: 'LIFE' },
      orderBy: { displayOrder: 'asc' },
    });

    try {
      // ---- the permission gate, on both halves ----
      await request(target.getHttpServer())
        .patch(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(other.accessToken))
        .send({ status: 'CURRENT' })
        .expect(403);
      await request(target.getHttpServer())
        .get(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(other.accessToken))
        .expect(403);

      // ---- a person with no approval is an ANSWER, not a 404 ----
      const empty = await request(target.getHttpServer())
        .get(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .expect(200);
      const emptyBody = empty.body as ApprovalBody;
      expect(emptyBody.status).toBeNull();
      expect(emptyBody.types).toEqual([]);
      expect(emptyBody.countsTowardMinimumStaff).toBe(false);

      // ---- A BRANCH CANNOT BELONG TO AN APPROVAL THAT DOES NOT EXIST ----
      // Without this the derivation would report a person as approved for a type on the strength of
      // a branch with no approval behind it.
      await request(target.getHttpServer())
        .post(`/employees/${employeeId}/cbj-approval/branches`)
        .set(bearer(hr.accessToken))
        .send({ insuranceLineId: generalLine.id })
        .expect(422);

      // ---- A DATE WITH NO STATUS IS REFUSED, with a message rather than a constraint 500 ----
      await request(target.getHttpServer())
        .patch(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .send({ approvalDate: '2025-06-01' })
        .expect(422);

      // ---- A DAY THAT DOES NOT EXIST ----
      // `@Matches(/^\d{4}-\d{2}-\d{2}$/)` admits 2026-02-30, which parses cleanly to 2 March
      // (IMPROVEMENTS § 1.63). The round trip is what catches it, and 422 is what a writer sees.
      await request(target.getHttpServer())
        .patch(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .send({ status: 'CURRENT', approvalDate: '2026-02-30' })
        .expect(422);
      // ...while the wrong SHAPE is a 400 from the DTO, a different message for a different problem.
      await request(target.getHttpServer())
        .patch(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .send({ status: 'CURRENT', approvalDate: '01/06/2025' })
        .expect(400);

      // ---- the approval itself ----
      const recorded = await request(target.getHttpServer())
        .patch(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .send({ status: 'CURRENT', approvalDate: '2025-06-01' })
        .expect(200);
      const recordedBody = recorded.body as ApprovalBody;
      expect(recordedBody.status).toBe('CURRENT');
      expect(recordedBody.approvalDate).toBe('2025-06-01');
      expect(recordedBody.countsTowardMinimumStaff).toBe(true);

      // ---- exactly one catalogue: neither, and both ----
      await request(target.getHttpServer())
        .post(`/employees/${employeeId}/cbj-approval/branches`)
        .set(bearer(hr.accessToken))
        .send({})
        .expect(422);
      const officeLine = await rawPrisma.officeInsuranceLine.findFirst({
        where: {
          organizationId: (await rawPrisma.organization.findFirstOrThrow()).id,
        },
      });
      if (officeLine) {
        await request(target.getHttpServer())
          .post(`/employees/${employeeId}/cbj-approval/branches`)
          .set(bearer(hr.accessToken))
          .send({
            insuranceLineId: generalLine.id,
            officeInsuranceLineId: officeLine.id,
          })
          .expect(422);
      }

      // ---- a line that does not exist reads as ABSENT ----
      await request(target.getHttpServer())
        .post(`/employees/${employeeId}/cbj-approval/branches`)
        .set(bearer(hr.accessToken))
        .send({ insuranceLineId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);

      // ---- branches, and the DERIVED types in CATALOGUE order ----
      // Added LIFE first on purpose: if the type were stored or ordered by insertion, this would
      // come back ['LIFE', 'GENERAL'].
      await request(target.getHttpServer())
        .post(`/employees/${employeeId}/cbj-approval/branches`)
        .set(bearer(hr.accessToken))
        .send({ insuranceLineId: lifeLine.id })
        .expect(201);
      const both = await request(target.getHttpServer())
        .post(`/employees/${employeeId}/cbj-approval/branches`)
        .set(bearer(hr.accessToken))
        .send({ insuranceLineId: generalLine.id })
        .expect(201);
      const bothBody = both.body as ApprovalBody;
      expect(bothBody.types).toEqual(['GENERAL', 'LIFE']);
      expect(bothBody.branches).toHaveLength(2);

      // ---- the same branch twice is refused by the partial unique ----
      await request(target.getHttpServer())
        .post(`/employees/${employeeId}/cbj-approval/branches`)
        .set(bearer(hr.accessToken))
        .send({ insuranceLineId: generalLine.id })
        .expect(409);

      // ---- SUSPENDED stops counting, and keeps the record ----
      const suspended = await request(target.getHttpServer())
        .patch(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .send({ status: 'SUSPENDED' })
        .expect(200);
      const suspendedBody = suspended.body as ApprovalBody;
      expect(suspendedBody.countsTowardMinimumStaff).toBe(false);
      // The branches and the date SURVIVE a suspension — that is the whole point of a status rather
      // than a deletion: the office can still say what this person was approved for.
      expect(suspendedBody.branches).toHaveLength(2);
      expect(suspendedBody.approvalDate).toBe('2025-06-01');

      // ---- an absent status leaves it alone; only an explicit null withdraws ----
      const dateOnly = await request(target.getHttpServer())
        .patch(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .send({ approvalDate: '2025-07-15' })
        .expect(200);
      expect((dateOnly.body as ApprovalBody).status).toBe('SUSPENDED');

      // ---- WITHDRAWING THE APPROVAL WITHDRAWS ITS BRANCHES ----
      const withdrawn = await request(target.getHttpServer())
        .patch(`/employees/${employeeId}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .send({ status: null, approvalDate: null })
        .expect(200);
      const withdrawnBody = withdrawn.body as ApprovalBody;
      expect(withdrawnBody.status).toBeNull();
      expect(withdrawnBody.branches).toEqual([]);
      expect(withdrawnBody.types).toEqual([]);

      // ---- the audit trail carries both sides of the change ----
      const rows = await prisma.auditLogEntry.findMany({
        where: {
          entityType: 'Employee',
          entityId: employeeId,
          action: 'UPDATE',
        },
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      // The branch rows are gone with the withdrawal; the employee stays, which is correct — nothing
      // in this product deletes a person, and the approval FK is RESTRICT for that reason.
      await rawPrisma.employeeCbjApprovalBranch.deleteMany({
        where: { employeeId },
      });
      await rawPrisma.employee.update({
        where: { id: employeeId },
        data: { cbjApprovalStatus: null, cbjApprovalDate: null },
      });
    }
  }, 300_000);

  it('refuses a CBJ approval typed into the free-text licensedRole, naming where it belongs', async () => {
    const target = app as INestApplication<App>;
    const hr = await makeUser('cbj-freetext', 'OFFICE_ADMINISTRATOR');

    // Both strings MEASURED in the two databases before the migration moved them — dev's 47 rows
    // and db-test's 7 — not invented examples.
    for (const text of [
      'CBJ Licensed Insurance Broker',
      'CBJ-licensed Broker Representative',
    ]) {
      const refused = await request(target.getHttpServer())
        .post('/employees')
        .set(bearer(hr.accessToken))
        .send({
          givenName: 'سامر',
          familyName: uniqueFamilyName(),
          nationalId: `17${Date.now()}`.slice(0, 10),
          hireDate: '2024-01-02',
          licensedRole: text,
        })
        .expect(400);
      // The refusal has to say where the fact goes, or the writer tries the same field again.
      expect(JSON.stringify(refused.body)).toContain('approved branches');
    }

    // ...and another real certification is still accepted, which is what the field is now for.
    const accepted = await request(target.getHttpServer())
      .post('/employees')
      .set(bearer(hr.accessToken))
      .send({
        givenName: 'ليان',
        familyName: uniqueFamilyName(),
        nationalId: `18${Date.now()}`.slice(0, 10),
        hireDate: '2024-01-03',
        licensedRole: 'Chartered Insurance Institute, Dip CII',
      })
      .expect(201);
    expect((accepted.body as { id: string }).id).toBeTruthy();
  }, 300_000);
});

describe('Minimum approved staff (e2e) — Module 0 item (f)', () => {
  it('refuses the SECOND insurance type until two approved people are on record', async () => {
    const target = app as INestApplication<App>;
    const compliance = await makeUser('staff-compliance', 'COMPLIANCE_OFFICER');
    const hr = await makeUser('staff-hr', 'OFFICE_ADMINISTRATOR');

    const generalLine = await rawPrisma.insuranceLine.findFirstOrThrow({
      where: { category: 'GENERAL' },
      orderBy: { displayOrder: 'asc' },
    });
    const lifeLine = await rawPrisma.insuranceLine.findFirstOrThrow({
      where: { category: 'LIFE' },
      orderBy: { displayOrder: 'asc' },
    });

    // The scope is shared state in a cumulative database, so whatever this test adds, it removes.
    const addedBranches: string[] = [];
    const approvedPeople: string[] = [];

    try {
      // THE ROUTE RESOLVES ITS CROSS-MODULE DEPENDENCY. A 200 carrying `staffing` is what proves
      // `EmployeeCbjApprovalRepository` is provided to the compliance-risk module — a missing
      // provider is a runtime DI failure `tsc` cannot see.
      const start = await request(target.getHttpServer())
        .get('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .expect(200);
      const startBody = start.body as ScopeBody;
      expect(startBody.staffing).toBeDefined();
      const staffAtStart = startBody.staffing.currentApprovedStaff;

      // Clear the scope so this test starts from a known shape rather than from whatever a previous
      // spec left — the branches are put back by nothing, because nothing else depends on them.
      for (const branch of startBody.branches) {
        await request(target.getHttpServer())
          .delete(`/broker-license/scope/${branch.id}`)
          .set(bearer(compliance.accessToken))
          .expect(200);
      }

      // ---- THE FIRST TYPE IS NEVER REFUSED ----
      // The reading that matters: refusing here would deadlock a brand-new office, because the
      // branch is the only thing that could justify the approved person (§ 1.62's shape).
      const first = await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: generalLine.id })
        .expect(201);
      const firstBody = first.body as ScopeBody;
      addedBranches.push(firstBody.branches[0].id);
      expect(firstBody.types).toEqual(['GENERAL']);
      expect(firstBody.staffing.requiredApprovedStaff).toBe(1);

      // ---- THE SECOND TYPE IS REFUSED while the office is short ----
      if (staffAtStart < 2) {
        const refused = await request(target.getHttpServer())
          .post('/broker-license/scope')
          .set(bearer(compliance.accessToken))
          .send({ insuranceLineId: lifeLine.id })
          .expect(422);
        // The refusal states BOTH numbers and names the remedy, rather than asserting a rule.
        const message = JSON.stringify(refused.body);
        expect(message).toContain('BOTH insurance types');
        expect(message).toContain('2 CBJ-approved people');
      }

      // ---- record the approvals, and the SAME request then succeeds ----
      for (const [index, name] of [
        ['1', 'فادي'],
        ['2', 'رانيا'],
      ].entries()) {
        const created = await request(target.getHttpServer())
          .post('/employees')
          .set(bearer(hr.accessToken))
          .send({
            givenName: name[1],
            familyName: uniqueFamilyName(),
            nationalId: `15${String(Date.now()).slice(-7)}${index}`,
            hireDate: '2023-05-05',
          })
          .expect(201);
        const id = (created.body as { id: string }).id;
        approvedPeople.push(id);
        await request(target.getHttpServer())
          .patch(`/employees/${id}/cbj-approval`)
          .set(bearer(hr.accessToken))
          .send({ status: 'CURRENT', approvalDate: '2024-02-02' })
          .expect(200);
      }

      const allowed = await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: lifeLine.id })
        .expect(201);
      const allowedBody = allowed.body as ScopeBody;
      addedBranches.push(
        allowedBody.branches.find((b) => b.code === lifeLine.code)!.id,
      );
      expect(allowedBody.types).toEqual(['GENERAL', 'LIFE']);
      expect(allowedBody.staffing.requiredApprovedStaff).toBe(2);
      expect(allowedBody.staffing.meetsRequirement).toBe(true);

      // ---- A SUSPENSION DOES NOT LOCK THE OFFICE OUT OF CORRECTING ITS BRANCH LIST ----
      // `requiredBefore < 2` is what holds this: the office already holds both types, so adding a
      // third branch inside a type it has is not what caused the shortfall and must not be refused.
      await request(target.getHttpServer())
        .patch(`/employees/${approvedPeople[0]}/cbj-approval`)
        .set(bearer(hr.accessToken))
        .send({ status: 'SUSPENDED' })
        .expect(200);
      const secondGeneral = await rawPrisma.insuranceLine.findFirstOrThrow({
        where: { category: 'GENERAL', id: { not: generalLine.id } },
        orderBy: { displayOrder: 'asc' },
      });
      const stillAllowed = await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: secondGeneral.id })
        .expect(201);
      const stillBody = stillAllowed.body as ScopeBody;
      addedBranches.push(
        stillBody.branches.find((b) => b.code === secondGeneral.code)!.id,
      );
      // ...and the shortfall is REPORTED rather than hidden, so the screen can say so.
      expect(stillBody.staffing.meetsRequirement).toBe(false);
      expect(stillBody.staffing.currentApprovedStaff).toBe(1);
    } finally {
      /*
       * Clear the STATE, not a replay of this test's own writes. Item (e) learned this the hard way:
       * a request whose `.expect()` threw had already created a row the bookkeeping never knew
       * about, and the next run failed on an assertion about a branch nobody could see.
       */
      const term = await rawPrisma.brokerLicense.findFirst({
        orderBy: { expiresAt: 'desc' },
      });
      if (term) {
        await rawPrisma.brokerLicenseScopeLine.deleteMany({
          where: { brokerLicenseId: term.id },
        });
      }
      for (const id of approvedPeople) {
        await rawPrisma.employeeCbjApprovalBranch.deleteMany({
          where: { employeeId: id },
        });
        await rawPrisma.employee.update({
          where: { id },
          data: { cbjApprovalStatus: null, cbjApprovalDate: null },
        });
      }
      void addedBranches;
    }
  }, 300_000);

  it('leaves the office with the approved-staff count it started with', async () => {
    // The assertion that makes the teardown above provable rather than hopeful: an office left with
    // two CURRENT approvals would make item (f) unprovable for every later spec in the run.
    const target = app as INestApplication<App>;
    const compliance = await makeUser('staff-check', 'COMPLIANCE_OFFICER');
    const after = await request(target.getHttpServer())
      .get('/broker-license/scope')
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((after.body as ScopeBody).staffing.currentApprovedStaff).toBe(0);
  }, 300_000);
});
