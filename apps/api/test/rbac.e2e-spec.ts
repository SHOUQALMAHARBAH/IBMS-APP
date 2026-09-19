import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

/** The eleven roles `packages/db/prisma/seed.ts` seeds. Asserted as a subset of
 *  what `GET /rbac/roles` returns, never as the whole of it — see the comment
 *  at that assertion. */
const SEEDED_ROLE_NAMES = [
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

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface RecertificationItemBody {
  id: string;
  cycleId: string;
  cycleLabel: string;
  subjectUserId: string;
  subjectFullName: string;
  subjectEmail: string;
  subjectRoles: string[];
  reviewerUserId: string;
  decision: string | null;
}
interface CycleBody {
  id: string;
}

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

async function signupAndLogin(
  app: INestApplication<App>,
  email: string,
): Promise<{ accessToken: string; userId: string }> {
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'RBAC Test User', email, password: PASSWORD })
    .expect(201);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = res.body as IssuedSessionBody;
  return { accessToken: body.accessToken, userId: body.user.id };
}

/** MfaRequiredGuard runs before PermissionsGuard in the guard chain — every
 * user in these tests must enroll MFA first or every request 403s on that
 * guard instead of exercising RBAC. */
async function enrollMfa(
  app: INestApplication<App>,
  accessToken: string,
): Promise<void> {
  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  const secret = secretFromOtpAuthUri(enrollBody.otpAuthUri);
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);
}

async function grantRole(userId: string, roleName: RoleName): Promise<void> {
  const role = await ensureRole(roleName);
  const activeGrant = await prisma.userRoleAssignment.findFirst({
    where: { userId, roleId: role.id, revokedAt: null },
  });
  if (!activeGrant) {
    await prisma.userRoleAssignment.create({
      data: { userId, roleId: role.id },
    });
  }
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  role?: RoleName,
): Promise<{ accessToken: string; userId: string; email: string }> {
  const email = uniqueEmail(label);
  const { accessToken, userId } = await signupAndLogin(app, email);
  await enrollMfa(app, accessToken);
  if (role) await grantRole(userId, role);
  return { accessToken, userId, email };
}

/** A role with a name no list in this codebase knows, holding exactly the given
 *  permission codes — what an office actually builds after Phase 3. */
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
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A mistyped code would otherwise grant nothing and make the test fail for a
  // reason that looks like the behaviour under test.
  expect(permissions.map((r) => r.code).sort()).toEqual([...codes].sort());
  await prisma.rolePermission.createMany({
    data: permissions.map((perm) => ({
      roleId: role.id,
      permissionId: perm.id,
    })),
  });
  return role;
}

/** `makeUser`, but granting a role by ID — `grantRole` upserts by NAME, which
 *  would resolve a custom role to a fresh one with no permissions. */
async function makeUserWithRoleId(
  app: INestApplication<App>,
  label: string,
  roleId: string,
): Promise<{ accessToken: string; userId: string; email: string }> {
  const created = await makeUser(app, label);
  await prisma.userRoleAssignment.create({
    data: { userId: created.userId, roleId },
  });
  return created;
}

/** AccessRecertificationService.startCycle always assigns the FIRST
 * eligible (!= subject) member of the reviewer pool — not "whoever started
 * the cycle". The test DB accumulates COMPLIANCE_OFFICER/
 * BRANCH_DEPARTMENT_MANAGER/EXECUTIVE_MANAGEMENT grants across every past
 * run of this file, which would otherwise make "who becomes the reviewer"
 * nondeterministic here. Reset the pool immediately before any test that
 * depends on knowing exactly who it'll be — scoped to these three roles
 * only, and only ever touches the (test-only) db-test database.
 */
/** Provisioning requires a Department AND a Branch (Part II §4.2.2), created
 *  through their own endpoints rather than inserted, so the only path an
 *  administrator really has stays exercised. */
