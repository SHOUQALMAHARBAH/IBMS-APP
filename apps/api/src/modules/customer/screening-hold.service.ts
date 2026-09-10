import {
  BadRequestException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ScreeningHoldRelease } from '@ibms/db';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  describeHold,
  evaluateScreeningHold,
  loadHoldPolicy,
  type ScreeningHoldEvaluation,
  type ScreeningHoldPolicy,
} from './screening-hold.config';

export interface ScreeningHoldView extends ScreeningHoldEvaluation {
  kycRecordId: string;
  lastScreenedAt: string | null;
  /** Releases already recorded on this file, newest first. A second approver
   * needs to see that somebody released a hold before, and why. */
  releases: {
    id: string;
    level: string;
    conditions: string[];
    reason: string;
    releasedByUserId: string;
    releasedAt: string;
    workflow: string;
  }[];
  /** Control settings that could not be applied. Shown so a misconfigured
   * deployment is visible rather than quietly running on defaults. */
  configurationProblems: string[];
}

/**
 * The screening hold — evaluated from the database, enforced at the decision
 * point, and released only on the record.
 *
 * ## Why the policy is loaded per call
 *
 * `loadHoldPolicy()` reads `process.env` on every evaluation rather than once
 * at construction. That costs a handful of string comparisons and buys the
 * property that a deployment which tightens a hold setting and restarts a
 * single worker cannot end up with two workers enforcing different policies
 * for the lifetime of the older process.
 */
@Injectable()
export class ScreeningHoldService {
  private readonly logger = new Logger(ScreeningHoldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  policy(): ScreeningHoldPolicy {
    return loadHoldPolicy();
  }

  /** Evaluate the hold in force on one KYC file, from current state. */
  async evaluate(kycRecordId: string): Promise<ScreeningHoldEvaluation> {
    const policy = this.policy();
    const [results, matches] = await Promise.all([
      this.prisma.client.screeningResult.findMany({
        where: { kycRecordId },
        select: { attemptOutcome: true, screenedAt: true },
        orderBy: { screenedAt: 'desc' },
      }),
      this.prisma.client.screeningMatch.findMany({
        where: { kycRecordId },
        select: { status: true, listType: true },
      }),
    ]);

    return evaluateScreeningHold(
      {
        attemptOutcomes: results.map((r) => r.attemptOutcome),
        matches: matches.map((m) => ({
          status: m.status,
          listType: m.listType,
        })),
        lastScreenedAt: results[0]?.screenedAt ?? null,
      },
      policy,
    );
  }

  /** The full view, for the screen that gates the approve button. */
  async view(kycRecordId: string): Promise<ScreeningHoldView> {
    const [evaluation, releases, latest] = await Promise.all([
      this.evaluate(kycRecordId),
      this.prisma.client.screeningHoldRelease.findMany({
        where: { kycRecordId },
        orderBy: { releasedAt: 'desc' },
      }),
      this.prisma.client.screeningResult.findFirst({
        where: { kycRecordId },
        orderBy: { screenedAt: 'desc' },
        select: { screenedAt: true },
      }),
    ]);

    return {
      ...evaluation,
      kycRecordId,
      lastScreenedAt: latest?.screenedAt.toISOString() ?? null,
      releases: releases.map((r) => ({
        id: r.id,
        level: r.level,
        conditions: r.conditions,
        reason: r.reason,
        releasedByUserId: r.releasedByUserId,
        releasedAt: r.releasedAt.toISOString(),
        workflow: r.workflow,
      })),
      configurationProblems: this.policy().invalid,
    };
  }

  /**
   * The gate. Called immediately before a workflow proceeds past screening.
   *
   * Three outcomes:
   *
   *  * `NO_HOLD` — returns, nothing recorded. There is nothing to accept.
   *  * `BLOCKED` — throws. No reason text releases it; that is what BLOCKED
   *    means, and a caller cannot opt out.
   *  * `REVIEW_REQUIRED` — proceeds ONLY with a written reason, which is
   *    recorded as a `ScreeningHoldRelease` before the workflow continues.
   *
   * Recorded BEFORE rather than after: if the process dies between the two,
   * an orphan release row is a recoverable inconsistency, whereas an approval
   * with no release row is the exact silent-override this whole mechanism
   * exists to make impossible.
   */
  async assertClearToProceed(input: {
    kycRecordId: string;
    actorUserId: string;
    /** The written acceptance. Required to release a REVIEW_REQUIRED hold and
     * meaningless otherwise. */
    releaseReason?: string;
    workflow?: string;
  }): Promise<ScreeningHoldRelease | null> {
    const evaluation = await this.evaluate(input.kycRecordId);
    if (evaluation.level === 'NO_HOLD') return null;

    if (evaluation.level === 'BLOCKED') {
      this.logger.error(
        `KYCRecord ${input.kycRecordId}: BLOCKED by screening hold; user ${input.actorUserId} attempted to proceed. ${describeHold(evaluation)}`,
      );
      throw new UnprocessableEntityException(
        `This file is BLOCKED by a screening hold and cannot proceed. ${evaluation.reasons.map((r) => r.detail).join(' ')}`,
      );
    }

    const reason = input.releaseReason?.trim();
    if (!reason) {
      throw new BadRequestException(
        `This file has a screening hold that must be accepted in writing before it can proceed. Re-send the request with a stated reason. ${evaluation.reasons.map((r) => r.detail).join(' ')}`,
      );
    }

    const release = await this.prisma.client.screeningHoldRelease.create({
      data: {
        kycRecordId: input.kycRecordId,
        level: 'REVIEW_REQUIRED',
        conditions: evaluation.reasons.map((r) => r.condition),
        detail: evaluation.reasons.map((r) => r.detail).join(' '),
        reason,
        releasedByUserId: input.actorUserId,
        workflow: input.workflow ?? 'kyc_decision',
      },
    });

    await this.audit.record({
      userId: input.actorUserId,
      action: 'UPDATE',
      entityType: 'ScreeningHoldRelease',
      entityId: release.id,
      afterValue: {
        kycRecordId: input.kycRecordId,
        conditions: release.conditions,
        workflow: release.workflow,
        // The reason is on the row. Not duplicated into the audit payload —
        // it is a reviewer's free text about a screening finding, and one
        // copy in a purpose-built column beats two copies in two retention
        // regimes.
      },
    });

    this.logger.warn(
      `KYCRecord ${input.kycRecordId}: screening hold RELEASED by ${input.actorUserId} (${release.conditions.join(', ')}).`,
    );
    return release;
  }
}
