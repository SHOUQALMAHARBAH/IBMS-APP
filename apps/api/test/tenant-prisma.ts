import { prisma as rawPrisma } from '@ibms/db';
import { OrgContextService } from '../src/common/org-context/org-context.service';
import { buildTenantScopedClient } from '../src/prisma/tenant-scope.extension';

/**
 * The Prisma client the e2e specs use for fixtures and assertions.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SPECS CANNOT USE THE RAW CLIENT ANY MORE
 * ---------------------------------------------------------------------------
 * Multi-tenancy Phase 2 dropped the temporary `organizationId` column default.
 * The application supplies it through `tenantScopeExtension`, but a spec
 * reaching for `@ibms/db`'s raw client bypasses that extension entirely — so
 * every one of the ~450 fixture writes across these specs would insert a row
 * with no Organization and fail on NOT NULL.
 *
 * That failure is the point, not an inconvenience: it is exactly what proves
 * the default is gone and that nothing can quietly write an unattributed row.
 * The fix is to give the specs the SAME tenant-scoped client the application
 * uses, pinned to the seeded Organization — not to hand-add `organizationId`
 * to 450 object literals, which would have taught the fixtures a habit the
 * application deliberately does not have.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CHANGES FOR A SPEC
 * ---------------------------------------------------------------------------
 * Nothing, in the single-Organization world the e2e suite runs in: reads are
 * filtered to the seeded org, which holds every row the suite creates, and
 * writes are stamped with it. It also means the fixtures now exercise the same
 * code path the API does, so a bug in the extension shows up as a failing e2e
 * rather than passing unnoticed.
 *
 * A spec that genuinely needs to cross Organizations — proving isolation, which
 * is Phase 2 step 9's checklist work — should import `rawPrisma` below and say
 * so explicitly, so that intent is visible in the diff.
 */
const orgContext = new OrgContextService();

/**
 * Kept in sync with `packages/db/prisma/seed.ts`'s `DEFAULT_ORGANIZATION_ID`.
 * Not imported from there because that module opens its own PrismaClient and
 * runs seeding side effects on import.
 */
export const TEST_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001';

const scoped = buildTenantScopedClient(orgContext);

/**
 * A tenant-scoped client permanently inside the seeded Organization's context.
 *
 * Every method is wrapped so the AsyncLocalStorage context is open for the
 * duration of the call — a spec cannot forget to establish it, and top-level
 * fixture code outside any request still works.
 */
type AnyFn = (...args: unknown[]) => unknown;

/**
 * Wraps one function so the query runs inside the seeded Organization's
 * context.
 *
 * The `await` is load-bearing and must not be "simplified" away. A Prisma
 * model method returns a LAZY `PrismaPromise`: calling it builds the query but
 * does not execute it — execution starts when something calls `.then()`. So
 * returning `fn.apply(...)` straight out of `runAs` closes the
 * AsyncLocalStorage scope BEFORE the query runs, and the extension then sees
 * no Organization and refuses the call. Awaiting inside keeps the scope open
 * across the actual execution.
 *
 * The application never hits this, because there the context spans the whole
 * request (or the whole `runAs` block in a scheduler) rather than one call.
 */
function inOrgContext(fn: AnyFn, self: object): AnyFn {
  return (...args: unknown[]): unknown =>
    orgContext.runAs(
      TEST_ORGANIZATION_ID,
      async () => (await fn.apply(self, args)) as unknown,
    );
}

export const prisma = new Proxy(scoped, {
  get(target, property, receiver): unknown {
    const value: unknown = Reflect.get(target, property, receiver);
    if (typeof value === 'function') {
      return inOrgContext(value as AnyFn, target);
    }
    if (value && typeof value === 'object') {
      // A model delegate (prisma.customer, prisma.policy, ...) — wrap its
      // operations the same way.
      const delegate = value;
      return new Proxy(delegate, {
        get(inner, op, innerReceiver): unknown {
          const fn: unknown = Reflect.get(inner, op, innerReceiver);
          if (typeof fn !== 'function') return fn;
          return inOrgContext(fn as AnyFn, inner);
        },
      });
    }
    return value;
  },
});

