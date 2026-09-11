import { Prisma, prisma, type PrismaClient } from '@ibms/db';
import type { OrgContextService } from '../common/org-context/org-context.service';

/**
 * Multi-tenancy Phase 2 (spec §1 layer 1, step 7) — the application-layer half
 * of tenant isolation.
 *
 * Spec §1: isolation "cannot depend solely on every developer remembering to
 * filter every query correctly." So no call site passes `organizationId`; this
 * extension injects it into every query against every tenant-scoped model,
 * and REFUSES to run one when it cannot.
 *
 * The Postgres RLS policies are the independent second layer and are NOT built
 * here (step 8). Until they exist, this is the only thing standing between two
 * offices, which is why it fails closed rather than passing a query through.
 *
 * ---------------------------------------------------------------------------
 * WHICH MODELS — derived from the DMMF, never hand-listed
 * ---------------------------------------------------------------------------
 * A model is tenant-scoped iff it actually has an `organizationId` field, read
 * from `Prisma.dmmf` at startup. Spec §8 warns that "a missed table is a real
 * isolation hole"; a hand-maintained list is exactly how a table gets missed,
 * because adding a model and forgetting the list fails silently. This cannot
 * drift: a new tenant-scoped model is covered the moment it is generated, and
 * a global one (Role, Permission, the watchlist cache) is never touched.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((f) => f.name === 'organizationId'))
    .map((model) => model.name),
);

/** Operations whose `where` selects the rows to act on. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
  'update',
  'delete',
  'upsert',
]);

/** Operations that write new rows and therefore need the org stamped on. */
const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'upsert',
]);

/**
 * Every model operation this extension knows how to scope.
 *
 * An operation missing from this set is REFUSED rather than passed through —
 * see `UnhandledOperationError`. That rule exists because of a real bug caught
 * by the e2e suite: `createManyAndReturn` was absent from the sets above, so
 * `PolicyRepository.attachDocuments` slipped past unstamped. The column's NOT
 * NULL caught it, but only because the default had already been dropped; a
 * missing READ operation would have leaked instead of failing. Fail-closed on
 * the unknown is the only version of this that is safe by construction.
 */
const HANDLED_OPERATIONS = new Set([...WHERE_OPERATIONS, ...CREATE_OPERATIONS]);

/**
 * `findUnique`/`update`/`delete`/`upsert` take a `WhereUniqueInput`, which in
 * Prisma 5+ ("extended where unique", GA and verified against this schema's
 * generated types) also accepts ordinary filters alongside the unique field.
 * That is what lets the org be added WITHOUT rewriting these into
 * `findFirst`/`updateMany` — so return shapes, P2025 behaviour and every
 * caller's expectations are untouched.
 */
function withOrg(
  where: Record<string, unknown> | undefined,
  organizationId: string,
): Record<string, unknown> {
  return { ...(where ?? {}), organizationId };
}

/**
 * Stamps the org onto a create payload, INCLUDING nested relation writes.
 *
 * Nested writes are the reason this recurses. `insurer.create({ data: { ...,
 * products: { create: [...] } } })` writes rows in a second tenant-scoped
 * table that the extension never sees as its own operation — while the
 * `@default` existed those rows inherited the default org, but Phase 2 removes
 * it, so an un-stamped nested create would fail outright. Walking the payload
 * is what keeps those writes correct rather than merely unbroken.
 *
 * Only recurses into the relation-write verbs that CREATE rows. `connect`
 * points at rows that already exist and carry their own org; `disconnect` and
 * `set` do not create anything.
 */
