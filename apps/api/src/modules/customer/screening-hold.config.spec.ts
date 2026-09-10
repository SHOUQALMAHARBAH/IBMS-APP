import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOLD_POLICY,
  HOLD_ENV,
  describeHold,
  evaluateScreeningHold,
  loadHoldPolicy,
  type ScreeningHoldFacts,
} from './screening-hold.config';

const policy = loadHoldPolicy({});

/** A file that screened cleanly: one NO_MATCH attempt, no matches. */
const clean: ScreeningHoldFacts = {
  attemptOutcomes: ['NO_MATCH', 'NO_MATCH', 'NO_MATCH'],
  matches: [],
  lastScreenedAt: new Date('2026-09-10T00:00:00Z'),
};

describe('THE GAP THIS CLOSES: an unresolved screening is not a clear one', () => {
  // Before §17 this file had three PENDING_INVESTIGATION ScreeningResult rows
  // and nothing read them, so it approved exactly like a clean one.
  it.each(['NOT_CONFIGURED', 'SCREENING_FAILED', 'UNABLE_TO_SCREEN'] as const)(
    '%s holds the workflow rather than passing it',
    (outcome) => {
      const result = evaluateScreeningHold(
        { ...clean, attemptOutcomes: [outcome, outcome, outcome] },
        policy,
      );
      expect(result.level).toBe('REVIEW_REQUIRED');
      expect(result.reasons[0]?.condition).toBe('UNRESOLVED_SCREENING');
      // Releasable — but only against a written reason, which the service
      // enforces. Never silently.
      expect(result.releasable).toBe(true);
    },
  );

  it('names every distinct unresolved outcome, so a releaser sees all of it', () => {
    const result = evaluateScreeningHold(
      {
        ...clean,
        attemptOutcomes: ['SCREENING_FAILED', 'NOT_CONFIGURED', 'NO_MATCH'],
      },
      policy,
    );
    expect(result.reasons[0]?.detail).toContain('NOT_CONFIGURED');
    expect(result.reasons[0]?.detail).toContain('SCREENING_FAILED');
  });

  it('one unresolved subject holds the file even when the others are clear', () => {
    // The same worst-wins direction `aggregateOutcome` takes: a customer is
    // not clear because their other UBOs came back clean.
    const result = evaluateScreeningHold(
      { ...clean, attemptOutcomes: ['NO_MATCH', 'NO_MATCH', 'NOT_CONFIGURED'] },
      policy,
    );
    expect(result.level).toBe('REVIEW_REQUIRED');
  });
});

describe('a clean file has no hold at all', () => {
  it('NO_MATCH with no matches is NO_HOLD', () => {
    const result = evaluateScreeningHold(clean, policy);
    expect(result.level).toBe('NO_HOLD');
    expect(result.reasons).toEqual([]);
    // Nothing to release — `releasable` is about a hold existing, not about
    // permission.
    expect(result.releasable).toBe(false);
    expect(describeHold(result)).toBe('No screening hold.');
  });
});

describe('the two floors', () => {
  it('a file that was never screened is BLOCKED, not merely reviewable', () => {
    const result = evaluateScreeningHold(
      { attemptOutcomes: [], matches: [], lastScreenedAt: null },
      policy,
    );
    expect(result.level).toBe('BLOCKED');
    expect(result.releasable).toBe(false);
    expect(result.reasons[0]?.condition).toBe('NEVER_SCREENED');
  });

  it('a never-screened file reports ONLY that, not invented findings', () => {
    // With no attempt there is nothing for the other conditions to be about.
    const result = evaluateScreeningHold(
      { attemptOutcomes: [], matches: [], lastScreenedAt: null },
      policy,
    );
    expect(result.reasons).toHaveLength(1);
  });

  it('a CONFIRMED sanctions match is BLOCKED and cannot be released', () => {
    const result = evaluateScreeningHold(
      {
        ...clean,
        matches: [{ status: 'confirmed', listType: 'SANCTIONS' }],
      },
      policy,
    );
    expect(result.level).toBe('BLOCKED');
    expect(result.releasable).toBe(false);
  });

  it.each([
    ['NEVER_SCREENED', HOLD_ENV.NEVER_SCREENED],
    ['CONFIRMED_SANCTIONS_MATCH', HOLD_ENV.CONFIRMED_SANCTIONS_MATCH],
  ])('%s cannot be configured DOWN, and says so', (_condition, envName) => {
    for (const attempt of ['NO_HOLD', 'REVIEW_REQUIRED']) {
      const relaxed = loadHoldPolicy({ [envName]: attempt });
      expect(relaxed.invalid.join(' ')).toContain(envName);
      expect(relaxed.invalid.join(' ')).toContain('cannot be relaxed');
    }
  });

  it('a relaxed floor is IGNORED, not merely reported', () => {
    const relaxed = loadHoldPolicy({
      [HOLD_ENV.CONFIRMED_SANCTIONS_MATCH]: 'NO_HOLD',
    });
    const result = evaluateScreeningHold(
      { ...clean, matches: [{ status: 'confirmed', listType: 'SANCTIONS' }] },
      relaxed,
    );
    expect(result.level).toBe('BLOCKED');
  });
});

