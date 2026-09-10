import { describe, expect, it } from 'vitest';
import {
  aggregateOutcome,
  bandFor,
  buildIdempotencyKey,
} from './provider-screening.service';
import type { ProviderScreeningResult } from '../screening-providers/screening-provider.types';

function result(
  outcome: ProviderScreeningResult['outcome'],
  candidateCount = 0,
): ProviderScreeningResult {
  return {
    outcome,
    candidates: Array.from({ length: candidateCount }, (_, i) => ({
      providerEntityId: `e-${i}`,
      entityName: 'SOMEBODY',
      entityType: 'individual' as const,
      listType: 'SANCTIONS' as const,
      score: 0.9,
      matchedAttributes: ['name' as const],
      sourceList: 'TEST',
    })),
    provider: 'built_in',
    providerName: 'test',
    correlationId: 'c',
    durationMs: 1,
  };
}

describe('aggregating outcomes across the subjects of one KYC file', () => {
  // The precedence is the safe direction at every step. A KYC file covers the
  // customer AND every UBO; if even one of them could not be screened, the
  // FILE has not been screened.

  it('one unscreenable subject makes the whole file unscreenable', () => {
    // The failure this ordering exists to prevent: reporting a customer clear
    // because their other UBOs came back clean.
    expect(
      aggregateOutcome([result('NO_MATCH'), result('SCREENING_FAILED')]),
    ).toBe('SCREENING_FAILED');
    expect(
      aggregateOutcome([result('NO_MATCH'), result('NOT_CONFIGURED')]),
    ).toBe('NOT_CONFIGURED');
    expect(
      aggregateOutcome([result('NO_MATCH'), result('UNABLE_TO_SCREEN')]),
    ).toBe('UNABLE_TO_SCREEN');
  });

  it('an unresolved subject outranks even a potential match', () => {
    // Both escalate, but the reason matters: "we found something" and "we
    // could not look" call for different follow-up.
    expect(
      aggregateOutcome([
        result('POTENTIAL_MATCH', 1),
        result('SCREENING_FAILED'),
      ]),
    ).toBe('SCREENING_FAILED');
  });

  it('a potential match outranks a clear one', () => {
    expect(
      aggregateOutcome([result('NO_MATCH'), result('POTENTIAL_MATCH', 1)]),
    ).toBe('POTENTIAL_MATCH');
  });

  it('every subject clear is the only route to NO_MATCH', () => {
    expect(aggregateOutcome([result('NO_MATCH'), result('NO_MATCH')])).toBe(
      'NO_MATCH',
    );
  });

  it('no subjects at all is UNABLE_TO_SCREEN, not a vacuous clear', () => {
    // An empty subject set means nothing was checked. Returning NO_MATCH here
    // would be the emptiest possible false assurance.
    expect(aggregateOutcome([])).toBe('UNABLE_TO_SCREEN');
  });
});

describe('threshold banding', () => {
  const thresholds = { high: 0.9, review: 0.7, low: 0.5 };

  it('bands by the CONFIGURED values, not a hard-coded figure', () => {
    expect(bandFor(0.95, thresholds)).toBe('high');
    expect(bandFor(0.9, thresholds)).toBe('high'); // inclusive
    expect(bandFor(0.8, thresholds)).toBe('review');
    expect(bandFor(0.7, thresholds)).toBe('review'); // inclusive
    expect(bandFor(0.6, thresholds)).toBe('below');
  });

  it('follows a different configuration', () => {
    const strict = { high: 0.99, review: 0.95, low: 0.9 };
    expect(bandFor(0.95, strict)).toBe('review');
    expect(bandFor(0.8, strict)).toBe('below');
  });

  it('a review threshold of 0 queues everything', () => {
    expect(bandFor(0, { high: 1, review: 0, low: 0 })).toBe('review');
  });
});

describe('idempotency key', () => {
  const subjects = [
    {
      subjectRef: 'a',
      fullName: 'Ahmad Al Hashimi',
      entityType: 'individual' as const,
    },
    {
      subjectRef: 'b',
      fullName: 'Acme Ltd',
      entityType: 'organization' as const,
    },
  ];

  it('is stable for the same screening', () => {
    const a = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
    });
    const b = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
    });
    expect(a).toBe(b);
  });

  it('ignores subject ORDER — the same people are the same screening', () => {
    const forward = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
    });
    const reversed = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects: [...subjects].reverse(),
      provider: 'built_in',
      dataset: null,
    });
    expect(forward).toBe(reversed);
  });

  it('changes when the SUBJECTS change — a new UBO is a new screening', () => {
    const withExtra = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects: [
        ...subjects,
        {
          subjectRef: 'c',
          fullName: 'New Person',
          entityType: 'individual' as const,
        },
      ],
      provider: 'built_in',
      dataset: null,
    });
    const without = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
    });
    expect(withExtra).not.toBe(without);
  });

  it('changes when the PROVIDER changes — a different source is a different answer', () => {
    expect(
      buildIdempotencyKey({
        kycRecordId: 'kyc-1',
        subjects,
        provider: 'built_in',
        dataset: null,
      }),
    ).not.toBe(
      buildIdempotencyKey({
        kycRecordId: 'kyc-1',
        subjects,
        provider: 'commercial',
        dataset: null,
      }),
    );
  });

  it('changes when the DATASET changes', () => {
    expect(
      buildIdempotencyKey({
        kycRecordId: 'kyc-1',
        subjects,
        provider: 'on_premise',
        dataset: 'default',
      }),
    ).not.toBe(
      buildIdempotencyKey({
        kycRecordId: 'kyc-1',
        subjects,
        provider: 'on_premise',
        dataset: 'sanctions-only',
      }),
    );
  });

  it('does NOT expose the screened names — they are Highly Confidential', () => {
    // The key sits in a queryable column. It must not be a readable list of
    // the people screened; the KYC id stays in the clear so the row is still
    // traceable to its file.
    const key = buildIdempotencyKey({
      kycRecordId: 'kyc-1',
      subjects,
      provider: 'built_in',
      dataset: null,
    });
    expect(key).toMatch(/^kyc-1:[0-9a-f]{32}$/);
    expect(key).not.toContain('Ahmad');
    expect(key).not.toContain('Acme');
  });
});