/** The unscoped client, for the few specs that must see across Organizations
 * (tenant-isolation proofs) or touch a global model directly. */
export { rawPrisma };

/**
 * Get or create a Role by name inside the seeded Organization.
 *
 * Office-scoped custom roles made `Role.name` non-unique — the constraint is
 * now `(organizationId, name)` — so the five-line `upsert({ where: { name } })`
 * that used to sit inline in 72 specs no longer type-checks, and the correct
 * replacement needs the compound key plus the two display-name columns.
 *
 * That belongs in one place rather than 72. Pushing `TEST_ORGANIZATION_ID` into
 * every spec's fixture body would teach the suite to name an Organization by
 * hand, which is exactly the habit `prisma` above exists to avoid.
 *
 * `create` deliberately omits `organizationId`: the scoped client stamps it,
 * the same way it does for every other fixture write here.
 *
 * `nameAr`/`nameEn` fall back to the machine name. A fixture is not the place
 * to invent Arabic display copy, and no assertion in the suite reads them —
 * the real bilingual names for the migrated roles are set by migration
 * `20261003100000_office_scoped_custom_roles`, and Phase 3's Role screen is
 * where an office edits them.
 */
export async function ensureRole(name: string): Promise<{ id: string }> {
  return prisma.role.upsert({
    where: {
      organizationId_name: { organizationId: TEST_ORGANIZATION_ID, name },
    },
    update: {},
    create: { name, nameAr: name, nameEn: name },
  });
}

/**
 * Give a fixture Organization the same `OFFICE_ADMINISTRATOR` a real office gets,
 * by mirroring the default office's row — its attributes and its grants.
 *
 * ## Why a fixture office needs this
 *
 * `office-administrator.e2e-spec.ts` asserts that EVERY Organization has an
 * active route to user administration: an office nobody can provision a user in
 * cannot be set up at all, and the failure would surface as its administrator
 * being unable to log in rather than as anything a test caught. That assertion is
 * the durable form of the rule, and it has to hold for every row in the table —
 * so a fixture that stands up an office and skips the administrator would break
 * it, and would also be modelling an office that could not exist.
 *
 * Both callers create their Organization as the OWNER (`rawPrisma`): standing one
 * up is a platform act, not something a tenant-scoped request can do. This helper
 * does the same, and names `organizationId` on every write, because outside a
 * scoped request the column default is NULL and the composite FK
 * `(roleId, organizationId)` -> `Role(id, organizationId)` rejects an
 * unattributed grant rather than accepting one.
 */
export async function ensureOfficeAdministratorFor(
  organizationId: string,
): Promise<{ id: string }> {
  const template = await rawPrisma.role.findUnique({
    where: {
      organizationId_name: {
        organizationId: TEST_ORGANIZATION_ID,
        name: 'OFFICE_ADMINISTRATOR',
      },
    },
    include: { permissions: { select: { permissionId: true } } },
  });
  if (!template) {
    throw new Error(
      'The default test organization has no OFFICE_ADMINISTRATOR role to mirror. Run `npm run db:test:migrate:dev` and the seed against .env.test.',
    );
  }

  const role = await rawPrisma.role.upsert({
    where: {
      organizationId_name: { organizationId, name: 'OFFICE_ADMINISTRATOR' },
    },
    update: {},
    create: {
      organizationId,
      name: 'OFFICE_ADMINISTRATOR',
      nameAr: template.nameAr,
      nameEn: template.nameEn,
      description: template.description,
      requiresMfaAlways: template.requiresMfaAlways,
      requiresHardwareToken: template.requiresHardwareToken,
      isSystem: template.isSystem,
    },
  });
  for (const { permissionId } of template.permissions) {
    await rawPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      update: {},
      create: { organizationId, roleId: role.id, permissionId },
    });
  }
  return role;
}
