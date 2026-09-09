import { describe, expect, it, vi } from 'vitest';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { RenewalService } from './renewal.service';
import type { RenewalCaseRepository } from '../../repositories/renewal-case.repository';
import type { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import type { SlaTimerService } from '../sla/sla-timer.service';
import type { LossRatioService } from '../loss-ratio/loss-ratio.service';
import type { AuditService } from '../audit/audit.service';

const ACTOR = 'user-1';

function caseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'rc-1',
    policyId: 'pol-1',
    status: 'RENEWAL_DUE',
    leadTimeDays: 90,
    triggeredAt: new Date('2026-09-01T00:00:00.000Z'),
    riskChangedSinceLastRenewal: false,
    insurerTermsWorsened: false,
    retentionEscalatedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    policy: {
      id: 'pol-1',
      customerId: 'cust-1',
      policyNumber: 'POL-0001',
      insuranceLine: 'Property All Risks',
      insurerId: 'ins-1',
      status: 'ACTIVE',
      inceptionDate: new Date('2026-01-01T00:00:00.000Z'),
      expiryDate: new Date('2026-12-31T00:00:00.000Z'),
      issuedPremium: new Prisma.Decimal('1000.000'),
      requestedPremium: new Prisma.Decimal('1000.000'),
      customer: { legalName: 'Acme Ltd' },
    },
    lossRatio: null,
    ...over,
  };
}

function makeDeps(over: Record<string, unknown> = {}) {
  const cases = {
    findRenewalCandidates: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 'rc-1',
      policyId: 'pol-1',
      status: 'RENEWAL_DUE',
      leadTimeDays: 90,
      riskChangedSinceLastRenewal: false,
      insurerTermsWorsened: false,
    }),
    findById: vi.fn().mockResolvedValue(caseRow()),
    findByPolicyId: vi.fn().mockResolvedValue(caseRow()),
    findMany: vi.fn().mockResolvedValue([caseRow()]),
    updateFlags: vi.fn().mockResolvedValue({
      id: 'rc-1',
      policyId: 'pol-1',
      status: 'RENEWAL_DUE',
      leadTimeDays: 90,
      riskChangedSinceLastRenewal: true,
      insurerTermsWorsened: false,
    }),
    ...(over.cases as object),
  };
  const workflow = { transition: vi.fn().mockResolvedValue({ id: 'rc-1' }) };
  const sla = {
    startTimer: vi.fn().mockResolvedValue([]),
    resolve: vi.fn().mockResolvedValue(undefined),
  };
  const lossRatio = {
    recomputeForPolicy: vi.fn().mockResolvedValue({ recomputed: true }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new RenewalService(
    cases as unknown as RenewalCaseRepository,
    workflow as unknown as WorkflowTransitionService,
    sla as unknown as SlaTimerService,
    lossRatio as unknown as LossRatioService,
    audit as unknown as AuditService,
  );
  return { service, cases, workflow, sla, lossRatio, audit };
}

describe('RenewalService.runSweep (Part 3.9 lead-time trigger)', () => {
  it('opens a case per candidate, starts the SLA timer, and triggers the loss-ratio recompute', async () => {
    const deps = makeDeps({
      cases: {
        findRenewalCandidates: vi
          .fn()
          .mockResolvedValue([
            { id: 'pol-1', customerId: 'cust-1', expiryDate: new Date() },
          ]),
      },
    });
    const result = await deps.service.runSweep(ACTOR);

    expect(result).toMatchObject({ scanned: 1, opened: 1, failed: 0 });
    // The gap IMPROVEMENTS.md §3.6 records: this is the producer both of
    // these consumers were waiting on.
    expect(deps.sla.startTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'RenewalCase',
        workflowName: 'renewal_workflow_start',
      }),
    );
    expect(deps.lossRatio.recomputeForPolicy).toHaveBeenCalledWith(
      'pol-1',
      { reason: 'renewal-case-opened' },
      ACTOR,
    );
  });

  it('counts a concurrent double-open (P2002) as a skip, not a failure', async () => {
    const deps = makeDeps({
      cases: {
        findRenewalCandidates: vi
          .fn()
          .mockResolvedValue([
            { id: 'pol-1', customerId: 'cust-1', expiryDate: new Date() },
          ]),
        create: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('dupe', {
            code: 'P2002',
            clientVersion: 'x',
          }),
        ),
      },
    });
    const result = await deps.service.runSweep(ACTOR);
    expect(result).toMatchObject({
      opened: 0,
      skippedAlreadyOpen: 1,
      failed: 0,
    });
  });

  it('isolates a failing row so one bad policy never aborts the sweep', async () => {
    const deps = makeDeps({
      cases: {
        findRenewalCandidates: vi.fn().mockResolvedValue([
          { id: 'pol-bad', customerId: 'c', expiryDate: new Date() },
          { id: 'pol-ok', customerId: 'c', expiryDate: new Date() },
        ]),
        create: vi
          .fn()
          .mockRejectedValueOnce(new Error('db blew up'))
          .mockResolvedValue({
            id: 'rc-2',
            policyId: 'pol-ok',
            status: 'RENEWAL_DUE',
            leadTimeDays: 90,
            riskChangedSinceLastRenewal: false,
            insurerTermsWorsened: false,
          }),
      },
    });
    const result = await deps.service.runSweep(ACTOR);
    expect(result).toMatchObject({ scanned: 2, opened: 1, failed: 1 });
  });

  it('still opens the case when the SLA timer fails — the case row is authoritative', async () => {
    const deps = makeDeps({
      cases: {
        findRenewalCandidates: vi
          .fn()
          .mockResolvedValue([
            { id: 'pol-1', customerId: 'cust-1', expiryDate: new Date() },
          ]),
      },
    });
    deps.sla.startTimer.mockRejectedValueOnce(new Error('sla down'));
    const result = await deps.service.runSweep(ACTOR);
    expect(result.opened).toBe(1);
  });

  it('skips the timer for a policy with no expiry date rather than throwing', async () => {
    const deps = makeDeps({
      cases: {
        findRenewalCandidates: vi
          .fn()
          .mockResolvedValue([
            { id: 'pol-1', customerId: 'cust-1', expiryDate: null },
          ]),
        findByPolicyId: vi.fn().mockResolvedValue(
          caseRow({
            policy: { ...caseRow().policy, expiryDate: null },
          }),
        ),
      },
    });
    const result = await deps.service.runSweep(ACTOR);
    expect(result.opened).toBe(1);
    expect(deps.sla.startTimer).not.toHaveBeenCalled();
  });
});

