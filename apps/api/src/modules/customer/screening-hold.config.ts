import type { ScreeningAttemptOutcome } from '../screening-providers/screening-provider.types';

/**
 * WHETHER A SCREENING RESULT MAY HOLD UP A WORKFLOW, and how hard.
 *
 * ## The gap this closes
 *
 * Before this, `KycService.decide()` asked only whether `ScreeningResult` rows
 * EXISTED. A file whose screening came back `NOT_CONFIGURED` has rows — three
 * of them, all `PENDING_INVESTIGATION` — so it passed that check and could be
 * approved with nothing anywhere recording that the customer was never
 * actually screened. The rows said "pending investigation" and no code read
 * them.
 *
 * A screening control that produces a state nothing consumes is documentation,
 * not a control. This is the consumer.
 *
 * ## Three levels, and why not two
 *
 *  * `NO_HOLD` — screening ran against a populated source and found nothing.
 *  * `REVIEW_REQUIRED` — the workflow may proceed, but only on an explicit,
 *    written, attributed acceptance by a compliance user. Not a checkbox: the
 *    reason is stored and audited, and the approval is refused without it.
 *  * `BLOCKED` — the workflow may not proceed through this path at all.
 *
 * Two levels would collapse "somebody must look at this and say why they are
 * satisfied" into either "warn and continue" (which is ignored) or "refuse"
 * (which gets worked around outside the system). The middle level is the one
 * that produces a record.
 *
 * ## Provenance — this is OPERATIONAL POLICY, not cited law
 *
 * No level here is presented as legally mandated, and none carries a
 * regulatory citation, because none was supplied to this repository. These are
 * the deployment's own control settings; the defaults were chosen to fail
 * toward review rather than toward silent approval, and every one is
 * configurable per deployment — except two floors.
 *
 * The two floors cannot be configured DOWN:
 *
 *  * `NEVER_SCREENED` is always `BLOCKED`. Approving a customer nobody ever
 *    screened is not a judgement a written reason can carry, because there is
 *    no finding to reason about.
 *  * `CONFIRMED_SANCTIONS_MATCH` is always `BLOCKED`. A human reviewer has
 *    already looked at that candidate and recorded, in writing, that it is a
 *    true match against a sanctions list. Letting a second person wave that
 *    through on a text field would make the review queue decorative.
 *
 * Everything else may be configured in either direction, and a deployment that
 * wants a confirmed PEP match to block outright can say so.
 *
 * A PEP match defaults to `REVIEW_REQUIRED` rather than `BLOCKED` because
 * political exposure is a risk classification that drives enhanced diligence
 * rather than a prohibition on dealing — a distinction this codebase already
 * makes elsewhere (`KYCRecord.isEdd`). That is a stated default, not a claim
 * about what any regulator requires.
 */

export type ScreeningHoldLevel = 'NO_HOLD' | 'REVIEW_REQUIRED' | 'BLOCKED';

/** Every distinct reason a hold can arise. Named rather than free text so the
 * UI, the tests and the configuration all refer to the same thing. */
export type ScreeningHoldCondition =
  | 'NEVER_SCREENED'
  | 'CONFIRMED_SANCTIONS_MATCH'
  | 'CONFIRMED_PEP_MATCH'
  | 'CONFIRMED_WATCHLIST_MATCH'
  | 'PENDING_MATCH_REVIEW'
  | 'UNRESOLVED_SCREENING'
  | 'POTENTIAL_MATCH'
  | 'SCREENING_STALE';

const LEVEL_RANK: Readonly<Record<ScreeningHoldLevel, number>> = {
  NO_HOLD: 0,
  REVIEW_REQUIRED: 1,
  BLOCKED: 2,
};

/** Conditions whose level is a floor the configuration may raise but not
 * lower. See the header for why each one is here. */
export const NON_RELAXABLE: Readonly<
  Partial<Record<ScreeningHoldCondition, ScreeningHoldLevel>>
> = {
  NEVER_SCREENED: 'BLOCKED',
  CONFIRMED_SANCTIONS_MATCH: 'BLOCKED',
};

export const DEFAULT_HOLD_POLICY: Readonly<
  Record<ScreeningHoldCondition, ScreeningHoldLevel>
> = {
  NEVER_SCREENED: 'BLOCKED',
  CONFIRMED_SANCTIONS_MATCH: 'BLOCKED',
  CONFIRMED_PEP_MATCH: 'REVIEW_REQUIRED',
  CONFIRMED_WATCHLIST_MATCH: 'REVIEW_REQUIRED',
  PENDING_MATCH_REVIEW: 'REVIEW_REQUIRED',
  UNRESOLVED_SCREENING: 'REVIEW_REQUIRED',
  POTENTIAL_MATCH: 'REVIEW_REQUIRED',
  SCREENING_STALE: 'REVIEW_REQUIRED',
};

/** The env var that configures each condition. Named per condition so a
 * deployment reads as a policy statement rather than a flag soup. */
