import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import {
  CommissionRepository,
  type AgreementWithInsurer,
} from '../../repositories/commission.repository';
import {
  agreementAuditSnapshot,
  COMMISSION_MAX_RATE_PERCENT,
  COMMISSION_MAX_VAT_RATE_PERCENT,
  deriveAgreementView,
  type CommissionAgreementView,
} from './commission.config';
import type { CreateCommissionAgreementDto } from './dto/create-commission-agreement.dto';
import type { ListCommissionAgreementsQueryDto } from './dto/list-commission-agreements-query.dto';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Process 35 — the governed commission-rate table (`CommissionAgreement`).
 * `commission-rate.manage` is `[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER]`
 * — Finance may *apply* the governed rate (`commission.calculate`) but never
 * *alter* the table (`roles-and-segregation-of-duties.md`: Finance "Cannot
 * alter commission rate tables without approval"). A rate change opens a new
 * window and closes the prior one at the same instant; the partial UNIQUE
 * index (`CommissionAgreement_one_open_per_insurer_line`) is the race
 * backstop.
 */
@Injectable()
export class CommissionAgreementService {
  private readonly logger = new Logger(CommissionAgreementService.name);

  constructor(
    private readonly commission: CommissionRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateCommissionAgreementDto,
    actorId: string,
  ): Promise<CommissionAgreementView> {
    if (!(await this.commission.insurerExists(dto.insurerId))) {
      throw new NotFoundException(`Insurer ${dto.insurerId} not found.`);
    }

    const rate = new Prisma.Decimal(dto.ratePercent);
    if (rate.lessThan(0) || rate.greaterThan(COMMISSION_MAX_RATE_PERCENT)) {
      throw new UnprocessableEntityException(
        `ratePercent (${rate.toFixed(2)}%) is outside 0..${COMMISSION_MAX_RATE_PERCENT}.`,
      );
    }

    const vatRate = new Prisma.Decimal(dto.vatRatePercent ?? '0');
    if (
      vatRate.lessThan(0) ||
      vatRate.greaterThan(COMMISSION_MAX_VAT_RATE_PERCENT)
    ) {
      throw new UnprocessableEntityException(
        `vatRatePercent (${vatRate.toFixed(2)}%) is outside 0..${COMMISSION_MAX_VAT_RATE_PERCENT}.`,
      );
    }

    const effectiveFrom = this.parseEffectiveFrom(dto.effectiveFrom);
    const insuranceLine = dto.insuranceLine.trim();

    const open = await this.commission.findOpenAgreement(
      dto.insurerId,
      insuranceLine,
    );
    if (open && open.effectiveFrom.getTime() > effectiveFrom.getTime()) {
      throw new UnprocessableEntityException(
        `The open agreement for this insurer / line took effect ${open.effectiveFrom
          .toISOString()
          .slice(
            0,
            10,
          )}; a superseding rate cannot take effect earlier than that.`,
      );
    }
    if (
      open &&
      open.effectiveFrom.getTime() === effectiveFrom.getTime() &&
      open.ratePercent.equals(rate) &&
      open.vatRatePercent.equals(vatRate)
    ) {
      // Idempotent re-post of the same open rate (commission AND VAT) — return
      // it, don't churn the window.
      const rows = await this.commission.findAgreements({
        insurerId: dto.insurerId,
        insuranceLine,
      });
      const existing = rows.find((r) => r.id === open.id);
      if (existing)
        return deriveAgreementView({
          ...existing,
          insurerName: existing.insurer.name,
        });
    }

    let created: AgreementWithInsurer;
    try {
      created = await this.commission.supersedeAndCreateAgreement({
        create: {
          insurerId: dto.insurerId,
          insuranceLine,
          ratePercent: rate,
          vatRatePercent: vatRate,
          effectiveFrom,
        },
        supersedeId: open?.id ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A commission agreement window for this insurer / line was opened concurrently — reload and retry.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorId,
      action: 'CREATE',
      entityType: 'CommissionAgreement',
      entityId: created.id,
      afterValue: agreementAuditSnapshot({
        agreementId: created.id,
        insurerId: created.insurerId,
        insuranceLine: created.insuranceLine,
        ratePercent: created.ratePercent,
        vatRatePercent: created.vatRatePercent,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: created.effectiveTo,
        supersededAgreementId: open?.id ?? null,
      }),
    });
    if (open) {
      await this.safeAudit({
        userId: actorId,
        action: 'UPDATE',
        entityType: 'CommissionAgreement',
        entityId: open.id,
        afterValue: {
          agreementId: open.id,
          effectiveTo: effectiveFrom.toISOString(),
          supersededByAgreementId: created.id,
        },
      });
    }

    return deriveAgreementView({
      ...created,
      insurerName: created.insurer.name,
    });
  }

  async list(
    query: ListCommissionAgreementsQueryDto,
  ): Promise<CommissionAgreementView[]> {
    const rows = await this.commission.findAgreements({
      insurerId: query.insurerId,
      insuranceLine: query.insuranceLine,
    });
    return rows.map((r) =>
      deriveAgreementView({ ...r, insurerName: r.insurer.name }),
    );
  }

  listInsurers(): Promise<{ id: string; name: string }[]> {
    return this.commission.listInsurers();
  }

  /** `YYYY-MM-DD` → a UTC-midnight instant. Only rejects a string that is not
   * a real calendar date; future dates are allowed (a scheduled rate change).
   * An omitted date defaults to **today at UTC midnight** (not `new Date()`)
   * so the same-rate/same-date idempotency short-circuit — which compares
   * `getTime()` exactly — engages for the no-date double-submit too. */
  private parseEffectiveFrom(raw: string | undefined): Date {
    if (raw == null) {
      const now = new Date();
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
    }
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new UnprocessableEntityException(
        `effectiveFrom ${raw} is not a valid calendar date.`,
      );
    }
    return parsed;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Commission-agreement audit (${input.action} ${input.entityType} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
