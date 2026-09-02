import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import {
  CLAIM_DOC_TYPES,
  CLAIM_LARGE_THRESHOLD_JOD,
  adjusterAuditSnapshot,
  buildDocumentChecklist,
  claimDocumentAuditSnapshot,
  claimNotificationAuditSnapshot,
  claimRegistrationAuditSnapshot,
  classifyInsuranceLine,
  coverageGapMessage,
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
