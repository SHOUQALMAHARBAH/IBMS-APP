import { it, expect } from 'vitest';
import { PrismaClient } from '@ibms/db';

/**
 * Removes the hand-created `GO_GLOBAL` role from the PROVIDER organization — the owner's request,
 * after it was reported as data on one database rather than an outcome of the seed.
 *
 * ## WHAT IT WAS, MEASURED rather than taken from a report
 *
 * Found while measuring the authorised mailbox widening's role sets: an unfiltered read of dev
 * answered 6 and 4 where the seed answers 5 and 3, because the provider organization carried a
 * second role — `isSystem = false`, ACTIVE, **0 holders, 74 codes**, already holding both email
 * codes before that widening. Far more than `PLATFORM_OPERATOR`'s thirteen.
 *
 * It granted nobody anything, because nothing held it. What it IS, is the **declared gap**
 * `seed.ts` describes in its own words: "nothing structurally stops a provider administrator
 * granting their own role an office-scoped code." That gap stays declared — this removes one row
 * somebody made, it does not close the gap, and the measurement at the end exists so the next one
 * is visible rather than discovered.
 *
 * ## IT REFUSES IF THE ROLE HAS ANY HOLDER, and the count is taken HERE
 *
 * Zero holders is a MEASUREMENT, not an assumption, and not something to carry over from a report
 * written hours earlier — somebody may have assigned it since. So the count is read at the moment
 * of removal and a non-zero answer stops the script with the holders named. Deactivating a role
 * somebody holds is a change to what that person can do; removing it is worse.
 *
 * ## REMOVAL, NOT DEACTIVATION, AND NOT THROUGH A ROUTE
 *
 * This product has `role.deactivate` and no delete permission, deliberately: a `RolePermission` row
 * is the record of what an office once granted, which is why `Role` has no DELETE route at all.
 * Deactivating would leave the 74-code row in place and still answer 6 and 4 to any unfiltered
 * read, so it would not do what was asked.
 *
 * So it is done HERE, as a maintenance step, and **no `role.delete` code was minted for it** — a
 * permission invented to make one row disappear would be a capability nobody decided, outliving
 * the row by years.
 *
 * ## IDEMPOTENT
 *
 * A second run finds nothing and says so. The assertions at the end describe the state the provider
 * must be in afterwards, so they hold on a database where the role never existed.
 *
 * Run: `npm run provider:remove-custom-role -w api` (loads `.env`, the DEV database).
 */

const ROLE_NAME = 'GO_GLOBAL';

function prismaForDev(): PrismaClient {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set; run this through `npm run provider:remove-custom-role -w api`',
    );
  }
  if (/_test(\?|$)/.test(url) || /ibms_test/.test(url)) {
    throw new Error(
      `DATABASE_URL points at what looks like the TEST database (${url.replace(/:[^:@]*@/, ':***@')}). This script is for the dev database — run it through the api workspace script, which loads .env.`,
    );
  }
  return new PrismaClient();
}