export const HOLD_ENV: Readonly<Record<ScreeningHoldCondition, string>> = {
  NEVER_SCREENED: 'SCREENING_HOLD_NEVER_SCREENED',
  CONFIRMED_SANCTIONS_MATCH: 'SCREENING_HOLD_CONFIRMED_SANCTIONS',
  CONFIRMED_PEP_MATCH: 'SCREENING_HOLD_CONFIRMED_PEP',
  CONFIRMED_WATCHLIST_MATCH: 'SCREENING_HOLD_CONFIRMED_WATCHLIST',
  PENDING_MATCH_REVIEW: 'SCREENING_HOLD_PENDING_REVIEW',
  UNRESOLVED_SCREENING: 'SCREENING_HOLD_UNRESOLVED',
  POTENTIAL_MATCH: 'SCREENING_HOLD_POTENTIAL_MATCH',
  SCREENING_STALE: 'SCREENING_HOLD_STALE',
};

/** How old a screening may be before it stops counting as current, in days.
 * `0` disables the staleness condition entirely, which is the default: no
 * sourced re-screening cadence exists in this repository, and inventing one
 * would be exactly the kind of unsourced figure Part A exists to prevent. */
export const STALE_AFTER_DAYS_ENV = 'SCREENING_STALE_AFTER_DAYS';
export const DEFAULT_STALE_AFTER_DAYS = 0;

export interface ScreeningHoldPolicy {
  levels: Readonly<Record<ScreeningHoldCondition, ScreeningHoldLevel>>;
  staleAfterDays: number;
  /** Settings that named a level this code does not know, or tried to relax a
   * floor. Surfaced rather than swallowed: a typo in a control setting
   * silently falling back to the default is how a deployment believes it
   * configured something it did not. */
  invalid: string[];
}

function parseLevel(raw: string): ScreeningHoldLevel | null {
  const value = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return value === 'NO_HOLD' ||
    value === 'REVIEW_REQUIRED' ||
    value === 'BLOCKED'
    ? value
    : null;
}

/** Read the policy from the environment. Unset means the default; an
 * unparseable value means the default AND a reported problem. */
export function loadHoldPolicy(
  env: NodeJS.ProcessEnv = process.env,
): ScreeningHoldPolicy {
  const invalid: string[] = [];
  const levels = {} as Record<ScreeningHoldCondition, ScreeningHoldLevel>;

  for (const condition of Object.keys(
    DEFAULT_HOLD_POLICY,
  ) as ScreeningHoldCondition[]) {
    const name = HOLD_ENV[condition];
    const raw = env[name];
    let level = DEFAULT_HOLD_POLICY[condition];

    if (raw !== undefined && raw.trim() !== '') {
      const parsed = parseLevel(raw);
      if (parsed === null) {
        invalid.push(
          `${name}="${raw}" is not one of NO_HOLD, REVIEW_REQUIRED, BLOCKED — using ${level}.`,
        );
      } else {
        level = parsed;
      }
    }

    const floor = NON_RELAXABLE[condition];
    if (floor && LEVEL_RANK[level] < LEVEL_RANK[floor]) {
      invalid.push(
        `${name} cannot be relaxed below ${floor} — the configured value ${level} was ignored.`,
      );
      level = floor;
    }
    levels[condition] = level;
  }

  const rawStale = env[STALE_AFTER_DAYS_ENV];
  let staleAfterDays = DEFAULT_STALE_AFTER_DAYS;
  if (rawStale !== undefined && rawStale.trim() !== '') {
    // The WHOLE string must be an integer. `Number.parseInt` alone accepts a
    // numeric prefix, so "1.5.2" would quietly become a 1-day window and
    // "30d" a 30-day one — a control setting silently meaning something other
    // than what was written. Rejected and reported instead.
    const trimmed = rawStale.trim();
    const parsed = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) {
      staleAfterDays = parsed;
    } else {
      invalid.push(
        `${STALE_AFTER_DAYS_ENV}="${rawStale}" is not a non-negative integer — staleness checking stays off.`,
      );
    }
  }

  return { levels, staleAfterDays, invalid };
}

/** What the evaluator is given. Deliberately plain data: the caller reads the
 * database, this decides, and the decision is testable without one. */
export interface ScreeningHoldFacts {
  /** Attempt outcomes across every `ScreeningResult` on the file. Empty means
   * screening never ran. */
  attemptOutcomes: readonly (ScreeningAttemptOutcome | null)[];
  /** `ScreeningMatch` rows on the file. */
  matches: readonly {
    status: string;
    listType: 'SANCTIONS' | 'PEP' | 'WATCHLIST';
  }[];
  /** When the most recent screening ran. Null when none has. */
  lastScreenedAt: Date | null;
  now?: Date;
}

export interface ScreeningHoldReason {
  condition: ScreeningHoldCondition;
  level: ScreeningHoldLevel;
  /** Operator-facing, and free of subject PII — a hold reason is read by
   * people who may not hold `isSensitiveDataAccess` (sensitive-data-handling
   * .md: identifiers, not names). */
  detail: string;
}

