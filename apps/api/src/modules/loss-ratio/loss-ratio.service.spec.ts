import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@ibms/db';
import { LossRatioService } from './loss-ratio.service';
import type { LossRatioRepository } from '../../repositories/loss-ratio.repository';
import type { AuditService } from '../audit/audit.service';

const d = (s: string) => new Prisma.Decimal(s);

function makeDeps(
  policy: Awaited<
    ReturnType<LossRatioRepository['loadPolicyForRecompute']>
  > | null,
) {
  const repo = {
    loadPolicyForRecompute: vi.fn().mockResolvedValue(policy),
    upsertLossRatio: vi
      .fn()
      .mockImplementation((renewalCaseId: string) =>
        Promise.resolve({ id: 'lr-1', renewalCaseId }),
      ),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new LossRatioService(
    repo as unknown as LossRatioRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('LossRatioService.recomputeForPolicy (Process 29)', () => {
  it('is a no-op when the policy is not found', async () => {
    const { service, repo, audit } = makeDeps(null);
    const res = await service.recomputeForPolicy(
      'pol-x',
      { reason: 'claim-closed' },
      'u-1',
    );
    expect(res).toEqual({ recomputed: false, reason: 'policy-not-found' });
    expect(repo.upsertLossRatio).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('is a logged no-op when the policy has no open renewal case (renewal not built)', async () => {
    const { service, repo, audit } = makeDeps({
      id: 'pol-1',
      premium: d('40000.000'),
      renewalCaseId: null,
      claimNetSettlements: [d('20000.000')],
    });
    const res = await service.recomputeForPolicy(
      'pol-1',
      { reason: 'claim-closed', claimId: 'claim-1' },
      'u-1',
    );
    expect(res).toEqual({ recomputed: false, reason: 'no-renewal-case' });
    expect(repo.upsertLossRatio).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('recomputes + upserts the LossRatio and writes an UPDATE audit row when a renewal case exists', async () => {
    const { service, repo, audit } = makeDeps({
      id: 'pol-1',
      premium: d('40000.000'),
      renewalCaseId: 'rc-1',
      claimNetSettlements: [d('15000.000'), d('5000.000'), null],
    });

    const res = await service.recomputeForPolicy(
      'pol-1',
      { reason: 'claim-closed', claimId: 'claim-1' },
      'u-1',
    );

    expect(res).toEqual({
      recomputed: true,
      ratio: '0.5000',
      ratioCapped: false,
    });
    expect(repo.upsertLossRatio).toHaveBeenCalledWith(
      'rc-1',
      expect.objectContaining({}),
    );
    const figures = repo.upsertLossRatio.mock.calls[0]?.[1] as {
      periodClaims: Prisma.Decimal;
      periodPremium: Prisma.Decimal;
      ratio: Prisma.Decimal;
    };
    expect(figures.periodClaims.toFixed(3)).toBe('20000.000');
    expect(figures.periodPremium.toFixed(3)).toBe('40000.000');
    expect(figures.ratio.toFixed(4)).toBe('0.5000');

    const auditArg = audit.record.mock.calls[0]?.[0] as {
      action: string;
      entityType: string;
      entityId: string;
      afterValue: Record<string, unknown>;
    };
    expect(auditArg.action).toBe('UPDATE');
    expect(auditArg.entityType).toBe('LossRatio');
    expect(auditArg.entityId).toBe('lr-1');
    expect(auditArg.afterValue).toMatchObject({
      policyId: 'pol-1',
      renewalCaseId: 'rc-1',
      trigger: 'claim-closed',
      claimId: 'claim-1',
      periodClaims: '20000.000',
      periodPremium: '40000.000',
      ratio: '0.5000',
    });
  });

  it('still reports recomputed:true if the audit write throws after the LossRatio row committed', async () => {
    const { service, repo, audit } = makeDeps({
      id: 'pol-1',
      premium: d('40000.000'),
      renewalCaseId: 'rc-1',
      claimNetSettlements: [d('20000.000')],
    });
    audit.record.mockRejectedValueOnce(new Error('audit down'));

    const res = await service.recomputeForPolicy(
      'pol-1',
      { reason: 'claim-closed' },
      'u-1',
    );

    expect(res).toMatchObject({ recomputed: true, ratio: '0.5000' });
    expect(repo.upsertLossRatio).toHaveBeenCalledTimes(1);
  });
});
