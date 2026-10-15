import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import {
  TEST_ORGANIZATION_ID as DEFAULT_ORGANIZATION_ID,
  prisma,
  rawPrisma,
} from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Office-scoped custom RBAC, PHASE 3 workstream D — the office administrator.
 *
 * An office that defines its own roles needs its administrator to be an ordinary
 * per-office row. Until this, that person had to hold
 * `SYSTEM_SECURITY_ADMINISTRATOR` — one of the fixed eleven the rework is
 * retiring — so "who administers this office" was answered by the platform
 * catalogue rather than by the office.
 *
 * ## What each test here is for
 *
 * The migration's own correctness (a byte-identical per-user effective-permission
 * diff across it, on 31 dev users and 36,688 test users) was proven against the
 * databases directly; it cannot be re-proven from inside a running app, which by
 * definition sees only the post-migration state. What CAN be proven here, and is:
 *
 *  1. Every Organization has a live route to user administration. This is the
 *     rule that outlives the mechanism — there is no org-provisioning endpoint
 *     anywhere yet, so whenever one lands it cannot ship without giving its new
 *     office an administrator.
 *  2. The role reaches exactly its 25 codes and none of the eight withheld ones,
 *     end to end through HTTP, on a real user.
 *  3. `isSystem` GRANTS NOTHING. A flag called "system" on a Role is exactly
 *     where an `if (isSystem) allow` bypass gets smuggled in, so a user holding
 *     an isSystem role with no permissions must reach nothing at all.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const tag = Math.random().toString(36).slice(2, 8);

/**
 * FIXED prefix, and cleaned up at BOTH ends.
 *
 * The `isSystem`-grants-nothing test has to create a role with `isSystem: true`,
 * and `role-security-attributes.e2e-spec.ts` asserts that ONLY platform-defined
 * roles carry that flag. A run killed mid-test therefore leaves a row that breaks
 * a different file — which is what happened, so the name is a fixed prefix rather
 * than a random one and the sweep runs in `beforeAll` too.
 */
const HOLLOW_ROLE_PREFIX = 'Hollow System Role';

async function removeHollowRoles(): Promise<void> {
  const roles = await prisma.role.findMany({
    where: { name: { startsWith: HOLLOW_ROLE_PREFIX } },
    select: { id: true },
  });
  if (roles.length === 0) return;
  const roleIds = roles.map((r) => r.id);
  await prisma.userRoleAssignment.deleteMany({
    where: { roleId: { in: roleIds } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { in: roleIds } },
  });
  await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
}

/** The 25, from `seed-data/roles.ts`. Duplicated deliberately: a test that read
 *  the same list the seed writes would pass whatever that list said.
 *
 *  22 at the Phase 3 migration; `insurer.read` and the insurer relationship codes
 *  are the 23rd and 24th, added by insurer management and deferred to there
 *  precisely so they would land after that migration rather than invalidate its
 *  empty-diff property. They arrive as a PAIR for the same reason `role.read` and
 *  the role write codes do: a write permission is useless on a screen the holder
 *  cannot render. `insurer.office-form.map` is the 25th, from Q9. */
