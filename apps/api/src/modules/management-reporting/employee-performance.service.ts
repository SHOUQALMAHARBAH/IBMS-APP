import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { EmployeePerformanceRepository } from '../../repositories/employee-performance.repository';
import { parseCalendarDate } from '../../common/calendar-date.util';
import {
  deriveEmployeePerformanceRecordView,
  previousUtcMonthRange,
  ratePercentOrNull,
  type EmployeePerformanceRecordView,
  type PeriodWindow,
} from './employee-performance.config';
import type { ListEmployeePerformanceQueryDto } from './dto/list-employee-performance-query.dto';
import type { ComputeEmployeePerformanceDto } from './dto/compute-employee-performance.dto';

export interface ComputeRecordsResult {
  periodLabel: string;
  employeesComputed: number;
  employeesFailed: number;
}

/** How many employees `computeRecords` scores concurrently per chunk — the
 * #60 lesson (bounded, not sequential, not fully unbounded) applied from
 * the first draft this time. */
const COMPUTE_CONCURRENCY = 20;

/**
 * Process 61 — computes and reads `EmployeePerformanceRecord`. See
 * `employee-performance.config.ts` for the pure per-metric math;
 * `ibms-brain/meta/context/employee-performance.md` for why each metric
 * was picked and why the two rate fields are `null`, not `0`, with no
 * outcomes to rate.
 */
@Injectable()
export class EmployeePerformanceService {
  private readonly logger = new Logger(EmployeePerformanceService.name);

  constructor(
    private readonly repo: EmployeePerformanceRepository,
    private readonly audit: AuditService,
  ) {}

