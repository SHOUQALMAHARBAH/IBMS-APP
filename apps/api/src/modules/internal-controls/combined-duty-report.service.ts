import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CombinedDutyActRepository } from '../../repositories/combined-duty-act.repository';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { UserRepository } from '../../repositories/user.repository';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * The constraint whose acts sit at the TOP of this report, flagged.
 *
 * The owner's condition, in her words: *a person's review of their OWN access appears at the top of the
 * self-approval report, flagged as the highest-attention row*. Every other self-approval concerns a
 * transaction — a customer, a claim, a refund. This one concerns the PERMISSIONS THEMSELVES: it is the control
 * over whoever distributes control.
 *
 * Named by the constraint rather than by a label, so a rename cannot quietly stop matching.
 */
const ACCESS_SELF_REVIEW_CONSTRAINT =
  'AccessRecertificationItem_maker_checker_distinct';

/** How many acts one page of the report carries. */
const REPORT_LIMIT = 200;

export interface CombinedDutyReportRow {
  id: string;
  /** The actor by NAME, not only by id: this report is read by a person asking who did what. */
  actorUserId: string;
  actorName: string | null;
  at: Date;
  entity: string;
  entityId: string;
  /** The pair, named by the CHECK constraint it excuses, so the act and the database rule cannot drift. */
  pair: string;
  reason: string;
  /** THE HAT — the roles that actually granted the checker permission, not every role the actor held. */
  roles: string[];
  hatAmbiguous: boolean;
  /**
   * True for a person reviewing their OWN access. These sort first, ahead of every transaction act, whatever
   * their dates.
   */
  accessSelfReview: boolean;
}

export interface CombinedDutyReport {
  /** The office's posture, beside the acts it permitted — one without the other answers half the question. */
  office: {
    mode: string;
    declaredAt: Date | null;
    declaredByUserId: string | null;
    declaredByName: string | null;
  };
  rows: CombinedDutyReportRow[];
  /** Split out so a reader does not have to count: "are there any of the highest-attention kind". */
  accessSelfReviewCount: number;
  totalCount: number;
  /** True when there are more acts than this page carries, so "none" is never confused with "none shown". */
  truncated: boolean;
}

/**
 * THE SELF-APPROVAL REPORT — the shipping gate for COMBINED mode.
 *
 * ## Why it exists, which is not "for completeness"
 *
 * The owner accepted applying the mode uniformly, INCLUDING to a person reviewing their own access, on one
 * stated mitigation: that every such act would surface here, flagged at the top. That mitigation was offered
 * against a report which, measured, had no reader at all — `segregationSignal()` wrote a log line and an audit
 * row, and no endpoint or screen listed self-approvals in any form.
 *
 * So a control was weakened on the strength of a report nobody could open. This is that report, and until it
 * existed the mode was not shippable — `duty-segregation-mode.service.ts` refused COMBINED for exactly that
 * reason.
 *
 * ## What it is NOT
 *
 * Not the silent-self-approval scan. `InternalControlsService.runSelfApprovalAudit` walks every maker/checker
 * pair looking for rows where the two ids MATCH and nothing explains it — which should find none, because the
 * CHECK constraints refuse them. This report is the opposite: the acts that were DECLARED, with their reasons.
 * Both live on the same screen because a reviewer asking "who has been on both sides of a control" needs both
 * answers, and neither is the other.
 */
@Injectable()
export class CombinedDutyReportService {
  private readonly logger = new Logger(CombinedDutyReportService.name);

  constructor(
    private readonly acts: CombinedDutyActRepository,
    private readonly organizations: OrganizationRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
  ) {}

  async run(actor: AuthenticatedUser): Promise<CombinedDutyReport> {
    const office = await this.organizations.findById(actor.organizationId);
    // One more than the page, so "there are more" is a fact rather than a guess at the boundary.
    const acts = await this.acts.findManyForOffice(REPORT_LIMIT + 1);
    const truncated = acts.length > REPORT_LIMIT;
    const page = truncated ? acts.slice(0, REPORT_LIMIT) : acts;

    // Names resolved in ONE query over the distinct actors, and NOT stored on the act: a name is a lookup,
    // whereas the roles ARE stored because a revoked role is unrecoverable. The same split the audit trail's
    // actor column already makes.
    const actorIds = [...new Set(page.map((a) => a.actorUserId))];
    const names = new Map(
      (await this.users.findSummariesByIds(actorIds)).map((u) => [
        u.id,
        u.fullName,
      ]),
    );

    const rows: CombinedDutyReportRow[] = page.map((act) => ({
      id: act.id,
      actorUserId: act.actorUserId,
      actorName: names.get(act.actorUserId) ?? null,
      at: act.actedAt,
      entity: act.entity,
      entityId: act.entityId,
      pair: act.constraintName,
      reason: act.reason,
      roles: act.grantingRoleNames,
      hatAmbiguous: act.multipleGrantingRoles,
      accessSelfReview: act.constraintName === ACCESS_SELF_REVIEW_CONSTRAINT,
    }));

    // THE FIRST ORDERING RULE. Access self-reviews first, whatever their dates; within each group, newest
    // first. Sorting here rather than in SQL because the rule is a product decision about attention, not a
    // property of the data — and because the flag is derived from the constraint name, which the database
    // cannot order by meaningfully.
    rows.sort((a, b) => {
      if (a.accessSelfReview !== b.accessSelfReview) {
        return a.accessSelfReview ? -1 : 1;
      }
      return b.at.getTime() - a.at.getTime();
    });

    const declaredBy = office?.dutySegregationModeDeclaredByUserId
      ? await this.users.findById(office.dutySegregationModeDeclaredByUserId)
      : null;

    // Somebody looked. Counts only, never a user id — the same "prove someone looked" precedent
    // `runSelfApprovalAudit` and the SLA dashboard set, and best-effort because a failed audit row must not
    // deny a compliance officer the report.
    try {
      await this.audit.record({
        userId: actor.id,
        action: 'READ',
        entityType: 'CombinedDutyAct',
        entityId: actor.organizationId,
        afterValue: {
          rows: rows.length,
          accessSelfReviews: rows.filter((r) => r.accessSelfReview).length,
          truncated,
        },
      });
    } catch (err) {
      this.logger.error(
        'Self-approval report audit row failed after the report was produced',
        err as Error,
      );
    }

    return {
      office: {
        mode: office?.dutySegregationMode ?? 'SEGREGATED',
        declaredAt: office?.dutySegregationModeDeclaredAt ?? null,
        declaredByUserId: office?.dutySegregationModeDeclaredByUserId ?? null,
        declaredByName: declaredBy?.fullName ?? null,
      },
      rows,
      accessSelfReviewCount: rows.filter((r) => r.accessSelfReview).length,
      totalCount: acts.length > REPORT_LIMIT ? REPORT_LIMIT : acts.length,
      truncated,
    };
  }
}
