import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { UnprocessableEntityException } from '@nestjs/common';
import type { App } from 'supertest/types';
import { rawPrisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { UserAdminService } from '../src/modules/rbac/services/user-admin.service';
import { UserRepository } from '../src/repositories/user.repository';
import { OrgContextService } from '../src/common/org-context/org-context.service';

/**
 * Office-scoped custom RBAC, PHASE 2 workstream F — the race the new lock
 * exists for.
 *
 * The last-administrator guard refuses to remove the final holder of
 * `user.manage`, because that is the capability which grants roles back: lose it
 * and the office is locked out of its own administration surface with no way
 * back short of direct database access.
 *
 * Until Phase 2 the guard held `SELECT ... FOR UPDATE` on ONE Role row, which
 * served while exactly one role could hold `user.manage`. Keyed on the
 * capability instead of that role's name, several roles in an office can hold
 * it — and two revocations against DIFFERENT administrator roles lock different
 * rows, serialise against nothing, both observe a surviving administrator, and
 * both commit. The row lock did not become wrong; the thing it protected stopped
 * being one row.
 *
 * ## Why this file runs against its own Organization
 *
 * The guard counts every holder in the office, and `db-test` is cumulative —
 * dozens of accounts there already hold `user.manage`, so nothing done to two
 * of them could ever reach the last one. A throwaway Organization is the only
 * way to control the population exactly. Spec files run serially
 * (`fileParallelism: false`), so creating one is safe.
 *
 * It is NOT safe to leave one behind, which the first version of this file did.
 * `POST /auth/signup` refuses once more than one Organization exists (it has no
 * subdomain to resolve against until Phase 4), so a leaked office breaks every
 * later spec that signs a user up — observed: 17 failures across `rbac` and
 * `tenant-isolation`, none of them about this file.
 *
 * The teardown failed for a reason worth knowing: `AuditLogEntry` carries a Part
 * 10.3 immutability trigger that rejects every DELETE, and this file's revokes
 * write audit rows, so the plain `deleteMany` threw and left the Organization
 * pinned by a foreign key. `SET LOCAL session_replication_role = replica`
 * suspends user triggers for one transaction on the OWNER connection — the
 * documented bypass `tenant-isolation.e2e-spec.ts` already uses for exactly
 * this. Cleanup therefore runs in `beforeAll` as well, so a crashed run cannot
 * poison the next one, and the fixture uses FIXED identifiers so repeated runs
 * cannot accumulate (five runs of the first version left ten users behind).
 *
 * ## Why this drives the service rather than HTTP
 *
 * Two genuinely concurrent requests are the whole point, and there is no
 * authenticated HTTP path into a second Organization until Phase 4's subdomain
 * resolution. Calling the service inside `orgContext.runAs` is the same code
 * path a request takes after `JwtStrategy` has established the office.
 */

const ORG_ID = '00000000-0000-0000-0000-0000000000c1';
const SUBDOMAIN = 'last-admin-lock-e2e';

let app: INestApplication<App> | null = null;
let service: UserAdminService;
let users: UserRepository;
let orgContext: OrgContextService;

/** Two DIFFERENT roles, both granting `user.manage` — the shape a single row
 *  lock cannot serialise. Addressed by ID: `revokeRole` takes a role id since
 *  the Phase 3 prep step, and this file calls the service directly, so no DTO
 *  would have caught a name here. */
let roleAId: string;
let roleBId: string;
let adminAId: string;
let adminBId: string;

/**
 * Removes every trace of this file's Organization, in dependency order.
 *
 * Idempotent and run at BOTH ends: a crashed run must not be able to leave an
 * Organization behind, because a second one breaks signup everywhere else.
 */
async function removeFixtureOrg(): Promise<void> {
  await rawPrisma.$transaction(async (tx) => {
    // See the file header: the audit trail is immutable by trigger, and these
    // rows would otherwise pin the Organization forever. Owner connection only —
    // `ibms_app` is NOSUPERUSER and genuinely cannot do this.
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRaw`DELETE FROM "AuditLogEntry" WHERE "organizationId" = ${ORG_ID}`;
  });
  await rawPrisma.userSession.deleteMany({ where: { organizationId: ORG_ID } });
  await rawPrisma.userRoleAssignment.deleteMany({
    where: { organizationId: ORG_ID },
  });
  await rawPrisma.rolePermission.deleteMany({
    where: { organizationId: ORG_ID },
  });
  await rawPrisma.role.deleteMany({ where: { organizationId: ORG_ID } });
  await rawPrisma.user.deleteMany({ where: { organizationId: ORG_ID } });
  await rawPrisma.organization.deleteMany({ where: { id: ORG_ID } });
}

async function resetFixture(): Promise<void> {
  await rawPrisma.userRoleAssignment.deleteMany({
    where: { organizationId: ORG_ID },
  });
  await rawPrisma.userRoleAssignment.createMany({
    data: [
      { organizationId: ORG_ID, userId: adminAId, roleId: roleAId },
      { organizationId: ORG_ID, userId: adminBId, roleId: roleBId },
    ],
  });
  await rawPrisma.user.updateMany({
    where: { organizationId: ORG_ID },
    data: { isActive: true },
  });
}

beforeAll(async () => {
  // BEFORE the app boots and before anything signs up: clear whatever a crashed
  // run left behind.
  await removeFixtureOrg();

  app = await createTestApp();
  service = app.get(UserAdminService);
  users = app.get(UserRepository);
  orgContext = app.get(OrgContextService);

  await rawPrisma.organization.create({
    data: {
      id: ORG_ID,
      legalName: 'Last Administrator Lock Office',
      subdomain: SUBDOMAIN,
    },
  });

  const userManage = await rawPrisma.permission.findUniqueOrThrow({
    where: { code: 'user.manage' },
  });

  // Two administrator roles with names no list in this codebase knows, so the
  // guard can only be finding them through the permission.
  const [roleA, roleB] = await Promise.all(
    ['Office Admin A', 'Office Admin B'].map((name) =>
      rawPrisma.role.create({
        data: {
          organizationId: ORG_ID,
          name,
          nameEn: name,
          nameAr: name,
          requiresMfaAlways: false,
          requiresHardwareToken: false,
          permissions: {
            create: [{ organizationId: ORG_ID, permissionId: userManage.id }],
          },
        },
      }),
    ),
  );
  roleAId = roleA.id;
  roleBId = roleB.id;

  const [adminA, adminB] = await Promise.all(
    ['admin-a', 'admin-b'].map((label) =>
      rawPrisma.user.create({
        data: {
          organizationId: ORG_ID,
          fullName: `Lock ${label}`,
          // FIXED, not timestamped: this Organization is removed at both ends,
          // so a stable address cannot collide — and if one ever did, that is a
          // teardown failure worth failing on rather than papering over with a
          // fresh address every run.
          email: `${label}@last-admin-lock.test`,
          passwordHash: 'x',
          isActive: true,
          languagePreference: 'AR',
        },
      }),
    ),
  );
  adminAId = adminA.id;
  adminBId = adminB.id;
  await resetFixture();
}, 240_000);

afterAll(async () => {
  await app?.close();
  app = null;
  await removeFixtureOrg();
});

describe('withCapabilityLocked actually serialises', () => {
  it('does not let a second holder of the same key enter before the first leaves', async () => {
    // The DETERMINISTIC proof, and the reason it exists separately from the race
    // tests below.
    //
    // A race test can pass for the wrong reason: two revocations that happen to
    // complete one after the other prove nothing about the lock. Observed
    // directly — removing the lock left the concurrent-revoke test below GREEN
    // while the concurrent-deactivate test went red, purely on I/O timing.
    //
    // This one cannot pass by luck. Each critical section announces entry, waits
    // long enough that an unserialised second caller would certainly have
    // entered, then announces exit. If the lock works the trace is strictly
    // paired: enter, exit, enter, exit.
    const trace: string[] = [];
    const section = (label: string) => async () => {
      trace.push(`enter-${label}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      trace.push(`exit-${label}`);
      return label;
    };

    await Promise.all([
      orgContext.runAs(ORG_ID, () =>
        users.withCapabilityLocked('user.manage', section('a')),
      ),
      orgContext.runAs(ORG_ID, () =>
        users.withCapabilityLocked('user.manage', section('b')),
      ),
    ]);

    expect(trace).toHaveLength(4);
    // Whichever went first, its exit must precede the other's entry.
    const first = trace[0].slice('enter-'.length);
    const second = first === 'a' ? 'b' : 'a';
    expect(trace).toEqual([
      `enter-${first}`,
      `exit-${first}`,
      `enter-${second}`,
      `exit-${second}`,
    ]);
  }, 120_000);

  it('does NOT serialise two different capabilities, or two different offices', async () => {
    // The other half: a lock that serialised everything would be correct and
    // useless. Keying on (organizationId, code) is what keeps an office's
    // administration surface from blocking on unrelated work.
    const trace: string[] = [];
    const section = (label: string) => async () => {
      trace.push(`enter-${label}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      trace.push(`exit-${label}`);
    };

    await Promise.all([
      orgContext.runAs(ORG_ID, () =>
        users.withCapabilityLocked('user.manage', section('a')),
      ),
      orgContext.runAs(ORG_ID, () =>
        users.withCapabilityLocked('role.manage', section('b')),
      ),
    ]);

    // Overlapping, so both entries precede both exits.
    expect(trace.slice(0, 2).every((e) => e.startsWith('enter-'))).toBe(true);
  }, 120_000);

  it('refuses to take an unkeyed lock with no Organization context', async () => {
    // An unkeyed lock would serialise every office against every other, and
    // silently. Refusing is the only safe answer.
    await expect(
      users.withCapabilityLocked('user.manage', () => Promise.resolve()),
    ).rejects.toThrow(/requires an Organization context/);
  }, 60_000);
});

describe('the last-administrator guard survives two concurrent removals', () => {
  it('lets exactly ONE of two simultaneous revocations through, across two different administrator roles', async () => {
    await resetFixture();

    // Both revocations start before either finishes. Each targets a DIFFERENT
    // role, so a lock on the Role row would put them on separate keys and let
    // both through.
    const results = await Promise.allSettled([
      orgContext.runAs(ORG_ID, () =>
        service.revokeRole(adminAId, roleAId, adminAId),
      ),
      orgContext.runAs(ORG_ID, () =>
        service.revokeRole(adminBId, roleBId, adminBId),
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled, 'exactly one revoke may succeed').toHaveLength(1);
    expect(rejected, 'the other must be refused').toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(UnprocessableEntityException);

    // The invariant itself, not just the call outcomes: somebody can still
    // administer users.
    const holders = await orgContext.runAs(ORG_ID, () =>
      users.findActiveHoldersOfPermission('user.manage'),
    );
    expect(
      new Set(holders.map((h) => h.userId)).size,
      'the office must keep at least one administrator',
    ).toBe(1);
  }, 120_000);

  it('lets exactly ONE of two simultaneous deactivations through', async () => {
    // The same invariant reached by a different route. Deactivating is as
    // effective a way to remove the last usable administrator as revoking —
    // `AuthService.login` refuses an inactive account — and two administrators
    // deactivating EACH OTHER are neither of them deactivating themselves, so the
    // self-deactivation guard does not catch it.
    await resetFixture();

    const results = await Promise.allSettled([
      orgContext.runAs(ORG_ID, () =>
        service.setActive(adminAId, false, adminBId),
      ),
      orgContext.runAs(ORG_ID, () =>
        service.setActive(adminBId, false, adminAId),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(UnprocessableEntityException);

    const holders = await orgContext.runAs(ORG_ID, () =>
      users.findActiveHoldersOfPermission('user.manage'),
    );
    expect(new Set(holders.map((h) => h.userId)).size).toBe(1);
  }, 120_000);

  it('guards a CUSTOM administrator role by name-independent means', async () => {
    // Neither role here is called SYSTEM_SECURITY_ADMINISTRATOR, so the old
    // name-keyed guard would not have fired at all and BOTH revocations would
    // have succeeded. Sequentially, the second must still be refused.
    await resetFixture();

    await orgContext.runAs(ORG_ID, () =>
      service.revokeRole(adminAId, roleAId, adminAId),
    );
    await expect(
      orgContext.runAs(ORG_ID, () =>
        service.revokeRole(adminBId, roleBId, adminBId),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  }, 120_000);

  it('does NOT refuse revoking one administrator role from a holder of two', async () => {
    // A count of holders would refuse this: `admin-a` would be the only holder,
    // so "one administrator" looks like the last one. Nothing is actually lost —
    // they keep `user.manage` through the second role — and the guard asks what
    // survives THIS revoke rather than how many holders exist.
    await rawPrisma.userRoleAssignment.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await rawPrisma.userRoleAssignment.createMany({
      data: [
        { organizationId: ORG_ID, userId: adminAId, roleId: roleAId },
        { organizationId: ORG_ID, userId: adminAId, roleId: roleBId },
      ],
    });

    await orgContext.runAs(ORG_ID, () =>
      service.revokeRole(adminAId, roleAId, adminAId),
    );

    const holders = await orgContext.runAs(ORG_ID, () =>
      users.findActiveHoldersOfPermission('user.manage'),
    );
    expect(holders.map((h) => h.roleId)).toEqual([roleBId]);
  }, 120_000);
});