  /** No fields -> the UTC calendar month that just ended (what the
   * scheduler itself passes). All three fields -> that explicit window.
   * Any other combination is incoherent — 422. */
  resolvePeriodFromDto(dto: ComputeEmployeePerformanceDto): PeriodWindow {
    const provided = [dto.periodLabel, dto.periodStart, dto.periodEnd].filter(
      (v) => v !== undefined,
    ).length;
    if (provided === 0) return previousUtcMonthRange(new Date());
    if (provided !== 3) {
      throw new UnprocessableEntityException(
        'periodLabel, periodStart, and periodEnd must all be supplied together, or all omitted for the previous calendar month',
      );
    }
    const periodStart = parseCalendarDate(dto.periodStart!, 'periodStart');
    const periodEnd = parseCalendarDate(dto.periodEnd!, 'periodEnd');
    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw new UnprocessableEntityException(
        'periodEnd must be after periodStart',
      );
    }
    return { periodLabel: dto.periodLabel!, periodStart, periodEnd };
  }

  /** Computes and upserts every linked employee's record for one period —
   * the scheduler's own job, never exposed as an HTTP "run for everybody"
   * trigger. Bounded-concurrency chunks + per-employee isolation, the #60
   * shape. */
  async computeRecords(
    period: PeriodWindow,
    actorUserId: string,
  ): Promise<ComputeRecordsResult> {
    const pairs = await this.repo.listEmployeeUserPairs();

    let employeesComputed = 0;
    let employeesFailed = 0;
    for (let i = 0; i < pairs.length; i += COMPUTE_CONCURRENCY) {
      const chunk = pairs.slice(i, i + COMPUTE_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((pair) =>
          this.computeForUser(
            pair.employeeId,
            pair.userId,
            period,
            actorUserId,
          ),
        ),
      );
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          employeesComputed += 1;
        } else {
          employeesFailed += 1;
          this.logger.error(
            `Employee performance compute for employee ${chunk[index].employeeId}, period ${period.periodLabel} failed: ${(result.reason as Error).message} — continuing; next run will retry.`,
          );
        }
      }
    }

    this.logger.log(
      `Employee performance compute (${period.periodLabel}): ${employeesComputed} employee(s) scored, ${employeesFailed} failed.`,
    );
    return {
      periodLabel: period.periodLabel,
      employeesComputed,
      employeesFailed,
    };
  }

  /** The manual-trigger entry point — resolves the employee's linked User
   * first (404 if neither exists), then computes. */
  async computeRecordForEmployee(
    employeeId: string,
    period: PeriodWindow,
    actorUserId: string,
  ): Promise<EmployeePerformanceRecordView> {
    const userId = await this.repo.findUserIdForEmployee(employeeId);
    if (!userId) {
      throw new NotFoundException(
        `Employee ${employeeId} was not found, or has no linked User account to compute performance against.`,
      );
    }
    return this.computeForUser(employeeId, userId, period, actorUserId);
  }

  private async computeForUser(
    employeeId: string,
    userId: string,
    period: PeriodWindow,
    actorUserId: string,
  ): Promise<EmployeePerformanceRecordView> {
    const { periodStart, periodEnd, periodLabel } = period;

    const [
      newClients,
      premiumWritten,
      commissionEarned,
      renewalOutcomes,
      crossSellOutcomes,
    ] = await Promise.all([
      this.repo.countNewClients(userId, periodStart, periodEnd),
      this.repo.sumPremiumWritten(userId, periodStart, periodEnd),
      this.repo.sumCommissionEarned(userId, periodStart, periodEnd),
      this.repo.countRenewalOutcomes(userId, periodStart, periodEnd),
      this.repo.countCrossSellOutcomes(userId, periodStart, periodEnd),
    ]);

    const { row, wasCreated } = await this.repo.upsertRecord(
      employeeId,
      periodLabel,
      {
        newClients,
        premiumWritten: premiumWritten ?? new Prisma.Decimal(0),
        commissionEarned: commissionEarned ?? new Prisma.Decimal(0),
        renewalRatePercent: ratePercentOrNull(
          renewalOutcomes.succeeded,
          renewalOutcomes.total,
        ),
        crossSellRatePercent: ratePercentOrNull(
          crossSellOutcomes.succeeded,
          crossSellOutcomes.total,
        ),
      },
    );

    await this.safeAudit({
      userId: actorUserId,
      action: wasCreated ? 'CREATE' : 'UPDATE',
      entityType: 'EmployeePerformanceRecord',
      entityId: row.id,
      afterValue: employeePerformanceAuditSnapshot(row),
    });

    return deriveEmployeePerformanceRecordView(row);
  }

  async list(
    query: ListEmployeePerformanceQueryDto,
  ): Promise<EmployeePerformanceRecordView[]> {
    const rows = await this.repo.findMany({
      employeeId: query.employeeId,
      periodLabel: query.periodLabel,
      branchId: query.branchId,
    });
    return rows.map(deriveEmployeePerformanceRecordView);
  }

  async latest(employeeId: string): Promise<EmployeePerformanceRecordView> {
    const row = await this.repo.findLatest(employeeId);
    if (!row) {
      throw new NotFoundException(
        `No performance record has been computed yet for employee ${employeeId}.`,
      );
    }
    return deriveEmployeePerformanceRecordView(row);
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Employee performance audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}

function employeePerformanceAuditSnapshot(row: {
  id: string;
  employeeId: string;
  periodLabel: string;
  newClients: number | null;
  premiumWritten: Prisma.Decimal | null;
  commissionEarned: Prisma.Decimal | null;
  renewalRatePercent: Prisma.Decimal | null;
  crossSellRatePercent: Prisma.Decimal | null;
}): Prisma.InputJsonObject {
  return {
    employeePerformanceRecordId: row.id,
    employeeId: row.employeeId,
    periodLabel: row.periodLabel,
    newClients: row.newClients,
    premiumWritten: row.premiumWritten?.toFixed(3) ?? null,
    commissionEarned: row.commissionEarned?.toFixed(3) ?? null,
    renewalRatePercent: row.renewalRatePercent?.toFixed(2) ?? null,
    crossSellRatePercent: row.crossSellRatePercent?.toFixed(2) ?? null,
  };
}
