import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { CrossSellOpportunity, CrossSellStatus } from '@ibms/db';
import { CrossSellOpportunityRepository } from '../../repositories/cross-sell-opportunity.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { VIEW_ALL_OWNERS_ROLES } from '../../common/rbac-visibility.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BENCHMARK_LINES, findCoverageGaps } from './cross-sell.config';

/** The result of one gap scan for a customer — what `runDetection` hands
 * back to the scheduler (`.newlyFlagged`) and to `detect()` (the whole
 * thing, plus the customer's current OPEN opportunities). */
export interface CrossSellDetectionOutcome {
  /** The customer's distinct in-force policy lines (the "held" side). */
  heldLines: string[];
  /** Benchmark lines the customer holds no in-force policy for. */
  gapLines: string[];
  /** Opportunities this scan actually created (empty on a re-run). */
  newlyFlagged: CrossSellOpportunity[];
}

export interface CrossSellDetectionView extends CrossSellDetectionOutcome {
  customerId: string;
  /** Echoed so the caller can see what "held" was compared against. */
  benchmarkLines: string[];
  /** Every currently-OPEN opportunity for the customer (not just this run's). */
  openOpportunities: CrossSellOpportunity[];
}

/**
 * Process 8 — Cross-Selling (backlog Part C #8, Domain A).
 *
 * A `CrossSellOpportunity` is only ever created by the detection scan —
 * there is no user-facing "raise a cross-sell opportunity" path. The scan
 * compares a customer's in-force `Policy` lines against `BENCHMARK_LINES`
 * (cross-sell.config.ts, pure) and flags each benchmark line the customer
 * has no cover for. It runs nightly (CrossSellDetectionScheduler) and
 * on-demand (`POST /cross-sell-opportunities/detect`).
 *
 * Idempotency / race safety (ibms-brain/meta/lex/race-safe-invariants.md):
 * `CrossSellOpportunity` has a `@@unique([customerId, gapLine])`, and the
 * scan inserts one row at a time, treating a `P2002` as "a concurrent scan
 * flagged this gap first, skip" — so a re-run or a concurrent run adds
 * nothing and audits nothing it did not create. A CONVERTED/DISMISSED gap
 * is never re-flagged (the pre-read skips it; the unique index would reject
 * the row anyway).
 *
 * `status` moves ONLY through WorkflowTransitionService (A.6) — `convert()`
 * / `dismiss()` are the only two moves (OPEN -> CONVERTED | DISMISSED,
 * both terminal). No maker/checker: acting on a system-surfaced nudge is a
 * single-actor Sales task (`cross-sell.convert`), not an approval.
 *
 * Visibility mirrors lead.service.ts / prospect.service.ts (this is a
 * Sales-pipeline concern): a Sales/Relationship Officer sees only
 * opportunities on a Customer they own; Manager/Executive
 * (VIEW_ALL_OWNERS_ROLES) get the org-wide view.
 */
@Injectable()
export class CrossSellService {
  private readonly logger = new Logger(CrossSellService.name);

  constructor(
    private readonly opportunities: CrossSellOpportunityRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  private canViewAllOwners(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (VIEW_ALL_OWNERS_ROLES as readonly string[]).includes(role),
    );
  }