function stampCreate(data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => stampCreate(item, organizationId));
  }
  if (data === null || typeof data !== 'object') return data;

  const source = data as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };

  // Never overwrite an explicitly supplied org — a caller that names one is
  // making a deliberate statement, and silently rewriting it would hide a bug.
  if (!('organizationId' in out) && !('organization' in out)) {
    out.organizationId = organizationId;
  }

  for (const [key, value] of Object.entries(source)) {
    if (value === null || typeof value !== 'object') continue;
    const nested = value as Record<string, unknown>;
    const rewritten: Record<string, unknown> = { ...nested };
    let touched = false;
    for (const verb of ['create', 'createMany', 'connectOrCreate'] as const) {
      if (!(verb in nested)) continue;
      touched = true;
      if (verb === 'createMany') {
        const many = nested.createMany as Record<string, unknown>;
        rewritten.createMany = {
          ...many,
          data: stampCreate(many.data, organizationId),
        };
      } else if (verb === 'connectOrCreate') {
        const coc = nested.connectOrCreate;
        const stampOne = (entry: unknown) => {
          const e = entry as Record<string, unknown>;
          return { ...e, create: stampCreate(e.create, organizationId) };
        };
        rewritten.connectOrCreate = Array.isArray(coc)
          ? coc.map(stampOne)
          : stampOne(coc);
      } else {
        rewritten.create = stampCreate(nested.create, organizationId);
      }
    }
    if (touched) out[key] = rewritten;
  }
  return out;
}

/** Raised when a tenant-scoped model is asked for an operation this extension
 * does not know how to scope. Refusing is deliberate: the alternative is
 * passing an unfiltered query straight to the database. */
export class UnhandledOperationError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Refusing to run ${model}.${operation}() — tenantScopeExtension has no rule for ` +
        `the "${operation}" operation, so it cannot guarantee the query is scoped to ` +
        `one Organization. Add it to WHERE_OPERATIONS or CREATE_OPERATIONS (with a ` +
        `test) rather than letting it through unfiltered.`,
    );
    this.name = 'UnhandledOperationError';
  }
}

/** Raised instead of running a tenant-scoped query with no Organization.
 * Deliberately not an HttpException: reaching here is a programming error —
 * a code path that never established context — not a client mistake. */
export class MissingOrgContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Refusing to run ${model}.${operation}() with no Organization in context. ` +
        `Every tenant-scoped query must run inside a request (OrgContextMiddleware), ` +
        `inside OrgContextService.runAs() — how the schedulers loop over active ` +
        `Organizations — or inside an explicitly justified runUnscoped() block. ` +
        `Passing the query through unfiltered would return every office's rows, ` +
        `so it fails here instead.`,
    );
    this.name = 'MissingOrgContextError';
  }
}

/**
 * Builds the tenant-scoped client.
 *
 * Exported as a standalone function so its return type is CONCRETE:
 * `ReturnType<typeof prisma.$extends>` erases every model into `unknown`
 * (the method is generic and overloaded), which silently turns ~400 typed
 * repository calls into unusable `unknown`s. `TenantPrismaClient` below keeps
 * the full generated types intact.
 */
export function buildTenantScopedClient(
  orgContext: OrgContextService,
  client: PrismaClient = prisma,
) {
  return client.$extends(tenantScopeExtension(orgContext, client));
}

export type TenantPrismaClient = ReturnType<typeof buildTenantScopedClient>;

/**
 * The client handed to an interactive `$transaction` callback.
 *
 * Derived from the extended client rather than using `Prisma.TransactionClient`
 * (which describes the RAW client): an extended client's transaction client is
 * a different type, and mixing the two makes every helper that accepts "either
 * a client or a tx" reject one of them. Deriving it from `$transaction`'s own
 * signature keeps the two in step automatically.
 *
 * Queries through it are tenant-scoped exactly like the outer client — the
 * extension wraps the operation, not the connection.
 */
export type TenantTransactionClient = Parameters<
  Parameters<TenantPrismaClient['$transaction']>[0]
>[0];

