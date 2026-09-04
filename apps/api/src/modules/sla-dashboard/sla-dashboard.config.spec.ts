import { describe, expect, it } from 'vitest';
import {
  baseWorkflowName,
  buildSlaDashboardSummary,
  buildSlaTimerRows,
  classifyTimer,
  computeDueSoonCutoff,
  deriveSlaTimerRow,
  hasSensitiveEntityType,
  SLA_DASHBOARD_DUE_SOON_WINDOW,
  type SlaTimerLike,
} from './sla-dashboard.config';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const CUTOFF = computeDueSoonCutoff(NOW); // NOW + 3 calendar days

function timer(over: Partial<SlaTimerLike> = {}): SlaTimerLike {
  return {
    id: 'timer-1',
    entityType: 'Complaint',
    entityId: 'ent-1',
    workflowName: 'complaint_resolution',
    dueAt: new Date(NOW.getTime() + 10 * DAY),
    escalatedAt: null,
    escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
    resolvedAt: null,
    createdAt: new Date(NOW.getTime() - 5 * DAY),
    ...over,
  };
}

describe('classifyTimer', () => {
  it('on_track — unresolved, due well beyond the due-soon window', () => {
    expect(classifyTimer(timer(), NOW, CUTOFF)).toBe('on_track');
  });

  it('due_soon — unresolved, due inside the window but not yet past', () => {
    expect(
      classifyTimer(
        timer({ dueAt: new Date(NOW.getTime() + 2 * DAY) }),
        NOW,
        CUTOFF,
      ),
    ).toBe('due_soon');
  });

  it('breached — unresolved, dueAt at or before now, not escalated', () => {
    expect(
      classifyTimer(timer({ dueAt: NOW }), NOW, CUTOFF), // boundary: dueAt == now
    ).toBe('breached');
    expect(
      classifyTimer(
        timer({ dueAt: new Date(NOW.getTime() - DAY) }),
        NOW,
        CUTOFF,
      ),
    ).toBe('breached');
  });

  it('escalated — unresolved with escalatedAt set, regardless of dueAt', () => {
    expect(
      classifyTimer(
        timer({
          dueAt: new Date(NOW.getTime() - 20 * DAY),
          escalatedAt: new Date(NOW.getTime() - 10 * DAY),
        }),
        NOW,
        CUTOFF,
      ),
    ).toBe('escalated');
  });

  it('resolved_on_time — resolvedAt on or before the deadline (boundary: equal)', () => {
    const dueAt = new Date(NOW.getTime() - 3 * DAY);
    expect(
      classifyTimer(timer({ dueAt, resolvedAt: dueAt }), NOW, CUTOFF),
    ).toBe('resolved_on_time');
    expect(
      classifyTimer(
        timer({ dueAt, resolvedAt: new Date(dueAt.getTime() - DAY) }),
        NOW,
        CUTOFF,
      ),
    ).toBe('resolved_on_time');
  });

  it('resolved_late — resolvedAt strictly after the deadline (even by 1ms)', () => {
    const dueAt = new Date(NOW.getTime() - 3 * DAY);
    expect(
      classifyTimer(
        timer({ dueAt, resolvedAt: new Date(dueAt.getTime() + 1) }),
        NOW,
        CUTOFF,
      ),
    ).toBe('resolved_late');
  });
});

describe('baseWorkflowName', () => {
  it('strips a ::stage suffix', () => {
    expect(baseWorkflowName('dsr_access_deletion::general_manager')).toBe(
      'dsr_access_deletion',
    );
  });
  it('leaves an unsuffixed name unchanged', () => {
    expect(baseWorkflowName('complaint_resolution')).toBe(
      'complaint_resolution',
    );
  });
});

