import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { UpSellRecommendation, UpSellStatus } from '@ibms/db';
import { UpSellRecommendationRepository } from '../../repositories/up-sell-recommendation.repository';
import { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { VIEW_ALL_OWNERS_ROLES } from '../../common/rbac-visibility.util';
import {
  addMoney,
  compareMoney,
  formatMoney,
  quantizeMoney,
} from '../../common/money.util';
import { deriveSumInsured } from '../risk-profile/risk-profile.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  assessUnderinsurance,
  PROPERTY_ALL_RISKS_LINE,
  UNDERINSURANCE_THRESHOLD_PERCENT,
} from './up-sell.config';

/** The two figures the comparison is built from, plus what they were
 * sourced from — computed fresh on every scan. Money as fixed-3dp strings. */
export interface UpSellFigures {
  /** Σ "Property All Risks" `sumInsuredBasis` over the customer's
   * non-SUPERSEDED programs. */
  currentSumInsured: string;
  /** `deriveSumInsured(...).propertySumInsured` over the customer's whole
   * asset survey. */
  currentAssetValue: string;
  /** How many non-SUPERSEDED programs contributed a property line basis. */
  programLineCount: number;
  /** How many assets fed `currentAssetValue`. */
  assetCount: number;
}

export interface UpSellDetectionOutcome extends UpSellFigures {
  shortfall: string;
  thresholdAmount: string;
  isUnderinsured: boolean;
  /** The recommendation THIS run created, or `null` (not under-insured, not
   * assessable, suppressed by a prior resolution, or a concurrent scan
   * flagged it first). */
  flagged: UpSellRecommendation | null;
  /** True when a real under-insurance verdict was suppressed because the
   * customer already resolved a recommendation at this asset level or
   * higher — see the re-nag pre-check in `runDetection`. */
  suppressedByPriorResolution: boolean;
}

export interface UpSellDetectionView extends UpSellDetectionOutcome {
  customerId: string;
  thresholdPercent: string;
  /** The customer's current OPEN recommendation (this run's or a prior one). */
  openRecommendation: UpSellRecommendation | null;
}

/**
 * Process 9 — Up-Selling (backlog Part C #9, Domain A).
 *
 * An `UpSellRecommendation` is only ever created by the detection scan —
 * there is no user-facing "raise a recommendation" path. The scan compares
 * a customer's currently designed **property Sum Insured** (Σ of the
 * "Property All Risks" line's `sumInsuredBasis` over their non-SUPERSEDED
 * `InsuranceProgram`s, Process 7) against the **current value of their
 * surveyed assets** (`deriveSumInsured(...).propertySumInsured` over the
 * `RiskProfile` asset survey, Process 6) and flags a proposed increase when
 * the asset value is materially higher (`assessUnderinsurance`,
 * up-sell.config.ts, pure). It runs nightly (UpSellDetectionScheduler) and
 * on-demand (`POST /up-sell-recommendations/detect`). Every figure goes
 * through money.util.ts (fils precision,
 * ibms-brain/meta/lex/money-decimal-jod.md).
 *
 * Idempotency / race safety (ibms-brain/meta/lex/race-safe-invariants.md):
 * a **partial** UNIQUE index (`customerId WHERE status = 'OPEN'`) keeps at
 * most one OPEN recommendation per customer, and `create()` catches Prisma
 * `P2002` as "a concurrent scan flagged it first, skip". A CONVERTED /
 * DISMISSED recommendation frees that slot — but a pre-check suppresses an
 * immediate re-flag until the asset value has actually grown past what was
 * last flagged, so a customer who declined an increase is not nagged
 * nightly with the same figure.
 *
 * `status` moves ONLY through WorkflowTransitionService (A.6) — `convert()`
 * / `dismiss()` are the only two moves (OPEN -> CONVERTED | DISMISSED, both
 * terminal). No maker/checker: acting on a system-surfaced nudge is a
 * single-actor Sales task (`up-sell.convert`), not an approval.
 *
 * Visibility mirrors cross-sell.service.ts / lead.service.ts (a
 * Sales-pipeline concern): a Sales/Relationship Officer sees only
 * recommendations on a Customer they own; Manager/Executive
 * (VIEW_ALL_OWNERS_ROLES) get the org-wide view.
 */
