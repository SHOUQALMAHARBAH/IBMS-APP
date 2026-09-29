import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/*
 * THE NARROW EMPLOYEE SEARCH, THROUGH REAL HTTP — IMPROVEMENTS § 1.83.
 *
 * `employee.national-id.reveal` is held by COMPLIANCE_OFFICER alone, and that role holds NO
 * `employee.read`. Measured: both employee reads require `employee.read`, so the sole holder of the
 * reveal could call `POST /employees/:id/reveal-field` and had no way to discover an id — the capability
 * was unusable by the only person trusted with it.
 *
 * The owner refused granting Compliance `employee.read` (a staff-privacy decision about browsing records)
 * and refused leaving it broken. `GET /employees/search` is the narrow answer: find a named person,
 * reveal, nothing more.
 *
 * This file proves the BEHAVIOUR. The SHAPE is proven separately by
 * `employee-search-narrowness.inventory.spec.ts`, which reads the source — because a request test cannot
 * show that the query could not return more, only what it did return this time.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 8);

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
interface SearchRow {
  id: string;
  fullName: string;
  fullNameEn: string | null;
  position: string | null;
  isCurrentEmployee: boolean;
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
    .send({ fullName: 'Narrow search E2E User', email, password: PASSWORD })
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

/**
 * A findable person, created with a MANAGER token because `employee.create` is what makes one and Compliance
 * does not hold it — which is itself the segregation this whole item is about.
 */
async function makeEmployee(
  app: INestApplication<App>,
  token: string,
  givenName: string,
  position: string,
  nationalId: string,
): Promise<string> {
  const body = (
    await request(app.getHttpServer())
      .post('/employees')
      .set(bearer(token))
      .send({
        // The FOUR PARTS, not `fullName`: `PersonRecordDto` composes `fullName` server-side and refuses it
        // as input, so a fixture sending `fullName` gets a 400 that looks like a permission problem. The
        // distinctive token goes in `givenName` so the composed `fullName` contains it and the search
        // matches on the same string a person would type.
        givenName,
        fatherName: 'ناصر',
        grandfatherName: 'كريم',
        familyName: 'الزعبي',
        nationalId,
        // REQUIRED by `PersonRecordDto`, and omitting it is a 400 that reads exactly like a permission
        // problem from the outside — which is what the first run of this file looked like.
        hireDate: '2026-01-01',
        position,
      })
      .expect(201)
  ).body as { id: string };
  return body.id;
}

