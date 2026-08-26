import { describe, expect, it } from 'vitest';
import {
  allowedNextStatuses,
  isWorkflowTransitionAllowed,
  WORKFLOW_TRANSITIONS,
  WorkflowEntityType,
} from './workflow-transitions.config';

// One row per entity in backlog A.6 / ibms-brain/meta/lex/
// workflow-state-transitions.md's entity list, table-driven so adding a
// twelfth workflow entity without a WORKFLOW_TRANSITIONS entry fails loudly
// here instead of only at the TypeScript Record<Status, ...> level.
const entityTypes: WorkflowEntityType[] = [
  'Opportunity',
  'RFQInsurer',
  'Policy',
  'Endorsement',
  'Claim',
  'Complaint',
  'RenewalCase',
  'Invoice',
  'DataSubjectRequest',
  'IncidentReport',
  'DisposalBatch',
  'Lead',
];

describe('WORKFLOW_TRANSITIONS', () => {
  it.each(entityTypes)('%s has a transition map entry', (entityType) => {
    expect(WORKFLOW_TRANSITIONS[entityType]).toBeDefined();
  });

  it.each(entityTypes)(
    '%s: every listed target status is itself a key (no dangling target)',
    (entityType) => {
      const map = WORKFLOW_TRANSITIONS[entityType] as Record<
        string,
        readonly string[]
      >;
      const knownStatuses = new Set(Object.keys(map));
      for (const [from, targets] of Object.entries(map)) {
        for (const target of targets) {
          expect(
            knownStatuses.has(target),
            `${entityType}.${from} lists "${target}" as reachable, but "${target}" is not a key in the map`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(entityTypes)(
    '%s: at least one terminal state exists',
    (entityType) => {
      const map = WORKFLOW_TRANSITIONS[entityType] as Record<
        string,
        readonly string[]
      >;
      const hasTerminal = Object.values(map).some(
        (targets) => targets.length === 0,
      );
      expect(hasTerminal).toBe(true);
    },
  );

  it.each(entityTypes)('%s: no status transitions to itself', (entityType) => {
    const map = WORKFLOW_TRANSITIONS[entityType] as Record<
      string,
      readonly string[]
    >;
    for (const [from, targets] of Object.entries(map)) {
      expect(targets).not.toContain(from);
    }
  });
});

describe('isWorkflowTransitionAllowed', () => {
  // Spot checks against the cited sources in workflow-transitions.config.ts,
  // not a restatement of the whole map — the completeness/no-dangling-target
  // tests above already cover full-map shape.
  it('allows Opportunity NEEDS_CONFIRMED -> RFQ_ISSUED (policy-lifecycle.md)', () => {
    expect(
      isWorkflowTransitionAllowed(
        'Opportunity',
        'NEEDS_CONFIRMED',
        'RFQ_ISSUED',
      ),
    ).toBe(true);
  });

  it('rejects Opportunity NEEDS_CONFIRMED -> PLACEMENT (skips the whole flow)', () => {
    expect(
      isWorkflowTransitionAllowed(
        'Opportunity',
        'NEEDS_CONFIRMED',
        'PLACEMENT',
      ),
    ).toBe(false);
  });

  it('allows Opportunity RENEGOTIATE -> RFQ_ISSUED (loops back to re-market)', () => {
    expect(
      isWorkflowTransitionAllowed('Opportunity', 'RENEGOTIATE', 'RFQ_ISSUED'),
    ).toBe(true);
  });

  it('rejects any move out of a terminal Opportunity status', () => {
    expect(
      isWorkflowTransitionAllowed('Opportunity', 'PLACEMENT', 'CLOSED_LOST'),
    ).toBe(false);
  });

  it('allows Policy DISCREPANCY -> CHECKING_IN_PROGRESS (re-check loop, policy-lifecycle.md)', () => {
    expect(
      isWorkflowTransitionAllowed(
        'Policy',
        'DISCREPANCY',
        'CHECKING_IN_PROGRESS',
      ),
    ).toBe(true);
  });

  it('rejects Policy DISCREPANCY -> DELIVERED (a discrepancy blocks delivery)', () => {
    expect(
      isWorkflowTransitionAllowed('Policy', 'DISCREPANCY', 'DELIVERED'),
    ).toBe(false);
  });

  it('rejects Claim DECLINED -> SETTLED (a decline has no settlement)', () => {
    expect(isWorkflowTransitionAllowed('Claim', 'DECLINED', 'SETTLED')).toBe(
      false,
    );
  });

  it('allows Claim DECLINED -> CLOSED', () => {
    expect(isWorkflowTransitionAllowed('Claim', 'DECLINED', 'CLOSED')).toBe(
      true,
    );
  });

  it('allows DataSubjectRequest IN_PROGRESS -> PARTIALLY_FULFILLED (M04 open-retention-flag rule)', () => {
    expect(
      isWorkflowTransitionAllowed(
        'DataSubjectRequest',
        'IN_PROGRESS',
        'PARTIALLY_FULFILLED',
      ),
    ).toBe(true);
  });

  it('rejects DataSubjectRequest RECEIVED -> FULFILLED (skips identity verification)', () => {
    expect(
      isWorkflowTransitionAllowed(
        'DataSubjectRequest',
        'RECEIVED',
        'FULFILLED',
      ),
    ).toBe(false);
  });

  it('follows IncidentReport strictly linearly (lex file, verbatim)', () => {
    const chain: Array<
      Parameters<typeof isWorkflowTransitionAllowed<'IncidentReport'>>[1]
    > = [
      'REPORTED',
      'CONTAINED',
      'IMPACT_ASSESSED',
      'CLASSIFIED',
      'NOTIFIED',
      'RECOVERED',
      'CLOSED',
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(
        isWorkflowTransitionAllowed('IncidentReport', chain[i], chain[i + 1]),
      ).toBe(true);
    }
    expect(
      isWorkflowTransitionAllowed('IncidentReport', 'REPORTED', 'CLASSIFIED'),
    ).toBe(false);
  });

  it('follows DisposalBatch strictly linearly (M06 dual-control chain)', () => {
    const chain: Array<
      Parameters<typeof isWorkflowTransitionAllowed<'DisposalBatch'>>[1]
    > = ['NOMINATED', 'MANAGER_APPROVED', 'DPO_APPROVED', 'EXECUTED', 'CLOSED'];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(
        isWorkflowTransitionAllowed('DisposalBatch', chain[i], chain[i + 1]),
      ).toBe(true);
    }
    expect(
      isWorkflowTransitionAllowed('DisposalBatch', 'NOMINATED', 'DPO_APPROVED'),
    ).toBe(false);
  });

  it('allows Lead NEW -> CONTACTED -> QUALIFIED -> CONVERTED_TO_PROSPECT (backlog Part C #1, verbatim)', () => {
    const chain: Array<
      Parameters<typeof isWorkflowTransitionAllowed<'Lead'>>[1]
    > = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED_TO_PROSPECT'];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(isWorkflowTransitionAllowed('Lead', chain[i], chain[i + 1])).toBe(
        true,
      );
    }
  });

  it('allows a Lead to be disqualified right after first contact, not only once qualified', () => {
    expect(isWorkflowTransitionAllowed('Lead', 'NEW', 'DISQUALIFIED')).toBe(
      true,
    );
    expect(
      isWorkflowTransitionAllowed('Lead', 'CONTACTED', 'DISQUALIFIED'),
    ).toBe(true);
  });

  it('rejects Lead NEW -> QUALIFIED (skips CONTACTED)', () => {
    expect(isWorkflowTransitionAllowed('Lead', 'NEW', 'QUALIFIED')).toBe(false);
  });

  it('rejects any move out of a terminal Lead status', () => {
    expect(
      isWorkflowTransitionAllowed(
        'Lead',
        'CONVERTED_TO_PROSPECT',
        'DISQUALIFIED',
      ),
    ).toBe(false);
  });
});

describe('allowedNextStatuses', () => {
  it('returns an empty array for a terminal status', () => {
    expect(allowedNextStatuses('Opportunity', 'PLACEMENT')).toEqual([]);
  });

  it('returns the configured targets for a non-terminal status', () => {
    expect(allowedNextStatuses('DisposalBatch', 'NOMINATED')).toEqual([
      'MANAGER_APPROVED',
    ]);
  });
});