describe('matches', () => {
  it('a PENDING match holds the file — work the queue first', () => {
    const result = evaluateScreeningHold(
      { ...clean, matches: [{ status: 'pending', listType: 'SANCTIONS' }] },
      policy,
    );
    expect(result.level).toBe('REVIEW_REQUIRED');
    expect(result.reasons[0]?.condition).toBe('PENDING_MATCH_REVIEW');
    expect(result.reasons[0]?.detail).toContain('1 screening match');
  });

  it('a CLEARED match is not a hold — that is what clearing it meant', () => {
    const result = evaluateScreeningHold(
      { ...clean, matches: [{ status: 'cleared', listType: 'SANCTIONS' }] },
      policy,
    );
    expect(result.level).toBe('NO_HOLD');
  });

  it('a confirmed PEP match defaults to REVIEW_REQUIRED, not BLOCKED', () => {
    // Political exposure drives enhanced diligence rather than a prohibition
    // on dealing. A deployment may configure it up; the default does not.
    const result = evaluateScreeningHold(
      { ...clean, matches: [{ status: 'confirmed', listType: 'PEP' }] },
      policy,
    );
    expect(result.level).toBe('REVIEW_REQUIRED');
    expect(result.releasable).toBe(true);
  });

  it('a confirmed PEP match CAN be configured to block', () => {
    const strict = loadHoldPolicy({
      [HOLD_ENV.CONFIRMED_PEP_MATCH]: 'BLOCKED',
    });
    const result = evaluateScreeningHold(
      { ...clean, matches: [{ status: 'confirmed', listType: 'PEP' }] },
      strict,
    );
    expect(result.level).toBe('BLOCKED');
    expect(result.releasable).toBe(false);
  });

  it('reports EVERY applicable condition, worst first', () => {
    const result = evaluateScreeningHold(
      {
        attemptOutcomes: ['NOT_CONFIGURED'],
        matches: [
          { status: 'pending', listType: 'PEP' },
          { status: 'confirmed', listType: 'SANCTIONS' },
        ],
        lastScreenedAt: new Date('2026-09-10T00:00:00Z'),
      },
      policy,
    );
    expect(result.level).toBe('BLOCKED');
    // A reviewer needs the whole picture, not just the headline.
    const conditions = result.reasons.map((r) => r.condition);
    expect(conditions).toContain('CONFIRMED_SANCTIONS_MATCH');
    expect(conditions).toContain('UNRESOLVED_SCREENING');
    expect(conditions).toContain('PENDING_MATCH_REVIEW');
    expect(result.reasons[0]?.level).toBe('BLOCKED');
  });
});

describe('POTENTIAL_MATCH', () => {
  it('holds the file', () => {
    const result = evaluateScreeningHold(
      { ...clean, attemptOutcomes: ['POTENTIAL_MATCH'] },
      policy,
    );
    expect(result.level).toBe('REVIEW_REQUIRED');
    expect(result.reasons[0]?.condition).toBe('POTENTIAL_MATCH');
  });
});