/**
 * Multi-tenancy Phase 2 step 8 — makes an explicit `$transaction` block set
 * `app.current_org_id` once, for the whole block.
 *
 * Without this, every query inside one of the ~23 existing `$transaction`
 * blocks would try to open its OWN transaction to set the variable — which
 * Prisma does not allow nested, and which would defeat the point of the outer
 * transaction anyway. Instead the variable is set once on the transaction's
 * connection, and `withScopedTransaction` tells the per-operation hook to stop
 * re-wrapping for the duration.
 *
 * Implemented as a Proxy rather than a `client` extension component because
 * overriding a built-in like `$transaction` is not something `$extends`
 * guarantees, and this has to be reliable: a missed case is a runtime error on
 * a write path, not a warning.
 *
 * Only the callback form is handled. Nothing in this codebase uses the array
 * form, and it would need different treatment (its promises are built before
 * the transaction opens), so it throws rather than silently running unscoped.
 */
/** The two client members reached structurally below. Naming their shapes once
 * keeps the casts out of the call sites, where they degrade to `any`. */
type TransactionRunner = (
  callback: (tx: unknown) => Promise<unknown>,
  ...rest: unknown[]
) => Promise<unknown>;
type RawRunner = (...args: unknown[]) => Promise<unknown>;
interface RawCapableTx {
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
}