async function orgUnitsFor(
  app: INestApplication<App>,
  accessToken: string,
  tag: number,
): Promise<{ departmentId: string; branchId: string }> {
  const department = await request(app.getHttpServer())
    .post('/admin/departments')
    .set(bearer(accessToken))
    .send({ name: `DTO Dept ${tag}`, nameAr: `قسم ${tag}` })
    .expect(201);
  const branch = await request(app.getHttpServer())
    .post('/admin/branches')
    .set(bearer(accessToken))
    .send({ name: `DTO Branch ${tag}`, nameAr: `فرع ${tag}` })
    .expect(201);
  return {
    departmentId: (department.body as { id: string }).id,
    branchId: (branch.body as { id: string }).id,
  };
}

async function resetReviewerPool(): Promise<void> {
  // Keyed on the PERMISSION since Phase 2, not on the three legacy role names.
  // A name-keyed reset would leave any custom reviewer role in the pool and make
  // "who becomes the reviewer" nondeterministic again — including the roles the
  // custom-role test below creates.
  const grants = await prisma.rolePermission.findMany({
    where: {
      permission: {
        code: {
          in: [
            'access-recertification.review',
            'access-recertification.review.routine',
          ],
        },
      },
    },
    select: { roleId: true },
  });
  await prisma.userRoleAssignment.updateMany({
    where: {
      revokedAt: null,
      roleId: { in: [...new Set(grants.map((g) => g.roleId))] },
    },
    data: { revokedAt: new Date() },
  });
}

