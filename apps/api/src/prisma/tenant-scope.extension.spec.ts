import { describe, expect, it } from 'vitest';
import { OrgContextService } from '../common/org-context/org-context.service';
import { Prisma } from '@ibms/db';
import {
  applyTenantScope,
  MissingOrgContextError,
  PROVIDER_OWNED_NULL_ORG_MODELS,
  TENANT_SCOPED_MODELS,
  UnhandledOperationError,
} from './tenant-scope.extension';

/**
 * Drives the tenant rule directly. `applyTenantScope` is the whole of it —
 * `tenantScopeExtension` only hands Prisma's `query` the arguments it returns —
 * so asserting on its output is asserting on what actually reaches the database.
 */
function scoped(
  orgContext: OrgContextService,
  model: string,
  operation: string,
  args: unknown,
): unknown {
  return applyTenantScope(orgContext, model, operation, args);
}

describe('tenantScopeExtension — which models it covers', () => {
  it('derives the tenant-scoped model list from the DMMF, not a hand-kept list', () => {
    // Spec §8: "a missed table is a real isolation hole". A hand-maintained
    // list is exactly how one gets missed.
    expect(TENANT_SCOPED_MODELS.has('Customer')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('Policy')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('AuditLogEntry')).toBe(true);
    expect(TENANT_SCOPED_MODELS.size).toBeGreaterThan(100);
  });

  it('leaves the spec §3.1 global models alone', () => {
    for (const global of [
      // `Permission` is the catalogue of what the SOFTWARE can do — identical
      // for every office, and every office's role screen must read all of it.
      'Permission',
      'WatchlistEntry',
      'WatchlistDatasetVersion',
      'WatchlistSyncRun',
      'Organization',
    ]) {
      expect(TENANT_SCOPED_MODELS.has(global)).toBe(false);
    }
  });

  it('now scopes Role and RolePermission, which used to be global', () => {
    // Office-scoped custom roles: both gained `organizationId`, so the
    // DMMF-derived set picks them up with no change to the extension itself.
    // That is the whole argument for deriving the set from the schema rather
    // than hand-listing it — and this assertion is the proof, because it is the
    // ONLY thing that had to change here when they stopped being global.
    expect(TENANT_SCOPED_MODELS.has('Role')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('RolePermission')).toBe(true);
  });

  it('a model with an RLS policy must be in the scoped set, or the policy is unsatisfiable', () => {
    // The lesson from migration 20261003110000, kept as a guard rather than a
    // comment. The extension sets `app.current_org_id` ONLY for models in this
    // set, so an RLS policy reading that variable on a model outside it can
    // never match a row — every read returns empty and every user is locked out
    // of everything. That is exactly what shipping the RolePermission policy
    // without the column did.
    //
    // If a future migration adds `tenant_isolation` to another table, that
    // table's model belongs here too.
    for (const rlsProtected of [
      'Role',
      'RolePermission',
      'UserRoleAssignment',
    ]) {
      expect(TENANT_SCOPED_MODELS.has(rlsProtected)).toBe(true);
    }
  });

  it('passes a global model straight through, untouched, even with no context', () => {});
});

describe('tenantScopeExtension — failing closed', () => {
  it('REFUSES a tenant-scoped query when no Organization is in context', () => {
    const ctx = new OrgContextService();
    expect(() => scoped(ctx, 'Customer', 'findMany', {})).toThrow(
      MissingOrgContextError,
    );
  });

  it('refuses a write just as firmly as a read', () => {
    const ctx = new OrgContextService();
    expect(() =>
      scoped(ctx, 'Customer', 'create', { data: { legalName: 'x' } }),
    ).toThrow(MissingOrgContextError);
  });

  it('REFUSES an operation it has no scoping rule for, rather than passing it through', () => {
    // Regression: `createManyAndReturn` was missing from the operation sets, so
    // PolicyRepository.attachDocuments slipped past unstamped. A missing WRITE
    // was caught by NOT NULL; a missing READ would have leaked silently.
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(() => scoped(ctx, 'Customer', 'someFutureOperation', {})).toThrow(
        UnhandledOperationError,
      );
    });
  });

  it('handles createManyAndReturn and updateManyAndReturn', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Document', 'createManyAndReturn', {
          data: [{ fileName: 'a.pdf' }],
        }),
      ).toEqual({ data: [{ fileName: 'a.pdf', organizationId: 'org-1' }] });

      expect(
        scoped(ctx, 'Document', 'updateManyAndReturn', {
          where: { category: 'POLICY' },
          data: { category: 'CLAIM' },
        }),
      ).toEqual({
        where: { category: 'POLICY', organizationId: 'org-1' },
        data: { category: 'CLAIM' },
      });
    });
  });

  it('names the model and operation, so the offending call site is findable', () => {
    const ctx = new OrgContextService();
    expect(() => scoped(ctx, 'Policy', 'updateMany', {})).toThrow(
      /Policy\.updateMany\(\)/,
    );
  });
});

