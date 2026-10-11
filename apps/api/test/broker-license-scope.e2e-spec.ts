import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import {
  ensureRole,
  prisma,
  rawPrisma,
  TEST_ORGANIZATION_ID,
} from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * MODULE 0 ITEM (e) — the licence scope, over REAL HTTP.
 *
 * ## Why this file exists rather than only unit tests
 *
 * ART. 3/a IS HELD BY THE SERVICE AND BY NOTHING ELSE. A natural person (sole establishment) may be
 * licensed for ONE insurance type only, and deciding that needs `Organization.brokerKind`, the scope
 * rows, and the catalogue's `category` — three tables. A Postgres CHECK compares columns of one row
 * of one table, so the database cannot express it; a trigger could, but would have to fire on two
 * tables and would put one rule in two places.
 *
 * That makes the service the only thing holding a regulatory rule, so it is proven WHERE IT IS
 * ACTUALLY CALLED. A unit test with a mocked repository proves the function; it does not prove the
 * route reaches it, that the module resolves its dependencies, or that the refusal survives the
 * HTTP boundary. A first version of the module wiring omitted `OrganizationRepository` from its
 * providers — TypeScript was happy, and only booting the app would have found it.
 *
 * ## db-test is cumulative, so brokerKind is restored unconditionally
 *
 * This file flips the shared office to NATURAL_PERSON to exercise art. 3/a. An office left that way
 * would make every later spec's licence scope refuse a second type — so the restore runs after the
 * try/catch (not in a `finally`, which would swallow a real failure: ESLint `no-unsafe-finally`),
 * and the last test asserts the office reads CORPORATE again.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

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
interface ScopeBody {
  brokerLicenseId: string;
  types: string[];
  branches: { id: string; category: string; code: string | null }[];
  branchCountByType: Record<string, number>;
  brokerKind: string | null;
  capital: {
    requiredCapital: string;
    paidUpCapital: string | null;
    shortfall: string | null;
    meetsRequirement: boolean;
    capitalIsUnrecorded: boolean;
  };
}

let app: INestApplication<App> | null = null;

/**
 * COPIED from `regulatory-compliance.e2e-spec.ts`, not reconstructed.
 *
 * The first version of this helper was written from memory and invented two route names
 * (`/auth/mfa/enroll`, `/auth/mfa/verify`) where the real ones are `/auth/mfa/totp/enroll` and
 * `/auth/mfa/totp/enroll/verify`, with different success codes. Both tests failed with a bare
 * "expected 201, got 404" that said nothing about which request was wrong. Copy the helper that
 * works; a paraphrase of an HTTP contract is a guess.
 */
