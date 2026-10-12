import { afterAll, describe, expect, it } from 'vitest';
import { TEST_ORGANIZATION_ID, prisma, rawPrisma } from './tenant-prisma';

/**
 * Office-scoped custom RBAC, PHASE 2 workstream A — the two MFA controls are
 * now security ATTRIBUTES of a role rather than hard-coded lists of role names.
 *
 * These are database-level guarantees, deliberately asserted against a real
 * database rather than in TypeScript. The whole value of the change is that the
 * STRICT value is what a row gets when nobody says otherwise, and that is a
 * default rather than anything a type can express.
 *
 * ## There are TWO defaults here, not one, and they can disagree
 *
 * Proven by planting the regression: setting the Postgres column default to
 * `false` did NOT fail a `prisma.role.create()` assertion, because Prisma fills
 * in a STATIC scalar `@default(true)` client-side and never lets the column
 * default apply. So a test that only goes through Prisma would keep passing
 * against a table whose own default is fail-open — and any raw INSERT (a
 * migration, a data-fix script, a `$executeRaw` seed) would silently produce a
 * relaxed role.
 *
 * Both defaults are therefore asserted separately below: the Prisma one because
 * it covers every application write, and the column one because it covers
 * everything that goes around Prisma.
 *
 * Part II §4.4 (always-MFA roles) and Part 10.1 (privileged / hardware-token
 * roles).
 */

/** §4.4 names exactly these three. */
const ALWAYS_MFA = [
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'COMPLIANCE_OFFICER',
  'DATA_PROTECTION_OFFICER',
];

/** Part 10.1's set — deliberately WIDER than §4.4's. Executive Management and
 *  Branch/Department Manager are here and NOT above, which is the distinction
 *  that keeps the trusted-device convenience for both of them. */
const PRIVILEGED = [
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'EXECUTIVE_MANAGEMENT',
  'BRANCH_DEPARTMENT_MANAGER',
  'COMPLIANCE_OFFICER',
  'DATA_PROTECTION_OFFICER',
];

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

/** Every role the PLATFORM defines, which is exactly the set `isSystem` marks.
 *  The legacy eleven plus `OFFICE_ADMINISTRATOR`, which Phase 3 installs in every
 *  office — a twelfth platform role, not an office's own.
 *
 *  `PLATFORM_OPERATOR` is the thirteenth, added by item (j)'s gap closure, and it is
 *  the first that is NOT per-office: it exists in the single `PROVIDER` organization
 *  and nowhere else. It belongs here for the same reason as the other twelve — the
 *  seed defines it, so the office Role screen must not be able to rename, retire or
 *  re-grant it — and `RoleAdminService.setPermissions` calls `assertNotSystem`, which
 *  is what makes that flag the thing stopping a provider administrator re-granting
 *  their own role through the screen. */
const PLATFORM_ROLE_NAMES = [
  ...LEGACY_ROLE_NAMES,
  'OFFICE_ADMINISTRATOR',
  'PLATFORM_OPERATOR',
];

const createdRoleIds: string[] = [];

afterAll(async () => {
  if (createdRoleIds.length > 0) {
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }
});