describe('deriveSlaTimerRow', () => {
  it('keeps the raw workflowName, derives the base, and pulls registry facts', () => {
    const row = deriveSlaTimerRow(
      timer({
        workflowName: 'complaint_resolution',
        dueAt: new Date(NOW.getTime() - 2 * DAY),
        createdAt: new Date(NOW.getTime() - 12 * DAY),
      }),
      NOW,
      CUTOFF,
    );
    expect(row.workflowName).toBe('complaint_resolution');
    expect(row.baseWorkflowName).toBe('complaint_resolution');
    expect(row.label).toBe('Customer complaint resolution');
    expect(row.drafted).toBe(true); // DRAFT, UNSOURCED citation
    expect(row.state).toBe('breached');
    expect(row.overdueDays).toBe(2);
    expect(row.ageDays).toBe(12);
  });

  it('falls back to the raw name for a workflow not in the registry', () => {
    const row = deriveSlaTimerRow(
      timer({ workflowName: 'legacy_workflow', entityType: 'Widget' }),
      NOW,
      CUTOFF,
    );
    expect(row.label).toBe('legacy_workflow');
    expect(row.drafted).toBe(false);
    expect(row.overdueDays).toBeNull(); // on_track
  });

  it('overdueDays is the lateness of a late close, null for an on-time close', () => {
    const dueAt = new Date(NOW.getTime() - 10 * DAY);
    expect(
      deriveSlaTimerRow(
        timer({ dueAt, resolvedAt: new Date(dueAt.getTime() + 4 * DAY) }),
        NOW,
        CUTOFF,
      ).overdueDays,
    ).toBe(4);
    expect(
      deriveSlaTimerRow(
        timer({ dueAt, resolvedAt: new Date(dueAt.getTime() - DAY) }),
        NOW,
        CUTOFF,
      ).overdueDays,
    ).toBeNull();
  });
});

describe('buildSlaTimerRows', () => {
  const rows = [
    timer({ id: 'on', dueAt: new Date(NOW.getTime() + 10 * DAY) }),
    timer({ id: 'soon', dueAt: new Date(NOW.getTime() + 2 * DAY) }),
    timer({ id: 'br-new', dueAt: new Date(NOW.getTime() - DAY) }),
    timer({ id: 'br-old', dueAt: new Date(NOW.getTime() - 9 * DAY) }),
    timer({
      id: 'esc',
      dueAt: new Date(NOW.getTime() - 12 * DAY),
      escalatedAt: new Date(NOW.getTime() - 2 * DAY),
    }),
    timer({
      id: 'done',
      dueAt: new Date(NOW.getTime() - 3 * DAY),
      resolvedAt: new Date(NOW.getTime() - 4 * DAY),
    }),
  ];

  it('worst-first: escalated, then breached (oldest deadline first), then due_soon, then on_track', () => {
    const out = buildSlaTimerRows({ timers: rows, now: NOW });
    expect(out.map((r) => r.id)).toEqual([
      'esc',
      'br-old',
      'br-new',
      'soon',
      'on',
      'done',
    ]);
  });

  it('a leaf state filter returns only that state', () => {
    const out = buildSlaTimerRows({
      timers: rows,
      now: NOW,
      state: 'escalated',
    });
    expect(out.map((r) => r.id)).toEqual(['esc']);
  });

  it('the open_breached group filter returns breached + escalated only', () => {
    const out = buildSlaTimerRows({
      timers: rows,
      now: NOW,
      state: 'open_breached',
    });
    expect(new Set(out.map((r) => r.id))).toEqual(
      new Set(['esc', 'br-old', 'br-new']),
    );
  });

  it('the open group filter excludes both resolved states', () => {
    const out = buildSlaTimerRows({ timers: rows, now: NOW, state: 'open' });
    expect(out.some((r) => r.id === 'done')).toBe(false);
    expect(out).toHaveLength(5);
  });
});

