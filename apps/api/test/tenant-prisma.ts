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

/**
 * Delete an organization and the rows that now BLOCK its deletion.
 *
 * ## WHY THIS EXISTS — a blast radius, measured the moment it bit
 *
 * Module 0-ب item 1 half B made registration create a default Branch and Department for every new
 * organization, so that a freshly registered office can provision its first user. Both carry
 * `onDelete: Restrict`, so every teardown that had been deleting a registered organization directly
 * started failing with:
 *
 *   update or delete on table "Organization" violates RESTRICT setting of foreign key constraint
 *   "Department_organizationId_fkey"
 *
 * The ORDER is the fact that bit, so the order gets one home. A spec that spells the order itself is
 * a spec that will be missed the next time registration creates something.
 *
 * Only the children that registration creates and that RESTRICT are handled here. Everything else an
 * organization owns either cascades or is genuinely undeletable on purpose — `AuditLogEntry` above
 * all, which is why an organization anybody has SIGNED INTO can never be removed at all and why no
 * test may authenticate inside a fixture organization.
 */
export async function deleteOrganizationCascade(
  organizationId: string,
): Promise<void> {
  await rawPrisma.branch.deleteMany({ where: { organizationId } });
  await rawPrisma.department.deleteMany({ where: { organizationId } });
  /*
   * AND `SlaHoliday`, which the seed attaches to EVERY organization.
   *
   * MEASURED the hard way: the organizations my broken teardown leaked became UNDELETABLE after I
   * re-ran `db:test:seed` for an unrelated change, because `ensureJordanFixedHolidays` sweeps
   * `organization.findMany()` and wrote sixteen rows into each of them —
   * `SlaHoliday_organizationId_fkey` is RESTRICT.
   *
   * The rule this adds: a PER-ORGANIZATION SEED SWEEP creates rows in fixture organizations too, so
   * every such sweep belongs here. There are three today — branches, departments and holidays — and
   * `ensureDefaultOrgUnitsForEveryOrganization` / `ensureJordanFixedHolidays` are the two to check
   * against whenever this helper is read.
   */
  await rawPrisma.slaHoliday.deleteMany({ where: { organizationId } });
  await rawPrisma.organization.deleteMany({ where: { id: organizationId } });
}

/**
 * DELETE THE USERS OF A DISPOSABLE FIXTURE ORGANIZATION, DEPENDENTS FIRST.
 *
 * ## Why this exists, and it is a regression this helper is the cure for
 *
 * `rawPrisma.user.deleteMany({ where: { organizationId } })` was the whole teardown in two specs,
 * and decision 25 broke both: the invitation now issues a `PasswordResetToken` for the invited
 * administrator, `PasswordResetToken_userId_fkey` is NOT a cascade, so the user delete throws, the
 * organization is never removed, and EVERY LATER SPEC IN THE RUN fails at `createTestApp` on the
 * organization count — with a fault that looks like its own.
 *
 * That is exactly what happened: CI's `backend` job went red on `9da34f1` with ELEVEN leaked
 * organizations, and db-test had accumulated a dozen locally. The failure was invisible to me
 * because I read the run output through `grep -E "Tests |Test Files"` and an `afterAll` error is
 * neither of those lines. Read the gate's own output.
 *
 * ## So the ORDER gets ONE home, like `deleteOrganizationCascade` above
 *
 * A spec that spells the order itself is a spec that will be missed the next time an invitation,
 * a session or an enrolment gains a row that points at `User`. Every dependent that RESTRICTS and
 * that a fixture can legitimately create goes here, and nothing else: a user who AUDITED is
 * permanent by design, which is what the `auditRows` assertion in each caller is for.
 */
export async function deleteFixtureUsersInOrganization(
  organizationId: string,
): Promise<void> {
  const users = await rawPrisma.user.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return;

  // The one decision 25 added. `invalidateAllForUser` marks tokens used; it does not remove them,
  // deliberately — a consumed reset link is evidence — so a fixture has to clear them explicitly.
  await rawPrisma.passwordResetToken.deleteMany({
    where: { userId: { in: userIds } },
  });
  await rawPrisma.userRoleAssignment.deleteMany({
    where: { userId: { in: userIds } },
  });
  await rawPrisma.userSession.deleteMany({
    where: { userId: { in: userIds } },
  });
  await rawPrisma.mfaCredential.deleteMany({
    where: { userId: { in: userIds } },
  });
  await rawPrisma.refreshToken.deleteMany({
    where: { userId: { in: userIds } },
  });
  await rawPrisma.user.deleteMany({ where: { id: { in: userIds } } });
}
