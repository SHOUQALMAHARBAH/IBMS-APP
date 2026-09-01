import { Injectable } from '@nestjs/common';
import type { PolicyChecking, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { CoverageChecklist } from '../modules/policy/policy-checking.config';

export interface RecordCheckingInput {
  policyId: string;
  placedByUserId: string;
  checkedByUserId: string;
  checklist: CoverageChecklist;
  discrepancyFound: boolean;
  discrepancyDetail: string | null;
  /** Non-null only when this check turned up a discrepancy. A linked
   * `ProfessionalIndemnityRiskEvent` is created in the same transaction —
   * unless one has already been logged for this checking row (a re-check that
   * still finds the same discrepancy does not double-log). */
  piRiskEvent: { description: string; piPolicyId: string | null } | null;
}

/**
 * Process 20 — Policy Checking (backlog Part C #20, Domain B). Owns the one
 * `PolicyChecking` row per `Policy` (`policyId @unique`) and the
 * `ProfessionalIndemnityRiskEvent` a discrepancy auto-logs.
 *
 * `PolicyChecking` has no workflow `status` — its lifecycle is the parent
 * `Policy`'s status, driven from `PolicyCheckingService` through
 * `WorkflowTransitionService`. Maker/checker (`placedByUserId` ≠
 * `checkedByUserId`) is enforced in the service by `assertDifferentActors`
 * and, at the DB layer, by the pre-existing
 * `PolicyChecking_maker_checker_distinct` CHECK constraint (migration
 * `20260826091424`).
 */
@Injectable()
export class PolicyCheckingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The broker's most recently-expiring PI policy, if any is on record — the
   * discrepancy risk event links to it when present (Part 7.1). */
  async findLatestPiPolicyId(): Promise<string | null> {
    const row = await this.prisma.client.professionalIndemnityPolicy.findFirst({
      orderBy: { expiresAt: 'desc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Upsert the one `PolicyChecking` row for a policy and keep its linked
   * `ProfessionalIndemnityRiskEvent` in step — all in ONE interactive
   * transaction, a deliberate local exception to this codebase's
   * no-`$transaction` convention (see `quotation.repository.ts`), so "a
   * discrepancy is recorded" and "a PI risk event exists" can never diverge:
   *
   *  - first discrepancy (`piRiskEvent` set, not yet logged) — create the
   *    event and flip `discrepancyLoggedAsPiRiskEvent`;
   *  - re-check that still finds a discrepancy **with the same detail** —
   *    no-op on the event (no double-log);
   *  - re-check that finds a **materially different** discrepancy (the
   *    `discrepancyDetail` changed) — refresh the existing event's
   *    `description` so the Process 54 risk-register entry does not go stale.
   */
  recordChecking(input: RecordCheckingInput): Promise<PolicyChecking> {
    const checklistJson = input.checklist as unknown as Prisma.InputJsonValue;
    return this.prisma.client.$transaction(async (tx) => {
      const prior = await tx.policyChecking.findUnique({
        where: { policyId: input.policyId },
        select: {
          discrepancyDetail: true,
          discrepancyLoggedAsPiRiskEvent: true,
        },
      });

      const checking = await tx.policyChecking.upsert({
        where: { policyId: input.policyId },
        create: {
          policyId: input.policyId,
          placedByUserId: input.placedByUserId,
          checkedByUserId: input.checkedByUserId,
          checklistResult: checklistJson,
          discrepancyFound: input.discrepancyFound,
          discrepancyDetail: input.discrepancyDetail,
          checkedAt: new Date(),
        },
        update: {
          checkedByUserId: input.checkedByUserId,
          checklistResult: checklistJson,
          discrepancyFound: input.discrepancyFound,
          discrepancyDetail: input.discrepancyDetail,
          checkedAt: new Date(),
        },
      });

      if (input.piRiskEvent) {
        if (!checking.discrepancyLoggedAsPiRiskEvent) {
          await tx.professionalIndemnityRiskEvent.create({
            data: {
              sourcePolicyCheckingId: checking.id,
              piPolicyId: input.piRiskEvent.piPolicyId,
              description: input.piRiskEvent.description,
            },
          });
          return tx.policyChecking.update({
            where: { id: checking.id },
            data: { discrepancyLoggedAsPiRiskEvent: true },
          });
        }
        if (prior && prior.discrepancyDetail !== input.discrepancyDetail) {
          await tx.professionalIndemnityRiskEvent.updateMany({
            where: { sourcePolicyCheckingId: checking.id },
            data: { description: input.piRiskEvent.description },
          });
        }
      }
      return checking;
    });
  }
}
