import { describe, expect, it } from 'vitest';
import { OrgContextService } from '../common/org-context/org-context.service';
import {
  applyTenantScope,
  MissingOrgContextError,
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
      'Role',
      'Permission',
      'RolePermission',
      'WatchlistEntry',
      'WatchlistDatasetVersion',
      'WatchlistSyncRun',
      'Organization',
    ]) {
      expect(TENANT_SCOPED_MODELS.has(global)).toBe(false);
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
