import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type {
  InsuranceProgram,
  NeedsAssessment,
  NeedsAssessmentStatus,
} from '@ibms/db';
import {
  InsuranceProgramRepository,
  type InsuranceProgramLineInput,
  type InsuranceProgramWithLines,
} from '../../repositories/insurance-program.repository';
import { NeedsAssessmentRepository } from '../../repositories/needs-assessment.repository';
import { RiskProfileRepository } from '../../repositories/risk-profile.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import { CUSTOMER_FILE_CROSS_OWNER_ROLES } from '../../common/rbac-visibility.util';
import { quantizeMoney } from '../../common/money.util';
import {
  deriveSumInsured,
  type SumInsuredSummary,
} from '../risk-profile/risk-profile.config';
import {
  assembleProgramLines,
  type AssembledProgramLine,
} from './insurance-program.config';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AssembleInsuranceProgramDto } from './dto/assemble-insurance-program.dto';

/** The derivation inputs echoed back on `GET /insurance-programs/:id` so the
 * Placement Officer can see *why* each line's Sum Insured basis is what it
 * is — and what a re-assembly would produce from the current survey. */
export interface InsuranceProgramContext {
  needsAssessmentId: string | null;
  needsAssessmentStatus: NeedsAssessmentStatus | null;
  /** The source coverage list the lines were assembled from. */
  recommendedCoverageLines: string[];
  riskProfileId: string;
  customerId: string | null;
  siteLabel: string | null;
  /** The Risk Profile's currently-derived Sum Insured — a re-assembly would
   * seed the Property / BI lines from these figures. */
  sumInsured: SumInsuredSummary;
  /** False when the asset survey has no rows — Property / BI lines then
   * carry a `null` basis (see insurance-program.config.ts). */
  surveyComplete: boolean;
}

export interface InsuranceProgramView extends InsuranceProgramWithLines {
  context: InsuranceProgramContext;
}

/**
 * Process 7 — Product Recommendation / Program Design (backlog Part C #7,
 * Domain A). Assembles a multi-line `InsuranceProgram` from the
 * risk-assessment results: an APPROVED `NeedsAssessment` (Process 5) supplies
 * the coverage-line set, and its parent `RiskProfile`'s asset survey
 * (Process 6, `deriveSumInsured`) supplies the per-line Sum Insured basis.
 * The mapping is pure and deterministic — see insurance-program.config.ts.
 *
 * Status moves ONLY through WorkflowTransitionService (A.6,
 * ibms-brain/meta/lex/workflow-state-transitions.md). The chain (see
 * workflow-transitions.config.ts):
 *
 *   DRAFT -[finalize]-> FINALIZED   (locked to feed an Opportunity/RFQ —
 *                                    Process 11+, not built)
 *   FINALIZED -[reopen]-> DRAFT     (a finalized program with an error is
 *                                    not a dead end)
 *   {DRAFT | FINALIZED} -> SUPERSEDED  (modeled for a re-assembled
 *     replacement — e.g. a mid-cycle risk change per policy-lifecycle.md —
 *     but no endpoint triggers it in this backlog item yet)
 *
 * There is no maker/checker gate on a program: assembly is a single-actor
 * Placement/Technical Officer task (`program.assemble`, PLACEMENT only), and
 * the coverage set it is built from was already maker/checker-approved at the
 * Needs Assessment stage (A.5).
 *
 * Visibility: a program inherits its Risk Profile's Customer's visibility —
 * the Sales/Relationship Officer who owns that Customer sees it;
 * Placement/Manager/Executive (CUSTOMER_FILE_CROSS_OWNER_ROLES) work the
 * whole book. Same pattern as RiskProfileService / NeedsAssessmentService.
 */
@Injectable()
export class InsuranceProgramService {
  private readonly logger = new Logger(InsuranceProgramService.name);

  constructor(
    private readonly programs: InsuranceProgramRepository,
    private readonly assessments: NeedsAssessmentRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowTransitionService,
  ) {}

