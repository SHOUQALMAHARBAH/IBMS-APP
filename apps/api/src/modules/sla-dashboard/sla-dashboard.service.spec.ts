import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { SlaDashboardService } from './sla-dashboard.service';
import {
  SLA_DASHBOARD_TIMER_LIMIT,
  type SlaTimerLike,
} from './sla-dashboard.config';
import type { SlaDashboardRepository } from '../../repositories/sla-dashboard.repository';
import type { AuditService } from '../audit/audit.service';

const NOW_MS = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function timer(over: Partial<SlaTimerLike> = {}): SlaTimerLike {
  return {
    id: `timer-${Math.random().toString(36).slice(2)}`,
    entityType: 'ServiceRequest',
    entityId: 'ent-1',
    workflowName: 'service_request_fulfilment',
    dueAt: new Date(NOW_MS - 3 * DAY),
    escalatedAt: null,
    escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
    resolvedAt: null,
    createdAt: new Date(NOW_MS - 10 * DAY),
    ...over,
  };
}

function makeService(rows: SlaTimerLike[] = []) {
  const repo = {
    loadTimers: vi.fn().mockResolvedValue(rows),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new SlaDashboardService(
    repo as unknown as SlaDashboardRepository,
    audit as unknown as AuditService,
  );
  return { service, repo, audit };
}

describe('SlaDashboardService.summary (Process 43)', () => {
  it('aggregates the loaded timers and returns the summary shape', async () => {
    const { service } = makeService([
      timer({ entityType: 'Complaint', workflowName: 'complaint_resolution' }),
      timer({
        entityType: 'Complaint',
        workflowName: 'complaint_resolution',
        entityId: 'ent-2',
        dueAt: new Date(NOW_MS + 30 * DAY),
      }),
    ]);

    const s = await service.summary('user-1');

    expect(s.totals.total).toBe(2);
    expect(s.totals.breached).toBe(1);
    expect(s.byWorkflow[0].workflowName).toBe('complaint_resolution');
    expect(typeof s.generatedAt).toBe('string');
  });

  it('writes a best-effort READ audit row flagged sensitive when a DSR / complaint timer is present', async () => {
    const { service, audit } = makeService([
      timer({ entityType: 'Complaint', workflowName: 'complaint_resolution' }),
    ]);

    await service.summary('user-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'SlaDashboard',
        entityId: 'summary',
        isSensitiveDataAccess: true,
      }),
    );
    const arg = audit.record.mock.calls[0]?.[0] as {
      afterValue: Record<string, unknown>;
    };
    expect(arg.afterValue).toMatchObject({
      view: 'sla-dashboard-summary',
      timers: 1,
    });
    // the sensitive flag lives on the column, never duplicated into afterValue
    expect(arg.afterValue).not.toHaveProperty('sensitive');
  });

  it('does NOT flag sensitive for purely operational timers, and a failed audit never breaks the read', async () => {
    const { service, audit } = makeService([
      timer({ entityType: 'Vendor', workflowName: 'vendor_annual_review' }),
    ]);
    audit.record.mockRejectedValueOnce(new Error('audit down'));

    const s = await service.summary('user-1');

    expect(s.totals.total).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ isSensitiveDataAccess: false }),
    );
  });

  it('warns when the loaded set hits the row cap', async () => {
    const rows = Array.from({ length: SLA_DASHBOARD_TIMER_LIMIT }, () =>
      timer(),
    );
    const { service } = makeService(rows);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      await service.summary('user-1');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('truncated at'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('SlaDashboardService.timers (Process 43)', () => {
  it('defaults to the "open" state group and forwards entityType / workflowName prefix to the repo', async () => {
    const { service, repo } = makeService([
      timer({ dueAt: new Date(NOW_MS - 2 * DAY) }), // breached -> in "open"
      timer({
        resolvedAt: new Date(NOW_MS - DAY),
        dueAt: new Date(NOW_MS - 2 * DAY),
      }), // resolved -> excluded from "open"
    ]);

    const rows = await service.timers(
      {
        entityType: 'ServiceRequest',
        workflowName: 'service_request_fulfilment',
      },
      'user-1',
    );

    expect(repo.loadTimers).toHaveBeenCalledWith({
      entityType: 'ServiceRequest',
      workflowNamePrefix: 'service_request_fulfilment',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('breached');
  });

  it('honours an explicit leaf state filter and records it in the READ audit', async () => {
    const { service, audit } = makeService([
      timer({
        id: 'esc',
        dueAt: new Date(NOW_MS - 8 * DAY),
        escalatedAt: new Date(NOW_MS - DAY),
      }),
      timer({ id: 'br', dueAt: new Date(NOW_MS - 2 * DAY) }),
    ]);

    const rows = await service.timers({ state: 'escalated' }, 'user-1');

    expect(rows.map((r) => r.id)).toEqual(['esc']);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ',
        entityType: 'SlaDashboard',
        entityId: 'timers',
      }),
    );
    const arg = audit.record.mock.calls[0]?.[0] as {
      afterValue: { filters: Record<string, unknown> };
    };
    expect(arg.afterValue.filters).toMatchObject({ state: 'escalated' });
  });
});