describe('buildSlaDashboardSummary', () => {
  it('stamps generatedAt and echoes the due-soon window', () => {
    const s = buildSlaDashboardSummary([], NOW);
    expect(s.generatedAt).toBe(NOW.toISOString());
    expect(s.dueSoonWindow).toEqual(SLA_DASHBOARD_DUE_SOON_WINDOW);
    expect(s.totals.total).toBe(0);
    expect(s.totals.breachRate).toBe('0.0000');
  });

  it('groups the two stage rows of one entity into a single workflow row (total 2, entityCount 1)', () => {
    const s = buildSlaDashboardSummary(
      [
        timer({
          id: 't1',
          entityType: 'DataSubjectRequest',
          entityId: 'dsr-1',
          workflowName: 'dsr_access_deletion::data_protection_officer',
          dueAt: new Date(NOW.getTime() - 6 * DAY),
        }),
        timer({
          id: 't2',
          entityType: 'DataSubjectRequest',
          entityId: 'dsr-1',
          workflowName: 'dsr_access_deletion::general_manager',
          dueAt: new Date(NOW.getTime() - 3 * DAY),
        }),
      ],
      NOW,
    );
    expect(s.byWorkflow).toHaveLength(1);
    const wf = s.byWorkflow[0];
    expect(wf.workflowName).toBe('dsr_access_deletion');
    expect(wf.label).toBe('DSR — Access / Deletion');
    expect(wf.drafted).toBe(false);
    expect(wf.configuredDuration).toEqual({ value: 15, unit: 'businessDays' });
    expect(wf.total).toBe(2);
    expect(wf.breached).toBe(2);
    expect(wf.openBreached).toBe(2);
    expect(wf.entityCount).toBe(1);
    expect(wf.oldestOverdueDays).toBe(6);
  });

  it('falls back to the raw name for an unregistered workflow', () => {
    const s = buildSlaDashboardSummary(
      [timer({ workflowName: 'legacy_thing', entityType: 'Widget' })],
      NOW,
    );
    expect(s.byWorkflow[0].label).toBe('legacy_thing');
    expect(s.byWorkflow[0].configuredDuration).toBeNull();
    expect(s.byWorkflow[0].drafted).toBe(false);
  });

  it('sorts byWorkflow worst-first (openBreached desc, then oldest overdue desc)', () => {
    const s = buildSlaDashboardSummary(
      [
        timer({
          id: 'a',
          workflowName: 'consent_withdrawal',
          entityType: 'ConsentRecord',
          dueAt: new Date(NOW.getTime() + 30 * DAY),
        }),
        timer({
          id: 'b',
          workflowName: 'complaint_resolution',
          dueAt: new Date(NOW.getTime() - 2 * DAY),
        }),
        timer({
          id: 'c',
          workflowName: 'complaint_resolution',
          entityId: 'ent-2',
          dueAt: new Date(NOW.getTime() - 5 * DAY),
        }),
      ],
      NOW,
    );
    expect(s.byWorkflow.map((w) => w.workflowName)).toEqual([
      'complaint_resolution', // openBreached 2
      'consent_withdrawal', // openBreached 0
    ]);
  });

  it('breachRate = (late + breached + escalated) / (that + on-time), 4dp', () => {
    const dueAt = new Date(NOW.getTime() - 4 * DAY);
    const s = buildSlaDashboardSummary(
      [
        timer({ id: 'ot', dueAt, resolvedAt: new Date(dueAt.getTime() - DAY) }),
        timer({ id: 'lt', dueAt, resolvedAt: new Date(dueAt.getTime() + DAY) }),
        timer({ id: 'br', dueAt }),
        // an on_track timer must NOT dilute the rate (not yet concluded)
        timer({ id: 'on', dueAt: new Date(NOW.getTime() + 20 * DAY) }),
      ],
      NOW,
    );
    // denom = 1 on-time + 1 late + 1 breached = 3 ; num = 1 late + 1 breached = 2
    expect(s.totals.breachRate).toBe('0.6667');
    expect(s.totals.total).toBe(4);
    expect(s.totals.onTrack).toBe(1);
  });

  it('byEscalationTarget groups by target (null bucket for a stage with no target) and counts open / openBreached', () => {
    const s = buildSlaDashboardSummary(
      [
        timer({
          id: 'm1',
          escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
          dueAt: new Date(NOW.getTime() - 2 * DAY),
        }),
        timer({
          id: 'm2',
          escalatedTo: 'BRANCH_DEPARTMENT_MANAGER',
          dueAt: new Date(NOW.getTime() + 20 * DAY),
        }),
        timer({
          id: 'n1',
          workflowName: 'consent_withdrawal',
          entityType: 'ConsentRecord',
          escalatedTo: null,
          dueAt: new Date(NOW.getTime() - DAY),
        }),
      ],
      NOW,
    );
    const mgr = s.byEscalationTarget.find(
      (r) => r.escalatedTo === 'BRANCH_DEPARTMENT_MANAGER',
    );
    expect(mgr).toMatchObject({ open: 2, openBreached: 1 });
    const none = s.byEscalationTarget.find((r) => r.escalatedTo === null);
    expect(none).toMatchObject({ open: 1, openBreached: 1 });
  });
});

describe('hasSensitiveEntityType', () => {
  it('true when an entity type that names a data subject is present', () => {
    for (const et of [
      'Complaint',
      'DataSubjectRequest',
      'ConsentRecord',
      'DataSharingApproval',
      'KYCRecord',
      'Claim',
      'IncidentReport',
      'LegalHold',
    ]) {
      expect(hasSensitiveEntityType([timer({ entityType: et })])).toBe(true);
    }
  });
  it('false for internal-governance timers that name no data subject', () => {
    expect(
      hasSensitiveEntityType([
        timer({ entityType: 'Vendor' }),
        timer({ entityType: 'AccessRecertificationCycle' }),
        timer({ entityType: 'DisposalBatch' }),
        timer({ entityType: 'RenewalCase' }),
      ]),
    ).toBe(false);
  });
});