export function withOrgAwareTransactions(
  client: TenantPrismaClient,
  orgContext: OrgContextService,
): TenantPrismaClient {
  const runTransaction = (
    client as unknown as { $transaction: TransactionRunner }
  ).$transaction.bind(client) as TransactionRunner;
  const rawRunners = client as unknown as Record<string, RawRunner>;
  const orgAwareTransaction = (
    arg: unknown,
    ...rest: unknown[]
  ): Promise<unknown> => {
    if (Array.isArray(arg)) {
      throw new Error(
        'The array form of $transaction is not supported under tenant isolation: its ' +
          'operations are built before the transaction opens, so app.current_org_id ' +
          'cannot be set for them. Use the callback form, $transaction(async (tx) => ...).',
      );
    }
    const callback = arg as (tx: unknown) => Promise<unknown>;
    return runTransaction(
      async (tx: unknown) => {
        const organizationId = orgContext.currentOrNull();
        // A transaction opened during the auth bootstrap, or one on global
        // models only, has no Organization to pin — leave the variable unset so
        // RLS stays fail-closed rather than pinning it to something invented.
        if (organizationId !== null && orgContext.unscopedReason() === null) {
          await (
            tx as {
              $executeRaw: (
                q: TemplateStringsArray,
                ...v: unknown[]
              ) => Promise<unknown>;
            }
          )
            .$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        }
        return orgContext.withScopedTransaction(() => callback(tx));
      },
      ...rest,
    );
  };

  /**
   * Raw SQL — `$queryRaw`, `$executeRaw` and their `Unsafe` variants — needs the
   * session variable just as much as a model query, and is the ONE place where
   * it genuinely matters rather than merely belting-and-bracing.
   *
   * The application layer cannot filter raw SQL: `applyTenantScope` rewrites a
   * Prisma argument object, and a raw query has none. Those ten call sites
   * (full-text search, `FOR UPDATE` row locks, the watchlist containment query)
   * are therefore protected by RLS ALONE — which is exactly spec §1's promise
   * that "a raw/forgotten query without the app-layer filter still can't cross
   * tenants". Wrapping them here is what makes that true instead of aspirational.
   *
   * It also caught these: the moment the policies went live, the four full-text
   * search e2e tests started returning nothing, because their raw queries were
   * the only reads in the system with no Organization pinned.
   */
  const RAW_METHODS = new Set([
    '$queryRaw',
    '$queryRawUnsafe',
    '$executeRaw',
    '$executeRawUnsafe',
  ]);

  const orgAwareRaw = (method: string) => {
    const original: RawRunner = rawRunners[method].bind(client) as RawRunner;

    return (...args: unknown[]): unknown => {
      const organizationId = orgContext.currentOrNull();
      if (
        organizationId === null ||
        orgContext.unscopedReason() !== null ||
        orgContext.inScopedTransaction()
      ) {
        return original(...args);
      }
      return runTransaction(async (tx: unknown) => {
        const t = tx as Record<string, RawRunner> & RawCapableTx;
        await t.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        return orgContext.withScopedTransaction(() => t[method](...args));
      }, RLS_SESSION_TRANSACTION_OPTIONS);
    };
  };

  const rawCache = new Map<string, (...a: unknown[]) => unknown>();

  return new Proxy(client, {
    get(target, property, receiver): unknown {
      if (property === '$transaction') return orgAwareTransaction;
      if (typeof property === 'string' && RAW_METHODS.has(property)) {
        let wrapped = rawCache.get(property);
        if (!wrapped) {
          wrapped = orgAwareRaw(property);
          rawCache.set(property, wrapped);
        }
        return wrapped;
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * Builds the extension. Takes the context service rather than importing a
 * singleton so the whole thing stays unit-testable with a fake context.
 */
/**
 * The whole of the tenant rule, as a plain function.
 *
 * Kept separate from `Prisma.defineExtension` below so it can be exercised
 * directly: `defineExtension` returns an opaque wrapper, and a rule this
 * load-bearing should not be testable only through a live database.
 */
export function applyTenantScope(
  orgContext: OrgContextService,
  model: string,
  operation: string,
  args: unknown,
): unknown {
  if (!TENANT_SCOPED_MODELS.has(model)) return args;

  // An explicitly justified bypass (authentication resolving who the caller
  // is, before their org can be known).
  if (orgContext.unscopedReason() !== null) return args;

  const organizationId = orgContext.currentOrNull();
  if (organizationId === null) {
    throw new MissingOrgContextError(model, operation);
  }

  if (!HANDLED_OPERATIONS.has(operation)) {
    throw new UnhandledOperationError(model, operation);
  }

  const next = { ...((args ?? {}) as Record<string, unknown>) };

  if (WHERE_OPERATIONS.has(operation)) {
    next.where = withOrg(
      next.where as Record<string, unknown> | undefined,
      organizationId,
    );
  }

  if (CREATE_OPERATIONS.has(operation)) {
    if (operation === 'upsert') {
      // `create` is stamped; `update` is not — it only ever touches the row
      // the (already org-filtered) `where` selected.
      next.create = stampCreate(next.create, organizationId);
    } else {
      next.data = stampCreate(next.data, organizationId);
    }
  }

  return next;
}

/**
 * Multi-tenancy Phase 2 step 8 — the session variable the RLS policies read.
 *
 * The policies are `USING ("organizationId" = current_setting('app.current_org_id', true))`.
 * `current_setting(..., true)` returns NULL when unset, and `column = NULL` is
 * NULL, so a connection that never sets it sees NOTHING — RLS fails closed on
 * its own, independently of anything this extension does to the `where`.
 *
 * It has to be `SET LOCAL` (the `true` third argument), which scopes it to the
 * surrounding transaction. That is a CORRECTNESS requirement on a connection
 * pool, not tidiness — a bare session-level `SET` fails two ways:
 *
 *   1. The `SET` and the query after it are not guaranteed the same physical
 *      connection, so the query may run with nothing set. Merely inert: RLS
 *      fails closed and returns no rows.
 *   2. Worse, a stale value left on a reused pooled connection FROM A PREVIOUS
 *      REQUEST can still be in effect when the next request's query runs before
 *      its own `SET` takes hold. That is a genuine cross-tenant read.
 *
 * `SET LOCAL` has neither problem: Postgres clears it when the transaction
 * ends, however the connection is later reused.
 *
 * ---------------------------------------------------------------------------
 * DECIDED (2026-09-11): ONE TRANSACTION PER QUERY, NOT PER REQUEST
 * ---------------------------------------------------------------------------
 * Measured cost: roughly +4ms and ~3.7x latency on a trivial query. Operations
 * already inside a `$transaction` pay it once for the whole block rather than
 * per query, which is what `inScopedTransaction` is for.
 *
 * The alternative is one transaction per REQUEST, which amortises that cost but
 * holds locks for the whole request and turns any mid-request failure into a
 * full rollback. Rejected deliberately: 4ms is imperceptible in an internal
 * back-office system, and per-request would trade a measured, tolerable cost
 * for an unmeasured risk with no load data behind it.
 *
 * Do NOT switch to per-request pre-emptively — only if load testing shows the
 * per-query cost is a real bottleneck, with numbers in hand. See
 * docs/multi-tenancy-rls.md.
 */
async function withRlsSession<T>(
  orgContext: OrgContextService,
  client: PrismaClient,
  organizationId: string,
  run: (tx: unknown) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    return orgContext.withScopedTransaction(() => run(tx));
  }, RLS_SESSION_TRANSACTION_OPTIONS);
}

/**
 * Timeouts for the transaction this extension opens around a single query.
 *
 * Prisma's interactive-transaction defaults are `maxWait` 2s / `timeout` 5s.
 * Those are sensible for a transaction a developer wrote deliberately around a
 * unit of work — they are NOT sensible here, because this transaction exists
 * only to scope a session variable and wraps ONE query that previously ran with
 * no deadline at all. Leaving the defaults silently imposes a 5-second ceiling
 * on every query in the system.
 *
 * That was not hypothetical: a bulk `auditLogEntry.createManyAndReturn` from
 * `AccessRecertificationService.startCycle` took 5837ms under load and died
 * with `P2028: Transaction already closed`. It had no timeout before step 8.
 *
 * So the ceiling is raised to something that will not fire in normal operation.
 * This does NOT change transaction semantics — the transaction still covers
 * exactly one query — it only stops the wrapper from imposing a deadline the
 * query never had.
 *
 * Transactions the APPLICATION opens are left alone: `withOrgAwareTransactions`
 * passes the caller's own options straight through, so a deliberate
 * `$transaction` keeps whatever bounds it chose.
 */
const RLS_SESSION_TRANSACTION_OPTIONS = {
  /** Time to wait for a connection from the pool. Generous because a loaded
   * pool is exactly when this would otherwise start failing. */
  maxWait: 30_000,
  /** Ceiling for the wrapped query itself. */
  timeout: 120_000,
} as const;

/** Prisma's delegate property for a model — `KYCRecord` -> `kYCRecord`, the
 * same lower-first rule the generated client uses. */
function delegateKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export function tenantScopeExtension(
  orgContext: OrgContextService,
  client: PrismaClient = prisma,
) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // `applyTenantScope` works on plain objects — Prisma's per-operation
          // argument union is not expressible there without enumerating all
          // ~2000 variants. The cast is at this single boundary rather than
          // being pushed out to call sites.
          const scoped = applyTenantScope(
            orgContext,
            model,
            operation,
            args,
          ) as typeof args;

          // Layer 1 only: a global model, or an explicitly justified bypass.
          // Neither needs the RLS session variable — global tables carry no
          // policy, and the bootstrap reads run before any org is known.
          const organizationId = orgContext.currentOrNull();
          if (
            !TENANT_SCOPED_MODELS.has(model) ||
            orgContext.unscopedReason() !== null ||
            organizationId === null
          ) {
            return query(scoped);
          }

          // Already inside a transaction whose connection has the variable
          // set — reuse it rather than nesting, which Prisma does not allow.
          if (orgContext.inScopedTransaction()) return query(scoped);

          return withRlsSession(orgContext, client, organizationId, (tx) =>
            (
              tx as Record<
                string,
                Record<string, (a: unknown) => Promise<unknown>>
              >
            )[delegateKey(model)][operation](scoped),
          );
        },
      },
    },
  });
}
