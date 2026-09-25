import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Office-scoped custom RBAC, PHASE 3 workstreams B and C — the office administers
 * its own roles.
 *
 * This is the first phase of the rework a user can see, and the surface it adds
 * is the one every earlier phase was clearing the way for: `POST /rbac/roles`,
 * `PUT /rbac/roles/:id/permissions`, retire/reactivate, and the security-attribute
 * route that is the first consumer of `@RequireStepUp` anywhere in the codebase.
 *
 * The test that matters most here is the shortest one: `isSystem` GRANTS NOTHING.
 * A flag by that name on a Role is exactly where an `if (isSystem) allow` bypass
 * would be smuggled in, and no amount of comment saying it does not happen is
 * evidence.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

let app: INestApplication<App> | null = null;
/** The administrator that drives every CRUD route. Its TOTP secret is kept
 *  because the security-attribute route needs a live step-up code. */
let admin: { accessToken: string; userId: string; totpSecret: string };
const tag = Math.random().toString(36).slice(2, 8);
const createdRoleIds: string[] = [];

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}

interface RoleView {
  id: string;
  name: string;
  status: string;
  isSystem: boolean;
  requiresMfaAlways: boolean;
  requiresHardwareToken: boolean;
  holderCount: number;
  permissionCount: number;
  permissionCodes?: string[];
}

/** Signs up, enrols MFA, and grants the given role by id. Returns the TOTP secret
 *  too, because the step-up route needs a live code. */
async function makeUser(
  label: string,
  roleId?: string,
): Promise<{ accessToken: string; userId: string; totpSecret: string }> {
  const email = uniqueEmail(label);
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Role CRUD ${label}`, email, password: PASSWORD })
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
  const totpSecret = decodeURIComponent(
    /[?&]secret=([^&]+)/.exec(enrollBody.otpAuthUri)![1],
  );
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(totpSecret),
    })
    .expect(200);

  if (roleId) {
    await prisma.userRoleAssignment.create({
      data: { userId: body.user.id, roleId },
    });
  }
  return { accessToken: body.accessToken, userId: body.user.id, totpSecret };
}

/** A role granting exactly these codes, created directly so the CRUD routes can
 *  be tested against a known starting point. */
async function seedRole(
  name: string,
  codes: string[],
  extra: { isSystem?: boolean } = {},
): Promise<{ id: string }> {
  const role = await prisma.role.create({
    data: {
      name,
      nameEn: name,
      nameAr: name,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      isSystem: extra.isSystem ?? false,
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

beforeAll(async () => {
  app = await createTestApp();
  // `role.manage` split in four-action Phase 1, so the administrator that drives these routes now needs
  // the four codes rather than two: read the catalogue, define, change, retire.
  const adminRole = await seedRole(`Role Administrator ${tag}`, [
    'role.read',
    'role.create',
    'role.update',
    'role.deactivate',
  ]);
  admin = await makeUser(`role-crud-admin-${tag}`, adminRole.id);
}, 240_000);

afterAll(async () => {
  await app?.close();
  app = null;
  // db-test is cumulative — a leftover role moves every count of the catalogue.
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

describe('isSystem is a protection flag and grants NOTHING', () => {
  it('gives a holder of an isSystem role with no permissions access to nothing', async () => {
    // The shortest test in this file and the one that matters most. A flag named
    // "system" on a Role is exactly where an `if (isSystem) allow` bypass gets
    // smuggled in, and the comment saying it does not is not evidence.
    const protectedEmpty = await seedRole(`Protected Empty ${tag}`, [], {
      isSystem: true,
    });
    const user = await makeUser(`is-system-empty-${tag}`, protectedEmpty.id);

    const me = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(user.accessToken))
      .expect(200);
    expect((me.body as { permissions: string[] }).permissions).toEqual([]);

    // A spread of routes gated on unrelated permissions — all refused.
    for (const path of [
      '/rbac/roles',
      '/admin/users',
      '/leads',
      '/customers',
    ]) {
      await request(app!.getHttpServer())
        .get(path)
        .set(bearer(user.accessToken))
        .expect(403);
    }
  }, 300_000);

  it('refuses to rename, re-grant or retire a platform role', async () => {
    const protectedRole = await seedRole(
      `Protected Legacy ${tag}`,
      ['lead.list.read'],
      { isSystem: true },
    );

    await request(app!.getHttpServer())
      .patch(`/rbac/roles/${protectedRole.id}`)
      .set(bearer(admin.accessToken))
      .send({ nameEn: 'Renamed' })
      .expect(422);
    await request(app!.getHttpServer())
      .put(`/rbac/roles/${protectedRole.id}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionCodes: [] })
      .expect(422);
    await request(app!.getHttpServer())
      .post(`/rbac/roles/${protectedRole.id}/retire`)
      .set(bearer(admin.accessToken))
      .expect(422);

    // Unchanged, not merely refused.
    const stored = await prisma.role.findUniqueOrThrow({
      where: { id: protectedRole.id },
      include: { permissions: true },
    });
    expect(stored.nameEn).toBe(`Protected Legacy ${tag}`);
    expect(stored.status).toBe('ACTIVE');
    expect(stored.permissions).toHaveLength(1);
  }, 300_000);
});

