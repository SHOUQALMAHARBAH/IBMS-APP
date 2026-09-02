import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import { AWAITING_INSURER_STATUSES } from '../../repositories/claim.repository';
import {
  CLAIM_AWAITING_INSURER_STATUSES,
  CLAIM_DOC_TYPES,
  CLAIM_LARGE_THRESHOLD_JOD,
  CLAIM_SETTLEABLE_STATUSES,
  DEFAULT_CLAIM_FOLLOWUP_THRESHOLD_DAYS,
  computeNetSettlement,
  deriveSettlementView,
  isSecondApproverRequired,
  settlementAuditSnapshot,
  adjusterAssessmentAuditSnapshot,
  adjusterAuditSnapshot,
  buildDocumentChecklist,
  claimDocumentAuditSnapshot,
  claimFollowUpAlertAuditSnapshot,
  claimNotificationAuditSnapshot,
  claimRegistrationAuditSnapshot,
  classifyInsuranceLine,
  coverageGapMessage,
  deriveAssessmentView,
  deriveFollowUpView,
  followUpThresholdDaysFor,
  isAssessmentConcluded,
  isClaimFollowUpDue,
  isLargeClaim,
  mandatoryDocTypesFor,
  resolveCoverageAtLossDate,
  thirdPartyClaimantAuditSnapshot,
} from './claim.config';

const d = (iso: string) => new Date(iso);

/** inception 2026-01-01, endorsed 2026-06-01, expiry 2027-01-01 */
const ENDORSED_SCHEDULES = [
  {
    id: 'sched-v1',
    effectiveFrom: d('2026-01-01T00:00:00.000Z'),
    effectiveTo: d('2026-06-01T00:00:00.000Z'),
  },
  {
    id: 'sched-v2',
    effectiveFrom: d('2026-06-01T00:00:00.000Z'),
    effectiveTo: null as Date | null,
  },
];
const EXPIRY = d('2027-01-01T00:00:00.000Z');

