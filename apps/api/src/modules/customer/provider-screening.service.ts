import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@ibms/db';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreeningProviderRegistry } from '../screening-providers/screening-provider.registry';
import { MATCHING_ALGORITHM_VERSION } from '../compliance-risk/watchlist-match.config';
import {
  isClear,
  isUnresolved,
  type ProviderCandidate,
  type ProviderScreeningResult,
  type ScreeningAttemptOutcome,
  type ScreeningSubject,
} from '../screening-providers/screening-provider.types';

export interface ScreeningExecution {
  /** The persisted attempt record. */
  requestId: string;
  correlationId: string;
  outcome: ScreeningAttemptOutcome;
  provider: string;
  providerName: string;
  datasetVersion: string | null;
  failureReason: string | null;
  /** Candidates that cleared the LOW threshold — i.e. everything worth
   * recording, before the review/high banding. */
  candidates: ScoredCandidate[];
  /** True when this execution resumed an earlier identical one instead of
   * calling the provider again. */
  idempotentResume: boolean;
}

export interface ScoredCandidate extends ProviderCandidate {
  subject: ScreeningSubject;
  /** Which band the score fell into. Drives whether a case is opened and at
   * what risk, and is computed from CONFIGURED thresholds. */
  band: 'high' | 'review' | 'below';
}

/**
 * Runs one screening through the configured provider and records what
 * happened.
 *
 * Split from `ScreeningService` because that service owns the KYC-side
 * consequences — risk rating, EDD escalation, the three `ScreeningResult`
 * rows — while this owns the provider interaction, the thresholds, and the
 * attempt record. Keeping them apart is what lets the provider change without
 * touching the compliance decisions built on top of it.
 */
@Injectable()
export class ProviderScreeningService {
  private readonly logger = new Logger(ProviderScreeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ScreeningProviderRegistry,
  ) {}

