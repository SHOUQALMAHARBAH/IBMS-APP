import { describe, expect, it, vi } from 'vitest';
import { InternalControlsService } from './internal-controls.service';
import { MAKER_CHECKER_REGISTRY } from './internal-controls.config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

function makeService(
  rowsByModel: Record<string, Array<Record<string, unknown>>> = {},
  policyCheckingCrossTableRows: Array<Record<string, unknown>> = [],
) {
  const client: Record<string, unknown> = {};
  for (const pair of MAKER_CHECKER_REGISTRY) {
    // policyChecking is special-cased below because it also serves the
    // cross-table query — every other model gets one plain findMany mock.
    if (pair.modelProperty === 'policyChecking') continue;
    client[pair.modelProperty] = {
      findMany: vi
        .fn()
        .mockResolvedValue(rowsByModel[pair.modelProperty] ?? []),
    };
  }
  // policyChecking.findMany is called TWICE per run (the registry's own
  // placedByUserId/checkedByUserId pair, then the cross-table issuer
  // check) — mockResolvedValueOnce lets each call return its own fixture,
  // falling back to the cross-table rows for every call after that.
  const policyCheckingFindMany = vi.fn();
  policyCheckingFindMany
    .mockResolvedValueOnce(rowsByModel['policyChecking'] ?? [])
    .mockResolvedValue(policyCheckingCrossTableRows);
  client['policyChecking'] = { findMany: policyCheckingFindMany };

  const prisma = { client } as unknown as PrismaService;
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
    recordMany: vi.fn().mockResolvedValue(undefined),
  };
  const service = new InternalControlsService(
    prisma,
    audit as unknown as AuditService,
  );
  return { service, audit, client };
}

describe('InternalControlsService.runSelfApprovalAudit (Process 56)', () => {
  it('scans every registered pair plus the cross-table PolicyChecking/Policy pair, finding nothing on clean data', async () => {
    const { service, audit } = makeService();

    const report = await service.runSelfApprovalAudit('user-1');

    expect(report.pairsScanned).toBe(MAKER_CHECKER_REGISTRY.length + 1);
    expect(report.violations).toEqual([]);
    expect(report.totalRowsChecked).toBe(0);

    // a clean run still writes the best-effort READ row...
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'READ',
        entityType: 'InternalControlsAuditReport',
        entityId: 'self-approval-audit',
      }),
    );
    // ...but never writes a violation row when there is nothing to report.
    expect(audit.recordMany).not.toHaveBeenCalled();
  });

  it('detects a same-table self-approval violation (KYCRecord)', async () => {
    const { service, audit } = makeService({
      kYCRecord: [
        { id: 'kyc-1', createdByUserId: 'user-a', approvedByUserId: 'user-a' },
      ],
    });

    const report = await service.runSelfApprovalAudit('auditor-1');

    expect(report.violations).toEqual([
      expect.objectContaining({
        entityType: 'KYCRecord',
        entityId: 'kyc-1',
        userId: 'user-a',
        dbCheckConstraint: 'KYCRecord_maker_checker_distinct',
      }),
    ]);
    // a violation is loud: one CREATE InternalControlsViolation row per hit.
    expect(audit.recordMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'auditor-1',
        action: 'CREATE',
        entityType: 'InternalControlsViolation',
        entityId: 'KYCRecord:kyc-1',
      }),
    ]);
  });

  it('detects the cross-table PolicyChecking.checkedByUserId vs Policy.issuedByUserId violation — the one pair no DB CHECK can express', async () => {
    const { service } = makeService({}, [
      {
        id: 'pc-1',
        checkedByUserId: 'user-x',
        policy: { issuedByUserId: 'user-x' },
      },
    ]);

    const report = await service.runSelfApprovalAudit('user-1');

    expect(report.violations).toEqual([
      expect.objectContaining({
        entityType: 'PolicyChecking',
        entityId: 'pc-1',
        makerField: 'issuedByUserId',
        checkerField: 'checkedByUserId',
        userId: 'user-x',
        dbCheckConstraint: null,
      }),
    ]);
  });

  it('reports rowsChecked per pair even when every pair is empty (dormant models included)', async () => {
    const { service } = makeService();
    const report = await service.runSelfApprovalAudit('user-1');
    const disposalBatchRow = report.byPair.find(
      (p) => p.entityType === 'DisposalBatch',
    );
    expect(disposalBatchRow).toEqual(
      expect.objectContaining({
        rowsChecked: 0,
        violationCount: 0,
        dormant: true,
      }),
    );
  });

  it('does not fail the whole scan if the READ audit row fails to write', async () => {
    const { service, audit } = makeService();
    audit.record.mockRejectedValueOnce(new Error('audit down'));

    const report = await service.runSelfApprovalAudit('user-1');
    expect(report.violations).toEqual([]);
  });

  it('runScheduledAudit delegates to the same scan with the system account id', async () => {
    const { service, audit } = makeService({
      kYCRecord: [
        { id: 'kyc-1', createdByUserId: 'user-a', approvedByUserId: 'user-a' },
      ],
    });

    await service.runScheduledAudit('system-user-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'system-user-1' }),
    );
    expect(audit.recordMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'system-user-1' }),
    ]);
  });
});
