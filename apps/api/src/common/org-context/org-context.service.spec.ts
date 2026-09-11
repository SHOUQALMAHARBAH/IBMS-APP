import { describe, expect, it } from 'vitest';
import { OrgContextService } from './org-context.service';

describe('OrgContextService — request scoping', () => {
  it('keeps two concurrent requests from seeing each other Organization', async () => {
    const ctx = new OrgContextService();
    const seen: string[] = [];

    const request = (orgId: string) =>
      ctx.runAs(orgId, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(`${orgId}:${ctx.currentOrNull()}`);
      });

    await Promise.all([request('org-1'), request('org-2')]);

    expect(seen.sort()).toEqual(['org-1:org-1', 'org-2:org-2']);
  });

  it('adopt() fills in the Organization for a request whose store is open', async () => {
    const ctx = new OrgContextService();
    await ctx.runForRequest(async () => {
      expect(ctx.currentOrNull()).toBeNull();
      ctx.adopt('org-7');
      expect(ctx.currentOrNull()).toBe('org-7');
      await Promise.resolve();
    });
  });
});

describe('OrgContextService — the unscoped bypass', () => {
  it('reports the reason only inside the block', async () => {
    const ctx = new OrgContextService();
    await ctx.runAs('org-1', async () => {
      expect(ctx.unscopedReason()).toBeNull();
      await ctx.runUnscoped('auth-bootstrap', () => {
        expect(ctx.unscopedReason()).toBe('auth-bootstrap');
        return Promise.resolve();
      });
      expect(ctx.unscopedReason()).toBeNull();
    });
  });

  it('restores scoping even when the block throws', async () => {
    const ctx = new OrgContextService();
    await ctx.runAs('org-1', async () => {
      await expect(
        ctx.runUnscoped('auth-bootstrap', () =>
          Promise.reject(new Error('bad password')),
        ),
      ).rejects.toThrow('bad password');

      // A failed login must not leave the rest of the request unscoped.
      expect(ctx.unscopedReason()).toBeNull();
      expect(ctx.currentOrNull()).toBe('org-1');
    });
  });

  it('does NOT leak the bypass to a concurrent sibling in the same request', async () => {
    const ctx = new OrgContextService();
    let siblingSawBypass: string | null = 'not-run';

    await ctx.runAs('org-1', async () => {
      await Promise.all([
        ctx.runUnscoped('auth-bootstrap', async () => {
          await new Promise((r) => setTimeout(r, 10));
        }),
        (async () => {
          await new Promise((r) => setTimeout(r, 5));
          siblingSawBypass = ctx.unscopedReason();
        })(),
      ]);
    });

    expect(siblingSawBypass).toBeNull();
  });
});

describe('OrgContextService — the RLS transaction flag', () => {
  it('is visible inside the transaction and gone after it', async () => {
    const ctx = new OrgContextService();
    await ctx.runAs('org-1', async () => {
      expect(ctx.inScopedTransaction()).toBe(false);
      await ctx.withScopedTransaction(() => {
        expect(ctx.inScopedTransaction()).toBe(true);
        return Promise.resolve();
      });
      expect(ctx.inScopedTransaction()).toBe(false);
    });
  });

  it('REGRESSION: a concurrent sibling does not inherit the flag', async () => {
    // The bug this exists to catch: the flag used to be a mutation of the
    // request's shared store, so the first of several CONCURRENT queries to
    // open its RLS transaction set it for all of them. The siblings then
    // skipped opening their own, ran on a pooled connection with no
    // `app.current_org_id`, and were rejected by the policy's WITH CHECK
    // (Postgres 42501). Every dashboard issues queries in parallel, so this
    // was not a corner case.
    const ctx = new OrgContextService();
    let siblingSawFlag: boolean | null = null;

    await ctx.runAs('org-1', async () => {
      await Promise.all([
        ctx.withScopedTransaction(async () => {
          await new Promise((r) => setTimeout(r, 10));
        }),
        (async () => {
          await new Promise((r) => setTimeout(r, 5));
          siblingSawFlag = ctx.inScopedTransaction();
        })(),
      ]);
    });

    expect(siblingSawFlag).toBe(false);
  });

  it('REGRESSION: outsideScopedTransaction clears the flag for work that runs on the outer client', async () => {
    // `UserRepository.withRoleLocked` opens a transaction only to hold a
    // `FOR UPDATE` row lock, then runs its work on the OUTER client. Left
    // inheriting the flag, that work skipped opening its own RLS session and
    // ran with no `app.current_org_id` — reads returned nothing and
    // `setActive`'s updateMany matched zero rows, which the service reads as
    // "already in that state" and reports as SUCCESS. Deactivating an account
    // silently did nothing.
    const ctx = new OrgContextService();
    let flagInsideWork: boolean | null = null;

    await ctx.runAs('org-1', () =>
      ctx.withScopedTransaction(() =>
        ctx.outsideScopedTransaction(() => {
          flagInsideWork = ctx.inScopedTransaction();
          return Promise.resolve();
        }),
      ),
    );

    expect(flagInsideWork).toBe(false);
  });

  it('outsideScopedTransaction keeps the Organization', async () => {
    const ctx = new OrgContextService();
    let org: string | null = null;
    await ctx.runAs('org-1', () =>
      ctx.withScopedTransaction(() =>
        ctx.outsideScopedTransaction(() => {
          org = ctx.currentOrNull();
          return Promise.resolve();
        }),
      ),
    );
    expect(org).toBe('org-1');
  });

  it('keeps the Organization visible inside the transaction', async () => {
    const ctx = new OrgContextService();
    await ctx.runAs('org-1', () =>
      ctx.withScopedTransaction(() => {
        expect(ctx.currentOrNull()).toBe('org-1');
        return Promise.resolve();
      }),
    );
  });
});