async function makeUser(
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const target = app as INestApplication<App>;
  const email = uniqueEmail(label);
  await request(target.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Licence Scope E2E User', email, password: PASSWORD })
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
    // The partial UNIQUE `UserRoleAssignment_one_active_per_user_role` makes a revoked grant
    // HISTORY, so a new grant is a new row — created only when no active one exists, rather than
    // resurrecting a revoked one and erasing its audit trail.
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

describe('Broker licence scope (e2e) — Module 0 item (e)', () => {
  it('describes the scope, refuses art. 3/a for a sole establishment, and restores the office', async () => {
    const target = app as INestApplication<App>;
    const compliance = await makeUser('scope-compliance', 'COMPLIANCE_OFFICER');
    const other = await makeUser('scope-other', 'SALES_RELATIONSHIP_OFFICER');

    // Every route is gated on `license.manage`, the same code as the licence itself.
    await request(target.getHttpServer())
      .get('/broker-license/scope')
      .set(bearer(other.accessToken))
      .expect(403);
    await request(target.getHttpServer())
      .post('/broker-license/scope')
      .set(bearer(other.accessToken))
      .send({})
      .expect(403);

    // Two standard catalogue lines of DIFFERENT types. Read from the catalogue rather than pinned:
    // a hard-coded uuid would break the moment the seed is rebuilt.
    const generalLine = await rawPrisma.insuranceLine.findFirstOrThrow({
      where: { category: 'GENERAL' },
      orderBy: { displayOrder: 'asc' },
    });
    const lifeLine = await rawPrisma.insuranceLine.findFirstOrThrow({
      where: { category: 'LIFE' },
      orderBy: { displayOrder: 'asc' },
    });

    // THE ROUTE RESOLVES ITS DEPENDENCIES. A 200 here is what proves the module provides
    // `OrganizationRepository` — a missing provider is a runtime DI failure TypeScript cannot see,
    // and the first version of the wiring had exactly that.
    const before = await request(target.getHttpServer())
      .get('/broker-license/scope')
      .set(bearer(compliance.accessToken))
      .expect(200);
    const beforeBody = before.body as ScopeBody;
    expect(beforeBody.brokerLicenseId).toBeTruthy();

    const added: string[] = [];
    let testError: unknown = null;
    try {
      // ---- exactly one catalogue, checked where it always runs ----
      await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({})
        .expect(400);
      await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({
          insuranceLineId: generalLine.id,
          officeInsuranceLineId: generalLine.id,
        })
        .expect(400);

      // ---- a branch that does not exist ----
      await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: '00000000-0000-4000-8000-00000000dead' })
        .expect(404);

      // ---- add a GENERAL branch; the TYPE is derived, never sent ----
      const afterGeneral = await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: generalLine.id })
        .expect(201);
      const g = afterGeneral.body as ScopeBody;
      expect(g.types).toContain('GENERAL');
      expect(g.branchCountByType.GENERAL).toBeGreaterThanOrEqual(1);
      const generalRow = g.branches.find((b) => b.code === generalLine.code);
      expect(generalRow, 'the added branch is on the wire').toBeTruthy();
      added.push(generalRow!.id);

      // Art. 4/a reached the wire. One type with few branches is the 5,000 band.
      expect(g.capital.requiredCapital).toBe('5000.000');
      // The office has recorded no capital, which is NOT the same as recording too little.
      expect(g.capital.capitalIsUnrecorded).toBe(true);
      expect(g.capital.shortfall).toBeNull();

      // ---- the SAME branch twice is a 409, caught by a PARTIAL unique ----
      // A compound unique over these nullable columns would have admitted it, because Postgres
      // treats NULLs as distinct (§ 1.25).
      await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: generalLine.id })
        .expect(409);

      // ---- ART. 3/a, THE WHOLE REASON THIS FILE EXISTS ----
      await rawPrisma.organization.update({
        where: { id: TEST_ORGANIZATION_ID },
        data: { brokerKind: 'NATURAL_PERSON' },
      });

      const refused = await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: lifeLine.id })
        .expect(422);
      const message = (refused.body as { message: string }).message;
      // The refusal names the REGULATION and the reason, not just "not allowed" — otherwise
      // Compliance goes looking for a system fault.
      expect(message).toMatch(/sole establishment/i);
      expect(message).toMatch(/art\. 3\/a/);

      // And it refused by REFUSING, not by writing and rolling back: the LIFE branch is absent.
      const stillOneType = await request(target.getHttpServer())
        .get('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .expect(200);
      expect((stillOneType.body as ScopeBody).types).toEqual(['GENERAL']);

      // A sole establishment may still hold MANY branches within its one type — the limit is on
      // types, and reading it as a branch limit would refuse a legitimate broad practice.
      const secondGeneral = await rawPrisma.insuranceLine.findFirstOrThrow({
        where: { category: 'GENERAL', id: { not: generalLine.id } },
        orderBy: { displayOrder: 'asc' },
      });
      const broadened = await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: secondGeneral.id })
        .expect(201);
      const b = broadened.body as ScopeBody;
      expect(b.types).toEqual(['GENERAL']);
      added.push(b.branches.find((x) => x.code === secondGeneral.code)!.id);

      // ---- a CORPORATE broker may hold both ----
      await rawPrisma.organization.update({
        where: { id: TEST_ORGANIZATION_ID },
        data: { brokerKind: 'CORPORATE' },
      });
      const both = await request(target.getHttpServer())
        .post('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .send({ insuranceLineId: lifeLine.id })
        .expect(201);
      const bothBody = both.body as ScopeBody;
      expect(bothBody.types).toEqual(['GENERAL', 'LIFE']);
      // Art. 4/a is SUMMED per type: 2 general (5,000) + 1 life (5,000).
      expect(bothBody.capital.requiredCapital).toBe('10000.000');
      added.push(bothBody.branches.find((x) => x.code === lifeLine.code)!.id);

      // ---- removal, which is also this test's teardown ----
      for (const id of added.splice(0)) {
        await request(target.getHttpServer())
          .delete(`/broker-license/scope/${id}`)
          .set(bearer(compliance.accessToken))
          .expect(200);
      }
      const emptied = await request(target.getHttpServer())
        .get('/broker-license/scope')
        .set(bearer(compliance.accessToken))
        .expect(200);
      expect((emptied.body as ScopeBody).types).toEqual([]);
      expect((emptied.body as ScopeBody).capital.requiredCapital).toBe('0.000');

      // A branch id that is not on this term is a 404 with one message, so it cannot be used to
      // discover that a branch exists elsewhere.
      await request(target.getHttpServer())
        .delete('/broker-license/scope/00000000-0000-4000-8000-00000000beef')
        .set(bearer(compliance.accessToken))
        .expect(404);
    } catch (err) {
      testError = err;
    }

    /*
     * ALWAYS RESTORE. No `finally` (ESLint `no-unsafe-finally` — a throw there swallows a genuine
     * assertion failure). An office left NATURAL_PERSON, or branches left behind, would change what
     * every later spec's licence scope permits.
     */
    /*
     * REMOVES EVERY BRANCH ON THE TERM, not only the ones this test recorded in `added`.
     *
     * Found by planting art. 3/a away: the refusal became a 201, so the LIFE branch was created by
     * the very request whose `.expect(422)` threw — and it was therefore never added to `added`.
     * The teardown cleaned what it knew about, left that row behind, and the NEXT run failed on an
     * assertion about a branch nobody could see had been created. A teardown that only reverses its
     * own bookkeeping cannot clean up after a request that unexpectedly SUCCEEDED.
     *
     * Safe to clear wholesale: nothing but this file writes a scope line on db-test (the seed
     * creates licence terms but no scope), so the term's scope is this test's to own.
     */
    const leftovers = await request(target.getHttpServer())
      .get('/broker-license/scope')
      .set(bearer(compliance.accessToken));
    if (leftovers.status === 200) {
      for (const branch of (leftovers.body as ScopeBody).branches) {
        await request(target.getHttpServer())
          .delete(`/broker-license/scope/${branch.id}`)
          .set(bearer(compliance.accessToken));
      }
    }
    await rawPrisma.organization.update({
      where: { id: TEST_ORGANIZATION_ID },
      data: { brokerKind: 'CORPORATE' },
    });

    if (testError instanceof Error) throw testError;
    if (testError) throw new Error(JSON.stringify(testError));
  }, 300_000);

  it('left the office CORPORATE and its licence scope empty', async () => {
    // The assertion that makes the restore above provable rather than hopeful. Runs last because
    // `fileParallelism: false` makes within-file order deterministic.
    const org = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: TEST_ORGANIZATION_ID },
      select: { brokerKind: true },
    });
    expect(org.brokerKind).toBe('CORPORATE');

    const target = app as INestApplication<App>;
    const compliance = await makeUser('scope-check', 'COMPLIANCE_OFFICER');
    const scope = await request(target.getHttpServer())
      .get('/broker-license/scope')
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((scope.body as ScopeBody).branches).toEqual([]);
  }, 300_000);
});