describe('Role CRUD', () => {
  it('creates a role with its grants, reads them back, and lists it with counts', async () => {
    const created = await request(app!.getHttpServer())
      .post('/rbac/roles')
      .set(bearer(admin.accessToken))
      .send({
        name: `Client Liaison ${tag}`,
        nameAr: `منسق العملاء ${tag}`,
        nameEn: `Client Liaison ${tag}`,
        description: 'Reads leads and the customer book.',
        permissionCodes: ['lead.list.read', 'customer.360-view.read'],
      })
      .expect(201);
    const roleId = (created.body as { id: string }).id;
    createdRoleIds.push(roleId);

    const one = await request(app!.getHttpServer())
      .get(`/rbac/roles/${roleId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    const view = one.body as RoleView;
    expect(view.permissionCodes).toEqual([
      'customer.360-view.read',
      'lead.list.read',
    ]);
    expect(view.status).toBe('ACTIVE');
    expect(
      view.isSystem,
      'an office-created role is never a platform role',
    ).toBe(false);
    expect(
      view.requiresMfaAlways,
      'and it arrives STRICT — Phase 2 made that the default',
    ).toBe(true);
    expect(view.holderCount).toBe(0);

    const list = await request(app!.getHttpServer())
      .get('/rbac/roles')
      .set(bearer(admin.accessToken))
      .expect(200);
    const row = (list.body as RoleView[]).find((r) => r.id === roleId);
    expect(row).toBeDefined();
    expect(row!.permissionCount).toBe(2);
  }, 300_000);

  it('SEPARABILITY: create without deactivate can define a role and cannot retire one', async () => {
    // The whole point of splitting `role.manage`. If this passes with the umbrella restored, the split is
    // decoration — so it asserts both halves on ONE account: the create succeeds, and the retire of the
    // very role it just created is refused.
    const partialRole = await seedRole(`Role Definer ${tag}`, [
      'role.read',
      'role.create',
    ]);
    const definer = await makeUser(`role-definer-${tag}`, partialRole.id);

    const created = await request(app!.getHttpServer())
      .post('/rbac/roles')
      .set(bearer(definer.accessToken))
      .send({
        name: `DEFINED_BY_A_PARTIAL_HOLDER_${tag}`,
        nameEn: 'Defined by a partial holder',
        nameAr: 'أُنشئ بصلاحية جزئية',
        permissionCodes: ['customer.360-view.read'],
      })
      .expect(201);
    const newRoleId = (created.body as { id: string }).id;
    createdRoleIds.push(newRoleId);

    // Cannot retire it...
    await request(app!.getHttpServer())
      .post(`/rbac/roles/${newRoleId}/retire`)
      .set(bearer(definer.accessToken))
      .send({})
      .expect(403);
    // ...cannot delete it...
    await request(app!.getHttpServer())
      .delete(`/rbac/roles/${newRoleId}`)
      .set(bearer(definer.accessToken))
      .expect(403);
    // ...and cannot rename it either, because renaming is `role.update`.
    await request(app!.getHttpServer())
      .patch(`/rbac/roles/${newRoleId}`)
      .set(bearer(definer.accessToken))
      .send({ nameEn: 'Renamed without permission' })
      .expect(403);

    // And the role it created is really there — so the 403s above are about the permission and not about
    // a request that failed for some other reason.
    const listed = await request(app!.getHttpServer())
      .get('/rbac/roles')
      .set(bearer(definer.accessToken))
      .expect(200);
    expect((listed.body as { id: string }[]).map((r) => r.id)).toContain(
      newRoleId,
    );
  });

  it('refuses a duplicate name with 422, not a 500', async () => {
    // `@@unique([organizationId, name])`. Without the P2002 translation this is a
    // Prisma error surfacing as a 500 for what is an ordinary, correctable
    // mistake.
    const name = `Duplicate Desk ${tag}`;
    const first = await request(app!.getHttpServer())
      .post('/rbac/roles')
      .set(bearer(admin.accessToken))
      .send({ name, nameAr: name, nameEn: name, permissionCodes: [] })
      .expect(201);
    createdRoleIds.push((first.body as { id: string }).id);

    await request(app!.getHttpServer())
      .post('/rbac/roles')
      .set(bearer(admin.accessToken))
      .send({ name, nameAr: name, nameEn: name, permissionCodes: [] })
      .expect(422);

    // And renaming an existing role onto a taken name is the same answer.
    const other = await seedRole(`Rename Source ${tag}`, []);
    await request(app!.getHttpServer())
      .patch(`/rbac/roles/${other.id}`)
      .set(bearer(admin.accessToken))
      .send({ name })
      .expect(422);
  }, 300_000);

  it('refuses an unknown permission code rather than granting less than asked', async () => {
    // A silently dropped code would give the role fewer permissions than the
    // screen showed, which is the worst kind of wrong: it looks saved.
    await request(app!.getHttpServer())
      .post('/rbac/roles')
      .set(bearer(admin.accessToken))
      .send({
        name: `Bad Codes ${tag}`,
        nameAr: `Bad Codes ${tag}`,
        nameEn: `Bad Codes ${tag}`,
        permissionCodes: ['lead.list.read', 'not.a.real.code'],
      })
      .expect(422);

    const role = await seedRole(`Bad Codes Target ${tag}`, ['lead.list.read']);
    await request(app!.getHttpServer())
      .put(`/rbac/roles/${role.id}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionCodes: ['also.not.real'] })
      .expect(422);
    // The original grant survives the refusal.
    const after = await prisma.role.findUniqueOrThrow({
      where: { id: role.id },
      include: { permissions: { select: { permission: true } } },
    });
    expect(after.permissions.map((p) => p.permission.code)).toEqual([
      'lead.list.read',
    ]);
  }, 300_000);

  it('takes effect IMMEDIATELY when grants change, not after the cache TTL', async () => {
    // `PermissionsService` caches for 60 seconds keyed on sorted role ids, and
    // changing a role's grants touches no assignment — so the ids a session
    // resolves are unchanged and the cached answer would stand. Without
    // `invalidateCache()` a permission the office just removed keeps working.
    //
    // A test that re-read after the TTL would pass either way, which is why this
    // one re-reads at once, on the same session.
    const role = await seedRole(`Cache Probe ${tag}`, ['lead.list.read']);
    const user = await makeUser(`cache-probe-${tag}`, role.id);

    await request(app!.getHttpServer())
      .get('/leads')
      .set(bearer(user.accessToken))
      .expect(200);

    await request(app!.getHttpServer())
      .put(`/rbac/roles/${role.id}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionCodes: ['customer.360-view.read'] })
      .expect(200);

    await request(app!.getHttpServer())
      .get('/leads')
      .set(bearer(user.accessToken))
      .expect(403);
    await request(app!.getHttpServer())
      .get('/customers')
      .set(bearer(user.accessToken))
      .expect(200);
  }, 300_000);

  it('records WHICH codes moved, not that permissions changed', async () => {
    // The diff is the only record of when an office widened a role, and it is the
    // first thing an auditor asks for.
    const role = await seedRole(`Audited Grants ${tag}`, ['lead.list.read']);
    await request(app!.getHttpServer())
      .put(`/rbac/roles/${role.id}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissionCodes: ['customer.360-view.read', 'policy.read'] })
      .expect(200);

    const entry = await prisma.auditLogEntry.findFirst({
      where: { entityType: 'RolePermission', entityId: role.id },
      orderBy: { occurredAt: 'desc' },
    });
    expect(entry).not.toBeNull();
    const after = entry!.afterValue as {
      added: string[];
      removed: string[];
    };
    expect([...after.added].sort()).toEqual([
      'customer.360-view.read',
      'policy.read',
    ]);
    expect(after.removed).toEqual(['lead.list.read']);
  }, 300_000);

  it('reads as ABSENT, not forbidden, for another office’s role id', async () => {
    // The house convention for a record the caller may not see. Confirming that
    // some other office's role exists would itself be a leak, and there is
    // nothing useful the caller could do with the distinction.
    await request(app!.getHttpServer())
      .get('/rbac/roles/00000000-0000-4000-8000-0000000000ff')
      .set(bearer(admin.accessToken))
      .expect(404);
  }, 120_000);
});