describe('Role security attributes — the default is the strict value', () => {
  it('gives a role created without either flag the STRICT value for both', async () => {
    // This is the fail-open bug the whole workstream exists to fix, inverted
    // into a test: a role an office invents is one nobody enumerated in any
    // list, and it must come out of the database strict.
    const name = `phase2-default-${Math.random().toString(36).slice(2, 8)}`;
    const role = await prisma.role.create({
      data: { name, nameAr: name, nameEn: name },
    });
    createdRoleIds.push(role.id);

    expect(role.requiresMfaAlways).toBe(true);
    expect(role.requiresHardwareToken).toBe(true);

    // Read it back rather than trusting the returned object: the assertion that
    // matters is about the stored row, not about what `create` echoed.
    const stored = await prisma.role.findUniqueOrThrow({
      where: { id: role.id },
      select: { requiresMfaAlways: true, requiresHardwareToken: true },
    });
    expect(stored).toEqual({
      requiresMfaAlways: true,
      requiresHardwareToken: true,
    });
  });

  it('gives a row inserted by RAW SQL the strict value too — the column default itself', async () => {
    // The one above passes even when the Postgres column default is `false`,
    // because Prisma sends a static scalar default itself. This is the other
    // half: an INSERT that names neither column, so only the table's own
    // default can decide. It is what protects a migration, a data-fix script,
    // or any future raw seed from quietly creating a relaxed role.
    const name = `phase2-raw-${Math.random().toString(36).slice(2, 8)}`;
    const rows = await rawPrisma.$queryRaw<
      { requiresMfaAlways: boolean; requiresHardwareToken: boolean }[]
    >`
      INSERT INTO "Role" ("id", "organizationId", "name", "nameAr", "nameEn")
      VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}::uuid, ${name}, ${name}, ${name})
      RETURNING "requiresMfaAlways", "requiresHardwareToken"
    `;
    await rawPrisma.role.deleteMany({ where: { name } });

    expect(rows).toHaveLength(1);
    expect(
      rows[0].requiresMfaAlways,
      'column default for requiresMfaAlways',
    ).toBe(true);
    expect(
      rows[0].requiresHardwareToken,
      'column default for requiresHardwareToken',
    ).toBe(true);
  });

  it('lets a role be relaxed deliberately, which is the only way it happens', async () => {
    const name = `phase2-relaxed-${Math.random().toString(36).slice(2, 8)}`;
    const role = await prisma.role.create({
      data: {
        name,
        nameAr: name,
        nameEn: name,
        requiresMfaAlways: false,
        requiresHardwareToken: false,
      },
    });
    createdRoleIds.push(role.id);
    expect(role.requiresMfaAlways).toBe(false);
    expect(role.requiresHardwareToken).toBe(false);
  });
});

