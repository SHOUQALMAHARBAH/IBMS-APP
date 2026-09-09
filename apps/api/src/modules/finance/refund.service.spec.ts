import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { RefundService } from './refund.service';
import type { EndorsementRepository } from '../../repositories/endorsement.repository';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const actor = { id: 'fin-1' } as AuthenticatedUser;
const d = (v: string) => new Prisma.Decimal(v);

/** Below `REFUND_APPROVAL_THRESHOLD_JOD` (5,000) — no checker required. */
const SMALL = '1200.000';
/** At/above the threshold — a distinct approver is mandatory. */
const LARGE = '9000.000';

function refundFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'ref-1',
    endorsementId: 'end-1',
    amount: d(SMALL),
    reason: 'cancellation',
    raisedByUserId: 'plc-1',
    approvedByUserId: null,
    approvalThresholdMatrixLevel: 'below_threshold_auto',
    paidAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    endorsement: {
      id: 'end-1',
      policyId: 'pol-1',
      status: 'APPLIED',
      policy: { id: 'pol-1', customerId: 'cust-1' },
    },
    ...over,
  };
}

function makeDeps(refund: unknown = refundFixture()) {
  const endorsements = {
    findRefundById: vi.fn().mockResolvedValue(refund),
    recordRefundDisbursement: vi.fn().mockResolvedValue({
      refund: { id: 'ref-1' },
      ledgerEntry: {
        id: 'led-out-1',
        customerId: 'cust-1',
        amount: d(SMALL),
        direction: 'out',
        reference: 'refund:ref-1',
      },
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new RefundService(
    endorsements as unknown as EndorsementRepository,
    audit as unknown as AuditService,
  );
  return { service, endorsements, audit };
}

describe('RefundService.disburse (Process 37 — IMPROVEMENTS §3.2)', () => {
  it('stamps paidAt and books the client-funds OUT movement together', async () => {
    const deps = makeDeps();
    const view = await deps.service.disburse('ref-1', actor);

    expect(deps.endorsements.recordRefundDisbursement).toHaveBeenCalledWith(
      expect.objectContaining({
        refundId: 'ref-1',
        customerId: 'cust-1',
        ledgerReference: 'refund:ref-1',
      }),
    );
    expect(view.clientFundsLedgerEntryId).toBe('led-out-1');
    const entities = deps.audit.record.mock.calls.map(
      (c) => (c[0] as { entityType: string }).entityType,
    );
    expect(entities).toContain('Refund');
    expect(entities).toContain('ClientFundsLedgerEntry');
  });

  it('REFUSES an at-threshold refund that nobody approved — the maker/checker gate', async () => {
    const deps = makeDeps(
      refundFixture({ amount: d(LARGE), approvedByUserId: null }),
    );
    await expect(deps.service.disburse('ref-1', actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(deps.endorsements.recordRefundDisbursement).not.toHaveBeenCalled();
  });

  it('allows an at-threshold refund once a distinct approver has signed it', async () => {
    const deps = makeDeps(
      refundFixture({ amount: d(LARGE), approvedByUserId: 'mgr-1' }),
    );
    await deps.service.disburse('ref-1', actor);
    expect(deps.endorsements.recordRefundDisbursement).toHaveBeenCalled();
  });

  it('re-derives the threshold from the live amount, not the stored matrix level', async () => {
    // A stale `below_threshold_auto` label on a genuinely large refund must
    // not buy a free pass — the gate is recomputed from `amount`.
    const deps = makeDeps(
      refundFixture({
        amount: d(LARGE),
        approvedByUserId: null,
        approvalThresholdMatrixLevel: 'below_threshold_auto',
      }),
    );
    await expect(deps.service.disburse('ref-1', actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('422s while the endorsement has not been APPLIED to the policy', async () => {
    const deps = makeDeps(
      refundFixture({
        endorsement: {
          id: 'end-1',
          policyId: 'pol-1',
          status: 'REFUND_APPROVAL_PENDING',
          policy: { id: 'pol-1', customerId: 'cust-1' },
        },
      }),
    );
    await expect(deps.service.disburse('ref-1', actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(deps.endorsements.recordRefundDisbursement).not.toHaveBeenCalled();
  });

  it('accepts a CLIENT_NOTIFIED endorsement (past APPLIED)', async () => {
    const deps = makeDeps(
      refundFixture({
        endorsement: {
          id: 'end-1',
          policyId: 'pol-1',
          status: 'CLIENT_NOTIFIED',
          policy: { id: 'pol-1', customerId: 'cust-1' },
        },
      }),
    );
    await deps.service.disburse('ref-1', actor);
    expect(deps.endorsements.recordRefundDisbursement).toHaveBeenCalled();
  });

  it('409s an already-disbursed refund — a refund is paid once', async () => {
    const deps = makeDeps(
      refundFixture({ paidAt: new Date('2026-09-05T00:00:00.000Z') }),
    );
    await expect(deps.service.disburse('ref-1', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('409s when a concurrent disbursement won the status-conditional write', async () => {
    const deps = makeDeps();
    deps.endorsements.recordRefundDisbursement.mockResolvedValueOnce(null);
    await expect(deps.service.disburse('ref-1', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s an unknown refund', async () => {
    const deps = makeDeps(null);
    await expect(deps.service.disburse('nope', actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('never puts the refund reason free text into the audit trail', async () => {
    const deps = makeDeps(
      refundFixture({ reason: 'client complained about pricing' }),
    );
    await deps.service.disburse('ref-1', actor);
    expect(JSON.stringify(deps.audit.record.mock.calls)).not.toContain(
      'complained',
    );
  });
});