describe('resolveCoverageAtLossDate', () => {
  it('resolves a loss to the schedule version in force on the day — NOT the current one', () => {
    const before = resolveCoverageAtLossDate({
      schedules: ENDORSED_SCHEDULES,
      expiryDate: EXPIRY,
      lossDate: d('2026-03-15T09:00:00.000Z'),
    });
    expect(before).toEqual({
      ok: true,
      scheduleId: 'sched-v1',
      effectiveFrom: ENDORSED_SCHEDULES[0].effectiveFrom,
      effectiveTo: ENDORSED_SCHEDULES[0].effectiveTo,
    });

    const after = resolveCoverageAtLossDate({
      schedules: ENDORSED_SCHEDULES,
      expiryDate: EXPIRY,
      lossDate: d('2026-09-15T09:00:00.000Z'),
    });
    expect(after).toMatchObject({ ok: true, scheduleId: 'sched-v2' });
  });

  it('treats the version boundary as [from, to) — a loss exactly on the endorsement date belongs to the new version', () => {
    const onBoundary = resolveCoverageAtLossDate({
      schedules: ENDORSED_SCHEDULES,
      expiryDate: EXPIRY,
      lossDate: d('2026-06-01T00:00:00.000Z'),
    });
    expect(onBoundary).toMatchObject({ ok: true, scheduleId: 'sched-v2' });
  });

  it('rejects a loss before cover incepted', () => {
    const r = resolveCoverageAtLossDate({
      schedules: ENDORSED_SCHEDULES,
      expiryDate: EXPIRY,
      lossDate: d('2025-12-20T00:00:00.000Z'),
    });
    expect(r).toEqual({ ok: false, reason: 'before_inception' });
  });

  it('rejects a loss on or after the policy expiry even while the open schedule row stays open', () => {
    const r = resolveCoverageAtLossDate({
      schedules: ENDORSED_SCHEDULES,
      expiryDate: EXPIRY,
      lossDate: d('2027-02-01T00:00:00.000Z'),
    });
    expect(r).toEqual({ ok: false, reason: 'after_cover_ended' });
  });

  it('rejects a loss after a cancellation closed the last version with no successor', () => {
    const cancelled = [
      {
        id: 'sched-v1',
        effectiveFrom: d('2026-01-01T00:00:00.000Z'),
        effectiveTo: d('2026-09-25T00:00:00.000Z'),
      },
    ];
    const r = resolveCoverageAtLossDate({
      schedules: cancelled,
      expiryDate: EXPIRY,
      lossDate: d('2026-10-10T00:00:00.000Z'),
    });
    expect(r).toEqual({ ok: false, reason: 'after_cover_ended' });
  });

  it('reports coverage_gap (not after_cover_ended) for a loss in a hole between two versions', () => {
    const withGap = [
      {
        id: 'sched-v1',
        effectiveFrom: d('2026-01-01T00:00:00.000Z'),
        effectiveTo: d('2026-03-01T00:00:00.000Z'),
      },
      {
        id: 'sched-v2',
        effectiveFrom: d('2026-05-01T00:00:00.000Z'),
        effectiveTo: null as Date | null,
      },
    ];
    const r = resolveCoverageAtLossDate({
      schedules: withGap,
      expiryDate: EXPIRY,
      lossDate: d('2026-04-01T00:00:00.000Z'),
    });
    expect(r).toEqual({ ok: false, reason: 'coverage_gap' });
  });

  it('still resolves a loss that predates the cancellation', () => {
    const cancelled = [
      {
        id: 'sched-v1',
        effectiveFrom: d('2026-01-01T00:00:00.000Z'),
        effectiveTo: d('2026-09-25T00:00:00.000Z'),
      },
    ];
    const r = resolveCoverageAtLossDate({
      schedules: cancelled,
      expiryDate: EXPIRY,
      lossDate: d('2026-05-10T00:00:00.000Z'),
    });
    expect(r).toMatchObject({ ok: true, scheduleId: 'sched-v1' });
  });

  it('reports not_issued when the policy has no schedule at all', () => {
    const r = resolveCoverageAtLossDate({
      schedules: [],
      expiryDate: EXPIRY,
      lossDate: d('2026-05-10T00:00:00.000Z'),
    });
    expect(r).toEqual({ ok: false, reason: 'not_issued' });
  });

  it('does not rely on expiryDate when it is null (windows only)', () => {
    const r = resolveCoverageAtLossDate({
      schedules: ENDORSED_SCHEDULES,
      expiryDate: null,
      lossDate: d('2026-09-15T00:00:00.000Z'),
    });
    expect(r).toMatchObject({ ok: true, scheduleId: 'sched-v2' });
  });
});

describe('coverageGapMessage', () => {
  it('names the expiry date for an after-expiry loss', () => {
    const msg = coverageGapMessage('after_cover_ended', {
      lossDate: d('2027-03-01T00:00:00.000Z'),
      expiryDate: EXPIRY,
    });
    expect(msg).toContain('2027-01-01');
    expect(msg).toContain('cover had ended');
  });

  it('distinguishes a closed-with-no-successor gap from an expiry gap', () => {
    const msg = coverageGapMessage('after_cover_ended', {
      lossDate: d('2026-10-10T00:00:00.000Z'),
      expiryDate: EXPIRY,
    });
    expect(msg).toContain('cancellation');
  });

  it('has a message for before_inception, not_issued and coverage_gap', () => {
    expect(
      coverageGapMessage('before_inception', {
        lossDate: d('2025-12-01T00:00:00.000Z'),
        expiryDate: EXPIRY,
      }),
    ).toContain('before this policy');
    expect(
      coverageGapMessage('not_issued', {
        lossDate: d('2026-01-01T00:00:00.000Z'),
        expiryDate: null,
      }),
    ).toContain('not been issued');
    expect(
      coverageGapMessage('coverage_gap', {
        lossDate: d('2026-04-01T00:00:00.000Z'),
        expiryDate: EXPIRY,
      }),
    ).toContain('does not fall within any coverage-schedule version');
  });
});