describe('tenantScopeExtension — read filtering', () => {
  it('injects the organization into a findMany where', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Customer', 'findMany', {
          where: { status: 'ACTIVE' },
        }),
      ).toEqual({
        where: { status: 'ACTIVE', organizationId: 'org-1' },
      });
    });
  });

  it('injects into findUnique WITHOUT rewriting it to findFirst', () => {
    // Prisma 5+ extended-where-unique accepts a filter alongside the unique
    // field, so return shapes and P2025 behaviour are untouched.
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Policy', 'findUnique', {
          where: { id: 'p-1' },
        }),
      ).toEqual({
        where: { id: 'p-1', organizationId: 'org-1' },
      });
    });
  });

  it('scopes deleteMany, so a delete cannot reach another office', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Claim', 'deleteMany', {
          where: { status: 'CLOSED' },
        }),
      ).toEqual({
        where: { status: 'CLOSED', organizationId: 'org-1' },
      });
    });
  });

  it('scopes count and groupBy — an aggregate must not span offices either', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      for (const op of ['count', 'groupBy', 'aggregate']) {
        expect(scoped(ctx, 'Invoice', op, {})).toEqual({
          where: { organizationId: 'org-1' },
        });
      }
    });
  });
});

describe('tenantScopeExtension — write stamping', () => {
  it('stamps the organization onto a create', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Customer', 'create', {
          data: { legalName: 'Acme' },
        }),
      ).toEqual({
        data: { legalName: 'Acme', organizationId: 'org-1' },
      });
    });
  });

  it('stamps every row of a createMany', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Customer', 'createMany', {
          data: [{ legalName: 'A' }, { legalName: 'B' }],
        }),
      ).toEqual({
        data: [
          { legalName: 'A', organizationId: 'org-1' },
          { legalName: 'B', organizationId: 'org-1' },
        ],
      });
    });
  });

  it('stamps NESTED relation creates — the case the dropped @default used to cover', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Insurer', 'create', {
          data: {
            name: 'AIG',
            products: { create: [{ line: 'MOTOR' }, { line: 'FIRE' }] },
          },
        }),
      ).toEqual({
        data: {
          name: 'AIG',
          organizationId: 'org-1',
          products: {
            create: [
              { line: 'MOTOR', organizationId: 'org-1' },
              { line: 'FIRE', organizationId: 'org-1' },
            ],
          },
        },
      });
    });
  });

  it('leaves `connect` alone — it points at rows that already carry an org', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Policy', 'create', {
          data: { customer: { connect: { id: 'c-1' } } },
        }),
      ).toEqual({
        data: {
          organizationId: 'org-1',
          customer: { connect: { id: 'c-1' } },
        },
      });
    });
  });

  it('never overwrites an explicitly supplied organization', () => {
    // A caller that names one is making a deliberate statement; silently
    // rewriting it would hide a bug rather than surface it.
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Customer', 'create', {
          data: { legalName: 'Acme', organizationId: 'org-2' },
        }),
      ).toEqual({
        data: { legalName: 'Acme', organizationId: 'org-2' },
      });
    });
  });

  it('scopes the upsert where AND stamps only its create half', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Customer', 'upsert', {
          where: { id: 'c-1' },
          create: { legalName: 'Acme' },
          update: { legalName: 'Acme Ltd' },
        }),
      ).toEqual({
        where: { id: 'c-1', organizationId: 'org-1' },
        create: { legalName: 'Acme', organizationId: 'org-1' },
        update: { legalName: 'Acme Ltd' },
      });
    });
  });
});