const OFFICE_ADMINISTRATOR_CODES = [
  'user.manage',
  // Part 4 step 4 — declaring whether this office separates the two halves of a maker/checker pair. This role
  // ALONE: whoever declares the mode must not be whoever reviews the acts it permits, and Compliance,
  // Executive Management and the external auditor are the ones holding `internal-controls.view`.
  //
  // This list is an INDEPENDENT COPY of the grid's, on purpose — and the grid's own comment says the two have
  // to move together. They did not, and CI caught it here after the grid spec had already caught it in
  // `packages/db`: one omission, two guards, which is what a deliberate duplicate is for.
  'duty-segregation.mode.declare',
  'employee.read',
  'employee.create',
  'employee.update',
  'deprovisioning.execute',
  'training.record',
  'role.read',
  // `role.manage` split in four-action Phase 1. Three successors; `role.read` above is the fourth.
  'role.create',
  'role.update',
  'role.deactivate',
  'permission.read',
  'security-config.read',
  'security-config.manage',
  'encryption-key.read',
  'email.integration.read',
  'email.integration.manage',
  'customer.bulk-import',
  // The narrow customer list code. This role could bulk-import an office's whole back-book and then
  // not see one of the rows it had written.
  'customer.read',
  'audit-log.read',
  'access-recertification.cycle.start',
  'incident.report',
  'incident.contain',
  'information-asset.manage',
  'bcp-dr.manage',
  // `vendor.manage` split in four-action Phase 1 — all four, because this role held the umbrella.
  'vendor.create',
  'vendor.deactivate',
  'vendor.read',
  'vendor.update',
  // The department/branch four-action pilot. Eight codes rather than one `.manage` each, because
  // separability is the decision: a role can be given view without edit. Declared here as well as in
  // `permissions.spec.ts` because the two copies are deliberately independent — if only one moved,
  // the other fails, which is the point of keeping both.
  'department.read',
  'department.create',
  'department.update',
  'department.deactivate',
  'branch.read',
  'branch.create',
  'branch.update',
  'branch.deactivate',
  // Insurer management — office-scoped, and a PAIR. Reading the office's own
  // insurer list, and registering/maintaining those records. NOT writing the
  // global catalogue.
  'insurer.read',
  // `insurer.relationship.manage` split in four-action Phase 1. FIVE successors: it gated two
  // entities, and an insurance LINE is not an insurer.
  'insurance-line.create',
  'insurance-line.update',
  'insurer.create',
  'insurer.deactivate',
  'insurer.update',
  // The cross-office directory, added with it. The administrator registers
  // insurers, and registration is where a duplicate has to be caught — the
  // match-at-registration suggestion reads this same list. Somebody who can
  // register a company but cannot see which already exist is the one person
  // guaranteed to create the duplicate.
  'insurer.directory.read',
  // Q9's office-scoped form mappings — the 25th. Granted here while `insurer.form.map` stays in
  // WITHHELD_CODES below, and that contrast is the reason both codes exist: the withheld one
  // becomes the form every OTHER office submits against, and this one is readable by one office.
  // Asserted from both sides so a future edit that decided "these are the same thing really"
  // has to break one of the two.
  'insurer.office-form.map',
  // MODULE 0-ب ITEM (e), DECISION 63 — deciding that one of the office's counterparty records IS a
  // particular registered company, and undoing that. This list is an INDEPENDENT COPY of the seed
  // grid's, deliberately: two lists that must be edited together are two chances to notice.
  'insurer.company.link',
  'insurer.company.unlink',
] as const;

/** Withheld on purpose, each for a stated reason. A code moving from this list to
 *  the one above is a deliberate decision, so it has to break a test. */
const WITHHELD_CODES = [
  // destructive business actions an administrator has no business performing
  'claim.delete',
  'document.delete-override',
  // `insurer.form.map`'s effect crosses offices — the grid's own description says
  // the mapping becomes the form every OTHER office submits against. There is no
  // `insurer.master.manage` code in the catalogue to withhold.
  'insurer.form.map',
  // an administrator reviewing their own access is the control this prevents
  'access-recertification.review',
  'access-recertification.review.routine',
  // Part 10.2 Highly Confidential — provisioning an account does not require
  // reading somebody's national identity number
  'employee.national-id.reveal',
  'customer.national-id.reveal',
] as const;

