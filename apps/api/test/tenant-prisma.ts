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
