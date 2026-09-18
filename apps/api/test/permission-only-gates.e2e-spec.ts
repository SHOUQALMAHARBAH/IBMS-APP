import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Office-scoped custom RBAC, PHASE 2 workstream B.
 *
 * Nineteen routes across six controllers used to carry BOTH
 * `@RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')` and a `@RequirePermissions`.
 * The name gate is gone. These are the two tests that say what that means.
 *
 * ## What is under test here is the GATE, not the handler
 *
 * Every assertion is about 403 or not-403. A holder may well get 400 from DTO
 * validation or 404 from a missing id — that is the handler doing its job, past
 * the gate. Asserting a success status per route would test nineteen handlers
 * instead of one authorization rule, and would need nineteen valid payloads
 * whose upkeep has nothing to do with authorization.
 *
 * ## Why a custom role is the whole point
 *
 * Before this phase, a role an office defines could hold `user.manage` and
 * still be refused by all nineteen, because its NAME was not
 * `SYSTEM_SECURITY_ADMINISTRATOR`. That is the state Phase 3's Role screen
 * would otherwise have shipped into: an office could build an administrator
 * role, grant it every administration permission, and find it locked out of
 * user administration with no error explaining why.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

/** The seven codes the nineteen removed role gates were paired with. Each was
 *  granted to exactly one role in the seed, which is what made removing the
 *  name gate zero-delta on effective access. */
const ADMIN_ROUTE_PERMISSIONS = [
  'security-config.read',
  'security-config.manage',
  'email.integration.manage',
  'user.manage',
  'role.manage',
  'permission.manage',
  'encryption-key.read',
];

interface Route {
  method: 'get' | 'post' | 'put';
  path: string;
  /** Which of the seven codes gates it. */
  permission: string;
  body?: Record<string, unknown>;
}

/** All nineteen, in controller order. */
const ROUTES: Route[] = [
  {
    method: 'get',
    path: '/auth/security-config',
    permission: 'security-config.read',
  },
  {
    method: 'put',
    path: '/auth/security-config',
    permission: 'security-config.manage',
    body: { idleTimeoutMinutes: 15 },
  },
  {
    method: 'get',
    path: '/admin/email-integration/authorize-url',
    permission: 'email.integration.manage',
  },
  {
    method: 'post',
    path: '/admin/email-integration/connect',
    permission: 'email.integration.manage',
  },
  {
    method: 'post',
    path: '/admin/email-integration/test',
    permission: 'email.integration.manage',
  },
  {
    method: 'post',
    path: '/admin/email-integration/revoke',
    permission: 'email.integration.manage',
  },
  { method: 'get', path: '/admin/departments', permission: 'user.manage' },
  { method: 'post', path: '/admin/departments', permission: 'user.manage' },
  { method: 'get', path: '/admin/branches', permission: 'user.manage' },
  { method: 'post', path: '/admin/branches', permission: 'user.manage' },
  { method: 'get', path: '/rbac/roles', permission: 'role.manage' },
  { method: 'get', path: '/rbac/permissions', permission: 'permission.manage' },
  { method: 'get', path: '/admin/users', permission: 'user.manage' },
  { method: 'post', path: '/admin/users', permission: 'user.manage' },
  {
    method: 'post',
    path: '/admin/users/00000000-0000-0000-0000-0000000000ff/roles',
    permission: 'user.manage',
  },
  {
    method: 'post',
    path: '/admin/users/00000000-0000-0000-0000-0000000000ff/roles/revoke',
    permission: 'user.manage',
  },
  {
    method: 'post',
    path: '/admin/users/00000000-0000-0000-0000-0000000000ff/deactivate',
    permission: 'user.manage',
  },
  {
    method: 'post',
    path: '/admin/users/00000000-0000-0000-0000-0000000000ff/activate',
    permission: 'user.manage',
  },
  {
    method: 'get',
    path: '/security/encryption-keys',
    permission: 'encryption-key.read',
  },
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

/** Signs up, enrols MFA (MfaRequiredGuard runs before PermissionsGuard, so
 *  every caller here needs it) and grants one role by id. */
async function makeUserWithRole(
  label: string,
  roleId: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Gate E2E ${label}`, email, password: PASSWORD })
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

/** A role with a name no list in this codebase has ever heard of, holding
 *  exactly the given permission codes. */
async function makeCustomRole(
  name: string,
  codes: string[],
): Promise<{ id: string }> {
  const role = await prisma.role.create({
    data: {
      name,
      nameEn: name,
      nameAr: name,
      // Relaxed deliberately: an always-MFA role would be challenged on every
      // login, which has nothing to do with what this file tests.
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
    // A typo in a code would otherwise silently grant nothing and make the
    // negative test pass for the wrong reason.
    expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }
  return role;
}

function call(route: Route, accessToken: string) {
  const req = request(app!.getHttpServer())
    [route.method](route.path)
    .set(bearer(accessToken));
  return route.body ? req.send(route.body) : req.send({});
}

beforeAll(async () => {
  app = await createTestApp();
}, 240_000);

afterAll(async () => {
  await app?.close();
  app = null;
  // db-test is CUMULATIVE. A role left behind here would accumulate one per run
  // and move any count of the role catalogue — which is exactly how an earlier
  // Phase 2 test broke `rbac.e2e-spec.ts`.
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

describe('the nineteen former role-gated routes are gated on permissions alone', () => {
  it('lets a CUSTOM role holding the permissions through every one of them', async () => {
    // The role that could not exist usefully before this phase: an office's own
    // administrator, named whatever the office likes.
    const role = await makeCustomRole(
      `Office Administrator ${tag}`,
      ADMIN_ROUTE_PERMISSIONS,
    );
    const user = await makeUserWithRole(`custom-admin-${tag}`, role.id);

    const refused: string[] = [];
    for (const route of ROUTES) {
      const res = await call(route, user.accessToken);
      if (res.status === 403) {
        refused.push(`${route.method.toUpperCase()} ${route.path}`);
      }
    }
    // Named rather than counted, so a failure says which route regressed.
    expect(refused).toEqual([]);
  }, 300_000);

  it('refuses a CUSTOM role holding none of them on every one of them', async () => {
    // The other half. Removing the name gate must not have opened anything: a
    // role with no administration permissions is refused by all nineteen, and
    // the refusal must be a 403 from the permission guard rather than a 404 or a
    // 400 that would mean the request got past it.
    const role = await makeCustomRole(`Office Nobody ${tag}`, []);
    const user = await makeUserWithRole(`custom-nobody-${tag}`, role.id);

    const allowed: string[] = [];
    for (const route of ROUTES) {
      const res = await call(route, user.accessToken);
      if (res.status !== 403) {
        allowed.push(
          `${route.method.toUpperCase()} ${route.path} -> ${res.status}`,
        );
      }
    }
    expect(allowed).toEqual([]);
  }, 300_000);

  it('covers all nineteen routes and names the seven permissions they use', () => {
    // A guard on the guard: if a route is added to a controller that used to
    // carry the role gate, this list should grow with it.
    expect(ROUTES).toHaveLength(19);
    expect([...new Set(ROUTES.map((r) => r.permission))].sort()).toEqual(
      [...ADMIN_ROUTE_PERMISSIONS].sort(),
    );
  });
});
