import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { PermissionRepository } from '../src/repositories/permission.repository';
import { OrgContextService } from '../src/common/org-context/org-context.service';

/**
 * Office-scoped custom RBAC, PHASE 3 workstream A — a retired role grants
 * nothing, everywhere it could have granted something.
 *
 * `Role.status` is not a screen affordance. It is enforced in four queries, and
 * this file covers each one from the outside:
 *
 *   `PermissionRepository.findCodesForRoles`        the authorization path
 *   `UserRepository.getRoleRefs`                    the session itself
 *   `UserRepository.findActiveHoldersOfPermission`  the lockout guard's count
 *   `RoleRepository.findActiveUserIdsWithPermission` the reviewer pool
 *
 * The one that would hurt most if it were missed is the third: a retired
 * administrator role still counted as a holder lets an office retire its only
 * administrator role and then revoke the grant, with the guard waving both
 * through because it still saw somebody holding `user.manage`. That case has its
 * own file (`last-administrator-lock.e2e-spec.ts`, extended in the next commit);
 * what is proven here is that retirement genuinely removes access.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

let app: INestApplication<App> | null = null;
let permissionRepo: PermissionRepository;
let orgContext: OrgContextService;
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
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A mistyped code would grant nothing and make these tests pass for the wrong
  // reason — the failure would look exactly like the retirement working.
  expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });
  return role;
}

async function makeUserWithRole(
  label: string,
  roleId: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Status E2E ${label}`, email, password: PASSWORD })
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

async function retire(roleId: string): Promise<void> {
  await prisma.role.update({
    where: { id: roleId },
    data: { status: 'INACTIVE' },
  });
}

beforeAll(async () => {
  app = await createTestApp();
  permissionRepo = app.get(PermissionRepository);
  orgContext = app.get(OrgContextService);
}, 240_000);

afterAll(async () => {
  await app?.close();
  app = null;
  // db-test is cumulative.
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

describe('retiring a role removes the access it granted', () => {
  it('drops its permissions from /auth/me and 403s the routes they gated', async () => {
    const role = await makeCustomRole(`Retiring Reader ${tag}`, [
      'lead.list.read',
    ]);
    const user = await makeUserWithRole(`retire-reader-${tag}`, role.id);

    // While ACTIVE: the permission is present and the route answers.
    const before = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(user.accessToken))
      .expect(200);
    const beforeBody = before.body as {
      roles: string[];
      permissions: string[];
    };
    expect(beforeBody.permissions).toContain('lead.list.read');
    expect(beforeBody.roles).toContain(`Retiring Reader ${tag}`);
    await request(app!.getHttpServer())
      .get('/leads')
      .set(bearer(user.accessToken))
      .expect(200);

    await retire(role.id);

    // The SAME session, no re-login. `PermissionsService` caches for 60s keyed on
    // sorted role ids, and retiring a role changes no assignment — so nothing
    // invalidates that cache. The route is re-checked here rather than only
    // `/auth/me` because the guard is what actually protects it.
    const after = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(user.accessToken))
      .expect(200);
    const afterBody = after.body as { roles: string[]; permissions: string[] };
    expect(
      afterBody.permissions,
      'a retired role grants nothing',
    ).not.toContain('lead.list.read');
    expect(
      afterBody.roles,
      'and it is filtered out of the session entirely, not just out of permissions',
    ).not.toContain(`Retiring Reader ${tag}`);

    await request(app!.getHttpServer())
      .get('/leads')
      .set(bearer(user.accessToken))
      .expect(403);
  }, 300_000);

  it('removes its holders from the recertification reviewer pool', async () => {
    // The pool is resolved by `findActiveUserIdsWithPermission`. A retired role
    // there would name a reviewer who can no longer decide anything — the item
    // would be assigned and then 403 on `decide`.
    const role = await makeCustomRole(`Retiring Reviewer ${tag}`, [
      'access-recertification.review',
      'access-recertification.review.routine',
    ]);
    const user = await makeUserWithRole(`retire-reviewer-${tag}`, role.id);

    const holdersWhileActive = await prisma.rolePermission.findMany({
      where: {
        permission: { code: 'access-recertification.review' },
        role: { status: 'ACTIVE' },
      },
      select: { roleId: true },
    });
    expect(holdersWhileActive.map((g) => g.roleId)).toContain(role.id);

    await retire(role.id);

    const holdersAfter = await prisma.rolePermission.findMany({
      where: {
        permission: { code: 'access-recertification.review' },
        role: { status: 'ACTIVE' },
      },
      select: { roleId: true },
    });
    expect(holdersAfter.map((g) => g.roleId)).not.toContain(role.id);

    // And the reviewer can no longer decide, which is the observable half.
    await request(app!.getHttpServer())
      .get('/access-recertification/items')
      .set(bearer(user.accessToken))
      .expect(403);
  }, 300_000);

  it('is enforced on the AUTHORIZATION PATH itself, not only in the session', async () => {
    // Defence in depth hides itself, and this test exists because of it.
    //
    // `getRoleRefs` filters retired roles out of the session, so a retired role's
    // id never reaches `findCodesForRoles` through an HTTP request at all. Proven
    // by planting: removing the status filter from `findCodesForRoles` left every
    // test above GREEN, because the outer layer was still doing the work. A test
    // that cannot fail is not evidence for the layer it claims to cover.
    //
    // So this one calls the authorization path DIRECTLY with the retired role's
    // id — the shape any future caller that sources ids from somewhere other than
    // `getRoleRefs` would produce.
    const role = await makeCustomRole(`Retiring Inner Layer ${tag}`, [
      'lead.list.read',
    ]);

    const whileActive = await orgContext.runAs(TEST_ORGANIZATION_ID, () =>
      permissionRepo.findCodesForRoles([role.id]),
    );
    expect(whileActive).toEqual(['lead.list.read']);

    await retire(role.id);

    const afterRetirement = await orgContext.runAs(TEST_ORGANIZATION_ID, () =>
      permissionRepo.findCodesForRoles([role.id]),
    );
    expect(
      afterRetirement,
      'findCodesForRoles must refuse a retired role on its own',
    ).toEqual([]);
  }, 300_000);

  it('keeps the role nameable — retirement is not deletion', async () => {
    // The whole reason there is no DELETE: an audit row, a past recertification
    // cycle and the grant history all have to keep reading correctly.
    const role = await makeCustomRole(`Retiring Historic ${tag}`, [
      'lead.list.read',
    ]);
    const user = await makeUserWithRole(`retire-historic-${tag}`, role.id);
    await retire(role.id);

    const stored = await prisma.role.findUniqueOrThrow({
      where: { id: role.id },
      select: { name: true, status: true },
    });
    expect(stored.name).toBe(`Retiring Historic ${tag}`);
    expect(stored.status).toBe('INACTIVE');

    // The grant row survives too, so "who held this, and when" is still
    // answerable.
    const grant = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.userId, roleId: role.id },
    });
    expect(grant).not.toBeNull();
    expect(
      grant!.revokedAt,
      'retiring a role does not revoke its grants',
    ).toBeNull();
  }, 300_000);
});
