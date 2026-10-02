import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * THE EVIDENCE FOR `Employee_one_active_person_per_office`.
 *
 * The index is partial on `terminationDate IS NULL`, so two simultaneously-active rows for one person
 * are refused while a person whose service ENDED may be rehired as a new row. Measured before building
 * it: there are **ZERO terminated employee rows in either database**, so the rehire path the partial
 * predicate exists for was exercised by nothing that already existed.
 *
 * A partial index whose whole purpose is untested is a shape this repo has paid for before. So this
 * spec is part of the index's own change rather than a follow-up, and it proves BOTH halves — because
 * either one alone is satisfied by the wrong index:
 *
 *   * a FULL unique on the name would also refuse the second ACTIVE row, and would wrongly refuse the
 *     rehire;
 *   * NO index at all would also permit the rehire, and would wrongly permit the second active row.
 *
 * Only the two assertions together say the predicate is what it should be.
 *
 * ## The name is the key, deliberately, and the ORDERED one
 *
 * `canonical_person_key`, not `canonical_name_key`: a Jordanian name is given + father + grandfather +
 * family, so swapping the middle two names a different ancestry. The third case below is that — two
 * cousins, who must BOTH be allowed to be active at once.
 *
 * Keyed on the name rather than on the national ID because `nationalIdEnc` is encrypted with a random IV
 * per value: every employee has one and none of them is comparable. The fingerprint layer is deferred.
 */
