import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * Multi-tenancy Phase 2 (spec §1, step 7) — the request-scoped answer to
 * "which Organization is this code running on behalf of?".
 *
 * Every tenant-scoped Prisma query is filtered by this value, injected by
 * `tenantScopeExtension` rather than written by hand at each call site — spec
 * §1: "a developer should not be able to write a query that skips this."
 *
 * ---------------------------------------------------------------------------
 * WHY A MUTABLE STORE, AND NOT `enterWith`
 * ---------------------------------------------------------------------------
 * NestJS runs middleware -> guards -> interceptors -> handler. The org is only
 * knowable AFTER the JWT guard has resolved the user, but an interceptor is too
 * late: the guard itself queries tenant-scoped tables (UserSession, User,
 * SecurityConfig) while authenticating.
 *
 * So the middleware opens ONE store for the whole request with the org still
 * unknown, and `adopt()` fills it in from inside the guard once the user is
 * resolved. Mutating a store the middleware already `run()` around is what
 * makes the value visible to everything downstream — guards, interceptors and
 * handler alike — without `enterWith`, whose store escapes into whatever async
 * work happens to share the caller's context.
 *
 * Each request gets its own store object, so two concurrent requests can never
 * observe each other's org, and `runUnscoped`'s flag flip is likewise local to
 * one request.
 */

/**
 * The only situations in which a tenant-scoped query may run WITHOUT an
 * Organization. Deliberately a closed union: adding a case is an edit to this
 * type, which is the point — every bypass should be argued for in review.
 */
export type UnscopedReason =
  /**
   * Authentication, before the caller's Organization is known. Resolving a
   * session, a refresh token, an MFA credential or a login email is literally
   * HOW the org context gets established, so it cannot already require one
   * (spec §3.1's own reasoning for why bearer secrets stay globally unique).
   *
   * Phase 4 narrows this: once `GET /orgs/resolve` resolves the Organization
   * from the subdomain BEFORE login (§4.10), the login path will have an org
   * and this reason should shrink to session/token lookups only.
   */
  'auth-bootstrap';

interface OrgStore {
  organizationId: string | null;
  unscopedReason: UnscopedReason | null;
}

@Injectable()
export class OrgContextService {
  private readonly storage = new AsyncLocalStorage<OrgStore>();

  /** Opens a store for one request with the Organization still unknown.
   * `adopt()` fills it in once the guard has authenticated the caller. */
  runForRequest<T>(work: () => T): T {
    return this.storage.run(
      { organizationId: null, unscopedReason: null },
      work,
    );
  }

  /** Runs `work` on behalf of one Organization. Used by the schedulers, which
   * have no request to inherit an org from and instead loop over the active
   * Organizations, and by anything else that legitimately knows its own org. */
  runAs<T>(organizationId: string, work: () => T): T {
    return this.storage.run({ organizationId, unscopedReason: null }, work);
  }

  /**
   * Runs `work` with tenant filtering switched OFF, for one of the enumerated
   * reasons above. Restores the previous state afterwards even if `work`
   * throws, so a failed login cannot leave a request unscoped.
   */
  async runUnscoped<T>(
    reason: UnscopedReason,
    work: () => Promise<T>,
  ): Promise<T> {
    const store = this.storage.getStore();
    // No store at all (a scheduler or a test calling straight in): open one.
    if (!store) {
      return this.storage.run(
        { organizationId: null, unscopedReason: reason },
        work,
      );
    }
    const previous = store.unscopedReason;
    store.unscopedReason = reason;
    try {
      return await work();
    } finally {
      store.unscopedReason = previous;
    }
  }

  /** Fills in the Organization for a request whose store is already open.
   * Called from the JWT strategy, once the session resolves to a real user. */
  adopt(organizationId: string): void {
    const store = this.storage.getStore();
    if (store) store.organizationId = organizationId;
  }

  /** The current Organization, or null when there is none (unauthenticated
   * request, scheduler bootstrap, or an explicitly unscoped block). */
  currentOrNull(): string | null {
    return this.storage.getStore()?.organizationId ?? null;
  }

  /** Whether tenant filtering is currently switched off, and why. */
  unscopedReason(): UnscopedReason | null {
    return this.storage.getStore()?.unscopedReason ?? null;
  }

  /** True when a store is open at all — i.e. this code is running inside a
   * request or an explicit `runAs`/`runUnscoped` block. */
  hasContext(): boolean {
    return this.storage.getStore() !== undefined;
  }
}