describe('isLargeClaim', () => {
  it('is true at or above the drafted threshold, false below', () => {
    expect(isLargeClaim(CLAIM_LARGE_THRESHOLD_JOD)).toBe(true);
    expect(isLargeClaim('25000.001')).toBe(true);
    expect(isLargeClaim('24999.999')).toBe(false);
    expect(isLargeClaim('1000')).toBe(false);
  });

  it('compares by value, not string — trailing zeros do not matter', () => {
    expect(isLargeClaim('25000')).toBe(true);
    expect(isLargeClaim(new Prisma.Decimal('25000.000'))).toBe(true);
  });
});

describe('audit snapshots — metadata not body', () => {
  it('claimNotificationAuditSnapshot carries no free text', () => {
    const snap = claimNotificationAuditSnapshot({
      id: 'claim-1',
      policyId: 'pol-1',
      customerId: 'cus-1',
      status: 'NOTIFIED',
      lossDate: d('2026-05-10T00:00:00.000Z'),
      estimatedLoss: new Prisma.Decimal('20000'),
      isThirdPartyInvolved: true,
      isLargeClaim: false,
      hasLossLocation: true,
      coverageScheduleId: 'sched-v1',
      coverageEffectiveFrom: d('2026-01-01T00:00:00.000Z'),
      coverageEffectiveTo: d('2026-06-01T00:00:00.000Z'),
    });
    expect(snap).toEqual({
      claimId: 'claim-1',
      policyId: 'pol-1',
      customerId: 'cus-1',
      status: 'NOTIFIED',
      lossDate: '2026-05-10T00:00:00.000Z',
      estimatedLoss: '20000.000',
      isThirdPartyInvolved: true,
      isLargeClaim: false,
      hasLossLocation: true,
      coverageScheduleId: 'sched-v1',
      coverageEffectiveFrom: '2026-01-01T00:00:00.000Z',
      coverageEffectiveTo: '2026-06-01T00:00:00.000Z',
    });
  });

  it('thirdPartyClaimantAuditSnapshot carries no name or contact', () => {
    const snap = thirdPartyClaimantAuditSnapshot({
      id: 'tp-1',
      claimId: 'claim-1',
      hasFullName: true,
      hasContactDetails: true,
      subrogationRecoveryFlag: true,
    });
    expect(snap).toEqual({
      thirdPartyClaimantId: 'tp-1',
      claimId: 'claim-1',
      hasFullName: true,
      hasContactDetails: true,
      subrogationRecoveryFlag: true,
    });
  });

  it('adjusterAuditSnapshot carries the adjuster name + firm (a professional service provider, not the claimant)', () => {
    const snap = adjusterAuditSnapshot({
      id: 'adj-1',
      claimId: 'claim-1',
      name: 'Cunningham Lindsey',
      firm: 'CL Loss Adjusters',
      assignedAt: d('2026-05-20T00:00:00.000Z'),
    });
    expect(snap).toEqual({
      adjusterId: 'adj-1',
      claimId: 'claim-1',
      name: 'Cunningham Lindsey',
      firm: 'CL Loss Adjusters',
      assignedAt: '2026-05-20T00:00:00.000Z',
    });
  });

  it('claimRegistrationAuditSnapshot carries the administrative identifiers only', () => {
    expect(
      claimRegistrationAuditSnapshot({
        claimId: 'claim-1',
        insurerClaimReference: 'INS-CLM-2026-0042',
        claimNumber: null,
      }),
    ).toEqual({
      claimId: 'claim-1',
      insurerClaimReference: 'INS-CLM-2026-0042',
      claimNumber: null,
    });
  });
});