describe('RenewalService.transition', () => {
  it('moves the status ONLY through the workflow engine', async () => {
    const deps = makeDeps();
    await deps.service.transition('rc-1', 'IN_PROGRESS', ACTOR);
    expect(deps.workflow.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'RenewalCase',
        entityId: 'rc-1',
        toStatus: 'IN_PROGRESS',
      }),
    );
  });

  it('is idempotent when the case is already in the target status', async () => {
    const deps = makeDeps();
    await deps.service.transition('rc-1', 'RENEWAL_DUE', ACTOR);
    expect(deps.workflow.transition).not.toHaveBeenCalled();
  });

  it('resolves the renewal SLA timer once the case reaches a terminal status', async () => {
    const deps = makeDeps();
    await deps.service.transition('rc-1', 'RENEWED', ACTOR);
    expect(deps.sla.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'renewal_workflow_start' }),
    );
  });

  it('leaves the timer open while the case is still live work', async () => {
    const deps = makeDeps();
    await deps.service.transition('rc-1', 'QUOTES_OBTAINED', ACTOR);
    expect(deps.sla.resolve).not.toHaveBeenCalled();
  });

  it('404s an unknown case', async () => {
    const deps = makeDeps({
      cases: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      deps.service.transition('nope', 'IN_PROGRESS', ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RenewalService.setFlags', () => {
  it('records the re-marketing trigger with a before/after audit row', async () => {
    const deps = makeDeps();
    await deps.service.setFlags(
      'rc-1',
      { riskChangedSinceLastRenewal: true },
      ACTOR,
    );
    expect(deps.cases.updateFlags).toHaveBeenCalledWith('rc-1', {
      riskChangedSinceLastRenewal: true,
    });
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'RenewalCase',
        action: 'UPDATE',
      }),
    );
  });

  it('422s when neither flag is supplied', async () => {
    const deps = makeDeps();
    await expect(
      deps.service.setFlags('rc-1', {}, ACTOR),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422s once the case has concluded — a closed renewal is not re-marketed', async () => {
    const deps = makeDeps({
      cases: {
        findById: vi.fn().mockResolvedValue(caseRow({ status: 'RENEWED' })),
      },
    });
    await expect(
      deps.service.setFlags('rc-1', { insurerTermsWorsened: true }, ACTOR),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