describe('Role lifecycle attributes — status and isSystem', () => {
  it('gives a new role ACTIVE and NOT isSystem, through Prisma and through raw SQL', async () => {
    // Both defaults, separately, for the reason Phase 2 established the hard
    // way: Prisma fills in a STATIC scalar default client-side and never lets the
    // column default apply, so a test that only goes through Prisma keeps passing
    // against a table whose own default is wrong — and any raw INSERT (a
    // migration, a data-fix script) would then produce a row nobody intended.
    //
    // The direction matters in opposite ways here. `status` defaults ACTIVE
    // because a role an office just built should work; `isSystem` defaults FALSE
    // because an office's own role must be editable BY the office. A row that
    // arrived `isSystem: true` by accident would be permanently uneditable with
    // no way to fix it from the screen.
    const name = `phase3-defaults-${Math.random().toString(36).slice(2, 8)}`;
    const role = await prisma.role.create({
      data: { name, nameAr: name, nameEn: name },
    });
    createdRoleIds.push(role.id);
    expect(role.status).toBe('ACTIVE');
    expect(role.isSystem).toBe(false);

    const rawName = `phase3-raw-defaults-${Math.random().toString(36).slice(2, 8)}`;
    const rows = await rawPrisma.$queryRaw<
      { status: string; isSystem: boolean }[]
    >`
      INSERT INTO "Role" ("id", "organizationId", "name", "nameAr", "nameEn")
      VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}::uuid, ${rawName}, ${rawName}, ${rawName})
      RETURNING "status"::text, "isSystem"
    `;
    await rawPrisma.role.deleteMany({ where: { name: rawName } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status, 'column default for status').toBe('ACTIVE');
    expect(rows[0].isSystem, 'column default for isSystem').toBe(false);
  });

  it('marks every PLATFORM-defined role isSystem, in EVERY organization, and nothing else', async () => {
    // `rawPrisma` on purpose: Phase 1 adopted or copied these rows per office, so
    // the property is "every office's copy is protected".
    //
    // The set is the eleven legacy names PLUS `OFFICE_ADMINISTRATOR`, which Phase 3
    // installs in every office and which is equally platform-defined. Keyed off
    // that list rather than off `isSystem` itself, so a role an office invents can
    // never satisfy this by having the flag set — which is the direction that
    // matters, since `isSystem` is what makes the Role screen refuse to touch a
    // row.
    const all = await rawPrisma.role.findMany({
      select: { name: true, organizationId: true, isSystem: true },
    });
    for (const role of all) {
      const shouldBeSystem = PLATFORM_ROLE_NAMES.includes(role.name);
      expect(
        role.isSystem,
        `${role.name} in org ${role.organizationId} isSystem`,
      ).toBe(shouldBeSystem);
    }
    /*
     * Guard against the loop passing on an empty set — and keyed on the PER-OFFICE twelve, not on
     * `PLATFORM_ROLE_NAMES.length`.
     *
     * That distinction appeared with the thirteenth name. `PLATFORM_OPERATOR` lives in the single
     * PROVIDER organization, so a floor of 13 is satisfied by one office's twelve plus the
     * provider's one — which means it would ALSO be satisfied by an office that had lost one of its
     * own twelve, as long as the provider existed. The floor has to be the set every office is
     * supposed to carry, which is the twelve.
     */
    const perOfficeRoleNames = PLATFORM_ROLE_NAMES.filter(
      (n) => n !== 'PLATFORM_OPERATOR',
    );
    const officeIds = new Set(
      (
        await rawPrisma.organization.findMany({
          where: { type: 'BROKERAGE_OFFICE' },
          select: { id: true },
        })
      ).map((o) => o.id),
    );
    expect(officeIds.size, 'at least one brokerage office').toBeGreaterThan(0);
    for (const officeId of officeIds) {
      const protectedHere = all.filter(
        (r) => r.organizationId === officeId && r.isSystem,
      );
      expect(
        protectedHere.length,
        `office ${officeId} must carry all ${perOfficeRoleNames.length} protected platform roles`,
      ).toBeGreaterThanOrEqual(perOfficeRoleNames.length);
    }
  });

  it('starts every legacy role ACTIVE — the migration retires nothing', async () => {
    const retired = await rawPrisma.role.findMany({
      where: { name: { in: LEGACY_ROLE_NAMES }, status: 'INACTIVE' },
      select: { name: true, organizationId: true },
    });
    expect(retired).toEqual([]);
  });
});

describe('Role security attributes — the migration preserved every legacy role exactly', () => {
  it('matches §4.4 and Part 10.1 for all 11 legacy roles, in EVERY organization', async () => {
    // `rawPrisma` on purpose: Phase 1 adopted or copied these rows per office,
    // so the property under test is "every office's copy agrees", which a
    // tenant-scoped read could not see. This is one of the few specs entitled
    // to cross organizations, and says so.
    const roles = await rawPrisma.role.findMany({
      where: { name: { in: LEGACY_ROLE_NAMES } },
      select: {
        name: true,
        organizationId: true,
        requiresMfaAlways: true,
        requiresHardwareToken: true,
      },
    });

    // Guard against the assertion silently passing on an empty set.
    expect(roles.length).toBeGreaterThanOrEqual(LEGACY_ROLE_NAMES.length);

    for (const role of roles) {
      expect(
        { name: role.name, mfa: role.requiresMfaAlways },
        `requiresMfaAlways for ${role.name} in org ${role.organizationId}`,
      ).toEqual({ name: role.name, mfa: ALWAYS_MFA.includes(role.name) });
      expect(
        { name: role.name, hw: role.requiresHardwareToken },
        `requiresHardwareToken for ${role.name} in org ${role.organizationId}`,
      ).toEqual({ name: role.name, hw: PRIVILEGED.includes(role.name) });
    }
  });

  it('kept the two sets DIFFERENT — collapsing them would silently remove a convenience', async () => {
    // Executive Management and Branch/Department Manager are the difference.
    // If a future change makes the privileged set drive the always-MFA
    // decision, both roles lose the trusted-device option and nothing else
    // fails. This is the test that would notice.
    const roles = await rawPrisma.role.findMany({
      where: {
        name: { in: ['EXECUTIVE_MANAGEMENT', 'BRANCH_DEPARTMENT_MANAGER'] },
      },
      select: {
        name: true,
        requiresMfaAlways: true,
        requiresHardwareToken: true,
      },
    });
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(role.requiresMfaAlways, `${role.name} keeps trusted device`).toBe(
        false,
      );
      expect(role.requiresHardwareToken, `${role.name} is privileged`).toBe(
        true,
      );
    }
  });
});