describe('classifyInsuranceLine', () => {
  it.each([
    ['Property All Risks', 'property'],
    ['Property', 'property'],
    ['Commercial Property', 'property'],
    ['Householder Property Owners', 'property'],
    ['Fire & Perils', 'property'],
    ['Business Interruption', 'property'],
    ['Motor Fleet', 'motor'],
    ['Comprehensive Vehicle', 'motor'],
    ['Group Medical', 'medical'],
    ['Group Personal Accident', 'medical'],
    ['Public Liability', 'liability'],
    ['Professional Indemnity', 'liability'],
    ['Marine Cargo', 'marine'],
    ['Goods in Transit', 'marine'],
    ['Fidelity Guarantee', 'other'],
    ['Cyber', 'other'],
  ])('classifies %j as %s', (line, family) => {
    expect(classifyInsuranceLine(line)).toBe(family);
  });
});

describe('mandatoryDocTypesFor', () => {
  it('always requires a claim_form', () => {
    expect(
      mandatoryDocTypesFor({
        insuranceLine: 'Cyber',
        isThirdPartyInvolved: false,
      }),
    ).toEqual(['claim_form']);
  });

  it('adds a police_report when a third party is involved', () => {
    expect(
      mandatoryDocTypesFor({
        insuranceLine: 'Cyber',
        isThirdPartyInvolved: true,
      }),
    ).toEqual(['claim_form', 'police_report']);
  });

  it('property → claim_form + photo + repair_estimate (in CLAIM_DOC_TYPES order)', () => {
    expect(
      mandatoryDocTypesFor({
        insuranceLine: 'Property All Risks',
        isThirdPartyInvolved: false,
      }),
    ).toEqual(['claim_form', 'photo', 'repair_estimate']);
  });

  it('motor → claim_form + police_report + photo + repair_estimate', () => {
    expect(
      mandatoryDocTypesFor({
        insuranceLine: 'Motor Fleet',
        isThirdPartyInvolved: false,
      }),
    ).toEqual(['claim_form', 'police_report', 'photo', 'repair_estimate']);
  });

  it('medical → claim_form + medical_report + invoice', () => {
    expect(
      mandatoryDocTypesFor({
        insuranceLine: 'Group Medical',
        isThirdPartyInvolved: false,
      }),
    ).toEqual(['claim_form', 'medical_report', 'invoice']);
  });

  it('liability → claim_form + expert_report', () => {
    expect(
      mandatoryDocTypesFor({
        insuranceLine: 'Public Liability',
        isThirdPartyInvolved: false,
      }),
    ).toEqual(['claim_form', 'expert_report']);
  });

  it('never requires correspondence', () => {
    for (const line of ['Property All Risks', 'Motor Fleet', 'Group Medical']) {
      expect(
        mandatoryDocTypesFor({
          insuranceLine: line,
          isThirdPartyInvolved: true,
        }),
      ).not.toContain('correspondence');
    }
  });
});