  /**
   * Screen a set of subjects for one KYC file.
   *
   * IDEMPOTENT. The key is derived from the KYC file, the exact subject set,
   * the provider and the dataset — so a retried scheduler tick or a duplicated
   * request resumes the earlier attempt instead of calling the provider again
   * and opening a second set of cases. A UNIQUE constraint on the key is what
   * enforces it; the read below is an optimisation, not the guarantee.
   */
  async execute(input: {
    kycRecordId: string;
    subjects: readonly ScreeningSubject[];
    requestedByUserId: string;
  }): Promise<ScreeningExecution> {
    const provider = this.registry.resolve();
    const config = this.registry.config();
    const thresholds = this.registry.thresholds();
    const correlationId = this.registry.newCorrelationId();

    const idempotencyKey = buildIdempotencyKey({
      kycRecordId: input.kycRecordId,
      subjects: input.subjects,
      provider: provider.kind,
      dataset: config.dataset,
      bucket: idempotencyBucket(config.idempotencyWindowMinutes),
    });

    const existing = await this.prisma.client.screeningRequest.findUnique({
      where: { idempotencyKey },
    });
    // Already done in this window. Returning the recorded outcome — rather
    // than re-running — is what stops a retry storm minting duplicate
    // compliance cases.
    if (existing) return resumed(existing);

    const startedAt = new Date();
    let results: ProviderScreeningResult[];
    try {
      results = await provider.screenBatch(input.subjects, correlationId);
    } catch (err) {
      // A provider that throws instead of returning a failure result is still
      // a failure, never an absence of matches.
      results = input.subjects.map(() => ({
        outcome: 'SCREENING_FAILED' as const,
        candidates: [],
        provider: provider.kind,
        providerName: provider.name,
        correlationId,
        failureReason: (err as Error).message,
        durationMs: 0,
      }));
    }

    const outcome = aggregateOutcome(results);
    const datasetVersion =
      results.find((r) => r.datasetVersion)?.datasetVersion ?? null;
    const failureReason =
      results.find((r) => r.failureReason)?.failureReason ?? null;

    // Pair each candidate with the subject it was raised for — a reviewer
    // needs to know WHICH name matched, since screening covers UBOs too.
    const scored: ScoredCandidate[] = [];
    results.forEach((result, index) => {
      const subject = input.subjects[index];
      if (!subject) return;
      for (const candidate of result.candidates) {
        const band = bandFor(candidate.score, thresholds);
        if (band === 'below') continue; // noise, per the configured floor
        scored.push({ ...candidate, subject, band });
      }
    });

    const completedAt = new Date();
    let request: { id: string };
    try {
      request = await this.prisma.client.screeningRequest.create({
        data: {
          kycRecordId: input.kycRecordId,
          correlationId,
          idempotencyKey,
          subjectFingerprint: subjectFingerprint(input.subjects),
          // Part B §13 — what decided this attempt, recorded with it. A stored
          // score is not interpretable later without the line it was judged
          // against and the matcher that produced it.
          algorithmVersion: MATCHING_ALGORITHM_VERSION,
          // Spread into a plain object: Prisma's JSON input type requires an
          // index signature, which the named `MatchThresholds` interface
          // deliberately does not have.
          thresholds: { ...thresholds },
          provider: provider.kind,
          providerName: provider.name,
          datasetVersion,
          outcome,
          failureReason,
          candidateCount: results.reduce(
            (sum, r) => sum + r.candidates.length,
            0,
          ),
          // Filled in by the caller once cases are opened.
          casesOpened: 0,
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          requestedByUserId: input.requestedByUserId,
        },
      });
    } catch (err) {
      // The UNIQUE on `idempotencyKey` is the guarantee; the read above is
      // only an optimisation (`race-safe-invariants.md`). Two concurrent
      // requests in the same window both find nothing and both insert — and
      // before this catch existed, the loser threw an unhandled P2002 and the
      // caller saw a 500 for a screening that had in fact just succeeded.
      if (isUniqueConstraintViolation(err)) {
        const winner = await this.prisma.client.screeningRequest.findUnique({
          where: { idempotencyKey },
        });
        if (winner) return resumed(winner);
      }
      throw err;
    }

    if (isUnresolved(outcome)) {
      // Loud: this customer was NOT cleared, and not because they matched
      // anything. Somebody has to notice.
      this.logger.error(
        `Screening ${input.kycRecordId} (${correlationId}): ${outcome} via ${provider.name}. ${failureReason ?? ''} This is NOT a clear result — the KYC file is escalated for compliance review.`,
      );
    }

    return {
      requestId: request.id,
      correlationId,
      outcome,
      provider: provider.kind,
      providerName: provider.name,
      datasetVersion,
      failureReason,
      candidates: scored,
      idempotentResume: false,
    };
  }

  /** Part B §13 — the configured REVIEW band, for stamping onto a match.
   *
   * Exposed here rather than injecting the registry into `ScreeningService`
   * too: the thresholds are part of the provider configuration this service
   * already owns, and a second reader of the same settings is a second place
   * for them to be read differently. */
  reviewThreshold(): number {
    return this.registry.thresholds().review;
  }

  /** Records how many cases the caller ended up opening for this attempt. */
  async recordCasesOpened(requestId: string, count: number): Promise<void> {
    await this.prisma.client.screeningRequest.update({
      where: { id: requestId },
      data: { casesOpened: count },
    });
  }
}

/**
 * Worst-outcome-wins across the subjects of one KYC file.
 *
 * Precedence is deliberate and is the safe direction at every step:
 *
 *   1. any UNRESOLVED  -> unresolved. If even one subject could not be
 *      screened, the FILE has not been screened. Reporting the customer clear
 *      because their other UBOs came back clean is the failure this ordering
 *      exists to prevent.
 *   2. any POTENTIAL_MATCH -> potential match.
 *   3. otherwise -> no match.
 */
export function aggregateOutcome(
  results: readonly ProviderScreeningResult[],
): ScreeningAttemptOutcome {
  if (results.length === 0) return 'UNABLE_TO_SCREEN';

  const unresolved = results.find((r) => isUnresolved(r.outcome));
  if (unresolved) return unresolved.outcome;

  if (results.some((r) => r.outcome === 'POTENTIAL_MATCH')) {
    return 'POTENTIAL_MATCH';
  }
  return results.every((r) => isClear(r.outcome))
    ? 'NO_MATCH'
    : 'UNABLE_TO_SCREEN';
}

