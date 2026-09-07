import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BcpDrPlan } from '@ibms/db';
import { BcpDrPlanRepository } from '../../repositories/bcp-dr-plan.repository';
import { DocumentRepository } from '../../repositories/document.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import {
  computeScenarioCoverage,
  type ScenarioCoverageView,
} from './bcp-dr-plan.config';
import type { CreateBcpDrPlanDto } from './dto/create-bcp-dr-plan.dto';
import type { UpdateBcpDrPlanDto } from './dto/update-bcp-dr-plan.dto';
import type { ListBcpDrPlansQueryDto } from './dto/list-bcp-dr-plans-query.dto';
import type { RecordBcpDrPlanTestDto } from './dto/record-bcp-dr-plan-test.dto';

/** Process 72-73 — the foundational `BcpDrPlan` CRUD + the scenario
 * coverage gap-check. See `bcp-dr-plan.config.ts` for the full design and
 * `ibms-brain/meta/context/bcp-dr-planning.md`. */
@Injectable()
export class BcpDrPlanService {
  private readonly logger = new Logger(BcpDrPlanService.name);

  constructor(
    private readonly plans: BcpDrPlanRepository,
    private readonly documents: DocumentRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateBcpDrPlanDto,
    actorUserId: string,
  ): Promise<BcpDrPlan> {
    if (dto.planDocumentId) {
      const doc = await this.documents.findById(dto.planDocumentId);
      if (!doc) throw new NotFoundException('Plan document not found');
    }

    const plan = await this.plans.create({
      scenario: dto.scenario,
      planDocumentId: dto.planDocumentId ?? null,
      rtoHours: dto.rtoHours ?? null,
      rpoHours: dto.rpoHours ?? null,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'BcpDrPlan',
      entityId: plan.id,
      afterValue: {
        scenario: plan.scenario,
        planDocumentId: plan.planDocumentId,
        rtoHours: plan.rtoHours,
        rpoHours: plan.rpoHours,
      },
    });

    return plan;
  }

  list(query: ListBcpDrPlansQueryDto): Promise<BcpDrPlan[]> {
    return this.plans.findMany({ scenario: query.scenario });
  }

  async get(id: string): Promise<BcpDrPlan> {
    const plan = await this.plans.findById(id);
    if (!plan) throw new NotFoundException('BCP/DR plan not found');
    return plan;
  }

  /** Backlog #72-73 checkbox 1 — a genuine coverage/gap check across all
   * five named scenarios, not just a list a caller must eyeball. */
  async coverage(): Promise<ScenarioCoverageView[]> {
    const all = await this.plans.findMany({});
    return computeScenarioCoverage(all);
  }

  async update(
    id: string,
    dto: UpdateBcpDrPlanDto,
    actorUserId: string,
  ): Promise<BcpDrPlan> {
    const existing = await this.plans.findById(id);
    if (!existing) throw new NotFoundException('BCP/DR plan not found');

    if (dto.planDocumentId) {
      const doc = await this.documents.findById(dto.planDocumentId);
      if (!doc) throw new NotFoundException('Plan document not found');
    }

    const updated = await this.plans.update(id, {
      planDocumentId: dto.planDocumentId,
      rtoHours: dto.rtoHours,
      rpoHours: dto.rpoHours,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'BcpDrPlan',
      entityId: id,
      afterValue: {
        planDocumentId: updated.planDocumentId,
        rtoHours: updated.rtoHours,
        rpoHours: updated.rpoHours,
      },
    });

    return updated;
  }

  /** Backlog #72-73 checkbox 2 — records a completed test + the
   * next-test-due date, both stated explicitly by the caller (no sourced
   * cadence to auto-compute from). */
  async recordTest(
    id: string,
    dto: RecordBcpDrPlanTestDto,
    actorUserId: string,
  ): Promise<BcpDrPlan> {
    const existing = await this.plans.findById(id);
    if (!existing) throw new NotFoundException('BCP/DR plan not found');

    const testedAt = dto.testedAt ? new Date(dto.testedAt) : new Date();
    const nextTestDueAt = new Date(dto.nextTestDueAt);
    const updated = await this.plans.recordTest(id, testedAt, nextTestDueAt);

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'BcpDrPlan',
      entityId: id,
      afterValue: {
        lastTestedAt: testedAt.toISOString(),
        nextTestDueAt: nextTestDueAt.toISOString(),
      },
    });

    return updated;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `BcpDrPlan audit (${input.action} ${input.entityId}) failed: ${(err as Error).message}`,
      );
    }
  }
}