describe('Employee uniqueness (e2e) — active service only, and a rehire is a new row', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  function bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  /** Unique to THIS RUN: db-test is cumulative, so a fixed name is a test that passes once. */
  function runId(): string {
    return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }

  function secretFromOtpAuthUri(uri: string): string {
    const match = /[?&]secret=([^&]+)/.exec(uri);
    if (!match) throw new Error('No secret in otpauth URI');
    return match[1];
  }

  /**
   * Lifted from `employee.e2e-spec.ts` rather than written fresh, and the first version of this spec is
   * why: it guessed `/auth/mfa/enroll` where the route is `/auth/mfa/totp/enroll`, and the 404 that came
   * back read as "POST /employees does not exist" — a wrong diagnosis one step away from being chased.
   * The proven helper is the shorter path to a correct one.
   */
  async function makeUser(
    label: string,
    ...roles: RoleName[]
  ): Promise<{ accessToken: string; userId: string }> {
    const app = await boot();
    const email = `${label}-${runId()}@ibms.test`;
    const password = 'Correct-Horse-Battery-Staple-9';
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ fullName: 'Employee rehire e2e', email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const { accessToken, user } = login.body as {
      accessToken: string;
      user: { id: string };
    };

    const enroll = await request(app.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set(bearer(accessToken))
      .expect(201);
    const enrollBody = enroll.body as {
      credentialId: string;
      otpAuthUri: string;
    };
    await request(app.getHttpServer())
      .post('/auth/mfa/totp/enroll/verify')
      .set(bearer(accessToken))
      .send({
        credentialId: enrollBody.credentialId,
        code: authenticator.generate(
          secretFromOtpAuthUri(enrollBody.otpAuthUri),
        ),
      })
      .expect(200);

    for (const roleName of roles) {
      const role = await ensureRole(roleName);
      // A revoked grant is HISTORY under the partial unique on UserRoleAssignment, so this creates a
      // grant only when no ACTIVE one exists rather than resurrecting a revoked row.
      const active = await prisma.userRoleAssignment.findFirst({
        where: { userId: user.id, roleId: role.id, revokedAt: null },
      });
      if (!active) {
        await prisma.userRoleAssignment.create({
          data: { userId: user.id, roleId: role.id },
        });
      }
    }
    return { accessToken, userId: user.id };
  }

  async function createEmployee(
    token: string,
    parts: {
      given: string;
      father: string;
      grandfather: string;
      family: string;
    },
  ) {
    const app = await boot();
    return request(app.getHttpServer())
      .post('/employees')
      .set(bearer(token))
      .send({
        givenName: parts.given,
        fatherName: parts.father,
        grandfatherName: parts.grandfather,
        familyName: parts.family,
        nationalId: `${runId()}`.slice(0, 10),
        hireDate: '2024-01-15',
      });
  }

  it('refuses a SECOND ACTIVE employee of the same name, and permits the rehire after termination', async () => {
    // Two roles, because the two acts are deliberately separated: `employee.create` records a person,
    // and `deprovisioning.execute` — System Security Administrator only, narrower — ends their service.
    // Terminating an employee IS the employment-status change that revokes access.
    const admin = await makeUser(
      'rehire-admin',
      'OFFICE_ADMINISTRATOR' as RoleName,
      'SYSTEM_SECURITY_ADMINISTRATOR' as RoleName,
    );

    const id = runId();
    const parts = {
      given: 'آية',
      father: 'ناصر',
      grandfather: 'عادل',
      family: `الخوالدة${id}`,
    };

    const first = await createEmployee(admin.accessToken, parts);
    expect(first.status).toBe(201);
    const firstId = (first.body as { id: string }).id;

    // 1 — A SECOND ACTIVE ROW FOR THE SAME PERSON IS REFUSED. This is the half a no-index world gets
    // wrong, and the reason the index exists at all.
    const second = await createEmployee(admin.accessToken, parts);
    expect(
      second.status,
      'a second ACTIVE employee of the same name must be refused while the first is still in service',
    ).toBeGreaterThanOrEqual(400);

    // 2 — END THE SERVICE.
    await request(app.getHttpServer())
      .post(`/employees/${firstId}/terminate`)
      .set(bearer(admin.accessToken))
      .expect(201);

    // 3 — THE REHIRE IS PERMITTED, as a NEW ROW. This is the half a FULL unique gets wrong, and the
    // whole reason the index is partial rather than total.
    const rehired = await createEmployee(admin.accessToken, parts);
    expect(
      rehired.status,
      'a person whose service ended must be rehirable as a new row — this is what the partial predicate buys',
    ).toBe(201);
    const rehiredId = (rehired.body as { id: string }).id;
    expect(rehiredId).not.toBe(firstId);

    // AND THE KNOWN LIMIT, asserted rather than only written down: the rehire is a SEPARATE ROW, so the
    // person's history is split across two of them and prior training sits on the old one. The cleaner
    // model is one person with service periods; that is a model change deliberately not opened. This
    // assertion exists so the limit is discovered by a reader of the test rather than by an office.
    expect(
      rehiredId,
      'the rehire is a new row, so history is split — the recorded limit of this design',
    ).not.toBe(firstId);

    // 4 — AND NOW A SECOND ACTIVE ROW IS REFUSED AGAIN, so the index did not simply stop applying once
    // a terminated row existed. Without this, an index dropped after the first assertion would pass.
    const third = await createEmployee(admin.accessToken, parts);
    expect(
      third.status,
      'the uniqueness must still hold against the REHIRED active row',
    ).toBeGreaterThanOrEqual(400);
  });

  it('permits two COUSINS to be active at once — the ordered key, not the sorted one', async () => {
    // The reason there are two canonical functions. `canonical_name_key` SORTS its tokens, so these two
    // names would share a key and the second would be refused — two real, different employees, one of
    // them unrecordable. `canonical_person_key` preserves the order, because in a Jordanian name the
    // order IS the ancestry: Ibrahim son of Rashid son of Salem, against Ibrahim son of Salem son of
    // Rashid.
    const admin = await makeUser(
      'rehire-cousins',
      'OFFICE_ADMINISTRATOR' as RoleName,
    );
    const family = `التميمي${runId()}`;

    const a = await createEmployee(admin.accessToken, {
      given: 'إبراهيم',
      father: 'رشيد',
      grandfather: 'سالم',
      family,
    });
    expect(a.status).toBe(201);

    const b = await createEmployee(admin.accessToken, {
      given: 'إبراهيم',
      father: 'سالم',
      grandfather: 'رشيد',
      family,
    });
    expect(
      b.status,
      'two cousins — the same four name parts in a different ORDER — are different people and must both be recordable',
    ).toBe(201);
  });
});
