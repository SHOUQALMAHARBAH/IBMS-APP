import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { ClaimsAnalyticsService } from './claims-analytics.service';
import type {
  AnalyticsPolicyRow,
  LossRatioRepository,
} from '../../repositories/loss-ratio.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const d = (s: string) => new Prisma.Decimal(s);
const actor: AuthenticatedUser = {
  id: 'mgr-1',
  email: 'mgr@ibms.test',
  roles: ['BRANCH_DEPARTMENT_MANAGER'],
  sessionId: 's-1',
};

function makeDeps(
  policies: Awaited<
    ReturnType<LossRatioRepository['loadPoliciesForAnalytics']>
  >,
) {
  const repo = {
    loadPoliciesForAnalytics: vi.fn().mockResolvedValue(policies),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ClaimsAnalyticsService(
    repo as unknown as LossRatioRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

const P: AnalyticsPolicyRow[] = [
  {
    id: 'p-1',
    customerId: 'acme',
    customerLegalName: 'Acme Ltd',
    insuranceLine: 'Property All Risks',
    policyRef: 'POL-1',
    premium: d('40000.000'),
    claimNetSettlements: [d('20000.000')],
  },
  {
    id: 'p-2',
    customerId: 'beta',
    customerLegalName: 'Beta Co',
    insuranceLine: 'Motor Fleet',
    policyRef: 'POL-2',
    premium: d('10000.000'),
    claimNetSettlements: [],
  },
];

describe('ClaimsAnalyticsService.lossRatioBreakdown (Process 30)', () => {
  it('returns the breakdown for the requested grouping and passes the scope filters to the repo', async () => {
    const { service, repo } = makeDeps(P);
    const b = await service.lossRatioBreakdown(
      { groupBy: 'line', insuranceLine: 'Property All Risks' },
      actor,
    );
    expect(repo.loadPoliciesForAnalytics).toHaveBeenCalledWith({
      customerId: undefined,
      policyId: undefined,
      insuranceLine: 'Property All Risks',
    });
    expect(b.groupBy).toBe('line');
    expect(b.rows.map((r) => r.key)).toEqual([
      'Property All Risks',
      'Motor Fleet',
    ]);
  });

  it('records a READ audit — counts / filters only, flagged sensitive when a claim contributed', async () => {
    const { service, audit } = makeDeps(P);
    await service.lossRatioBreakdown(
      { groupBy: 'customer', customerId: 'acme' },
      actor,
    );

    const arg = audit.record.mock.calls[0]?.[0] as {
      action: string;
      entityType: string;
      entityId: string;
      isSensitiveDataAccess: boolean;
      afterValue: Record<string, unknown>;
    };
    expect(arg.action).toBe('READ');
    expect(arg.entityType).toBe('ClaimsAnalytics');
    expect(arg.entityId).toBe('acme');
    expect(arg.isSensitiveDataAccess).toBe(true);
    expect(arg.afterValue).toMatchObject({
      view: 'loss-ratio-breakdown',
      groupBy: 'customer',
      policies: 2,
      claims: 1,
    });
    // no figure / customer name leaks into the audit payload
    expect(JSON.stringify(arg.afterValue)).not.toContain('40000');
    expect(JSON.stringify(arg.afterValue)).not.toContain('Acme');
  });

  it('does not flag sensitive when no claim contributed', async () => {
    const { service, audit } = makeDeps([P[1]]); // Beta, no settled claims
    await service.lossRatioBreakdown({ groupBy: 'line' }, actor);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ isSensitiveDataAccess: false }),
    );
  });

  it('still returns the breakdown if the READ audit write throws (best-effort)', async () => {
    const { service, audit } = makeDeps(P);
    audit.record.mockRejectedValueOnce(new Error('audit down'));
    const b = await service.lossRatioBreakdown({ groupBy: 'customer' }, actor);
    expect(b.rows).toHaveLength(2);
  });

  it('uses "book-wide" as the audit entityId when no scope filter is given', async () => {
    const { service, audit } = makeDeps(P);
    await service.lossRatioBreakdown({ groupBy: 'policy' }, actor);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'book-wide' }),
    );
  });
});
