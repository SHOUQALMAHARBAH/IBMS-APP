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