describe('the security attributes are behind a step-up challenge', () => {
  it('refuses without a fresh challenge, allows with one, and audits the relaxation', async () => {
    // The FIRST consumer of `@RequireStepUp` anywhere in this codebase — the gate
    // has existed since backlog A.1 with nothing to attach to.
    //
    // Why these two attributes and not the whole PATCH: `requiresMfaAlways`
    // decides whether a trusted device can shorten the second factor, and both
    // default strict. Relaxing one weakens a control, and a control an
    // administrator can weaken with no re-authentication is weaker than it looks.
    // Renaming a label, by contrast, must not cost a challenge — a prompt people
    // learn to click through is not a control.
    const role = await seedRole(`Step Up Target ${tag}`, ['lead.list.read']);
    await prisma.role.update({
      where: { id: role.id },
      data: { requiresMfaAlways: true },
    });

    await request(app!.getHttpServer())
      .patch(`/rbac/roles/${role.id}/security-attributes`)
      .set(bearer(admin.accessToken))
      .send({ requiresMfaAlways: false })
      .expect(403);

    // An ordinary rename on the same session still works — the challenge is
    // scoped to the attribute route, not to role administration.
    await request(app!.getHttpServer())
      .patch(`/rbac/roles/${role.id}`)
      .set(bearer(admin.accessToken))
      .send({ description: 'renamed without a challenge' })
      .expect(200);

    await request(app!.getHttpServer())
      .post('/auth/step-up')
      .set(bearer(admin.accessToken))
      // Step-up is a PASSWORD re-entry plus a live MFA code — re-proving the
      // first factor, not just the second. A code-only challenge would let
      // anyone sitting at an unlocked machine relax the control.
      .send({
        password: PASSWORD,
        code: authenticator.generate(admin.totpSecret),
      })
      .expect(200);

    const relaxed = await request(app!.getHttpServer())
      .patch(`/rbac/roles/${role.id}/security-attributes`)
      .set(bearer(admin.accessToken))
      .send({ requiresMfaAlways: false })
      .expect(200);
    expect(
      (relaxed.body as { requiresMfaAlways: boolean }).requiresMfaAlways,
    ).toBe(false);

    const entry = await prisma.auditLogEntry.findFirst({
      where: { entityType: 'RoleSecurityAttributes', entityId: role.id },
      orderBy: { occurredAt: 'desc' },
    });
    expect(entry).not.toBeNull();
    const after = entry!.afterValue as { relaxed: boolean; name: string };
    expect(
      after.relaxed,
      'the audit row names the DIRECTION so an alert can key on it',
    ).toBe(true);
    expect(after.name).toBe(`Step Up Target ${tag}`);
  }, 300_000);
});

