import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type SalesTarget } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SalesPerformanceRepository } from '../../repositories/sales-performance.repository';
import type { SalesTargetScope } from '../../repositories/sales-performance.repository';
import {
  computeAchievementPercent,
  deriveSalesTargetView,
  isExactlyOneScope,
  salesTargetAuditSnapshot,
  type SalesPerformanceView,
  type SalesTargetView,
} from './sales-performance.config';
import { parseCalendarDate } from '../../common/calendar-date.util';
import { VIEW_ALL_OWNERS_ROLES } from '../../common/rbac-visibility.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateSalesTargetDto } from './dto/create-sales-target.dto';
import type { UpdateSalesTargetDto } from './dto/update-sales-target.dto';
import type { ListSalesTargetQueryDto } from './dto/list-sales-target-query.dto';
import type { SalesPerformanceQueryDto } from './dto/sales-performance-query.dto';

/**
 * Process 59 — `SalesTarget` CRUD (`sales-target.manage`, Manager/Executive)
 * plus the live `report()` read (`dashboard.sales.view`, already pre-seeded
 * for `[SALES, MANAGER, EXEC]`) that resolves a target against a live
 * `Lead`/`Prospect` count. See `sales-performance.config.ts` for why the
 * target metric is `targetNewProspects`, not premium/commission.
 */
@Injectable()
export class SalesPerformanceService {
  private readonly logger = new Logger(SalesPerformanceService.name);

  constructor(
    private readonly repo: SalesPerformanceRepository,
    private readonly audit: AuditService,
  ) {}

  async createTarget(
    dto: CreateSalesTargetDto,
    actorUserId: string,
  ): Promise<SalesTargetView> {
    if (!isExactlyOneScope(dto.ownerUserId, dto.branchId)) {
      throw new UnprocessableEntityException(
        'exactly one of ownerUserId/branchId is required — an individual quota or a team quota, never both, never neither',
      );
    }
    const periodStart = parseCalendarDate(dto.periodStart, 'periodStart');
    const periodEnd = parseCalendarDate(dto.periodEnd, 'periodEnd');
    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw new UnprocessableEntityException(
        'periodEnd must be after periodStart',
      );
    }

    const scope: SalesTargetScope = {
      ownerUserId: dto.ownerUserId,
      branchId: dto.branchId,
    };
    const existing = await this.repo.findByScopeAndLabel(
      scope,
      dto.periodLabel,
    );
    if (existing) {
      throw this.duplicateTargetConflict(dto.ownerUserId, dto.periodLabel);
    }

    let row: SalesTarget;
    try {
      row = await this.repo.create({
        ownerUserId: dto.ownerUserId ?? null,
        branchId: dto.branchId ?? null,
        periodLabel: dto.periodLabel,
        periodStart,
        periodEnd,
        targetNewProspects: dto.targetNewProspects,
        createdByUserId: actorUserId,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw this.duplicateTargetConflict(dto.ownerUserId, dto.periodLabel);
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'SalesTarget',
      entityId: row.id,
      afterValue: salesTargetAuditSnapshot(row),
    });

    return deriveSalesTargetView(row);
  }

  async updateTarget(
    id: string,
    dto: UpdateSalesTargetDto,
    actorUserId: string,
  ): Promise<SalesTargetView> {
    await this.mustFindTarget(id);
    const row = await this.repo.updateTargetValue(id, dto.targetNewProspects);

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'SalesTarget',
      entityId: row.id,
      afterValue: salesTargetAuditSnapshot(row),
    });

    return deriveSalesTargetView(row);
  }

  async getTarget(id: string): Promise<SalesTargetView> {
    return deriveSalesTargetView(await this.mustFindTarget(id));
  }

  async listTargets(
    query: ListSalesTargetQueryDto,
  ): Promise<SalesTargetView[]> {
    const rows = await this.repo.findMany({
      ownerUserId: query.ownerUserId,
      branchId: query.branchId,
    });
    return rows.map(deriveSalesTargetView);
  }

  /** A Sales/Relationship Officer is forced to their own `ownerUserId`
   * regardless of what's passed — hiding another officer's or any branch's
   * performance is enforced here, not left to the frontend not offering the
   * filter (`lead.service.ts`'s `list()` shape). Manager/Executive may
   * request either scope, but exactly one. */
  async report(
    query: SalesPerformanceQueryDto,
    actor: AuthenticatedUser,
  ): Promise<SalesPerformanceView> {
    const canViewAllOwners = actor.roles.some((role) =>
      VIEW_ALL_OWNERS_ROLES.includes(role),
    );

    let scope: { ownerUserId: string } | { branchId: string };
    if (!canViewAllOwners) {
      if (query.branchId) {
        throw new ForbiddenException(
          "only Branch/Department Manager or Executive Management may view a team's performance",
        );
      }
      scope = { ownerUserId: actor.id };
    } else {
      if (!isExactlyOneScope(query.ownerUserId, query.branchId)) {
        throw new UnprocessableEntityException(
          'exactly one of ownerUserId/branchId is required',
        );
      }
      scope = query.ownerUserId
        ? { ownerUserId: query.ownerUserId }
        : { branchId: query.branchId as string };
    }

    const target = query.periodLabel
      ? await this.repo.findByScopeAndLabel(scope, query.periodLabel)
      : await this.repo.findCurrent(scope, new Date());

    if (!target) {
      if (query.periodLabel) {
        throw new NotFoundException(
          `No sales target found for this scope and period "${query.periodLabel}".`,
        );
      }
      await this.safeAudit(this.reportAuditInput(actor.id, scope, false));
      return { scope, target: null, actual: null, achievementPercent: null };
    }

    const ownerUserIds =
      'ownerUserId' in scope
        ? [scope.ownerUserId]
        : (await this.repo.findUserIdsInBranch(scope.branchId)).map(
            (u) => u.id,
          );

    const [newLeads, newProspects] = await Promise.all([
      this.repo.countNewLeads(
        ownerUserIds,
        target.periodStart,
        target.periodEnd,
      ),
      this.repo.countNewProspects(
        ownerUserIds,
        target.periodStart,
        target.periodEnd,
      ),
    ]);

    await this.safeAudit(this.reportAuditInput(actor.id, scope, true));

    return {
      scope,
      target: deriveSalesTargetView(target),
      actual: { newLeads, newProspects },
      achievementPercent: computeAchievementPercent(
        newProspects,
        target.targetNewProspects,
      ),
    };
  }

  private reportAuditInput(
    userId: string,
    scope: { ownerUserId: string } | { branchId: string },
    hasTarget: boolean,
  ): RecordAuditEntryInput {
    return {
      userId,
      action: 'READ',
      entityType: 'SalesPerformance',
      entityId:
        'ownerUserId' in scope ? scope.ownerUserId : `branch:${scope.branchId}`,
      afterValue: { scope, hasTarget },
    };
  }

  private duplicateTargetConflict(
    ownerUserId: string | undefined,
    periodLabel: string,
  ): ConflictException {
    return new ConflictException(
      `A sales target for this ${ownerUserId ? 'employee' : 'branch'} already exists for period "${periodLabel}" — revise it instead of creating a new one.`,
    );
  }

  private async mustFindTarget(id: string): Promise<SalesTarget> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Sales target ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Sales performance audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