describe('the narrow employee search (e2e) — IMPROVEMENTS § 1.83', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('lets the sole holder of the reveal find a named person and then reveal — the capability end to end', async () => {
    const app = await boot();
    const admin = await makeUser(app, 'ns-admin', 'BRANCH_DEPARTMENT_MANAGER');
    const compliance = await makeUser(app, 'ns-comp', 'COMPLIANCE_OFFICER');

    const distinctive = `Zubaydah-${RUN}`;
    const nationalId = `99${Date.now()}`.slice(0, 10);
    const employeeId = await makeEmployee(
      app,
      admin.accessToken,
      distinctive,
      'Underwriting Assistant',
      nationalId,
    );

    // THE PRECONDITION THIS ITEM EXISTS FOR, asserted rather than assumed: Compliance cannot read an
    // employee record at all. If this ever returns 200, the role has been given `employee.read` and the
    // narrow search has become redundant — which is a decision, not a drift.
    await request(app.getHttpServer())
      .get(`/employees/${employeeId}`)
      .set(bearer(compliance.accessToken))
      .expect(403);

    // But it CAN search by name.
    const found = (
      await request(app.getHttpServer())
        .get(`/employees/search?q=${encodeURIComponent(distinctive)}`)
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as SearchRow[];
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(employeeId);
    expect(found[0].position).toBe('Underwriting Assistant');
    expect(found[0].isCurrentEmployee).toBe(true);

    // THE WIRE SHAPE — exactly five keys, asserted by equality rather than by presence. A `toContain`-style
    // check would pass on a row carrying the hire date, the licensing state, or the encrypted national ID
    // alongside the five.
    expect(Object.keys(found[0]).sort()).toEqual([
      'fullName',
      'fullNameEn',
      'id',
      'isCurrentEmployee',
      'position',
    ]);

    // …and the reveal now works, which is the whole point: the id came from the search.
    const revealed = (
      await request(app.getHttpServer())
        .post(`/employees/${employeeId}/reveal-field`)
        .set(bearer(compliance.accessToken))
        .send({
          field: 'nationalId',
          reason: 'AML file review for this employee',
        })
        .expect(201)
    ).body as { field: string; value: string };
    expect(revealed.value).toBe(nationalId);
  }, 600_000);

  it('refuses an empty search, a whitespace-only search, and a one-character search', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'ns-comp-empty',
      'COMPLIANCE_OFFICER',
    );

    // The owner's condition 1. `'   '` is the case that matters: it satisfies a bare `@IsString()` and,
    // untrimmed, reaches the repository as a pattern matching every employee — "browsing with extra
    // steps", which is how a narrow search becomes the staff directory she refused.
    for (const bad of ['', '   ', 'a']) {
      await request(app.getHttpServer())
        .get(`/employees/search?q=${encodeURIComponent(bad)}`)
        .set(bearer(compliance.accessToken))
        .expect(400);
    }
    // And with no `q` parameter at all — there is no unfiltered mode.
    await request(app.getHttpServer())
      .get('/employees/search')
      .set(bearer(compliance.accessToken))
      .expect(400);
  }, 600_000);

  it('records WHO searched for WHOM, on the search itself and not only on the reveal', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'ns-admin-audit',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const compliance = await makeUser(
      app,
      'ns-comp-audit',
      'COMPLIANCE_OFFICER',
    );

    const distinctive = `Mutasim-${RUN}`;
    const employeeId = await makeEmployee(
      app,
      admin.accessToken,
      distinctive,
      'Claims Clerk',
      `98${Date.now()}`.slice(0, 10),
    );

    await request(app.getHttpServer())
      .get(`/employees/search?q=${encodeURIComponent(distinctive)}`)
      .set(bearer(compliance.accessToken))
      .expect(200);

    // The owner's condition 3: in a compliance context, who asked about a person is information in its own
    // right. Scoped to THIS actor — db-test is cumulative, so a global count would depend on run order.
    const rows = await prisma.auditLogEntry.findMany({
      where: { entityType: 'EmployeeSearch', userId: compliance.userId },
      orderBy: { occurredAt: 'desc' },
      take: 5,
    });
    expect(rows).toHaveLength(1);
    const after = rows[0].afterValue as {
      term: string;
      matchedEmployeeIds: string[];
      matchCount: number;
    };
    expect(rows[0].userId).toBe(compliance.userId);
    expect(after.term).toBe(distinctive);
    expect(after.matchedEmployeeIds).toContain(employeeId);
    expect(rows[0].isSensitiveDataAccess).toBe(true);
  }, 600_000);

  it('records a search that found NOBODY — the case a log of reveals alone cannot show', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'ns-comp-zero',
      'COMPLIANCE_OFFICER',
    );

    const nobody = `NoSuchPerson-${RUN}`;
    const found = (
      await request(app.getHttpServer())
        .get(`/employees/search?q=${encodeURIComponent(nobody)}`)
        .set(bearer(compliance.accessToken))
        .expect(200)
    ).body as SearchRow[];
    expect(found).toHaveLength(0);

    // THIS is why the TERM is recorded and not only the matched ids. A reviewer asking "was this officer
    // probing for somebody" gets nothing from a log that stores only successful reveals, or only the ids a
    // search happened to match.
    const rows = await prisma.auditLogEntry.findMany({
      where: { entityType: 'EmployeeSearch', userId: compliance.userId },
    });
    expect(rows).toHaveLength(1);
    const after = rows[0].afterValue as {
      term: string;
      matchedEmployeeIds: string[];
      matchCount: number;
    };
    expect(after.term).toBe(nobody);
    expect(after.matchCount).toBe(0);
    expect(after.matchedEmployeeIds).toEqual([]);
  }, 600_000);

  it('is gated on the reveal permission, not on employee.read', async () => {
    const app = await boot();
    // Holds `employee.read` and NOT `employee.national-id.reveal` — the mirror image of Compliance, and
    // the assertion that proves the gate is the reveal code rather than the read.
    const manager = await makeUser(app, 'ns-mgr', 'BRANCH_DEPARTMENT_MANAGER');
    await request(app.getHttpServer())
      .get(`/employees/search?q=Zubaydah`)
      .set(bearer(manager.accessToken))
      .expect(403);
  }, 600_000);
});