describe('buildDocumentChecklist', () => {
  it('marks every CLAIM_DOC_TYPE, derives complete/missing', () => {
    const mandatory = mandatoryDocTypesFor({
      insuranceLine: 'Property All Risks',
      isThirdPartyInvolved: false,
    });
    const r = buildDocumentChecklist(mandatory, ['claim_form', 'photo']);
    expect(r.checklist).toHaveLength(CLAIM_DOC_TYPES.length);
    expect(r.checklist.find((c) => c.docType === 'claim_form')).toEqual({
      docType: 'claim_form',
      required: true,
      present: true,
    });
    expect(r.checklist.find((c) => c.docType === 'repair_estimate')).toEqual({
      docType: 'repair_estimate',
      required: true,
      present: false,
    });
    expect(r.checklist.find((c) => c.docType === 'correspondence')).toEqual({
      docType: 'correspondence',
      required: false,
      present: false,
    });
    expect(r.documentationComplete).toBe(false);
    expect(r.missing).toEqual(['repair_estimate']);
  });

  it('is complete when every required type is present (extra non-required types are fine)', () => {
    const r = buildDocumentChecklist(
      ['claim_form', 'photo'],
      ['claim_form', 'photo', 'correspondence', 'expert_report'],
    );
    expect(r.documentationComplete).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

describe('claimDocumentAuditSnapshot — metadata not body', () => {
  it('carries ids + type + classification, never fileName / storageRef', () => {
    const snap = claimDocumentAuditSnapshot({
      claimDocumentId: 'cd-1',
      documentId: 'doc-1',
      claimId: 'claim-1',
      docType: 'medical_report',
      category: 'CLAIM',
      classification: 'HIGHLY_CONFIDENTIAL',
      uploadedByUserId: 'u-1',
    });
    expect(snap).toEqual({
      claimDocumentId: 'cd-1',
      documentId: 'doc-1',
      claimId: 'claim-1',
      docType: 'medical_report',
      category: 'CLAIM',
      classification: 'HIGHLY_CONFIDENTIAL',
      uploadedByUserId: 'u-1',
    });
  });
});

describe('isAssessmentConcluded', () => {
  it('is true for the three verdicts and beyond, false before', () => {
    for (const s of [
      'APPROVED',
      'PARTIALLY_APPROVED',
      'DECLINED',
      'SETTLED',
      'CLOSED',
    ]) {
      expect(isAssessmentConcluded(s)).toBe(true);
    }
    for (const s of [
      'NOTIFIED',
      'REGISTERED',
      'DOCUMENTATION_IN_PROGRESS',
      'UNDER_ASSESSMENT',
    ]) {
      expect(isAssessmentConcluded(s)).toBe(false);
    }
  });
});

describe('deriveAssessmentView', () => {
  const survey = d('2026-05-10T00:00:00.000Z');
  const investigation = d('2026-05-12T00:00:00.000Z');

  it('readyForAssessment only when DOCUMENTATION_IN_PROGRESS and docs complete', () => {
    expect(
      deriveAssessmentView({
        status: 'DOCUMENTATION_IN_PROGRESS',
        documentationComplete: true,
        surveyCompletedAt: null,
        investigationCompletedAt: null,
      }).readyForAssessment,
    ).toBe(true);
    expect(
      deriveAssessmentView({
        status: 'DOCUMENTATION_IN_PROGRESS',
        documentationComplete: false,
        surveyCompletedAt: null,
        investigationCompletedAt: null,
      }).readyForAssessment,
    ).toBe(false);
    expect(
      deriveAssessmentView({
        status: 'UNDER_ASSESSMENT',
        documentationComplete: true,
        surveyCompletedAt: null,
        investigationCompletedAt: null,
      }).readyForAssessment,
    ).toBe(false);
  });

  it('adjusterWorkComplete needs BOTH stamps', () => {
    expect(
      deriveAssessmentView({
        status: 'UNDER_ASSESSMENT',
        documentationComplete: true,
        surveyCompletedAt: survey,
        investigationCompletedAt: null,
      }).adjusterWorkComplete,
    ).toBe(false);
    expect(
      deriveAssessmentView({
        status: 'UNDER_ASSESSMENT',
        documentationComplete: true,
        surveyCompletedAt: survey,
        investigationCompletedAt: investigation,
      }).adjusterWorkComplete,
    ).toBe(true);
  });

  it('outcome is the status once it is a verdict, else null', () => {
    expect(
      deriveAssessmentView({
        status: 'UNDER_ASSESSMENT',
        documentationComplete: true,
        surveyCompletedAt: survey,
        investigationCompletedAt: investigation,
      }).outcome,
    ).toBeNull();
    expect(
      deriveAssessmentView({
        status: 'PARTIALLY_APPROVED',
        documentationComplete: true,
        surveyCompletedAt: survey,
        investigationCompletedAt: investigation,
      }).outcome,
    ).toBe('PARTIALLY_APPROVED');
    // SETTLED is past the verdict — outcome is not re-derived from it
    expect(
      deriveAssessmentView({
        status: 'SETTLED',
        documentationComplete: true,
        surveyCompletedAt: survey,
        investigationCompletedAt: investigation,
      }).outcome,
    ).toBeNull();
  });
});

describe('adjusterAssessmentAuditSnapshot — metadata not body', () => {
  it('carries ids + the two ISO timestamps, no claim narrative', () => {
    expect(
      adjusterAssessmentAuditSnapshot({
        adjusterId: 'adj-1',
        claimId: 'claim-1',
        surveyCompletedAt: d('2026-05-10T09:00:00.000Z'),
        investigationCompletedAt: null,
      }),
    ).toEqual({
      adjusterId: 'adj-1',
      claimId: 'claim-1',
      surveyCompletedAt: '2026-05-10T09:00:00.000Z',
      investigationCompletedAt: null,
    });
  });
});

describe('CLAIM_AWAITING_INSURER_STATUSES', () => {
  it('stays in sync with the repo copy (AWAITING_INSURER_STATUSES) — the two are hand-duplicated to avoid a repo->module import', () => {
    expect([...CLAIM_AWAITING_INSURER_STATUSES].sort()).toEqual(
      [...AWAITING_INSURER_STATUSES].sort(),
    );
  });

  it('is exactly the three pre-verdict statuses', () => {
    expect([...CLAIM_AWAITING_INSURER_STATUSES].sort()).toEqual([
      'DOCUMENTATION_IN_PROGRESS',
      'REGISTERED',
      'UNDER_ASSESSMENT',
    ]);
  });
});

describe('followUpThresholdDaysFor (Process 27 — drafted per-line)', () => {
  it.each([
    ['Motor Fleet', 7],
    ['Comprehensive Vehicle', 7],
    ['Property All Risks', 10],
    ['Fire & Perils', 10],
    ['Group Medical', 7],
    ['Public Liability', 15],
    ['Professional Indemnity', 15],
    ['Marine Cargo', 15],
    ['Fidelity Guarantee', DEFAULT_CLAIM_FOLLOWUP_THRESHOLD_DAYS],
    ['Cyber', DEFAULT_CLAIM_FOLLOWUP_THRESHOLD_DAYS],
  ])('maps %j -> %i business days', (line, days) => {
    expect(followUpThresholdDaysFor(line)).toBe(days);
  });

  it('the neutral default is the Part 3.7 worked-example figure (9)', () => {
    expect(DEFAULT_CLAIM_FOLLOWUP_THRESHOLD_DAYS).toBe(9);
  });
});

describe('isClaimFollowUpDue', () => {
  // Thu 1 Jan 2026 (Jordan weekend = Fri/Sat) + 2 business days -> Mon 5 Jan.
  const REGISTERED_THURSDAY = d('2026-01-01T09:00:00.000Z');

  it('false before the whole business-day window has elapsed', () => {
    expect(
      isClaimFollowUpDue(REGISTERED_THURSDAY, 2, d('2026-01-04T12:00:00Z')),
    ).toBe(false);
  });

  it('true once the window has elapsed', () => {
    expect(
      isClaimFollowUpDue(REGISTERED_THURSDAY, 2, d('2026-01-05T09:00:00Z')),
    ).toBe(true);
  });

  it('a non-positive / malformed threshold never auto-alerts', () => {
    const now = d('2026-02-01T00:00:00Z');
    expect(isClaimFollowUpDue(REGISTERED_THURSDAY, 0, now)).toBe(false);
    expect(isClaimFollowUpDue(REGISTERED_THURSDAY, -1, now)).toBe(false);
    expect(isClaimFollowUpDue(REGISTERED_THURSDAY, Number.NaN, now)).toBe(
      false,
    );
  });
});

describe('deriveFollowUpView', () => {
  const REG = d('2026-05-01T00:00:00.000Z');
  const A = (id: string, resolvedAt: Date | null) => ({
    id,
    triggeredAt: d('2026-05-15T00:00:00.000Z'),
    resolvedAt,
  });

  it('followUpAlertOpen is true iff some alert has no resolvedAt', () => {
    expect(
      deriveFollowUpView({
        status: 'UNDER_ASSESSMENT',
        followUpAlertThresholdDays: 10,
        registeredAt: REG,
        alerts: [A('a1', d('2026-05-20T00:00:00.000Z'))],
      }).followUpAlertOpen,
    ).toBe(false);
    expect(
      deriveFollowUpView({
        status: 'UNDER_ASSESSMENT',
        followUpAlertThresholdDays: 10,
        registeredAt: REG,
        alerts: [A('a1', d('2026-05-20T00:00:00.000Z')), A('a2', null)],
      }).followUpAlertOpen,
    ).toBe(true);
  });

  it('awaitingInsurerResponse is true only for the pre-verdict statuses', () => {
    for (const status of [
      'REGISTERED',
      'DOCUMENTATION_IN_PROGRESS',
      'UNDER_ASSESSMENT',
    ]) {
      expect(
        deriveFollowUpView({
          status,
          followUpAlertThresholdDays: 10,
          registeredAt: REG,
          alerts: [],
        }).awaitingInsurerResponse,
      ).toBe(true);
    }
    for (const status of [
      'NOTIFIED',
      'APPROVED',
      'DECLINED',
      'SETTLED',
      'CLOSED',
    ]) {
      expect(
        deriveFollowUpView({
          status,
          followUpAlertThresholdDays: 10,
          registeredAt: REG,
          alerts: [],
        }).awaitingInsurerResponse,
      ).toBe(false);
    }
  });

  it('passes through the threshold + clock start', () => {
    const v = deriveFollowUpView({
      status: 'REGISTERED',
      followUpAlertThresholdDays: 15,
      registeredAt: REG,
      alerts: [],
    });
    expect(v.followUpAlertThresholdDays).toBe(15);
    expect(v.awaitingInsurerSince).toBe(REG);
    expect(v.followUpAlerts).toEqual([]);
  });
});

describe('claimFollowUpAlertAuditSnapshot — metadata not body', () => {
  it('raise: ids + threshold + clock timestamps only', () => {
    expect(
      claimFollowUpAlertAuditSnapshot({
        claimFollowUpAlertId: 'fa-1',
        claimId: 'claim-1',
        triggeredAt: d('2026-05-15T00:00:00.000Z'),
        resolvedAt: null,
        thresholdDays: 10,
        registeredAt: d('2026-05-01T00:00:00.000Z'),
      }),
    ).toEqual({
      claimFollowUpAlertId: 'fa-1',
      claimId: 'claim-1',
      triggeredAt: '2026-05-15T00:00:00.000Z',
      resolvedAt: null,
      thresholdDays: 10,
      registeredAt: '2026-05-01T00:00:00.000Z',
    });
  });

  it('resolve: omits the raise context, records who resolved it', () => {
    expect(
      claimFollowUpAlertAuditSnapshot({
        claimFollowUpAlertId: 'fa-1',
        claimId: 'claim-1',
        triggeredAt: d('2026-05-15T00:00:00.000Z'),
        resolvedAt: d('2026-05-25T00:00:00.000Z'),
        resolvedBy: 'manual',
      }),
    ).toEqual({
      claimFollowUpAlertId: 'fa-1',
      claimId: 'claim-1',
      triggeredAt: '2026-05-15T00:00:00.000Z',
      resolvedAt: '2026-05-25T00:00:00.000Z',
      resolvedBy: 'manual',
    });
  });
});

describe('Process 28 — settlement', () => {
  it('CLAIM_SETTLEABLE_STATUSES is exactly the two SETTLED predecessors', () => {
    expect([...CLAIM_SETTLEABLE_STATUSES].sort()).toEqual([
      'APPROVED',
      'PARTIALLY_APPROVED',
    ]);
  });

  it('computeNetSettlement = approved - deductible, quantized (the worked example)', () => {
    expect(computeNetSettlement('17500', '2500').toString()).toBe('15000');
    expect(computeNetSettlement('17500.005', '2500').toString()).toBe(
      '15000.005',
    );
    // deductible == approved -> net 0 (allowed)
    expect(computeNetSettlement('5000', '5000').isZero()).toBe(true);
  });

  it('isSecondApproverRequired: true at/above the large threshold on the APPROVED amount', () => {
    expect(
      isSecondApproverRequired({
        approvedAmount: CLAIM_LARGE_THRESHOLD_JOD,
        brokerProcessedPayment: false,
      }),
    ).toBe(true);
    expect(
      isSecondApproverRequired({
        approvedAmount: '24999.999',
        brokerProcessedPayment: false,
      }),
    ).toBe(false);
  });

  it('isSecondApproverRequired: true for any broker-processed payment regardless of amount', () => {
    expect(
      isSecondApproverRequired({
        approvedAmount: '100.000',
        brokerProcessedPayment: true,
      }),
    ).toBe(true);
  });

  it('deriveSettlementView returns null with no settlement, otherwise the money strings + re-derived gate', () => {
    expect(
      deriveSettlementView({ status: 'APPROVED', settlement: null }),
    ).toBeNull();

    const v = deriveSettlementView({
      status: 'APPROVED',
      settlement: {
        estimatedLoss: new Prisma.Decimal('20000'),
        approvedAmount: new Prisma.Decimal('30000'),
        deductible: new Prisma.Decimal('2500'),
        netSettlement: new Prisma.Decimal('27500'),
        brokerProcessedPayment: false,
        approvedByUserId: 'u-1',
        secondApproverUserId: null,
        createdAt: d('2026-06-01T00:00:00.000Z'),
      },
    });
    expect(v).toMatchObject({
      estimatedLoss: '20000.000',
      approvedAmount: '30000.000',
      deductible: '2500.000',
      netSettlement: '27500.000',
      secondApproverRequired: true, // 30000 >= 25000
      settled: false,
      approvedByUserId: 'u-1',
      secondApproverUserId: null,
    });
  });

  it('deriveSettlementView.settled is true once the claim is SETTLED', () => {
    const v = deriveSettlementView({
      status: 'SETTLED',
      settlement: {
        estimatedLoss: new Prisma.Decimal('1000'),
        approvedAmount: new Prisma.Decimal('900'),
        deductible: new Prisma.Decimal('0'),
        netSettlement: new Prisma.Decimal('900'),
        brokerProcessedPayment: false,
        approvedByUserId: 'u-1',
        secondApproverUserId: null,
        createdAt: d('2026-06-01T00:00:00.000Z'),
      },
    });
    expect(v?.settled).toBe(true);
    expect(v?.secondApproverRequired).toBe(false);
  });

  it('settlementAuditSnapshot carries the four figures as fixed strings, no narrative', () => {
    const snap = settlementAuditSnapshot({
      settlementId: 's-1',
      claimId: 'claim-1',
      estimatedLoss: new Prisma.Decimal('20000'),
      approvedAmount: new Prisma.Decimal('17500'),
      deductible: new Prisma.Decimal('2500'),
      netSettlement: new Prisma.Decimal('15000'),
      brokerProcessedPayment: true,
      approvedByUserId: 'u-1',
      secondApproverUserId: 'u-2',
      secondApproverRequired: true,
    });
    expect(snap).toEqual({
      settlementId: 's-1',
      claimId: 'claim-1',
      estimatedLoss: '20000.000',
      approvedAmount: '17500.000',
      deductible: '2500.000',
      netSettlement: '15000.000',
      brokerProcessedPayment: true,
      approvedByUserId: 'u-1',
      secondApproverUserId: 'u-2',
      secondApproverRequired: true,
    });
  });
});
