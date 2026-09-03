import { describe, expect, it } from 'vitest';
import { getSlaRegistryEntry, SLA_REGISTRY } from './sla-registry.config';

// The 14 SLA types named in ibms-brain/meta/lex/pdpl-sla-timers.md's
// registry table — a completeness check so a future accidental removal (or
// typo'd rename) of a row is caught here rather than silently shrinking the
// registry below what backlog A.8 requires ("wired to every SLA type").
const EXPECTED_PDPL_WORKFLOW_NAMES = [
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

// Backlog Part C #3-4's two KYC/EDD review workflows — deliberately NOT part
// of the PDPL-sourced 14 above (see the DRAFT/UNSOURCED citation on each in
// sla-registry.config.ts); kept as a separate list so the PDPL-completeness
// check above stays a precise match to pdpl-sla-timers.md, not a moving
// target every time a non-PDPL SLA is added to this same generic engine.
const EXPECTED_NON_PDPL_WORKFLOW_NAMES = [
  'kyc_standard_review',
  'kyc_edd_review',
  'service_request_fulfilment',
  'complaint_resolution',
].sort();

describe('SLA_REGISTRY', () => {
  it('has exactly the 14 PDPL-sourced workflow types named in pdpl-sla-timers.md, plus the drafted non-PDPL ones', () => {
    expect([...SLA_REGISTRY.map((e) => e.workflowName)].sort()).toEqual(
      [
        ...EXPECTED_PDPL_WORKFLOW_NAMES,
        ...EXPECTED_NON_PDPL_WORKFLOW_NAMES,
      ].sort(),
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

  it('EDD review carries a longer duration than the standard KYC review (backlog Part C #3-4 "a separate, longer SLA")', () => {
    const standard = getSlaRegistryEntry('kyc_standard_review');
    const edd = getSlaRegistryEntry('kyc_edd_review');
    expect(standard.duration.unit).toBe('businessDays');
    expect(edd.duration.unit).toBe('businessDays');
    expect(edd.duration.value).toBeGreaterThan(standard.duration.value);
  });

  it('marks every non-PDPL entry as drafted/unsourced, unlike the 14 PDPL rows', () => {
    for (const workflowName of EXPECTED_NON_PDPL_WORKFLOW_NAMES) {
      expect(getSlaRegistryEntry(workflowName).citation).toMatch(
        /DRAFT, UNSOURCED/,
      );
    }
    for (const workflowName of EXPECTED_PDPL_WORKFLOW_NAMES) {
      expect(getSlaRegistryEntry(workflowName).citation).not.toMatch(
        /DRAFT, UNSOURCED/,
      );
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
