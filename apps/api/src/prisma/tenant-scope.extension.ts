import { Prisma, prisma } from '@ibms/db';
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
export function buildTenantScopedClient(orgContext: OrgContextService) {
  return prisma.$extends(tenantScopeExtension(orgContext));
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

export function tenantScopeExtension(orgContext: OrgContextService) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          // `applyTenantScope` works on plain objects — Prisma's per-operation
          // argument union is not expressible there without enumerating all
          // ~2000 variants. The cast is at this single boundary rather than
          // being pushed out to call sites.
          return query(
            applyTenantScope(orgContext, model, operation, args) as typeof args,
          );
        },
      },
    },
  });
}
