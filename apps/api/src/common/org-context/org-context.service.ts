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
  /**
   * Multi-tenancy Phase 2 step 8 — whether a database transaction is already
   * open on this async path, with `app.current_org_id` already set on its
   * connection.
   *
   * The RLS session variable is transaction-scoped (`SET LOCAL`), so it has to
   * be set inside the same transaction as the query it governs. Every
   * tenant-scoped operation therefore opens one — unless one is already open,
   * which this flag is how we know. Without it, the ~56 existing
   * `$transaction` blocks would each try to open a nested transaction per
   * inner query, which Prisma does not support.
   */
  scopedTransactionOrg: string | null;
}

@Injectable()
export class OrgContextService {
  private readonly storage = new AsyncLocalStorage<OrgStore>();

  /** Opens a store for one request with the Organization still unknown.
   * `adopt()` fills it in once the guard has authenticated the caller. */
  runForRequest<T>(work: () => T): T {
    return this.storage.run(
      {
        organizationId: null,
        unscopedReason: null,
        scopedTransactionOrg: null,
      },
      work,
    );
  }

  /** Runs `work` on behalf of one Organization. Used by the schedulers, which
   * have no request to inherit an org from and instead loop over the active
   * Organizations, and by anything else that legitimately knows its own org. */
  runAs<T>(organizationId: string, work: () => T): T {
    return this.storage.run(
      { organizationId, unscopedReason: null, scopedTransactionOrg: null },
      work,
    );
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
    // A NESTED store, not a mutation of the current one. See
    // `withScopedTransaction` below for why mutating is unsafe.
    //
    // The `await` inside is load-bearing and must not be "simplified" to
    // passing `work` directly: a Prisma model method returns a LAZY
    // PrismaPromise, so handing it straight back would close this store before
    // the query ever runs — and the query would then execute with no bypass.
    return this.storage.run(
      {
        organizationId: store?.organizationId ?? null,
        unscopedReason: reason,
        scopedTransactionOrg: null,
      },
      async () => await work(),
    );
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

  /**
   * The Organization an already-open RLS transaction pinned on its connection,
   * or null if there is none on this async path.
   *
   * Deliberately the ORG and not a boolean. A boolean answers "is some
   * transaction open?", which is the wrong question: a query may reuse an
   * ambient transaction's connection ONLY if that connection's
   * `app.current_org_id` matches the Organization the query is being filtered
   * by. If the two disagree, the application layer filters to one office while
   * RLS filters to another — the write is rejected or the read comes back
   * empty, and neither is distinguishable from a legitimate empty result.
   *
   * Keeping the org here makes that mismatch unreachable by accident: the
   * caller compares, and opens its own session when they differ.
   */
  scopedTransactionOrg(): string | null {
    return this.storage.getStore()?.scopedTransactionOrg ?? null;
  }

  /**
   * Runs `work` as if no transaction were open, so its queries open their own
   * RLS session instead of assuming the ambient one covers them.
   *
   * For code that runs INSIDE a `$transaction` but deliberately issues its
   * queries on the outer client — `UserRepository.withRoleLocked`, where the
   * transaction exists only to hold a `FOR UPDATE` row lock and the work is
   * meant to be separate from it.
   *
   * Without this, that work inherited a pinned Organization, skipped
   * opening its own session, and ran on a pooled connection with no
   * `app.current_org_id`. Reads returned nothing and — the reason this is not
   * cosmetic — `setActive`'s `updateMany` matched zero rows, which the service
   * correctly reads as "already in that state" and reports as success. A
   * deactivation silently did nothing. RLS is what surfaced it.
   */
  async outsideScopedTransaction<T>(work: () => Promise<T>): Promise<T> {
    const store = this.storage.getStore();
    if (!store) return work();
    // `await` inside: a lazy PrismaPromise handed straight back would execute
    // after this store closed. Same trap as `runUnscoped`.
    return this.storage.run(
      { ...store, scopedTransactionOrg: null },
      async () => work(),
    );
  }

  /**
   * Marks a transaction as open for the duration of `work`, so operations
   * inside it reuse that transaction's connection instead of each opening one.
   *
   * A NESTED `storage.run`, deliberately — NOT a mutation of the current store.
   *
   * Mutating was a real bug, caught by the e2e suite once RLS went live: the
   * store is shared by everything in one request, so when a request issued
   * queries CONCURRENTLY (every dashboard does), the first to open its RLS
   * transaction set the flag for all of them. Its siblings then skipped opening
   * their own, ran on a pooled connection with no `app.current_org_id` set, and
   * were rejected by the policy's WITH CHECK with `42501` — the application
   * layer had stamped an Organization the database could not see.
   *
   * A nested run scopes the flag to this transaction's own async subtree, so a
   * concurrent sibling still sees `false` and opens its own session. Which is
   * also the reason it fails CLOSED rather than leaking: the mismatch is a
   * rejection, never another tenant's rows.
   */
  async withScopedTransaction<T>(
    organizationId: string | null,
    work: () => Promise<T>,
  ): Promise<T> {
    const store = this.storage.getStore();
    if (!store) return work();
    // `await` inside for the same reason as `runUnscoped` above — a lazy
    // PrismaPromise handed straight back would execute after this store closed.
    // `null` means the transaction opened WITHOUT `app.current_org_id` being
    // set — the auth bootstrap, or a transaction touching global models only.
    // Nothing may reuse that connection as if it were scoped, so nothing is
    // pinned and the next tenant query opens its own session.
    return this.storage.run(
      { ...store, scopedTransactionOrg: organizationId },
      async () => work(),
    );
  }
}