  /** Logged, not thrown — the real write already committed; an audit hiccup
   * must not turn a successful operation into a reported failure (same
   * philosophy as InsuranceProgramService.safeAudit and the workflow
   * engine's own sideEffect catch). */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `CrossSellOpportunity ${input.entityId}: audit record (${input.action}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** Resolves a Customer and enforces the caller's visibility on it.
   * NotFoundException either way (missing customer, or one the caller can't
   * see) so the response can't be used as an existence oracle — same
   * pattern as InsuranceProgramService.assertCustomerVisible(). */
  private async assertCustomerVisible(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const customer = await this.customers.findById(customerId);
    if (
      !customer ||
      (!this.canViewAllOwners(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Customer not found');
    }
  }

  private async findVisibleOpportunity(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<CrossSellOpportunity> {
    const opportunity = await this.opportunities.findById(id);
    if (!opportunity) {
      throw new NotFoundException('CrossSellOpportunity not found');
    }
    try {
      await this.assertCustomerVisible(opportunity.customerId, actor);
    } catch {
      throw new NotFoundException('CrossSellOpportunity not found');
    }
    return opportunity;
  }

  private async mustFind(id: string): Promise<CrossSellOpportunity> {
    const opportunity = await this.opportunities.findById(id);
    if (!opportunity) {
      throw new NotFoundException(`CrossSellOpportunity ${id} not found`);
    }
    return opportunity;
  }

  /**
   * The core gap scan for one customer, with NO visibility gate — shared by
   * the HTTP `detect()` (which gates first) and the nightly sweep (system
   * actor). Returns only what THIS run created.
   */
  async runDetection(
    customerId: string,
    detectedByUserId: string,
  ): Promise<CrossSellDetectionOutcome> {
    const empty: CrossSellDetectionOutcome = {
      heldLines: [],
      gapLines: [],
      newlyFlagged: [],
    };

    const customer = await this.customers.findById(customerId);
    if (!customer) return empty;

    const heldLines =
      await this.opportunities.findInForcePolicyLinesByCustomerId(customerId);
    // No in-force cover at all -> a new-business prospect, not a cross-sell
    // target. (The nightly sweep only visits customers that DO hold cover;
    // this guard also covers the on-demand path and a policy that lapsed
    // between the sweep's customer list and this scan.)
    if (heldLines.length === 0) return empty;

    const gapLines = findCoverageGaps(heldLines);
    if (gapLines.length === 0) return { heldLines, gapLines, newlyFlagged: [] };

    // Pre-read to skip the gaps already flagged/converted/dismissed — a
    // convenience, not the invariant: the @@unique([customerId, gapLine])
    // index below is what actually enforces "one per (customer, line)"
    // (ibms-brain/meta/lex/race-safe-invariants.md).
    const alreadyKnown = new Set(
      await this.opportunities.findExistingGapLines(customerId, gapLines),
    );
    const freshGaps = gapLines.filter((line) => !alreadyKnown.has(line));
    if (freshGaps.length === 0)
      return { heldLines, gapLines, newlyFlagged: [] };

    // Insert one row per fresh gap (freshGaps.length <= BENCHMARK_LINES.length,
    // i.e. <= 4), each guarded by the unique index: a concurrent scan that
    // flagged the same gap first makes create() throw P2002, which is "already
    // flagged, skip" — not an error. Per-row rather than createMany so the
    // CREATE audit row and the `newlyFlagged` payload reflect only what THIS
    // run actually inserted, and a mid-loop crash is resumable (the next run
    // recomputes freshGaps and inserts the rest).
    const newlyFlagged: CrossSellOpportunity[] = [];
    for (const gapLine of freshGaps) {
      let created: CrossSellOpportunity;
      try {
        created = await this.opportunities.createGap({
          customerId,
          gapLine,
          detectedByUserId,
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
      newlyFlagged.push(created);
      await this.safeAudit({
        userId: detectedByUserId,
        action: 'CREATE',
        entityType: 'CrossSellOpportunity',
        entityId: created.id,
        afterValue: {
          customerId,
          gapLine: created.gapLine,
          status: created.status,
        },
      });
    }

    return { heldLines, gapLines, newlyFlagged };
  }

  /** On-demand gap scan for one customer (`POST /cross-sell-opportunities/detect`). */
  async detect(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<CrossSellDetectionView> {
    await this.assertCustomerVisible(customerId, actor);
    const outcome = await this.runDetection(customerId, actor.id);
    const openOpportunities = await this.opportunities.findManyByCustomerId(
      customerId,
      'OPEN',
    );
    return {
      customerId,
      benchmarkLines: [...BENCHMARK_LINES],
      ...outcome,
      openOpportunities,
    };
  }

  async list(
    customerId: string,
    actor: AuthenticatedUser,
    status?: CrossSellStatus,
  ): Promise<CrossSellOpportunity[]> {
    await this.assertCustomerVisible(customerId, actor);
    return this.opportunities.findManyByCustomerId(customerId, status);
  }

  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<CrossSellOpportunity> {
    return this.findVisibleOpportunity(id, actor);
  }

  /** OPEN -> CONVERTED. "Converting" only records the decision — starting
   * the actual Opportunity/RFQ for the gap line is Process 11+ (not built),
   * the same edge NeedsAssessment.APPROVED sits at. */
  async convert(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<CrossSellOpportunity> {
    await this.findVisibleOpportunity(id, actor);
    await this.workflow.transition({
      entityType: 'CrossSellOpportunity',
      entityId: id,
      toStatus: 'CONVERTED',
      actorUserId: actor.id,
      data: { resolvedByUserId: actor.id, resolvedAt: new Date() },
    });
    return this.mustFind(id);
  }

  /** OPEN -> DISMISSED, with a mandatory reason (why the gap is not being
   * pursued — "client declined", "covered under a group policy elsewhere",
   * ...). */
  async dismiss(
    id: string,
    actor: AuthenticatedUser,
    reason: string,
  ): Promise<CrossSellOpportunity> {
    await this.findVisibleOpportunity(id, actor);
    await this.workflow.transition({
      entityType: 'CrossSellOpportunity',
      entityId: id,
      toStatus: 'DISMISSED',
      actorUserId: actor.id,
      data: {
        resolvedByUserId: actor.id,
        resolvedAt: new Date(),
        dismissReason: reason,
      },
    });
    return this.mustFind(id);
  }
}