describe('RBAC / access recertification (e2e)', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('GET /rbac/roles, /rbac/permissions', () => {
    it('is forbidden for a user without role.manage/permission.manage', async () => {
      const app = await boot();
      const plain = await makeUser(app, 'rbac-plain');
      await request(app.getHttpServer())
        .get('/rbac/roles')
        .set(bearer(plain.accessToken))
        .expect(403);
      await request(app.getHttpServer())
        .get('/rbac/permissions')
        .set(bearer(plain.accessToken))
        .expect(403);
    });

    it('is allowed for SYSTEM_SECURITY_ADMINISTRATOR and returns the seeded catalogue', async () => {
      const app = await boot();
      const admin = await makeUser(
        app,
        'rbac-admin',
        'SYSTEM_SECURITY_ADMINISTRATOR',
      );
      const roles = await request(app.getHttpServer())
        .get('/rbac/roles')
        .set(bearer(admin.accessToken))
        .expect(200);
      // A SUPERSET check, not `length === 11`.
      //
      // Two reasons the exact count was the wrong assertion, and office-scoped
      // custom roles made both of them real. This database is cumulative, so any
      // spec that creates a role — several now do — moves a global count; and
      // the whole point of this project is that an office defines roles beyond
      // the legacy eleven, so a catalogue of exactly eleven stops being the
      // expected state the moment Phase 3 ships. What must hold is that every
      // seeded role is still there.
      const names = (roles.body as { name: string }[]).map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(SEEDED_ROLE_NAMES));
      expect(new Set(names).size, 'no duplicate role names in one office').toBe(
        names.length,
      );

      const permissions = await request(app.getHttpServer())
        .get('/rbac/permissions')
        .set(bearer(admin.accessToken))
        .expect(200);
      expect((permissions.body as { code: string }[]).length).toBeGreaterThan(
        50,
      );
    });
  });

  describe('role names are free text, not the legacy enum', () => {
    it('accepts a CUSTOM role name on provisioning and on a later grant', async () => {
      // Phase 2 workstream H. `ProvisionUserDto` and `RoleAssignmentDto`
      // validated `roles` against the legacy `RoleName` enum, so every custom
      // name was rejected with a 400 before the service could look it up — Phase
      // 3 could have created a role that no endpoint would assign.
      const app = await boot();
      const tag = Date.now();
      const custom = await makeCustomRole(`Client Liaison ${tag}`, [
        'lead.list.read',
      ]);
      const second = await makeCustomRole(`Renewals Desk ${tag}`, [
        'renewal.read',
      ]);
      const admin = await makeUser(
        app,
        'dto-admin',
        'SYSTEM_SECURITY_ADMINISTRATOR',
      );
      const orgUnits = await orgUnitsFor(app, admin.accessToken, tag);

      try {
        const provisioned = await request(app.getHttpServer())
          .post('/admin/users')
          .set(bearer(admin.accessToken))
          .send({
            fullName: 'Custom Role Holder',
            email: uniqueEmail('custom-role-holder'),
            password: PASSWORD,
            departmentId: orgUnits.departmentId,
            branchId: orgUnits.branchId,
            roles: [`Client Liaison ${tag}`],
          })
          .expect(201);
        const provisionedId = (provisioned.body as { id: string }).id;
        expect((provisioned.body as { roles: string[] }).roles).toEqual([
          `Client Liaison ${tag}`,
        ]);

        // And a second custom role granted afterwards, through the other DTO.
        const granted = await request(app.getHttpServer())
          .post(`/admin/users/${provisionedId}/roles`)
          .set(bearer(admin.accessToken))
          .send({ role: `Renewals Desk ${tag}` })
          .expect(201);
        expect((granted.body as { roles: string[] }).roles.sort()).toEqual(
          [`Client Liaison ${tag}`, `Renewals Desk ${tag}`].sort(),
        );
      } finally {
        const ids = [custom.id, second.id];
        await prisma.userRoleAssignment.deleteMany({
          where: { roleId: { in: ids } },
        });
        await prisma.rolePermission.deleteMany({
          where: { roleId: { in: ids } },
        });
        await prisma.role.deleteMany({ where: { id: { in: ids } } });
      }
    }, 300_000);

    it('rejects an UNKNOWN role with 422, not 400 — the lookup decides, not the validator', async () => {
      // The distinction matters: 400 means "this could never be a role name",
      // which is no longer something a validator can know. 422 means "no such
      // role in THIS office", which is the scoped lookup answering — and that
      // scoping is what stops one office probing another's role names.
      const app = await boot();
      const tag = Date.now();
      const admin = await makeUser(
        app,
        'dto-admin-unknown',
        'SYSTEM_SECURITY_ADMINISTRATOR',
      );
      const target = await makeUser(app, 'dto-target');

      await request(app.getHttpServer())
        .post(`/admin/users/${target.userId}/roles`)
        .set(bearer(admin.accessToken))
        .send({ role: `No Such Role ${tag}` })
        .expect(422);

      const orgUnits = await orgUnitsFor(app, admin.accessToken, tag);
      await request(app.getHttpServer())
        .post('/admin/users')
        .set(bearer(admin.accessToken))
        .send({
          fullName: 'Unknown Role',
          email: uniqueEmail('unknown-role'),
          password: PASSWORD,
          departmentId: orgUnits.departmentId,
          branchId: orgUnits.branchId,
          roles: [`No Such Role ${tag}`],
        })
        .expect(422);
    }, 300_000);

    it('still rejects a malformed name with 400 — the shape is bounded even though the vocabulary is not', async () => {
      // Relaxing the vocabulary is not the same as accepting anything. These
      // values reach audit rows and log lines, so an empty name, an
      // over-long one, and one carrying a control character are all still 400.
      const app = await boot();
      const admin = await makeUser(
        app,
        'dto-admin-malformed',
        'SYSTEM_SECURITY_ADMINISTRATOR',
      );
      const target = await makeUser(app, 'dto-target-malformed');

      for (const role of ['', 'x'.repeat(101), 'Bad\nName']) {
        await request(app.getHttpServer())
          .post(`/admin/users/${target.userId}/roles`)
          .set(bearer(admin.accessToken))
          .send({ role })
          .expect(400);
      }
    }, 300_000);
  });

  describe('access-recertification cycle lifecycle', () => {
    it('is forbidden to start a cycle or list items without access-recertification permissions', async () => {
      const app = await boot();
      const plain = await makeUser(app, 'recert-plain');
      await request(app.getHttpServer())
        .post('/access-recertification/cycles')
        .set(bearer(plain.accessToken))
        .send({ cycleLabel: 'unauthorized-attempt' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/access-recertification/items')
        .set(bearer(plain.accessToken))
        .expect(403);
    });

    it('runs a full cycle for an office whose reviewers are CUSTOM roles only', async () => {
      // Phase 2 workstream E, and the case that is broken before it.
      //
      // The reviewer pool used to be three hard-coded role NAMES. An office that
      // had built its own roles matched none of them, so `pickReviewer` threw for
      // every subject, `startCycle` skipped every one with a warning, and the
      // cycle completed having recertified NOBODY — a compliance control
      // reporting success while doing nothing. Nothing failed; there was simply
      // no work in the cycle.
      const app = await boot();
      await resetReviewerPool();

      const tag = Date.now();
      const reviewerRole = await makeCustomRole(`Access Reviewer ${tag}`, [
        'access-recertification.cycle.start',
        'access-recertification.review',
        'access-recertification.review.routine',
      ]);
      const subjectRole = await makeCustomRole(`Ordinary Staff ${tag}`, [
        'lead.list.read',
      ]);

      try {
        const reviewer = await makeUserWithRoleId(
          app,
          'recert-custom-reviewer',
          reviewerRole.id,
        );
        const subject = await makeUserWithRoleId(
          app,
          'recert-custom-subject',
          subjectRole.id,
        );

        const cycleRes = await request(app.getHttpServer())
          .post('/access-recertification/cycles')
          .set(bearer(reviewer.accessToken))
          .send({ cycleLabel: `custom-roles-${tag}` })
          .expect(201);
        const cycleId = (cycleRes.body as CycleBody).id;

        const itemsRes = await request(app.getHttpServer())
          .get('/access-recertification/items')
          .query({ cycleId })
          .set(bearer(reviewer.accessToken))
          .expect(200);
        const items = itemsRes.body as RecertificationItemBody[];

        // The cycle did real work: the ordinary-staff subject has an item, and
        // its reviewer is the custom role's holder. Before this phase there would
        // have been no item at all.
        const subjectItem = items.find(
          (i) => i.subjectUserId === subject.userId,
        );
        expect(
          subjectItem,
          'a custom-role office must still recertify its staff',
        ).toBeDefined();
        expect(subjectItem!.reviewerUserId).toBe(reviewer.userId);

        // And the reviewer is never their own reviewer: with one pool member they
        // are skipped entirely rather than self-assigned, which is the same
        // behaviour the seeded-role test below pins.
        expect(
          items.find((i) => i.subjectUserId === reviewer.userId),
        ).toBeUndefined();

        // The decision itself works for a custom role — eligibility to decide is
        // `access-recertification.review`, which this role holds.
        await request(app.getHttpServer())
          .post(`/access-recertification/items/${subjectItem!.id}/decision`)
          .set(bearer(reviewer.accessToken))
          .send({ decision: 'confirmed' })
          .expect(201);
      } finally {
        // db-test is cumulative.
        const ids = [reviewerRole.id, subjectRole.id];
        await prisma.userRoleAssignment.deleteMany({
          where: { roleId: { in: ids } },
        });
        await prisma.rolePermission.deleteMany({
          where: { roleId: { in: ids } },
        });
        await prisma.role.deleteMany({ where: { id: { in: ids } } });
      }
    }, 300_000);

    it('a Compliance Officer starting a cycle never becomes the reviewer of their own item, and reviews the subject assigned to them', async () => {
      const app = await boot();
      await resetReviewerPool();
      const compliance = await makeUser(
        app,
        'recert-compliance',
        'COMPLIANCE_OFFICER',
      );
      const subject = await makeUser(
        app,
        'recert-subject',
        'SALES_RELATIONSHIP_OFFICER',
      );

      const cycleRes = await request(app.getHttpServer())
        .post('/access-recertification/cycles')
        .set(bearer(compliance.accessToken))
        .send({ cycleLabel: `e2e-${Date.now()}` })
        .expect(201);
      const cycleId = (cycleRes.body as CycleBody).id;

      const itemsRes = await request(app.getHttpServer())
        .get('/access-recertification/items')
        .query({ cycleId })
        .set(bearer(compliance.accessToken))
        .expect(200);
      const items = itemsRes.body as RecertificationItemBody[];

      // The compliance officer must never review themselves — with only
      // one pool member, they have no item at all in this cycle rather
      // than one reviewed by someone else, which is the correct behavior
      // (see access-recertification.service.spec.ts's equivalent unit test).
      expect(items.some((i) => i.subjectUserId === compliance.userId)).toBe(
        false,
      );
      // The subject, with no other eligible reviewer in a freshly-reset
      // pool, must have been assigned to this compliance officer.
      const subjectItem = items.find((i) => i.subjectUserId === subject.userId);
      expect(subjectItem).toBeDefined();
      expect(subjectItem?.reviewerUserId).toBe(compliance.userId);
      // The item is enriched for the review screen — not just raw ids.
      expect(subjectItem?.subjectEmail).toBe(subject.email);
      expect(subjectItem?.subjectFullName.length).toBeGreaterThan(0);
      expect(subjectItem?.subjectRoles).toContain('SALES_RELATIONSHIP_OFFICER');
      expect(subjectItem?.cycleLabel.length).toBeGreaterThan(0);

      // Deciding it works...
      await request(app.getHttpServer())
        .post(`/access-recertification/items/${subjectItem!.id}/decision`)
        .set(bearer(compliance.accessToken))
        .send({ decision: 'confirmed' })
        .expect(201);

      // ...and a second decision on the same item is rejected.
      await request(app.getHttpServer())
        .post(`/access-recertification/items/${subjectItem!.id}/decision`)
        .set(bearer(compliance.accessToken))
        .send({ decision: 'revoked' })
        .expect(409);
    });

    it("rejects a decision from a user who holds access-recertification.review but is not this item's assigned reviewer", async () => {
      const app = await boot();
      await resetReviewerPool();
      const compliance = await makeUser(
        app,
        'recert-compliance2',
        'COMPLIANCE_OFFICER',
      );
      const subject = await makeUser(app, 'recert-subject2', 'CLAIMS_OFFICER');
      const bystander = await makeUser(
        app,
        'recert-bystander',
        'COMPLIANCE_OFFICER',
      );

      const cycleRes = await request(app.getHttpServer())
        .post('/access-recertification/cycles')
        .set(bearer(compliance.accessToken))
        .send({ cycleLabel: `e2e-${Date.now()}` })
        .expect(201);
      const cycleId = (cycleRes.body as CycleBody).id;

      const itemsRes = await request(app.getHttpServer())
        .get('/access-recertification/items')
        .query({ cycleId })
        .set(bearer(compliance.accessToken))
        .expect(200);
      const subjectItem = (itemsRes.body as RecertificationItemBody[]).find(
        (i) => i.subjectUserId === subject.userId,
      );
      // "compliance" was created (and thus resolved as the pool's first
      // eligible member) before "bystander", so it — not bystander — is
      // the assigned reviewer.
      expect(subjectItem).toBeDefined();
      expect(subjectItem?.reviewerUserId).toBe(compliance.userId);

      await request(app.getHttpServer())
        .post(`/access-recertification/items/${subjectItem!.id}/decision`)
        .set(bearer(bystander.accessToken))
        .send({ decision: 'confirmed' })
        .expect(403);
    });

    it('closes the double-decide race: two concurrent decisions on the same item — exactly one succeeds, the other gets a clean 409', async () => {
      const app = await boot();
      await resetReviewerPool();
      const compliance = await makeUser(
        app,
        'recert-race-compliance',
        'COMPLIANCE_OFFICER',
      );
      const subject = await makeUser(
        app,
        'recert-race-subject',
        'SALES_RELATIONSHIP_OFFICER',
      );

      const cycleRes = await request(app.getHttpServer())
        .post('/access-recertification/cycles')
        .set(bearer(compliance.accessToken))
        .send({ cycleLabel: `e2e-race-${Date.now()}` })
        .expect(201);
      const cycleId = (cycleRes.body as CycleBody).id;

      const itemsRes = await request(app.getHttpServer())
        .get('/access-recertification/items')
        .query({ cycleId })
        .set(bearer(compliance.accessToken))
        .expect(200);
      const subjectItem = (itemsRes.body as RecertificationItemBody[]).find(
        (i) => i.subjectUserId === subject.userId,
      );
      expect(subjectItem).toBeDefined();

      // Both requests read the item before either has decided — only the
      // status-conditional updateMany in AccessRecertificationRepository
      // (not the in-app pre-check) can close this race
      // (race-safe-invariants.md).
      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post(`/access-recertification/items/${subjectItem!.id}/decision`)
          .set(bearer(compliance.accessToken))
          .send({ decision: 'confirmed' }),
        request(app.getHttpServer())
          .post(`/access-recertification/items/${subjectItem!.id}/decision`)
          .set(bearer(compliance.accessToken))
          .send({ decision: 'revoked' }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
    });
  });
});