  private canReachAnyCustomer(actor: AuthenticatedUser): boolean {
    return actor.roles.some((role) =>
      (CUSTOMER_FILE_CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
  }

  /** Logged, not thrown — the real write already committed; an audit hiccup
   * must not turn a successful operation into a reported failure (same
   * philosophy as RiskProfileService / NeedsAssessmentService and the
   * workflow engine's own sideEffect catch). */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `InsuranceProgram ${input.entityId}: audit record (${input.action}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** Resolves the Customer behind a Risk Profile and enforces the caller's
   * visibility on it. NotFoundException either way (missing customer, or one
   * the caller can't see) so the response can't be used as an existence
   * oracle — same pattern as RiskProfileService.assertCustomerVisible(). */
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

  private async assertRiskProfileVisible(
    riskProfileId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const riskProfile = await this.riskProfiles.findById(riskProfileId);
    if (!riskProfile) {
      throw new NotFoundException('RiskProfile not found');
    }
    try {
      await this.assertCustomerVisible(riskProfile.customerId, actor);
    } catch {
      throw new NotFoundException('RiskProfile not found');
    }
  }

  /** find-or-404 a program with the Risk Profile / Customer visibility gate
   * applied; the failure modes collapse into one NotFoundException. */
  private async findVisibleProgram(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<InsuranceProgramWithLines> {
    const program = await this.programs.findById(id);
    if (!program) {
      throw new NotFoundException('InsuranceProgram not found');
    }
    try {
      await this.assertRiskProfileVisible(program.riskProfileId, actor);
    } catch {
      throw new NotFoundException('InsuranceProgram not found');
    }
    return program;
  }

  private async loadSummary(riskProfileId: string): Promise<SumInsuredSummary> {
    const assets =
      await this.riskProfiles.findAssetsByRiskProfileId(riskProfileId);
    return deriveSumInsured(
      assets.map((a) => ({
        assetType: a.assetType,
        declaredValue: a.declaredValue,
        annualGrossProfit: a.annualGrossProfit,
        indemnityPeriodMonths: a.indemnityPeriodMonths,
        fleetVehicleCount: a.fleetVehicleCount,
      })),
    );
  }

  private toLineInputs(
    lines: readonly AssembledProgramLine[],
  ): InsuranceProgramLineInput[] {
    return lines.map((line) => ({
      insuranceLine: line.insuranceLine,
      // Already a fils-precision string off deriveSumInsured — quantize again
      // at the persistence boundary per money-decimal-jod.md rather than
      // trusting the upstream format.
      sumInsuredBasis:
        line.sumInsuredBasis == null
          ? null
          : quantizeMoney(line.sumInsuredBasis),
    }));
  }

  private async buildContext(
    program: InsuranceProgramWithLines,
  ): Promise<InsuranceProgramContext> {
    const [assessment, summary, riskProfile] = await Promise.all([
      program.needsAssessmentId
        ? this.assessments.findById(program.needsAssessmentId)
        : Promise.resolve<NeedsAssessment | null>(null),
      this.loadSummary(program.riskProfileId),
      this.riskProfiles.findById(program.riskProfileId),
    ]);
    return {
      needsAssessmentId: program.needsAssessmentId,
      needsAssessmentStatus: assessment?.status ?? null,
      recommendedCoverageLines: assessment?.recommendedCoverageLines ?? [],
      riskProfileId: program.riskProfileId,
      customerId: riskProfile?.customerId ?? null,
      siteLabel: riskProfile?.siteLabel ?? null,
      sumInsured: summary,
      surveyComplete: summary.assetCount > 0,
    };
  }

  private async toView(
    program: InsuranceProgramWithLines,
  ): Promise<InsuranceProgramView> {
    return { ...program, context: await this.buildContext(program) };
  }

  /** Re-reads a program after a lines rewrite / transition. */
  private async mustFind(id: string): Promise<InsuranceProgramWithLines> {
    const program = await this.programs.findById(id);
    if (!program) {
      throw new NotFoundException(`InsuranceProgram ${id} not found`);
    }
    return program;
  }

  private assertApproved(assessment: NeedsAssessment): void {
    const status: NeedsAssessmentStatus = assessment.status;
    if (status !== 'APPROVED') {
      throw new UnprocessableEntityException(
        `NeedsAssessment ${assessment.id} is ${status}; a program can only be assembled from an APPROVED needs assessment.`,
      );
    }
    if (assessment.recommendedCoverageLines.length === 0) {
      throw new UnprocessableEntityException(
        `NeedsAssessment ${assessment.id} recommends no coverage lines — there is nothing to assemble.`,
      );
    }
  }

  /** Inserts the program row, translating the partial-UNIQUE-index violation
   * (a concurrent assemble() for the same Risk Profile lost the race — see
   * migration 20260827180000) into the same 409 the pre-check raises. */
  private async insertProgramRow(
    riskProfileId: string,
    needsAssessmentId: string,
    assembledByUserId: string,
  ): Promise<InsuranceProgram> {
    try {
      return await this.programs.create({
        riskProfileId,
        needsAssessmentId,
        assembledByUserId,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `RiskProfile ${riskProfileId} already has a live program — re-assemble or reopen it instead of creating another.`,
        );
      }
      throw err;
    }
  }

  async assemble(
    dto: AssembleInsuranceProgramDto,
    actor: AuthenticatedUser,
  ): Promise<InsuranceProgramView> {
    const assessment = await this.assessments.findById(dto.needsAssessmentId);
    if (!assessment) {
      throw new NotFoundException('NeedsAssessment not found');
    }
    // Normalise the "exists but not visible" branch to the same message as
    // "does not exist" — the response must not be an existence oracle for
    // another officer's needs assessment (same rule RiskProfileService's
    // own helpers apply).
    try {
      await this.assertRiskProfileVisible(assessment.riskProfileId, actor);
    } catch {
      throw new NotFoundException('NeedsAssessment not found');
    }
    this.assertApproved(assessment);

    // "One live program per Risk Profile" is enforced by a partial UNIQUE
    // index (migration 20260827180000) — insertProgramRow() maps its
    // violation to 409. This pre-check is the fast path: a descriptive 409
    // (naming the existing program) whenever there is no actual race. A
    // re-assembly reuses the DRAFT program (see reassemble()); a genuinely
    // fresh one needs the current program SUPERSEDED first (no endpoint yet).
    const existing = await this.programs.findManyByRiskProfileId(
      assessment.riskProfileId,
    );
    const live = existing.find((p) => p.status !== 'SUPERSEDED');
    if (live) {
      throw new ConflictException(
        `RiskProfile ${assessment.riskProfileId} already has a ${live.status} program (${live.id}) — re-assemble or reopen it instead of creating another.`,
      );
    }

    const summary = await this.loadSummary(assessment.riskProfileId);
    const lines = assembleProgramLines(
      assessment.recommendedCoverageLines,
      summary,
    );

    const program = await this.insertProgramRow(
      assessment.riskProfileId,
      assessment.id,
      actor.id,
    );

    // Audit the creation BEFORE the lines write: a crash in between still
    // leaves a CREATE trail (Part 10.3), and the resulting zero-line DRAFT
    // program is recoverable via reassemble().
    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'InsuranceProgram',
      entityId: program.id,
      afterValue: {
        riskProfileId: program.riskProfileId,
        needsAssessmentId: assessment.id,
        status: program.status,
        lineCount: lines.length,
        insuranceLines: lines.map((l) => l.insuranceLine),
      },
    });

    await this.programs.createLines(program.id, this.toLineInputs(lines));

    return this.toView(await this.mustFind(program.id));
  }

  /** Re-derives a DRAFT program's lines from the (still-APPROVED) source
   * Needs Assessment and the current asset survey — replaces them wholesale,
   * the same "PATCH replaces in place" shape Process 6 uses for an Asset. */
  async reassemble(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<InsuranceProgramView> {
    const program = await this.findVisibleProgram(id, actor);
    if (program.status !== 'DRAFT') {
      throw new UnprocessableEntityException(
        `InsuranceProgram ${id}: only a DRAFT program can be re-assembled (this one is ${program.status}). Reopen it first.`,
      );
    }
    if (!program.needsAssessmentId) {
      throw new UnprocessableEntityException(
        `InsuranceProgram ${id}: no source needs assessment recorded — cannot re-assemble.`,
      );
    }
    const assessment = await this.assessments.findById(
      program.needsAssessmentId,
    );
    if (!assessment) {
      throw new NotFoundException('NeedsAssessment not found');
    }
    this.assertApproved(assessment);

    const summary = await this.loadSummary(program.riskProfileId);
    const lines = assembleProgramLines(
      assessment.recommendedCoverageLines,
      summary,
    );

    // Re-read status immediately before the wholesale rewrite: a finalize()
    // landing in the window since the guard above must not have its lines
    // silently replaced under the FINALIZED lock.
    const current = await this.programs.findById(program.id);
    if (!current || current.status !== 'DRAFT') {
      throw new UnprocessableEntityException(
        `InsuranceProgram ${id}: no longer DRAFT — re-assembly aborted.`,
      );
    }

    await this.programs.deleteLines(program.id);
    await this.programs.createLines(program.id, this.toLineInputs(lines));

    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'InsuranceProgram',
      entityId: program.id,
      afterValue: {
        reassembled: true,
        lineCount: lines.length,
        insuranceLines: lines.map((l) => l.insuranceLine),
      },
    });

    return this.toView(await this.mustFind(program.id));
  }

  /** DRAFT -> FINALIZED. Refuses a program with no lines — a finalized
   * program is meant to feed an Opportunity/RFQ (Process 11+). */
  async finalize(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<InsuranceProgramView> {
    const program = await this.findVisibleProgram(id, actor);
    if (program.lines.length === 0) {
      throw new UnprocessableEntityException(
        `InsuranceProgram ${id}: has no lines — re-assemble it before finalizing.`,
      );
    }
    await this.workflow.transition({
      entityType: 'InsuranceProgram',
      entityId: id,
      toStatus: 'FINALIZED',
      actorUserId: actor.id,
    });
    return this.toView(await this.mustFind(id));
  }

  /** FINALIZED -> DRAFT — reopen for revision. */
  async reopen(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<InsuranceProgramView> {
    await this.findVisibleProgram(id, actor);
    await this.workflow.transition({
      entityType: 'InsuranceProgram',
      entityId: id,
      toStatus: 'DRAFT',
      actorUserId: actor.id,
    });
    return this.toView(await this.mustFind(id));
  }

  async list(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<InsuranceProgramWithLines[]> {
    await this.assertCustomerVisible(customerId, actor);
    return this.programs.findManyByCustomerId(customerId);
  }

  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<InsuranceProgramView> {
    return this.toView(await this.findVisibleProgram(id, actor));
  }
}
