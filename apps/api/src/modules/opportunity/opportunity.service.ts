import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { Opportunity, OpportunityStatus } from '@ibms/db';
import {
  OpportunityRepository,
  type CreateOpportunityInput,
} from '../../repositories/opportunity.repository';
import { InsuranceProgramRepository } from '../../repositories/insurance-program.repository';
import { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { quantizeMoney } from '../../common/money.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateOpportunityDto } from './dto/create-opportunity.dto';
import type { SetTargetPremiumThresholdDto } from './dto/set-target-premium-threshold.dto';

/** The programme context echoed back on a create / get so the caller can see
 * which finalized Insurance Program this Opportunity was taken to market
 * from. */
export interface OpportunityContext {
  insuranceProgramId: string | null;
  customerId: string;
}

export interface OpportunityView extends Opportunity {
  context: OpportunityContext;
}

/**
 * Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). This
 * module is the **minimal parent** an `RFQ` hangs off, in the same shape as
 * Process 5's minimal RiskProfile parent: it creates an `Opportunity` from a
 * FINALIZED `InsuranceProgram` (ibms-brain/meta/context/policy-lifecycle.md —
 * the designed programme is what feeds an Opportunity/RFQ) and then only
 * lists / reads it. The full Opportunity lifecycle — Recommendation, Client
 * Decision (6 outcomes), renegotiation, close-lost, `targetPremiumThreshold`
 * — is Processes 16-17 and NOT built here.
 *
 * `status` moves ONLY through WorkflowTransitionService (A.6). This module
 * exposes no transition endpoint: the one move this backlog item drives
 * (NEEDS_CONFIRMED -> RFQ_ISSUED) happens from `rfq.service.ts` when the
 * first RFQ is issued.
 *
 * "At most one live Opportunity per InsuranceProgram" is a real DB invariant
 * — the partial UNIQUE index `Opportunity_one_live_per_insurance_program`
 * (migration 20260828120000, ibms-brain/meta/lex/race-safe-invariants.md).
 * `create()` keeps a descriptive pre-check for the common non-racing path
 * and maps the Prisma P2002 to the same 409 for the concurrent case.
 *
 * Visibility: an Opportunity inherits its Risk Profile's Customer's
 * visibility — the Sales/Relationship Officer who owns that Customer sees it;
 * Placement/Manager/Executive (CUSTOMER_FILE_CROSS_OWNER_ROLES) work the
 * whole book. Same pattern as InsuranceProgramService.
 */
@Injectable()
export class OpportunityService {
  private readonly logger = new Logger(OpportunityService.name);

  constructor(
    private readonly opportunities: OpportunityRepository,
    private readonly programs: InsuranceProgramRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
  ) {}

  private canReachAnyCustomer(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (CUSTOMER_FILE_CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
  }

  /** Logged, not thrown — the real write already committed; an audit hiccup
   * must not turn a successful operation into a reported failure (same
   * philosophy as InsuranceProgramService / the workflow engine's own
   * sideEffect catch). */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Opportunity ${input.entityId}: audit record (${input.action}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** Resolves the Customer behind a Risk Profile and enforces the caller's
   * visibility on it. NotFoundException either way (missing customer, or one
   * the caller can't see) so the response can't be used as an existence
   * oracle — same pattern as InsuranceProgramService.assertCustomerVisible(). */
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

  /** Resolves the Customer behind an already-loaded Insurance Program
   * (program -> risk profile -> customer) and enforces the caller's
   * visibility on it. Every failure mode collapses to one NotFoundException
   * on the program — no existence oracle. */
  private async resolveVisibleProgramCustomerId(
    program: { id: string; riskProfileId: string },
    actor: AuthenticatedUser,
  ): Promise<string> {
    const riskProfile = await this.riskProfiles.findById(program.riskProfileId);
    if (!riskProfile) {
      throw new NotFoundException('InsuranceProgram not found');
    }
    try {
      await this.assertCustomerVisible(riskProfile.customerId, actor);
    } catch {
      throw new NotFoundException('InsuranceProgram not found');
    }
    return riskProfile.customerId;
  }

  private async findVisible(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Opportunity> {
    const opportunity = await this.opportunities.findById(id);
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found');
    }
    try {
      await this.assertCustomerVisible(opportunity.customerId, actor);
    } catch {
      throw new NotFoundException('Opportunity not found');
    }
    return opportunity;
  }

  private toView(opportunity: Opportunity): OpportunityView {
    return {
      ...opportunity,
      context: {
        insuranceProgramId: opportunity.insuranceProgramId,
        customerId: opportunity.customerId,
      },
    };
  }

  /** Inserts the Opportunity row, translating the partial-UNIQUE-index
   * violation (a concurrent create() for the same Insurance Program lost the
   * race — see migration 20260828120000) into the same 409 the pre-check
   * raises. */
  private async insertRow(input: CreateOpportunityInput): Promise<Opportunity> {
    try {
      return await this.opportunities.create(input);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `InsuranceProgram ${input.insuranceProgramId} already has a live Opportunity — take that one to market instead of creating another.`,
        );
      }
      throw err;
    }
  }

  async create(
    dto: CreateOpportunityDto,
    actor: AuthenticatedUser,
  ): Promise<OpportunityView> {
    const program = await this.programs.findById(dto.insuranceProgramId);
    if (!program) {
      throw new NotFoundException('InsuranceProgram not found');
    }
    const customerId = await this.resolveVisibleProgramCustomerId(
      program,
      actor,
    );

    if (program.status !== 'FINALIZED') {
      throw new UnprocessableEntityException(
        `InsuranceProgram ${program.id} is ${program.status}; finalize it before taking it to market.`,
      );
    }

    // The partial UNIQUE index (migration 20260828120000) is the real
    // enforcement — insertRow() maps its violation to 409. This pre-check is
    // the fast path: a descriptive 409 (naming the existing Opportunity)
    // whenever there is no actual race.
    const existing = await this.opportunities.findManyByInsuranceProgramId(
      dto.insuranceProgramId,
    );
    const live = existing.find((o) => o.status !== 'CLOSED_LOST');
    if (live) {
      throw new ConflictException(
        `InsuranceProgram ${dto.insuranceProgramId} already has a ${live.status} Opportunity (${live.id}).`,
      );
    }

    const opportunity = await this.insertRow({
      customerId,
      insuranceProgramId: dto.insuranceProgramId,
      createdByUserId: actor.id,
    });

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Opportunity',
      entityId: opportunity.id,
      afterValue: {
        customerId: opportunity.customerId,
        insuranceProgramId: opportunity.insuranceProgramId,
        status: opportunity.status,
      },
    });

    return this.toView(opportunity);
  }

  async list(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<Opportunity[]> {
    await this.assertCustomerVisible(customerId, actor);
    return this.opportunities.findManyByCustomerId(customerId);
  }

  async get(id: string, actor: AuthenticatedUser): Promise<OpportunityView> {
    return this.toView(await this.findVisible(id, actor));
  }

  /**
   * Backlog Part C #16 — set (or clear) the Opportunity's configurable
   * senior-officer approval threshold. A recommended quote whose premium
   * exceeds this needs `recommendation.approve` before it can be sent to the
   * client. Changing it at `RECOMMENDATION_DRAFTED` **does** take effect on
   * an already-drafted recommendation: `RecommendationService` re-derives the
   * send-gates from live data (this field + the current competing quotes),
   * OR'd with the draft-time snapshot, so a gate can be added late but never
   * silently cleared. Refused only once the recommendation has been sent
   * (`SENT_TO_CLIENT` onward), where changing the bar would be pointless.
   */
  async setTargetPremiumThreshold(
    id: string,
    dto: SetTargetPremiumThresholdDto,
    actor: AuthenticatedUser,
  ): Promise<OpportunityView> {
    const opportunity = await this.findVisible(id, actor);

    const OPEN_TO_THRESHOLD_CHANGE: OpportunityStatus[] = [
      'NEEDS_CONFIRMED',
      'RFQ_ISSUED',
      'QUOTES_RECEIVED',
      'COMPARISON_BUILT',
      'RECOMMENDATION_DRAFTED',
      'RENEGOTIATE',
    ];
    if (!OPEN_TO_THRESHOLD_CHANGE.includes(opportunity.status)) {
      throw new UnprocessableEntityException(
        `Opportunity ${id} is ${opportunity.status}; the target premium threshold can only be changed before the recommendation is sent.`,
      );
    }

    const value =
      dto.targetPremiumThreshold === null
        ? null
        : quantizeMoney(dto.targetPremiumThreshold);
    if (value !== null && value.isNegative()) {
      throw new UnprocessableEntityException(
        'targetPremiumThreshold cannot be negative.',
      );
    }

    const updated = await this.opportunities.updateTargetPremiumThreshold(
      id,
      value,
    );

    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'Opportunity',
      entityId: id,
      afterValue: {
        targetPremiumThreshold: value === null ? null : value.toFixed(3),
      },
    });

    return this.toView(updated);
  }
}