@Injectable()
export class UpSellService {
  private readonly logger = new Logger(UpSellService.name);

  constructor(
    private readonly recommendations: UpSellRecommendationRepository,
    private readonly insurancePrograms: InsuranceProgramRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  private canViewAllOwners(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (VIEW_ALL_OWNERS_ROLES as readonly string[]).includes(role),
    );
  }

  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `UpSellRecommendation ${input.entityId}: audit record (${input.action}) failed after the operation already committed`,
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
      (!this.canViewAllOwners(actor) && customer.ownerUserId !== actor.id)
    ) {
      throw new NotFoundException('Customer not found');
    }
  }

  private async findVisibleRecommendation(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<UpSellRecommendation> {
    const recommendation = await this.recommendations.findById(id);
    if (!recommendation) {
      throw new NotFoundException('UpSellRecommendation not found');
    }
    try {
      await this.assertCustomerVisible(recommendation.customerId, actor);
    } catch {
      throw new NotFoundException('UpSellRecommendation not found');
    }
    return recommendation;
  }

  private async mustFind(id: string): Promise<UpSellRecommendation> {
    const recommendation = await this.recommendations.findById(id);
    if (!recommendation) {
      throw new NotFoundException(`UpSellRecommendation ${id} not found`);
    }
    return recommendation;
  }

  /** Σ of the "Property All Risks" line's `sumInsuredBasis` over the
   * customer's non-SUPERSEDED programs, plus how many lines contributed. */
  private async currentSumInsuredFor(
    customerId: string,
  ): Promise<{ total: Prisma.Decimal; lineCount: number }> {
    const programs =
      await this.insurancePrograms.findManyByCustomerId(customerId);
    const bases = programs
      .filter((p) => p.status !== 'SUPERSEDED')
      .flatMap((p) => p.lines)
      .filter(
        (l) =>
          l.insuranceLine === PROPERTY_ALL_RISKS_LINE &&
          l.sumInsuredBasis != null,
      )
      .map((l) => l.sumInsuredBasis as Prisma.Decimal);

    return {
      total: bases.length > 0 ? addMoney(...bases) : new Prisma.Decimal(0),
      lineCount: bases.length,
    };
  }

  /** `deriveSumInsured(...).propertySumInsured` over every asset behind the
   * customer's whole book of Risk Profiles. */
  private async currentAssetValueFor(
    customerId: string,
  ): Promise<{ value: Prisma.Decimal; assetCount: number }> {
    const assets = await this.riskProfiles.findAssetsByCustomerId(customerId);
    const summary = deriveSumInsured(
      assets.map((a) => ({
        assetType: a.assetType,
        declaredValue: a.declaredValue,
        annualGrossProfit: a.annualGrossProfit,
        indemnityPeriodMonths: a.indemnityPeriodMonths,
        fleetVehicleCount: a.fleetVehicleCount,
      })),
    );
    return {
      value: quantizeMoney(summary.propertySumInsured),
      assetCount: summary.assetCount,
    };
  }

  /**
   * The core under-insurance scan for one customer, with NO visibility gate
   * — shared by the HTTP `detect()` (which gates first) and the nightly
   * sweep (system actor).
   */
  async runDetection(
    customerId: string,
    detectedByUserId: string,
  ): Promise<UpSellDetectionOutcome> {
    const customer = await this.customers.findById(customerId);

    const [si, av] = customer
      ? await Promise.all([
          this.currentSumInsuredFor(customerId),
          this.currentAssetValueFor(customerId),
        ])
      : [
          { total: new Prisma.Decimal(0), lineCount: 0 },
          { value: new Prisma.Decimal(0), assetCount: 0 },
        ];

    const verdict = assessUnderinsurance({
      currentSumInsured: si.total,
      currentAssetValue: av.value,
    });

    const base: UpSellDetectionOutcome = {
      currentSumInsured: formatMoney(si.total),
      currentAssetValue: formatMoney(av.value),
      programLineCount: si.lineCount,
      assetCount: av.assetCount,
      shortfall: verdict.shortfall,
      thresholdAmount: verdict.thresholdAmount,
      isUnderinsured: verdict.isUnderinsured,
      flagged: null,
      suppressedByPriorResolution: false,
    };

    if (!customer || !verdict.isUnderinsured) return base;

    // Re-nag pre-check (a convenience, not the invariant — the partial
    // UNIQUE index below is what enforces "one OPEN per customer"): if the
    // customer already CONVERTED/DISMISSED a recommendation at this asset
    // value or higher, don't surface the same figure again. Only re-flag
    // once their assets have actually grown past what we last told them.
    const priorResolved =
      await this.recommendations.findLatestResolvedByCustomerId(customerId);
    if (
      priorResolved &&
      compareMoney(av.value, priorResolved.currentAssetValue) <= 0
    ) {
      return { ...base, suppressedByPriorResolution: true };
    }

    let flagged: UpSellRecommendation;
    try {
      flagged = await this.recommendations.create({
        customerId,
        currentSumInsured: quantizeMoney(si.total),
        currentAssetValue: quantizeMoney(av.value),
        detectedByUserId,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return base; // a concurrent scan flagged this customer first
      }
      throw err;
    }

    await this.safeAudit({
      userId: detectedByUserId,
      action: 'CREATE',
      entityType: 'UpSellRecommendation',
      entityId: flagged.id,
      afterValue: {
        customerId,
        currentSumInsured: formatMoney(flagged.currentSumInsured),
        currentAssetValue: formatMoney(flagged.currentAssetValue),
        shortfall: verdict.shortfall,
        status: flagged.status,
      },
    });

    return { ...base, flagged };
  }

  /** On-demand under-insurance scan for one customer
   * (`POST /up-sell-recommendations/detect`). */
  async detect(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<UpSellDetectionView> {
    await this.assertCustomerVisible(customerId, actor);
    const outcome = await this.runDetection(customerId, actor.id);
    const open = await this.recommendations.findManyByCustomerId(
      customerId,
      'OPEN',
    );
    return {
      customerId,
      thresholdPercent: UNDERINSURANCE_THRESHOLD_PERCENT,
      ...outcome,
      openRecommendation: open[0] ?? null,
    };
  }

  async list(
    customerId: string,
    actor: AuthenticatedUser,
    status?: UpSellStatus,
  ): Promise<UpSellRecommendation[]> {
    await this.assertCustomerVisible(customerId, actor);
    return this.recommendations.findManyByCustomerId(customerId, status);
  }

  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<UpSellRecommendation> {
    return this.findVisibleRecommendation(id, actor);
  }

  /** OPEN -> CONVERTED. Records the decision only — taking the proposed
   * increase forward is an endorsement / re-quote (Process 22 / 11+, not
   * built), the same edge `CrossSellStatus.CONVERTED` sits at. */
  async convert(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<UpSellRecommendation> {
    await this.findVisibleRecommendation(id, actor);
    await this.workflow.transition({
      entityType: 'UpSellRecommendation',
      entityId: id,
      toStatus: 'CONVERTED',
      actorUserId: actor.id,
      data: { resolvedByUserId: actor.id, resolvedAt: new Date() },
    });
    return this.mustFind(id);
  }

  /** OPEN -> DISMISSED, with a mandatory reason (why the increase is not
   * being pursued). */
  async dismiss(
    id: string,
    actor: AuthenticatedUser,
    reason: string,
  ): Promise<UpSellRecommendation> {
    await this.findVisibleRecommendation(id, actor);
    await this.workflow.transition({
      entityType: 'UpSellRecommendation',
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