let app: INestApplication<App> | null = null;

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeUserWithRole(
  label: string,
  roleId: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Office Admin ${label}`, email, password: PASSWORD })
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
  // Whatever a crashed run left behind, before anything asserts on it.
  await removeHollowRoles();
}, 240_000);

afterAll(async () => {
  await removeHollowRoles();
  await app?.close();
  app = null;
});

describe('every office has a route to user administration', () => {
  it('has at least one ACTIVE role granting user.manage in every Organization', async () => {
    // The rule that outlives the mechanism. There is no endpoint, service or
    // screen that creates an Organization — the only two writers are
    // `packages/db/prisma/seed.ts` and `apps/api/scripts/seed-demo.script.ts`,
    // and both now install an `OFFICE_ADMINISTRATOR`. This test is what makes
    // the rule survive the arrival of real org provisioning: an office with no
    // way to administer users cannot be set up at all, and would be discovered
    // by its administrator failing to log in rather than by anything here.
    //
    // Asked as a CAPABILITY, not by role name. An office whose administration
    // sits on a role it named itself satisfies this, which is the whole point of
    // the phase.
    //
    // ## THE DENOMINATOR IS BROKERAGE OFFICES, AND THAT IS A CORRECTION, NOT A WEAKENING
    //
    // This read was `findMany()` over every Organization, which was the same set
    // as "every office" until item (j)'s gap closure seeded a PROVIDER row. The
    // rule is about an OFFICE being able to administer itself: the failure it
    // prevents is an office that cannot be set up, or that loses its last
    // administrator and cannot repair itself from inside the system. The platform
    // operator is not an office — it holds no brokerage data and is created
    // deliberately by the seed rather than by signup.
    //
    // The third place the same denominator correction was needed, and the
    // reason is one fact: `soleOrganizationIdOrThrow` (signup's office resolver)
    // and `assertOneOrganization` (the e2e harness) both counted Organizations
    // when they meant brokerage offices. Two things were the same thing until
    // today.
    //
    // WHAT THIS STILL CATCHES, which is why it is not the thing the message below
    // warns against: a leaked e2e fixture office is a BROKERAGE_OFFICE, so it is
    // still in this set and still fails here. Nothing about a real office's
    // administrability is excused.
    const organizations = await prisma.organization.findMany({
      where: { type: 'BROKERAGE_OFFICE' },
      select: { id: true, subdomain: true },
    });
    expect(
      organizations.length,
      'the test database must hold at least the default Organization',
    ).toBeGreaterThan(0);

    /*
     * `rawPrisma`, AND THAT IS A FIX RATHER THAN A STYLE CHOICE.
     *
     * This read was the exported tenant-scoped `prisma`, which is permanently inside the seeded
     * office's context. `Organization` carries no `organizationId` so it is not in
     * `TENANT_SCOPED_MODELS` and the read above sees every row — but `Role` and `RolePermission`
     * both carry one and are scoped, so this set could only ever contain the DEFAULT office.
     *
     * The consequence: a SECOND brokerage office would have been reported orphaned even with a
     * perfectly good administrator role, because its role was invisible to the query. The test
     * claims "in every Organization" and could answer for exactly one.
     *
     * MEASURED, not reasoned — a throwaway probe against db-test comparing the two clients:
     *
     *   scopedRoles=30  rawRoles=31
     *   scopedGrants=517 rawGrants=518
     *   scopedOrgs=2    rawOrgs=2
     *
     * The one role and one grant missing from the scoped view are the platform operator's. This is
     * one of the few specs entitled to cross organizations, for the same reason
     * `role-security-attributes.e2e-spec.ts` says so in its own header: the property under test is
     * "every office's copy agrees", which a tenant-scoped read cannot see.
     */
    const grantingOrgIds = new Set(
      (
        await rawPrisma.role.findMany({
          where: {
            status: 'ACTIVE',
            permissions: { some: { permission: { code: 'user.manage' } } },
          },
          select: { organizationId: true },
        })
      ).map((r) => r.organizationId),
    );

    const orphaned = organizations
      .filter((o) => !grantingOrgIds.has(o.id))
      .map((o) => `${o.subdomain} (${o.id})`);
    expect(
      orphaned,
      'These Organizations have no ACTIVE role granting user.manage, so nobody in them can provision a user. ' +
        'If one is named after an e2e fixture, a killed run leaked it — clean it up rather than weakening this check, ' +
        'because the same failure on a real office means that office cannot be administered at all.',
    ).toEqual([]);
  }, 120_000);

  it('and the PROVIDER administers ITSELF — exactly these codes, and no brokerage capability', async () => {
    /*
     * THE SAME PIN, REPOINTED. Module 0-ب item (b) moved its target rather than removing it.
     *
     * It used to assert the opposite: that the provider held NO route to user administration. That
     * was the honest consequence of item (j) giving its role a single code — and it was a defect,
     * not a design. The provider organization could not add a second operator, change a role, or
     * repair itself from inside the application, which is the same shape
     * `every office has a route to user administration` above calls a defect in its own message.
     *
     * So the provider now administers ITSELF, and what this pins is the SET — because the risk
     * never was that it would hold too few codes, it is that it would quietly acquire a brokerage
     * one. A provider operator holds `role.update` and the permission catalogue is global, so
     * nothing structurally stops them granting their own role `customer.create`. THAT is the
     * declared gap, it stays declared in `seed.ts` and in README § Known gaps, and this assertion
     * is what turns a silent drift into a failing build.
     *
     * WHAT BOUNDS IT TO ITS OWN ORGANIZATION IS TENANCY, not anything written for this module:
     * `User`, `Role`, `UserRoleAssignment` and `RolePermission` all carry `organizationId`, so
     * every read and write through these codes is filtered before it reaches the database. That
     * half is proven over real HTTP in `provider-self-administration.e2e-spec.ts`, by asking for an
     * office's role BY ID and being told it does not exist.
     */
    // `rawPrisma` throughout: `Role` and `RolePermission` are tenant-scoped, so reading another
    // organization's rows through the scoped client returns the DEFAULT OFFICE's — measured last
    // module at 517 grants where one was expected. This test would not have been vacuous, it would
    // have been confidently wrong.
    const provider = await rawPrisma.organization.findFirst({
      where: { type: 'PROVIDER' },
      select: { id: true },
    });
    /*
     * S1 OF THE NAMED SHORT PASS — THIS RETURNED BEFORE IT MEASURED.
     *
     * It used to `return` here, justified as "correct on a database seeded without sample data".
     * The justification was about a database this test never runs against, and the cost was that
     * the guard bounding the provider's capabilities PASSED SILENTLY in exactly the state where
     * something had gone wrong: no provider organization at all.
     *
     * Measured rather than argued: `NODE_ENV` is assigned nowhere in `ci.yml`, `.env.example` or
     * `.env`, so `SEED_SAMPLE_DATA` is TRUE in CI and `ensureProviderOrganization()` always runs;
     * db-test holds exactly one PROVIDER row today. So the branch was unreachable in every
     * environment this spec executes in — which is why nobody noticed that the one environment it
     * WAS written for is the one where a missing provider is a finding rather than a configuration.
     *
     * A missing provider is now a FAILURE NAMING ITSELF. If this spec is ever pointed at a database
     * seeded without sample data, the right answer is to skip the FILE, not to let one test report
     * a correct grant set for an organization that does not exist.
     */
    expect(
      provider,
      'no PROVIDER organization exists, so the set of codes this test bounds could not be read at all. ' +
        'It used to return here and pass. `ensureProviderOrganization()` runs inside SEED_SAMPLE_DATA ' +
        '(NODE_ENV !== "production"), which is TRUE in CI — so an absent provider means the seed did not ' +
        'run or did not complete, and a silent pass would hide it.',
    ).not.toBeNull();
    if (!provider) return; // unreachable past the assertion; narrows the type for the read below

    const codes = (
      await rawPrisma.rolePermission.findMany({
        where: { organizationId: provider.id },
        select: { permission: { select: { code: true } } },
      })
    )
      .map((c) => c.permission.code)
      .sort();

    // THE SET, not a count. A count of eight is satisfied by a set containing `customer.create`,
    // which is exactly the drift this exists to catch — and it is what caught item (d) adding a
    // code, by NAME, in CI. Each entry below is a deliberate edit with a reason beside it.
    expect(codes).toEqual(
      [
        'permission.read',
        // Item (j) — the cross-office dashboard the organization exists for.
        'provider.office-state.read',
        // Item (d) — registering a brokerage office. PLATFORM-scoped, and the only route in this
        // product that creates a tenant.
        'provider.office.register',
        // Item (e) — the other kind of tenant.
        'provider.insurer.register',
        /*
         * Item (f) — giving a registered office its FIRST account, and CI caught this omission by
         * name. I updated `PROVIDER_CODES` in the seed and the grid spec's PLATFORM set and missed
         * THIS pin, which is the same blast-radius mistake as before: I measured "what declares the
         * provider's codes" and the thing that mattered was "what ASSERTS them".
         *
         * Not a tenant-creating code like the two above — it writes INSIDE a tenant, which is why it
         * is a separate grant: registering an office is a filing, handing over its keys is not.
         */
        'provider.office.administrator.invite',
        // Item (b) — self-administration, bounded by tenancy rather than by anything written for it.
        'role.create',
        'role.deactivate',
        'role.read',
        'role.update',
        'user.manage',
      ].sort(),
    );

    // Said a second way, on the SHAPE rather than the list, so a brokerage code added under a name
    // this list does not enumerate still fails. The list above would catch it too; this one says
    // WHY in its message, which is what a reader needs at 3am.
    const brokerage = codes.filter((c) =>
      /^(policy|customer|claim|commission|collection|invoice|receipt|remittance|refund|endorsement|rfq|quotation|lead|prospect|employee)\./.test(
        c,
      ),
    );
    expect(
      brokerage,
      'the provider organization holds a BROKERAGE capability — it administers itself and reads the dashboard, nothing else',
    ).toEqual([]);
  }, 120_000);

  it('gives every Organization an isSystem OFFICE_ADMINISTRATOR with all 25 codes', async () => {
    // The first test would also pass on an office whose only administrator is a
    // legacy `SYSTEM_SECURITY_ADMINISTRATOR`. This one is about the role the
    // migration and both seed writers install.
    const roles = await prisma.role.findMany({
      where: { name: 'OFFICE_ADMINISTRATOR' },
      select: {
        id: true,
        organizationId: true,
        isSystem: true,
        status: true,
        requiresMfaAlways: true,
        requiresHardwareToken: true,
        nameAr: true,
        nameEn: true,
        permissions: { select: { permission: { select: { code: true } } } },
      },
    });
    // Deliberately NOT `roles.length === organizationCount`. `db-test` is
    // cumulative, and a killed run can leave a fixture office behind — that is a
    // leak for the previous test to report, not a reason for this one to fail
    // about grants. What this asserts instead: the seeded default office has the
    // role, and EVERY administrator row that exists anywhere holds exactly the
    // 25 codes, so a drifted copy in any office fails here.
    expect(
      roles.some((r) => r.organizationId === DEFAULT_ORGANIZATION_ID),
      'the seeded default office must have an OFFICE_ADMINISTRATOR',
    ).toBe(true);
    expect(roles.length).toBeGreaterThan(0);

    for (const role of roles) {
      expect(role.isSystem, `${role.organizationId}: must be protected`).toBe(
        true,
      );
      expect(role.status).toBe('ACTIVE');
      // Part II §4.4 — strict, like every administration role. This one can
      // provision accounts, which is the capability an attacker wants most.
      expect(role.requiresMfaAlways).toBe(true);
      expect(role.requiresHardwareToken).toBe(true);
      // A display name in both scripts, or the role shows up untranslated
      // mid-sentence on an Arabic page.
      expect(role.nameAr.length).toBeGreaterThan(0);
      expect(role.nameEn.length).toBeGreaterThan(0);

      const codes = role.permissions.map((p) => p.permission.code).sort();
      expect(codes).toEqual([...OFFICE_ADMINISTRATOR_CODES].sort());
      for (const withheld of WITHHELD_CODES) {
        expect(
          codes,
          `${withheld} must never be granted to the office administrator`,
        ).not.toContain(withheld);
      }
    }
  }, 120_000);

  it('backfilled every administrator it found — in addition, never instead — and only those', async () => {
    // The migration adds a grant and revokes nothing. Removing the legacy grant
    // would be a privilege change disguised as a rename, and would discard the
    // audit record of what somebody held — the reason
    // `UserRoleAssignment.revokedAt` exists rather than a DELETE.
    //
    // ## The set has to be the one the migration could have touched
    //
    // This is a MIGRATION outcome, not an invariant, and the difference is the
    // whole test. The migration is a one-time backfill of the administrators that
    // existed when it ran — it is not a trigger, so a legacy administrator grant
    // made AFTERWARDS does not receive the new role and must not be expected to.
    //
    // The first version of this test asserted the property over
    // `findMany(...).slice(0, 25)`, which is an UNORDERED sample: on the
    // cumulative test database those 25 rows happened to be pre-migration ones, so
    // it passed by luck, and it failed the moment CI ran it against a database
    // created fresh — where the migration runs before any user exists and every
    // administrator is therefore a post-migration one. Both halves are asserted
    // here instead, split on the role's own `createdAt`.
    const adminRole = await prisma.role.findFirstOrThrow({
      where: { name: 'OFFICE_ADMINISTRATOR' },
      select: { id: true, organizationId: true, createdAt: true },
    });
    const legacyHolders = await prisma.userRoleAssignment.findMany({
      where: {
        revokedAt: null,
        role: { name: 'SYSTEM_SECURITY_ADMINISTRATOR' },
      },
      select: {
        userId: true,
        grantedAt: true,
        role: { select: { organizationId: true } },
      },
    });
    expect(
      legacyHolders.length,
      'the seeded sample administrator alone guarantees at least one',
    ).toBeGreaterThan(0);

    const backfilled = legacyHolders.filter(
      (h) => h.grantedAt < adminRole.createdAt,
    );
    const laterGrants = legacyHolders.filter(
      (h) => h.grantedAt >= adminRole.createdAt,
    );

    // Every administrator that PREDATES the role holds it too, in their own
    // office. On a freshly created database this set is empty, and that is
    // correct rather than vacuous — the assertion below covers that case.
    for (const holder of backfilled) {
      const alsoAdministrator = await prisma.userRoleAssignment.findFirst({
        where: {
          userId: holder.userId,
          revokedAt: null,
          role: {
            name: 'OFFICE_ADMINISTRATOR',
            organizationId: holder.role.organizationId,
          },
        },
      });
      expect(
        alsoAdministrator,
        `user ${holder.userId} held the legacy administrator role BEFORE the migration ran and did not receive OFFICE_ADMINISTRATOR`,
      ).not.toBeNull();
    }

    // And the one thing that is true on every database: the two sets together are
    // every legacy administrator, so neither branch can silently cover nothing
    // while the other passes.
    expect(backfilled.length + laterGrants.length).toBe(legacyHolders.length);

    // Nobody lost the capability either way — which is the property the office
    // actually depends on, and the one that does hold as an invariant.
    const holders = await prisma.userRoleAssignment.findMany({
      where: {
        revokedAt: null,
        role: {
          status: 'ACTIVE',
          permissions: { some: { permission: { code: 'user.manage' } } },
        },
      },
      select: { userId: true },
    });
    const canAdminister = new Set(holders.map((h) => h.userId));
    for (const holder of legacyHolders) {
      expect(
        canAdminister.has(holder.userId),
        `user ${holder.userId} holds the legacy administrator role but can no longer administer users`,
      ).toBe(true);
    }
  }, 120_000);
});

describe('the office administrator reaches exactly its 25 codes', () => {
  it('provisions a user and reads the role catalogue, holding no legacy role', async () => {
    const role = await prisma.role.findFirstOrThrow({
      where: { name: 'OFFICE_ADMINISTRATOR' },
      select: { id: true },
    });
    const admin = await makeUserWithRole(`oa-${tag}`, role.id);

    const me = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(admin.accessToken))
      .expect(200);
    const body = me.body as { roles: string[]; permissions: string[] };
    expect(body.roles).toEqual(['OFFICE_ADMINISTRATOR']);
    expect([...body.permissions].sort()).toEqual(
      [...OFFICE_ADMINISTRATOR_CODES].sort(),
    );

    // The two capabilities the role exists for, through the real guard chain.
    await request(app!.getHttpServer())
      .get('/rbac/roles')
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app!.getHttpServer())
      .get('/rbac/permissions')
      .set(bearer(admin.accessToken))
      .expect(200);
    await request(app!.getHttpServer())
      .get('/admin/users')
      .set(bearer(admin.accessToken))
      .expect(200);
  }, 300_000);

  it('is refused the eight withheld codes at the route, not merely absent from the grid', async () => {
    // A code missing from the grid proves nothing about the gate. These are the
    // routes behind three of the eight, chosen because each has a real endpoint:
    // the insurer catalogue, the recertification review, and the national-ID
    // reveal. 403 in every case.
    const role = await prisma.role.findFirstOrThrow({
      where: { name: 'OFFICE_ADMINISTRATOR' },
      select: { id: true },
    });
    const admin = await makeUserWithRole(`oa-refused-${tag}`, role.id);

    // `insurer.form.map` — the global insurer catalogue is a platform concern.
    await request(app!.getHttpServer())
      .post(
        '/insurer-masters/00000000-0000-0000-0000-000000000000/form-templates',
      )
      .set(bearer(admin.accessToken))
      .send({ version: 'v1', fieldMap: {} })
      .expect(403);

    // `access-recertification.review` — the administrator STARTS a cycle
    // (`.cycle.start`, which it does hold) and never reviews its own access.
    // That split is the control, and it only means anything if the review route
    // refuses.
    await request(app!.getHttpServer())
      .get('/access-recertification/items')
      .set(bearer(admin.accessToken))
      .expect(403);

    // Part 10.2. An administrator provisions accounts; it does not read a
    // person's national identity number. The employee reveal is gated at the
    // route because its DTO accepts only that field.
    await request(app!.getHttpServer())
      .post('/employees/00000000-0000-0000-0000-000000000000/reveal-field')
      .set(bearer(admin.accessToken))
      .send({
        field: 'nationalId',
        reason: 'Checking whether this gate holds.',
      })
      .expect(403);
  }, 300_000);
});

describe('isSystem grants nothing', () => {
  it('reaches NOTHING when an isSystem role holds no permissions', async () => {
    // The bypass test. `isSystem` protects a row from being renamed, retired or
    // re-granted and does nothing else — authorization never reads it. A flag
    // called "system" on a Role is exactly where an `if (isSystem) allow` would
    // be smuggled in, so this holds an isSystem role with ZERO grants and walks
    // the routes an administrator would use.
    const hollowName = `${HOLLOW_ROLE_PREFIX} ${tag}`;
    const hollow = await prisma.role.create({
      data: {
        name: hollowName,
        nameAr: hollowName,
        nameEn: hollowName,
        isSystem: true,
      },
    });
    const user = await makeUserWithRole(`hollow-${tag}`, hollow.id);

    const me = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(user.accessToken))
      .expect(200);
    expect((me.body as { permissions: string[] }).permissions).toEqual([]);

    for (const [method, path] of [
      ['get', '/rbac/roles'],
      ['get', '/rbac/permissions'],
      ['get', '/admin/users'],
      ['get', '/employees'],
      ['get', '/audit-trail'],
      ['get', '/customers'],
    ] as const) {
      await request(app!.getHttpServer())
        [method](path)
        .set(bearer(user.accessToken))
        .expect(403);
    }

    await prisma.userRoleAssignment.deleteMany({
      where: { roleId: hollow.id },
    });
    await prisma.role.delete({ where: { id: hollow.id } });
  }, 300_000);
});
