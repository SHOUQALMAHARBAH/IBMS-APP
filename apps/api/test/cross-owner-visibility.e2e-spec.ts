import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { crossOwnerPermissionsFor } from './fixtures/authenticated-user';
import { ALL_OWNERS_READ_CODES } from '../src/common/rbac-visibility.util';

/**
 * Office-scoped custom RBAC, PHASE 2 workstream C.
 *
 * Cross-owner visibility — "may this caller see a record they do not own?" —
 * used to be seven hard-coded lists of role NAMES. A role an office defines
 * appeared in none of them and therefore saw only what it owned, however its
 * permissions had been granted. It failed CLOSED, which is the right direction,
 * but it was still wrong and nothing reported it.
 *
 * Two things are proven here that no unit test can prove.
 *
 * 1. A CUSTOM role granted the permission really does reach another owner's
 *    record, end to end through HTTP. This is the case that is broken today.
 * 2. The fixture table in `fixtures/authenticated-user.ts` agrees with the
 *    grants actually in the database. That table is a second copy of the seed's
 *    cross-owner grants — around sixty unit-test actors derive their permissions
 *    from it — and a copy nobody checks is a copy that drifts. Checking it
 *    against the seeded rows rather than against the seed SOURCE means the thing
 *    under test is what the application will really see.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

const LEGACY_ROLE_NAMES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'POLICY_CHECKING_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'COMPLIANCE_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
  'DATA_PROTECTION_OFFICER',
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'EXECUTIVE_MANAGEMENT',
  'EXTERNAL_AUDITOR',
];

let app: INestApplication<App> | null = null;
const tag = Math.random().toString(36).slice(2, 8);
const createdRoleIds: string[] = [];

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}

async function makeCustomRole(
  name: string,
  codes: string[],
): Promise<{ id: string }> {
  const role = await prisma.role.create({
    data: {
      name,
      nameEn: name,
      nameAr: name,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
    },
  });
  createdRoleIds.push(role.id);
  if (codes.length > 0) {
    const permissions = await prisma.permission.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }
  return role;
}

async function makeUserWithRole(
  label: string,
  roleId: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Visibility E2E ${label}`, email, password: PASSWORD })
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

  await prisma.userRoleAssignment.create({
    data: { userId: body.user.id, roleId },
  });
  return { accessToken: body.accessToken, userId: body.user.id };
}

beforeAll(async () => {
  app = await createTestApp();
}, 240_000);

afterAll(async () => {
  await app?.close();
  app = null;
  // db-test is cumulative — leaving roles behind moves every count of the
  // catalogue for every later run.
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

describe('cross-owner visibility is a permission, not a role name', () => {
  it('lets a CUSTOM role holding customer.all-owners.read open another officer owner’s customer', async () => {
    // The whole point of the workstream, end to end. Before Phase 2 this role
    // was in no list, so it could hold every customer permission and still see
    // only its own — which is what an office building its own Manager role
    // would have run into.
    const ownerRole = await makeCustomRole(`Visibility Owner ${tag}`, [
      'customer.create',
      'customer.360-view.read',
    ]);
    const owner = await makeUserWithRole(`vis-owner-${tag}`, ownerRole.id);

    const created = await request(app!.getHttpServer())
      .post('/customers')
      .set(bearer(owner.accessToken))
      .send({
        customerType: 'INDIVIDUAL',
        givenName: 'Cross',
        familyName: `Owner ${tag}`,
        nationalId: '9901019999',
        contactPhone: '+962-7-9000-0001',
        contactEmail: `cross-owner-${tag}@example.test`,
        languagePreference: 'AR',
      })
      .expect(201);
    const customerId = (created.body as { id: string }).id;

    // Same read permission, different person, NO cross-owner grant: not found.
    // 404 rather than 403 is this codebase's convention for a record the caller
    // may not see — confirming it exists would itself be a leak.
    const scopedRole = await makeCustomRole(`Visibility Scoped ${tag}`, [
      'customer.360-view.read',
    ]);
    const scoped = await makeUserWithRole(`vis-scoped-${tag}`, scopedRole.id);
    await request(app!.getHttpServer())
      .get(`/customers/${customerId}`)
      .set(bearer(scoped.accessToken))
      .expect(404);

    // Add the cross-owner permission to an otherwise identical role: 200.
    const crossRole = await makeCustomRole(`Visibility Cross ${tag}`, [
      'customer.360-view.read',
      'customer.all-owners.read',
    ]);
    const cross = await makeUserWithRole(`vis-cross-${tag}`, crossRole.id);
    const seen = await request(app!.getHttpServer())
      .get(`/customers/${customerId}`)
      .set(bearer(cross.accessToken))
      .expect(200);
    expect((seen.body as { id: string }).id).toBe(customerId);
  }, 300_000);

  it('scopes the LIST endpoint by the same permission, as a query filter', async () => {
    // The list path is separate from the single-record path: the rule reaches
    // the repository as a `where` clause so the page window bounds MATCHING
    // rows. If it were applied to rows after paging, the page size would decide
    // what the caller cannot see.
    const ownerRole = await makeCustomRole(`Visibility List Owner ${tag}`, [
      'customer.create',
      'customer.360-view.read',
    ]);
    const owner = await makeUserWithRole(`vis-list-owner-${tag}`, ownerRole.id);
    await request(app!.getHttpServer())
      .post('/customers')
      .set(bearer(owner.accessToken))
      .send({
        customerType: 'INDIVIDUAL',
        givenName: 'Listed',
        familyName: `Owner ${tag}`,
        nationalId: '9901019998',
        contactPhone: '+962-7-9000-0002',
        contactEmail: `listed-owner-${tag}@example.test`,
        languagePreference: 'AR',
      })
      .expect(201);

    const scopedRole = await makeCustomRole(`Visibility List Scoped ${tag}`, [
      'customer.360-view.read',
    ]);
    const scoped = await makeUserWithRole(
      `vis-list-scoped-${tag}`,
      scopedRole.id,
    );
    const ownList = await request(app!.getHttpServer())
      .get('/customers')
      .set(bearer(scoped.accessToken))
      .expect(200);
    // This caller owns nothing, so an owner-scoped list is empty — regardless of
    // how many customers the cumulative test database holds. The endpoint
    // returns the house `{items,total,page,pageSize}` envelope, so the count is
    // `total`, not the array length: a bare length check would pass on a page
    // that merely happened to be empty.
    expect((ownList.body as { items: unknown[]; total: number }).total).toBe(0);
    expect((ownList.body as { items: unknown[] }).items).toEqual([]);

    const crossRole = await makeCustomRole(`Visibility List Cross ${tag}`, [
      'customer.360-view.read',
      'customer.all-owners.read',
    ]);
    const cross = await makeUserWithRole(`vis-list-cross-${tag}`, crossRole.id);
    const allList = await request(app!.getHttpServer())
      .get('/customers')
      .set(bearer(cross.accessToken))
      .expect(200);
    expect(
      (allList.body as { total: number }).total,
      'a cross-owner caller sees the whole book',
    ).toBeGreaterThan(0);
  }, 300_000);
});

describe('the unit-test fixture table agrees with the seeded grants', () => {
  it('derives the same cross-owner codes the database actually grants, for all 11 legacy roles', async () => {
    // `fixtures/authenticated-user.ts` is a second copy of these grants, used by
    // around sixty unit-test actors. This is the check that keeps it honest.
    const roles = await prisma.role.findMany({
      where: { name: { in: LEGACY_ROLE_NAMES } },
      select: {
        name: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
    expect(roles).toHaveLength(LEGACY_ROLE_NAMES.length);

    for (const role of roles) {
      const seeded = role.permissions
        .map((p) => p.permission.code)
        .filter((code) => ALL_OWNERS_READ_CODES.includes(code))
        .sort();
      const fixture = [...crossOwnerPermissionsFor([role.name])].sort();
      expect(fixture, `cross-owner codes for ${role.name}`).toEqual(seeded);
    }
  }, 120_000);

  it('grants every cross-owner code to at least one role, and none to a role that had no reach', async () => {
    const granted = await prisma.rolePermission.findMany({
      where: { permission: { code: { in: [...ALL_OWNERS_READ_CODES] } } },
      select: {
        permission: { select: { code: true } },
        role: { select: { name: true } },
      },
    });
    for (const code of ALL_OWNERS_READ_CODES) {
      expect(
        granted.filter((g) => g.permission.code === code).length,
        `${code} must be granted to someone`,
      ).toBeGreaterThan(0);
    }
    // The three roles that never had cross-owner reach must still have none —
    // the administrator most of all, since this phase is also where an
    // "administrator can see everything" assumption would creep in.
    for (const name of [
      'SALES_RELATIONSHIP_OFFICER',
      'SYSTEM_SECURITY_ADMINISTRATOR',
      'DATA_PROTECTION_OFFICER',
    ]) {
      expect(
        granted
          .filter((g) => g.role.name === name)
          .map((g) => g.permission.code),
        `${name} must hold no cross-owner code`,
      ).toEqual([]);
    }
  }, 120_000);
});