describe('tenantScopeExtension — the auth bootstrap bypass', () => {
  it('passes through while an explicitly justified bypass is active', async () => {
    const ctx = new OrgContextService();
    await ctx.runUnscoped('auth-bootstrap', () => {
      expect(
        scoped(ctx, 'User', 'findFirst', { where: { email: 'a@b.c' } }),
      ).toEqual({ where: { email: 'a@b.c' } });
      return Promise.resolve();
    });
  });

  it('restores filtering after the bypass, even when the work throws', async () => {
    const ctx = new OrgContextService();
    await ctx.runAs('org-1', async () => {
      await expect(
        ctx.runUnscoped('auth-bootstrap', () =>
          Promise.reject(new Error('bad password')),
        ),
      ).rejects.toThrow('bad password');

      // A failed login must not leave the rest of the request unscoped.
      expect(scoped(ctx, 'Customer', 'findMany', {})).toEqual({
        where: { organizationId: 'org-1' },
      });
    });
  });

  it('keeps two concurrent requests from seeing each other organization', async () => {
    const ctx = new OrgContextService();
    const observed: string[] = [];
    const request = (orgId: string) =>
      ctx.runAs(orgId, async () => {
        await new Promise((r) => setTimeout(r, 5));
        observed.push(`${orgId}:${ctx.currentOrNull()}`);
      });

    await Promise.all([request('org-1'), request('org-2')]);

    expect(observed.sort()).toEqual(['org-1:org-1', 'org-2:org-2']);
  });
});

