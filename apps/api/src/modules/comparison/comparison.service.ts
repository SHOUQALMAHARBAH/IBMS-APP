import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OpportunityStatus } from '@ibms/db';
import {
  ComparisonRepository,
  type ComparisonWithRows,
} from '../../repositories/comparison.repository';
import {
  RfqRepository,
  type RfqWithSubmissions,
} from '../../repositories/rfq.repository';
import { QuotationRepository } from '../../repositories/quotation.repository';
import { OpportunityRepository } from '../../repositories/opportunity.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { planComparison } from './comparison.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { BuildComparisonDto } from './dto/build-comparison.dto';

type MatrixRow = ComparisonWithRows['rows'][number];

/** An insurer flagged in the comparison output — resolved to its identity
 * and current RFQ-response status. */
export interface FlaggedInsurer {
  id: string;
  name: string;
  status: string | null;
}

/** The comparison matrix as the API returns it: one row per current-version
 * quotation (each carrying the full `Quotation` — premium / deductible /
 * `limits` / BI period / liability limit / exclusions / conditions — so the
 * matrix is **never price alone**), plus the shortlisted insurers with no
 * quote to compare. `missingInsurers` is the stored build-time snapshot;
 * `declinedInsurers` is recomputed from the live shortlist. */
export interface ComparisonView {
  id: string;
  rfqId: string;
  insuranceLine: string;
  builtAt: Date;
  builtByUserId: string | null;
  rows: MatrixRow[];
  missingInsurers: FlaggedInsurer[];
  declinedInsurers: FlaggedInsurer[];
}

/**
 * Process 14 — Quote Comparison (backlog Part C #14, Domain B).
 *
 *  - `build` — (re)assemble the matrix for one RFQ from every
 *    **current-version** `Quotation` on it (one `ComparisonMatrixRow` each),
 *    record the shortlisted insurers with no quote to compare, and
 *    optionally attach the two subjective scores (insurer quality, service)
 *    per insurer. Idempotent: rebuilding replaces the rows wholesale
 *    (`ComparisonRepository.buildOrRebuild`, one `$transaction`). A build
 *    best-effort advances the parent `Opportunity`
 *    QUOTES_RECEIVED -> COMPARISON_BUILT through the workflow engine
 *    (logged, never thrown — the matrix is already committed and audited,
 *    same philosophy as `QuotationService`'s best-effort moves).
 *  - `get` / `getById` — read the matrix. The `missing` / `declined`
 *    flagged-insurer buckets are recomputed live from the current shortlist
 *    (see `toView`), so they stay mutually disjoint after a post-build
 *    status change. The stored rows are NOT re-filtered: a row whose
 *    `Quotation` was revised since the build carries stale terms until a
 *    rebuild — `builtAt` and each row's `quotation.isCurrentVersion` signal
 *    that; "rebuild to refresh" is the model (README § Known gaps #14).
 *
 * The comparison is **never price alone**
 * (ibms-brain/meta/context/policy-lifecycle.md § "The rules that aren't
 * obvious"): rows point to their `Quotation`, which carries every objective
 * dimension, and the row order is deliberately neutral (by insurer, not by
 * premium). `ComparisonMatrix` has no workflow `status` and no maker/checker
 * — it is a derived artefact; the maker/checker gate in this lifecycle sits
 * downstream at the Recommendation (#16).
 *
 * Visibility mirrors `QuotationService` / `RfqService`: the matrix inherits
 * its RFQ's Opportunity's Customer's visibility.
 */
@Injectable()
export class ComparisonService {
  private readonly logger = new Logger(ComparisonService.name);