it('removes the hand-created provider role, refusing if anybody holds it', async () => {
  const prisma = prismaForDev();
  try {
    const provider = await prisma.organization.findFirst({
      where: { type: 'PROVIDER' },
      select: { id: true, subdomain: true },
    });
    expect(
      provider,
      'no PROVIDER organization exists on this database, so there is nothing for this script to act on',
    ).not.toBeNull();
    if (!provider) return;

    const role = await prisma.role.findFirst({
      where: { organizationId: provider.id, name: ROLE_NAME },
      select: { id: true, isSystem: true, status: true },
    });

    if (!role) {
      console.log(
        `No ${ROLE_NAME} role in the provider organization (${provider.subdomain}) — nothing to remove.`,
      );
    } else {
      /*
       * THE REFUSAL, and the count is read NOW. A role somebody holds is somebody's access, and a
       * maintenance script is the last place that should be decided quietly.
       */
      const holders = await prisma.userRoleAssignment.findMany({
        where: { roleId: role.id },
        select: { user: { select: { email: true, isActive: true } } },
      });
      if (holders.length > 0) {
        throw new Error(
          `${ROLE_NAME} is held by ${holders.length} account(s) and will NOT be removed: ` +
            holders
              .map((h) => `${h.user.email} (active=${h.user.isActive})`)
              .join(', ') +
            '. Removing a role somebody holds takes away access nobody decided to take away. Withdraw the ' +
            'assignments first, deliberately, and run this again.',
        );
      }

      /*
       * `isSystem` is asserted rather than assumed: a `true` here would mean this is a SEEDED role
       * and the script is pointed at the wrong row entirely — `PLATFORM_OPERATOR` is `isSystem` and
       * removing it would leave the provider organization with no route to its own administration.
       */
      expect(
        role.isSystem,
        `${ROLE_NAME} is marked isSystem, which means it is a SEEDED role and not the hand-created one this script is for. Stop and look before removing it.`,
      ).toBe(false);

      const grants = await prisma.rolePermission.deleteMany({
        where: { roleId: role.id },
      });
      await prisma.role.delete({ where: { id: role.id } });
      console.log(
        `Removed ${ROLE_NAME} (status ${role.status}) and its ${grants.count} grant(s) from the provider organization (${provider.subdomain}).`,
      );
    }

    // ---------------------------------------------------------------- the state afterwards
    const roles = await prisma.role.findMany({
      where: { organizationId: provider.id },
      select: { name: true, isSystem: true },
    });
    expect(roles.map((r) => r.name).sort()).toEqual(['PLATFORM_OPERATOR']);
    expect(roles[0].isSystem).toBe(true);

    const operatorCodes = await prisma.rolePermission.findMany({
      where: {
        role: { organizationId: provider.id, name: 'PLATFORM_OPERATOR' },
      },
      select: { permission: { select: { code: true } } },
    });
    const codes = operatorCodes.map((g) => g.permission.code).sort();
    console.log(
      `Provider organization now holds ${roles.length} role (${roles[0].name}) with ${codes.length} codes: ${codes.join(', ')}.`,
    );
    expect(codes).toHaveLength(13);

    /*
     * ---------------------------------------------------------------- THE MEASUREMENT
     *
     * A PRINTED COUNT, NOT A GATE AND NOT A REFUSAL. The owner keeps the ability to create roles in
     * her own organization — that is what `/settings/roles` is for — and we keep the ability to see
     * it happen. A gate here would take away a capability to make a report tidier.
     *
     * The declared gap in `seed.ts` stays declared: this measures it, it does not close it.
     */
    const others = await prisma.role.findMany({
      where: {
        organizationId: provider.id,
        name: { not: 'PLATFORM_OPERATOR' },
      },
      select: { name: true, isSystem: true, status: true },
    });
    let withOfficeCodes = 0;
    for (const other of others) {
      const officeScoped = await prisma.rolePermission.count({
        where: {
          role: { organizationId: provider.id, name: other.name },
          permission: { scope: 'OFFICE' },
        },
      });
      if (officeScoped > 0) {
        withOfficeCodes += 1;
        console.log(
          `  MEASUREMENT: provider role ${other.name} (isSystem=${other.isSystem}, ${other.status}) holds ${officeScoped} OFFICE-scoped code(s).`,
        );
      }
    }
    console.log(
      `MEASUREMENT — roles in the PROVIDER organization other than PLATFORM_OPERATOR holding an OFFICE-scoped code: ${withOfficeCodes}. ` +
        'This is a count, not a gate: creating a role in your own organization is a capability the owner keeps, and this only makes it visible.',
    );
  } finally {
    // `prisma`, not a fresh `prismaForDev()` — the first version called the factory again, which
    // opened a SECOND client, disconnected that one, and left the original connected. Caught by
    // reading it rather than by a failure, because a leaked connection in a one-shot script does
    // not fail anything; it just never exits cleanly.
    await prisma.$disconnect();
  }
});