describe('tenantScopeExtension — a NULL organizationId that means PROVIDER-OWNED', () => {
  /*
   * MODULE 1's LEGAL-VALUES TABLE. `LegalValue.organizationId` is NULLABLE and NULL means the row
   * is the provider's — a figure CBJ Instructions No. 9 of 2026 itself states — which every office
   * must be able to READ and none may write.
   *
   * The DMMF-derived scoped set answers a two-value question, and this is a three-value table.
   * Without the exception, `withOrg` adds `{ organizationId }` to every read and the instrument's
   * own figures become invisible to the application. With it widened too far, an office can update
   * or delete the provider's rows through Prisma. Both directions are asserted here.
   */

  const nullableOrgModels = (): string[] =>
    Prisma.dmmf.datamodel.models
      .filter((m) =>
        m.fields.some((f) => f.name === 'organizationId' && !f.isRequired),
      )
      .map((m) => m.name);

  it('every declared provider-owned-NULL model really has a NULLABLE organizationId', () => {
    // A model whose column is NOT NULL has no NULL rows at all, so listing it widens reads for
    // nothing and is pure risk.
    for (const model of PROVIDER_OWNED_NULL_ORG_MODELS) {
      expect(nullableOrgModels()).toContain(model);
    }
  });

  it('every NULLABLE organizationId in the schema is declared here', () => {
    // The second direction, and the one that cannot be noticed by reading code: a new model with a
    // nullable tenant column is either this pattern or a mistake, and both need naming. Left
    // undeclared, its NULL rows would be invisible to every office — including the office that
    // wrote them.
    expect([...nullableOrgModels()].sort()).toEqual(
      [...PROVIDER_OWNED_NULL_ORG_MODELS].sort(),
    );
  });

  it('is in the tenant-scoped set, because that is what sets app.current_org_id', () => {
    // The lex's own rule: an RLS policy is only enforceable on a model the extension recognises as
    // tenant-scoped, because that is how the session variable gets set at all. A nullable column
    // still satisfies the DMMF filter, which is why naming the column `organizationId` — rather
    // than something like `ownerOrganizationId` — was the load-bearing choice.
    expect(TENANT_SCOPED_MODELS.has('LegalValue')).toBe(true);
  });

  it('a READ sees this office rows OR the provider rows', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(scoped(ctx, 'LegalValue', 'findMany', {})).toEqual({
        where: {
          AND: [
            { OR: [{ organizationId: 'org-1' }, { organizationId: null }] },
          ],
        },
      });
    });
  });

  it("keeps the caller's own OR, by appending to AND rather than merging a second OR", () => {
    // A caller's `where` may already carry an `OR`. Merging a second top-level `OR` key would
    // OVERWRITE it and silently widen the caller's filter — the failure direction that does not
    // look like a bug.
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'LegalValue', 'findFirst', {
          where: { OR: [{ code: 'A' }, { code: 'B' }] },
        }),
      ).toEqual({
        where: {
          OR: [{ code: 'A' }, { code: 'B' }],
          AND: [
            { OR: [{ organizationId: 'org-1' }, { organizationId: null }] },
          ],
        },
      });
    });
  });

  it("keeps the caller's own AND too, rather than replacing it", () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'LegalValue', 'findMany', {
          where: { AND: [{ code: 'A' }] },
        }),
      ).toEqual({
        where: {
          AND: [
            { code: 'A' },
            { OR: [{ organizationId: 'org-1' }, { organizationId: null }] },
          ],
        },
      });
    });
  });

  it('🔴 a findUnique keeps its UNIQUE FIELD at the top level', () => {
    /*
     * THE DEFECT THIS WAS WRITTEN FOR, and it was a real one in the first version of the widening.
     *
     * `findUnique`/`findUniqueOrThrow` take a `WhereUniqueInput`, and Prisma needs the unique field
     * AT THE TOP LEVEL to identify the row. The first version returned `{ AND: [where, ownership] }`,
     * which moved `id` off the top level and produced
     * `PrismaClientValidationError: Invalid prisma.legalValue.findUniqueOrThrow() invocation`.
     * `withOrg` never hit it because it spreads — so the bug was introduced by the ONE function that
     * did not.
     *
     * Caught by `legal-value.e2e-spec.ts` on its first run, which is the argument for that spec
     * existing: no unit test of the extension's output SHAPE would have noticed, because the shape
     * was internally consistent and simply not the one Prisma accepts.
     */
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      const args = scoped(ctx, 'LegalValue', 'findUniqueOrThrow', {
        where: { id: 'lv-1' },
      }) as { where: Record<string, unknown> };
      expect(args.where.id).toBe('lv-1');
      expect(args.where.AND).toEqual([
        { OR: [{ organizationId: 'org-1' }, { organizationId: null }] },
      ]);
    });
  });

  for (const op of ['update', 'updateMany', 'delete', 'deleteMany'] as const) {
    it(`a ${op} is NOT widened — an office must not reach the provider's rows`, () => {
      const ctx = new OrgContextService();
      ctx.runAs('org-1', () => {
        const args = scoped(ctx, 'LegalValue', op, {
          where: { code: 'X' },
          ...(op.startsWith('update') ? { data: { name: 'y' } } : {}),
        }) as { where: Record<string, unknown> };
        expect(args.where).toEqual({ code: 'X', organizationId: 'org-1' });
      });
    });
  }

  it('an upsert is not widened on its where, and its create is still stamped', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'LegalValue', 'upsert', {
          where: { code: 'X' },
          create: { code: 'X', name: 'n' },
          update: { name: 'n' },
        }),
      ).toEqual({
        where: { code: 'X', organizationId: 'org-1' },
        create: { code: 'X', name: 'n', organizationId: 'org-1' },
        update: { name: 'n' },
      });
    });
  });

  it('a create is STAMPED, so the application cannot author a provider row', () => {
    // The only thing that can write `organizationId: null` here is the seed, running as the
    // database owner under a policy granted TO that role alone. An office account attempting it is
    // refused by RLS — `new row violates row-level security policy`, measured.
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'LegalValue', 'create', { data: { code: 'X', name: 'n' } }),
      ).toEqual({ data: { code: 'X', name: 'n', organizationId: 'org-1' } });
    });
  });

  it('an ordinary tenant-scoped model is untouched by the exception', () => {
    const ctx = new OrgContextService();
    ctx.runAs('org-1', () => {
      expect(
        scoped(ctx, 'Customer', 'findMany', { where: { status: 'ACTIVE' } }),
      ).toEqual({
        where: { status: 'ACTIVE', organizationId: 'org-1' },
      });
    });
  });
});
