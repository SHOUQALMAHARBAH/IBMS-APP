import { describe, expect, it } from 'vitest';
import { getSlaRegistryEntry, SLA_REGISTRY } from './sla-registry.config';

// The 14 SLA types named in ibms-brain/meta/lex/pdpl-sla-timers.md's
// registry table — a completeness check so a future accidental removal (or
// typo'd rename) of a row is caught here rather than silently shrinking the
// registry below what backlog A.8 requires ("wired to every SLA type").
const EXPECTED_WORKFLOW_NAMES = [
  'consent_withdrawal',
  'dsr_access_deletion',
  'dsr_correction_objection',
  'termination_access_revocation',
  'quarterly_access_review',
  'disposal_batch_execution',
  'legal_hold_necessity_review',
  'vendor_annual_review',
  'data_sharing_decision',
  'incident_containment',
  'incident_senior_management_notification',
  'dpia_review',
  'renewal_workflow_start',
  'claim_followup_insurer_response',
].sort();

describe('SLA_REGISTRY', () => {
  it('has exactly the 14 workflow types named in pdpl-sla-timers.md', () => {
    expect([...SLA_REGISTRY.map((e) => e.workflowName)].sort()).toEqual(
      EXPECTED_WORKFLOW_NAMES,
    );
  });

  it('has no duplicate workflowName', () => {
    const names = SLA_REGISTRY.map((e) => e.workflowName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every entry a non-empty citation and at least one escalation stage', () => {
    for (const entry of SLA_REGISTRY) {
      expect(entry.citation.length).toBeGreaterThan(0);
      expect(entry.escalationStages.length).toBeGreaterThan(0);
    }
  });

  it('gives the two DSR workflows a T-3-business-day DPO stage before a General Manager stage at the due date', () => {
    for (const workflowName of [
      'dsr_access_deletion',
      'dsr_correction_objection',
    ]) {
      const entry = getSlaRegistryEntry(workflowName);
      expect(entry.escalationStages).toEqual([
        {
          offset: { value: -3, unit: 'businessDays' },
          escalateTo: 'DATA_PROTECTION_OFFICER',
        },
        {
          offset: { value: 0, unit: 'businessDays' },
          escalateTo: 'GENERAL_MANAGER',
        },
      ]);
    }
  });

  it('only data_sharing_decision defines a regulatory-channel override duration', () => {
    for (const entry of SLA_REGISTRY) {
      if (entry.workflowName === 'data_sharing_decision') {
        expect(entry.regulatoryChannelDuration).toEqual({
          value: 1,
          unit: 'businessDays',
        });
      } else {
        expect(entry.regulatoryChannelDuration).toBeUndefined();
      }
    }
  });
});

describe('getSlaRegistryEntry', () => {
  it('throws on an unknown workflow name', () => {
    expect(() => getSlaRegistryEntry('not_a_real_workflow')).toThrow(
      /Unknown SLA workflow/,
    );
  });

  it('returns the matching entry for a known workflow name', () => {
    expect(getSlaRegistryEntry('consent_withdrawal').entityType).toBe(
      'ConsentRecord',
    );
  });
});