describe('staleness is OFF unless configured', () => {
  it('defaults to off — no sourced cadence exists to invent one from', () => {
    expect(loadHoldPolicy({}).staleAfterDays).toBe(0);
    const ancient = evaluateScreeningHold(
      {
        ...clean,
        lastScreenedAt: new Date('2020-01-01T00:00:00Z'),
        now: new Date('2026-09-10T00:00:00Z'),
      },
      policy,
    );
    expect(ancient.level).toBe('NO_HOLD');
  });

  it('holds a screening older than the configured limit', () => {
    const configured = loadHoldPolicy({ SCREENING_STALE_AFTER_DAYS: '30' });
    const result = evaluateScreeningHold(
      {
        ...clean,
        lastScreenedAt: new Date('2026-07-01T00:00:00Z'),
        now: new Date('2026-09-10T00:00:00Z'),
      },
      configured,
    );
    expect(result.level).toBe('REVIEW_REQUIRED');
    expect(result.reasons[0]?.condition).toBe('SCREENING_STALE');
    expect(result.reasons[0]?.detail).toContain('30-day');
  });

  it('does not hold one inside the limit', () => {
    const configured = loadHoldPolicy({ SCREENING_STALE_AFTER_DAYS: '30' });
    const result = evaluateScreeningHold(
      {
        ...clean,
        lastScreenedAt: new Date('2026-09-01T00:00:00Z'),
        now: new Date('2026-09-10T00:00:00Z'),
      },
      configured,
    );
    expect(result.level).toBe('NO_HOLD');
  });
});

describe('configuration parsing', () => {
  it('unset means the documented default', () => {
    expect(loadHoldPolicy({}).levels).toEqual(DEFAULT_HOLD_POLICY);
    expect(loadHoldPolicy({}).invalid).toEqual([]);
  });

  it('accepts the level in any reasonable spelling', () => {
    for (const written of [
      'blocked',
      'BLOCKED',
      ' Blocked ',
      'review-required',
    ]) {
      const loaded = loadHoldPolicy({
        [HOLD_ENV.UNRESOLVED_SCREENING]: written,
      });
      expect(loaded.invalid, written).toEqual([]);
    }
    expect(
      loadHoldPolicy({ [HOLD_ENV.UNRESOLVED_SCREENING]: 'review-required' })
        .levels.UNRESOLVED_SCREENING,
    ).toBe('REVIEW_REQUIRED');
  });

  it('REPORTS an unparseable value instead of silently defaulting', () => {
    // A typo in a control setting that falls back quietly is how a deployment
    // believes it configured something it did not.
    const loaded = loadHoldPolicy({
      [HOLD_ENV.UNRESOLVED_SCREENING]: 'ignore',
    });
    expect(loaded.levels.UNRESOLVED_SCREENING).toBe('REVIEW_REQUIRED');
    expect(loaded.invalid).toHaveLength(1);
    expect(loaded.invalid[0]).toContain(HOLD_ENV.UNRESOLVED_SCREENING);
  });

  it('an empty string is "unset", not an error', () => {
    expect(
      loadHoldPolicy({ [HOLD_ENV.UNRESOLVED_SCREENING]: '' }).invalid,
    ).toEqual([]);
  });

  it('rejects a negative or non-numeric staleness window and says so', () => {
    for (const raw of ['-1', 'soon', '1.5.2']) {
      const loaded = loadHoldPolicy({ SCREENING_STALE_AFTER_DAYS: raw });
      expect(loaded.staleAfterDays, raw).toBe(0);
      expect(loaded.invalid.join(' '), raw).toContain(
        'SCREENING_STALE_AFTER_DAYS',
      );
    }
  });

  it('a condition configured to NO_HOLD stops contributing a reason', () => {
    const off = loadHoldPolicy({ [HOLD_ENV.UNRESOLVED_SCREENING]: 'NO_HOLD' });
    const result = evaluateScreeningHold(
      { ...clean, attemptOutcomes: ['SCREENING_FAILED'] },
      off,
    );
    expect(result.level).toBe('NO_HOLD');
    expect(result.reasons).toEqual([]);
  });
});

describe('hold reasons carry no subject PII', () => {
  it('never echoes a matched name', () => {
    // The evaluator is given only statuses and list types — there is no name
    // in its input to leak. This test pins that input shape: adding a name
    // field to the facts would fail to compile here.
    const result = evaluateScreeningHold(
      {
        ...clean,
        matches: [{ status: 'confirmed', listType: 'SANCTIONS' }],
      },
      policy,
    );
    const text = describeHold(result);
    expect(text).toContain('sanctions match');
    expect(text).not.toMatch(/[A-Z][a-z]+ [A-Z][a-z]+/); // no "Firstname Lastname"
  });
});
