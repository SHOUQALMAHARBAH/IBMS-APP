import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PiRiskEventService } from './pi-risk-event.service';
import type { PiRiskEventRepository } from '../../repositories/pi-risk-event.repository';
import type { PiPolicyRepository } from '../../repositories/pi-policy.repository';
import type { AuditService } from '../audit/audit.service';

const eventRow = (over: Record<string, unknown> = {}) => ({
  id: 'event-1',
  piPolicyId: 'pi-1',
  sourcePolicyCheckingId: null,
  description: 'A manually observed exposure.',
  mitigationAction: null,
  loggedAt: new Date('2026-09-01T09:00:00.000Z'),
  ...over,
});

const policyRow = (over: Record<string, unknown> = {}) => ({
  id: 'pi-1',
  insurerName: 'Jordan Insurance Co.',
  coverageLimit: '1000000.000',
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  claimsHistorySummary: null,
  ...over,
});

function makeService(
  over: {
    events?: Record<string, unknown>;
    policies?: Record<string, unknown>;
  } = {},
) {
  const events = {
    create: vi.fn().mockResolvedValue(eventRow()),
    findById: vi.fn().mockResolvedValue(eventRow()),
    findMany: vi.fn().mockResolvedValue([eventRow()]),
    updateMitigation: vi.fn().mockResolvedValue(eventRow()),
    ...over.events,
  };
  const policies = {
    findById: vi.fn().mockResolvedValue(policyRow()),
    findCurrent: vi.fn().mockResolvedValue(policyRow()),
    ...over.policies,
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new PiRiskEventService(
    events as unknown as PiRiskEventRepository,
    policies as unknown as PiPolicyRepository,
    audit as unknown as AuditService,
  );
  return { service, events, policies, audit };
}

describe('PiRiskEventService.logManual (Process 54)', () => {
  it('404s an explicit but unknown piPolicyId', async () => {
    const { service } = makeService({
      policies: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.logManual(
        { description: 'x', piPolicyId: 'nope' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses the explicit piPolicyId when given', async () => {
    const { service, events, policies } = makeService();
    await service.logManual(
      { description: 'x', piPolicyId: 'pi-1' },
      'u-compliance',
    );
    expect(policies.findById).toHaveBeenCalledWith('pi-1');
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ piPolicyId: 'pi-1' }),
    );
  });

  it('auto-resolves to the current PI policy when piPolicyId is omitted', async () => {
    const { service, events, policies } = makeService();
    await service.logManual({ description: 'x' }, 'u-compliance');
    expect(policies.findCurrent).toHaveBeenCalled();
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ piPolicyId: 'pi-1' }),
    );
  });

  it('leaves piPolicyId null when none is configured and none is given', async () => {
    const { service, events } = makeService({
      policies: { findCurrent: vi.fn().mockResolvedValue(null) },
    });
    await service.logManual({ description: 'x' }, 'u-compliance');
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ piPolicyId: null }),
    );
  });

  it('audits CREATE', async () => {
    const { service, audit } = makeService();
    await service.logManual({ description: 'x' }, 'u-compliance');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'ProfessionalIndemnityRiskEvent',
      }),
    );
  });

  it('flags linkedPolicyWasLapsedAtLogTime in the audit row when the explicit policy is lapsed (review-fix regression)', async () => {
    const { service, audit } = makeService({
      policies: {
        findById: vi
          .fn()
          .mockResolvedValue(
            policyRow({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
          ),
      },
    });
    await service.logManual(
      { description: 'x', piPolicyId: 'pi-1' },
      'u-compliance',
    );
    const call = audit.record.mock.calls[0]?.[0] as {
      afterValue: { linkedPolicyWasLapsedAtLogTime: boolean };
    };
    expect(call.afterValue.linkedPolicyWasLapsedAtLogTime).toBe(true);
  });

  it('flags linkedPolicyWasLapsedAtLogTime when auto-resolving to a lapsed current policy (review-fix regression)', async () => {
    const { service, audit } = makeService({
      policies: {
        findCurrent: vi
          .fn()
          .mockResolvedValue(
            policyRow({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
          ),
      },
    });
    await service.logManual({ description: 'x' }, 'u-compliance');
    const call = audit.record.mock.calls[0]?.[0] as {
      afterValue: { linkedPolicyWasLapsedAtLogTime: boolean };
    };
    expect(call.afterValue.linkedPolicyWasLapsedAtLogTime).toBe(true);
  });

  it('does not flag linkedPolicyWasLapsedAtLogTime when nothing is configured (no policy to be lapsed)', async () => {
    const { service, audit } = makeService({
      policies: { findCurrent: vi.fn().mockResolvedValue(null) },
    });
    await service.logManual({ description: 'x' }, 'u-compliance');
    const call = audit.record.mock.calls[0]?.[0] as {
      afterValue: { linkedPolicyWasLapsedAtLogTime: boolean };
    };
    expect(call.afterValue.linkedPolicyWasLapsedAtLogTime).toBe(false);
  });
});

describe('PiRiskEventService.recordMitigation (Process 54)', () => {
  it('404s an unknown id', async () => {
    const { service } = makeService({
      events: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.recordMitigation(
        'nope',
        { mitigationAction: 'x' },
        'u-compliance',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates mitigationAction and audits UPDATE', async () => {
    const { service, events, audit } = makeService({
      events: {
        updateMitigation: vi
          .fn()
          .mockResolvedValue(eventRow({ mitigationAction: 'Fixed.' })),
      },
    });
    const v = await service.recordMitigation(
      'event-1',
      { mitigationAction: 'Fixed.' },
      'u-compliance',
    );
    expect(events.updateMitigation).toHaveBeenCalledWith('event-1', 'Fixed.');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE' }),
    );
    expect(v.mitigationAction).toBe('Fixed.');
  });
});

describe('PiRiskEventService reads (Process 54)', () => {
  it('get() 404s an unknown id', async () => {
    const { service } = makeService({
      events: { findById: vi.fn().mockResolvedValue(null) },
    });
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list() passes filters through to the repository', async () => {
    const { service, events } = makeService();
    await service.list({ piPolicyId: 'pi-1' });
    expect(events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ piPolicyId: 'pi-1' }),
      expect.any(Number),
    );
  });
});