describe('role deletion', () => {
  /**
   * Delete, and the one assertion a 204 cannot make.
   *
   * The owner decided the behaviour: the role and its effect go immediately, no reassignment gate, a
   * user left with zero permissions is accepted, AND the record of who held it survives marked
   * revoked. The last part is why this is a soft delete — `UserRoleAssignment.roleId` is ON DELETE
   * RESTRICT, so a hard delete would either fail or take the history with it.
   *
   * So the proof is reading the rows back, not the status code.
   */
  it('deletes a role, withdraws it from its holders, and KEEPS the record that they held it', async () => {
    const role = await seedRole(`Deletable ${tag}`, ['claim.read']);
    const holder = await makeUser(`delete-holder-${tag}`);
    await prisma.userRoleAssignment.create({
      data: { userId: holder.userId, roleId: role.id },
    });

    await request(app!.getHttpServer())
      .delete(`/rbac/roles/${role.id}`)
      .set(bearer(admin.accessToken))
      .expect(204);

    // 1. The grants are GONE, which is what makes the effect vanish through every read path rather
    //    than only the ones that remember to check a flag.
    expect(
      await prisma.rolePermission.count({ where: { roleId: role.id } }),
    ).toBe(0);

    // 2. The assignment row SURVIVES, still names the role, and carries revokedAt.
    const assignment = await prisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: holder.userId, roleId: role.id },
    });
    expect(assignment.roleId).toBe(role.id);
    expect(assignment.revokedAt).not.toBeNull();

    // 3. The role is stamped deleted and forced inactive.
    const after = await prisma.role.findUniqueOrThrow({
      where: { id: role.id },
    });
    expect(after.deletedAt).not.toBeNull();
    expect(after.status).toBe('INACTIVE');

    // 4. And it is gone from the catalogue the screen reads — retired roles stay so they can be
    //    reactivated; a deleted one must not offer that.
    const list = await request(app!.getHttpServer())
      .get('/rbac/roles')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((list.body as { id: string }[]).map((r) => r.id)).not.toContain(
      role.id,
    );
  }, 300_000);

  it("takes the permission away on the holder's NEXT request, not a cache TTL later", async () => {
    // "Permissions resolve from the role at request time" is the owner's requirement, and a 60-second
    // cache would make it a lie in the one direction that matters: someone's access is removed and
    // they keep it for another minute.
    //
    // WHAT A PLANT SHOWED, recorded here so this test is not read as more than it is: removing
    // `invalidateCache()` from the delete path does NOT make this test fail. The immediacy on THIS
    // path comes from somewhere else — the per-request role read filters `revokedAt: null` and
    // `role.status = 'ACTIVE'`, and deletion sets both, so the role drops out of the caller's role
    // set and the cache KEY changes. The invalidation is belt-and-braces here and load-bearing on the
    // grant-set path, which its own test ("takes effect IMMEDIATELY when grants change") covers.
    const role = await seedRole(`Immediate ${tag}`, ['claim.read']);
    const holder = await makeUser(`delete-immediate-${tag}`);
    await prisma.userRoleAssignment.create({
      data: { userId: holder.userId, roleId: role.id },
    });

    // Warm the cache by actually using the permission.
    await request(app!.getHttpServer())
      .get('/claims')
      .set(bearer(holder.accessToken))
      .expect(200);

    await request(app!.getHttpServer())
      .delete(`/rbac/roles/${role.id}`)
      .set(bearer(admin.accessToken))
      .expect(204);

    // The very next request, with the same session.
    await request(app!.getHttpServer())
      .get('/claims')
      .set(bearer(holder.accessToken))
      .expect(403);
  }, 300_000);

  it('accepts leaving a user with no roles and no permissions at all', async () => {
    // Explicitly NOT an error. The owner overruled a reassignment gate: "if that leaves a user with
    // zero roles/zero permissions, that's an accepted, expected outcome, not something to prevent."
    const role = await seedRole(`Only Role ${tag}`, ['claim.read']);
    const holder = await makeUser(`delete-last-role-${tag}`);
    await prisma.userRoleAssignment.create({
      data: { userId: holder.userId, roleId: role.id },
    });

    await request(app!.getHttpServer())
      .delete(`/rbac/roles/${role.id}`)
      .set(bearer(admin.accessToken))
      .expect(204);

    const live = await prisma.userRoleAssignment.count({
      where: { userId: holder.userId, revokedAt: null },
    });
    expect(live).toBe(0);
  }, 300_000);

  it('refuses to delete a system role, and refuses a second delete', async () => {
    const system = await seedRole(`Platform ${tag}`, [], { isSystem: true });
    await request(app!.getHttpServer())
      .delete(`/rbac/roles/${system.id}`)
      .set(bearer(admin.accessToken))
      .expect(422);

    const once = await seedRole(`Twice ${tag}`, []);
    await request(app!.getHttpServer())
      .delete(`/rbac/roles/${once.id}`)
      .set(bearer(admin.accessToken))
      .expect(204);
    await request(app!.getHttpServer())
      .delete(`/rbac/roles/${once.id}`)
      .set(bearer(admin.accessToken))
      .expect(422);
  }, 300_000);

  it('creates a role WITH its permissions in one request, and stores exactly those', async () => {
    const res = await request(app!.getHttpServer())
      .post('/rbac/roles')
      .set(bearer(admin.accessToken))
      .send({
        name: `CREATED_WITH_GRANTS_${tag.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
        nameEn: 'Created With Grants',
        nameAr: 'أُنشئ مع صلاحياته',
        permissionCodes: ['claim.read', 'customer.create'],
      })
      .expect(201);
    const roleId = (res.body as { id: string }).id;
    createdRoleIds.push(roleId);

    const stored = await prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { code: true } } },
    });
    expect(stored.map((r) => r.permission.code).sort()).toEqual([
      'claim.read',
      'customer.create',
    ]);
  }, 300_000);
});