export interface ScreeningHoldEvaluation {
  level: ScreeningHoldLevel;
  reasons: ScreeningHoldReason[];
  /** True when a written, attributed acceptance can let the workflow proceed.
   * False for `BLOCKED` — and false for `NO_HOLD`, where there is nothing to
   * release. */
  releasable: boolean;
}

const UNRESOLVED: readonly ScreeningAttemptOutcome[] = [
  'NOT_CONFIGURED',
  'SCREENING_FAILED',
  'UNABLE_TO_SCREEN',
];

/**
 * Evaluate the hold on one KYC file.
 *
 * Worst-condition-wins, and every applicable condition is reported rather than
 * only the worst — a reviewer releasing a hold needs to see everything they
 * are accepting, not just the headline.
 */
export function evaluateScreeningHold(
  facts: ScreeningHoldFacts,
  policy: ScreeningHoldPolicy,
): ScreeningHoldEvaluation {
  const reasons: ScreeningHoldReason[] = [];
  const add = (condition: ScreeningHoldCondition, detail: string) => {
    const level = policy.levels[condition];
    if (level === 'NO_HOLD') return; // configured off, deliberately
    reasons.push({ condition, level, detail });
  };

  if (facts.attemptOutcomes.length === 0) {
    // Reported and returned immediately: with no attempt there is nothing for
    // the other conditions to be about, and listing them would imply findings
    // that do not exist.
    const level = policy.levels.NEVER_SCREENED;
    return {
      level,
      reasons:
        level === 'NO_HOLD'
          ? []
          : [
              {
                condition: 'NEVER_SCREENED',
                level,
                detail:
                  'No screening has been performed on this file. There is no result to accept.',
              },
            ],
      releasable: level === 'REVIEW_REQUIRED',
    };
  }

  const unresolved = facts.attemptOutcomes.filter(
    (o): o is ScreeningAttemptOutcome => o !== null && UNRESOLVED.includes(o),
  );
  if (unresolved.length > 0) {
    const distinct = [...new Set(unresolved)].sort().join(', ');
    add(
      'UNRESOLVED_SCREENING',
      `Screening did not produce a usable answer (${distinct}). This customer has NOT been cleared — the check did not complete.`,
    );
  }

  if (facts.attemptOutcomes.some((o) => o === 'POTENTIAL_MATCH')) {
    add(
      'POTENTIAL_MATCH',
      'The provider returned at least one potential match above the review threshold.',
    );
  }

  const confirmed = facts.matches.filter((m) => m.status === 'confirmed');
  const confirmedSanctions = confirmed.filter(
    (m) => m.listType === 'SANCTIONS',
  ).length;
  if (confirmedSanctions > 0) {
    add(
      'CONFIRMED_SANCTIONS_MATCH',
      `A reviewer has confirmed ${confirmedSanctions} sanctions match(es) on this file.`,
    );
  }
  if (confirmed.some((m) => m.listType === 'PEP')) {
    add(
      'CONFIRMED_PEP_MATCH',
      'A reviewer has confirmed a politically-exposed-person match on this file.',
    );
  }
  if (confirmed.some((m) => m.listType === 'WATCHLIST')) {
    add(
      'CONFIRMED_WATCHLIST_MATCH',
      'A reviewer has confirmed a watchlist match on this file.',
    );
  }

  const pending = facts.matches.filter((m) => m.status === 'pending').length;
  if (pending > 0) {
    add(
      'PENDING_MATCH_REVIEW',
      `${pending} screening match(es) are still awaiting review. Work the review queue before deciding this file.`,
    );
  }

  if (policy.staleAfterDays > 0 && facts.lastScreenedAt) {
    const ageDays =
      ((facts.now ?? new Date()).getTime() - facts.lastScreenedAt.getTime()) /
      86_400_000;
    if (ageDays > policy.staleAfterDays) {
      add(
        'SCREENING_STALE',
        `The most recent screening is ${Math.floor(ageDays)} days old, past the configured ${policy.staleAfterDays}-day limit. Re-screen before deciding this file.`,
      );
    }
  }

  const level = reasons.reduce<ScreeningHoldLevel>(
    (worst, r) => (LEVEL_RANK[r.level] > LEVEL_RANK[worst] ? r.level : worst),
    'NO_HOLD',
  );

  return {
    level,
    // Worst first: the reason that decides the outcome should be the one read.
    reasons: reasons.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]),
    releasable: level === 'REVIEW_REQUIRED',
  };
}

/** A one-line summary for an operator or an error message. */
export function describeHold(evaluation: ScreeningHoldEvaluation): string {
  if (evaluation.level === 'NO_HOLD') return 'No screening hold.';
  return `${evaluation.level}: ${evaluation.reasons.map((r) => r.detail).join(' ')}`;
}