/** Which configured band a score falls into. */
export function bandFor(
  score: number,
  thresholds: { high: number; review: number; low: number },
): 'high' | 'review' | 'below' {
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.review) return 'review';
  return 'below';
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/** The shape returned when an identical attempt already exists in this
 * window — from the read fast-path and from the P2002 loser alike, so the two
 * cannot drift apart. */
function resumed(row: {
  id: string;
  correlationId: string;
  outcome: ScreeningAttemptOutcome;
  provider: string;
  providerName: string;
  datasetVersion: string | null;
  failureReason: string | null;
}): ScreeningExecution {
  return {
    requestId: row.id,
    correlationId: row.correlationId,
    outcome: row.outcome,
    provider: row.provider,
    providerName: row.providerName,
    datasetVersion: row.datasetVersion,
    failureReason: row.failureReason,
    candidates: [],
    idempotentResume: true,
  };
}

/**
 * Part B §12 — a hash of the IDENTITY ATTRIBUTES actually screened.
 *
 * Deliberately NOT the idempotency key. That key folds in the provider and the
 * dataset, so it changes when a deployment switches provider even though the
 * same people were checked. This answers the different question: "are the
 * people on this file still the people we checked?"
 *
 * Covers each subject's name, date of birth and nationality — every attribute
 * a match is made on. Adding a UBO changes it. Correcting a date of birth
 * changes it. Switching provider does not.
 *
 * Sorted, so the same people in a different order fingerprint identically, and
 * hashed, so a column an operator can query is not a readable list of the
 * people screened (sensitive-data-handling.md).
 */
export function subjectFingerprint(
  subjects: readonly ScreeningSubject[],
): string {
  const material = [...subjects]
    .map((s) =>
      [
        s.fullName.trim().toLowerCase(),
        s.dateOfBirth ?? '-',
        (s.nationality ?? '-').toUpperCase(),
        s.entityType,
      ].join('~'),
    )
    .sort()
    .join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/**
 * The idempotency key.
 *
 * Hashed rather than concatenated because a subject set can be long and a
 * customer's legal name is Highly Confidential — a key stored in a queryable
 * column should not be a readable list of the people screened. The KYC id is
 * kept in the clear so the row is still traceable to its file.
 */
export function buildIdempotencyKey(input: {
  kycRecordId: string;
  subjects: readonly ScreeningSubject[];
  provider: string;
  dataset: string | null;
  /** The window this attempt falls in. See `idempotencyBucket`. */
  bucket: number;
}): string {
  const material = [
    input.provider,
    input.dataset ?? '-',
    String(input.bucket),
    // Sorted: the same people in a different order is the same screening.
    ...[...input.subjects].map((s) => s.fullName.trim().toLowerCase()).sort(),
  ].join('|');
  const digest = createHash('sha256').update(material).digest('hex');
  return `${input.kycRecordId}:${digest.slice(0, 32)}`;
}

/**
 * Which idempotency window a moment falls in.
 *
 * A coarse bucket rather than a sliding "was there an attempt in the last N
 * minutes?" query, because the UNIQUE constraint on `idempotencyKey` is what
 * actually makes this race-safe (`race-safe-invariants.md`) — and a constraint
 * needs a deterministic key, which a sliding window cannot give.
 *
 * The cost is a boundary artefact: two requests a minute apart can straddle a
 * bucket edge and both reach the provider. That is the harmless direction —
 * one extra screening read, with the resulting candidates de-duplicated by
 * `ScreeningMatch`'s own unique key. The opposite error, suppressing a genuine
 * re-screen, is the one that stops ongoing monitoring dead.
 */
export function idempotencyBucket(
  windowMinutes: number,
  now: Date = new Date(),
): number {
  return Math.floor(now.getTime() / (windowMinutes * 60_000));
}