  constructor(
    private readonly comparisons: ComparisonRepository,
    private readonly rfqs: RfqRepository,
    private readonly quotations: QuotationRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  private canReachAnyCustomer(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (CUSTOMER_FILE_CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
  }

  /** Logged, not thrown — the real write already committed. */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Comparison audit record (${input.action} ${input.entityType} ${input.entityId}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  private async assertCustomerVisible(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const customer = await this.customers.findById(customerId);
    if (
      !customer ||
      (!this.canReachAnyCustomer(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Customer not found');
    }
  }

  /** Loads an RFQ and enforces the caller's visibility on its Opportunity's
   * Customer; every failure mode collapses to one NotFoundException. */
  private async loadVisibleRfq(
    rfqId: string,
    actor: AuthenticatedUser,
    label: string,
  ): Promise<{
    rfq: RfqWithSubmissions;
    opportunityId: string;
    opportunityStatus: OpportunityStatus;
  }> {
    const rfq = await this.rfqs.findRfqById(rfqId);
    if (!rfq) {
      throw new NotFoundException(label);
    }
    const opportunity = await this.opportunities.findById(rfq.opportunityId);
    if (!opportunity) {
      throw new NotFoundException(label);
    }
    try {
      await this.assertCustomerVisible(opportunity.customerId, actor);
    } catch {
      throw new NotFoundException(label);
    }
    return {
      rfq,
      opportunityId: opportunity.id,
      opportunityStatus: opportunity.status,
    };
  }

  /** Best-effort Opportunity QUOTES_RECEIVED -> COMPARISON_BUILT. Logged,
   * never thrown — not authoritative (derive "a comparison exists" from the
   * `ComparisonMatrix` table, not `Opportunity.status`). */
  private async advanceOpportunityToComparisonBuilt(
    opportunityId: string,
    currentStatus: OpportunityStatus,
    actorUserId: string,
  ): Promise<void> {
    if (currentStatus !== 'QUOTES_RECEIVED') return;
    try {
      await this.workflow.transition({
        entityType: 'Opportunity',
        entityId: opportunityId,
        toStatus: 'COMPARISON_BUILT',
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `Comparison built for Opportunity ${opportunityId} but the QUOTES_RECEIVED -> COMPARISON_BUILT transition did not apply: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The flagged-insurer buckets are **recomputed live on every read** from
   * the current shortlist vs. the insurers actually in the matrix — NOT
   * from the stored `ComparisonMatrix.missingInsurers` snapshot. That
   * column stays a build-time record (it feeds the audit counts), but
   * surfacing it would let the two buckets overlap after a post-build
   * status change (an insurer that was silent at build, so in the stored
   * snapshot, later goes DECLINED — it would appear in *both* lists) or
   * show an insurer as "missing" whose status is now QUOTED. Live-from-the-
   * shortlist keeps `missing` / `declined` / (in-matrix) disjoint at all
   * times; `builtAt` still signals that a row's *terms* may be stale (a
   * quote revised since the build — rebuild to refresh).
   */
  private toView(
    matrix: ComparisonWithRows,
    rfq: RfqWithSubmissions,
  ): ComparisonView {
    const inMatrix = new Set(matrix.rows.map((r) => r.quotation.insurerId));
    const missingInsurers: FlaggedInsurer[] = [];
    const declinedInsurers: FlaggedInsurer[] = [];
    for (const submission of rfq.insurerSubmissions) {
      if (inMatrix.has(submission.insurerId)) continue;
      const flagged: FlaggedInsurer = {
        id: submission.insurerId,
        name: submission.insurer.name,
        status: submission.status,
      };
      if (submission.status === 'DECLINED') declinedInsurers.push(flagged);
      else missingInsurers.push(flagged);
    }
    return {
      id: matrix.id,
      rfqId: matrix.rfqId,
      insuranceLine: matrix.rfq.insuranceLine,
      builtAt: matrix.builtAt,
      builtByUserId: matrix.builtByUserId,
      rows: matrix.rows,
      missingInsurers,
      declinedInsurers,
    };
  }

  async build(
    dto: BuildComparisonDto,
    actor: AuthenticatedUser,
  ): Promise<ComparisonView> {
    const { rfq, opportunityId, opportunityStatus } = await this.loadVisibleRfq(
      dto.rfqId,
      actor,
      'RFQ not found',
    );

    const quotations = await this.quotations.findManyByRfqId(dto.rfqId);
    const plan = planComparison(
      quotations.map((q) => ({
        id: q.id,
        insurerId: q.insurerId,
        isCurrentVersion: q.isCurrentVersion,
      })),
      rfq.insurerSubmissions.map((s) => ({
        insurerId: s.insurerId,
        status: s.status,
      })),
      dto.scores ?? [],
    );

    const { matrix, created } = await this.comparisons.buildOrRebuild({
      rfqId: dto.rfqId,
      builtByUserId: actor.id,
      missingInsurerIds: plan.missingInsurerIds,
      rows: plan.rows,
    });

    await this.safeAudit({
      userId: actor.id,
      action: created ? 'CREATE' : 'UPDATE',
      entityType: 'ComparisonMatrix',
      entityId: matrix.id,
      afterValue: {
        rfqId: dto.rfqId,
        rowCount: plan.rows.length,
        scoredRowCount: plan.rows.filter(
          (r) => r.insurerQualityScore !== null || r.serviceScore !== null,
        ).length,
        missingInsurerCount: plan.missingInsurerIds.length,
        declinedInsurerCount: plan.declinedInsurerIds.length,
      },
    });

    await this.advanceOpportunityToComparisonBuilt(
      opportunityId,
      opportunityStatus,
      actor.id,
    );

    return this.toView(matrix, rfq);
  }

  async get(rfqId: string, actor: AuthenticatedUser): Promise<ComparisonView> {
    const { rfq } = await this.loadVisibleRfq(rfqId, actor, 'RFQ not found');
    const matrix = await this.comparisons.findByRfqId(rfqId);
    if (!matrix) {
      throw new NotFoundException(
        'No comparison matrix has been built for this RFQ yet.',
      );
    }
    return this.toView(matrix, rfq);
  }

  async getById(id: string, actor: AuthenticatedUser): Promise<ComparisonView> {
    const matrix = await this.comparisons.findById(id);
    if (!matrix) {
      throw new NotFoundException('Comparison matrix not found');
    }
    const { rfq } = await this.loadVisibleRfq(
      matrix.rfqId,
      actor,
      'Comparison matrix not found',
    );
    return this.toView(matrix, rfq);
  }
}
