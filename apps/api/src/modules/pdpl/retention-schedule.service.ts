import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type RetentionScheduleItem } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { DutySegregationService } from '../duty-segregation/duty-segregation.service';
import type { CombinedDutyDeclarationDto } from '../../common/dto/combined-duty-declaration.dto';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { RetentionScheduleRepository } from '../../repositories/retention-schedule.repository';
import {
  deriveRetentionScheduleItemView,
  retentionScheduleItemAuditSnapshot,
  type RetentionScheduleItemView,
} from './retention-schedule.config';
import type { CreateRetentionScheduleItemDto } from './dto/create-retention-schedule-item.dto';
import type { UpdateRetentionScheduleItemDto } from './dto/update-retention-schedule-item.dto';

const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/**
 * M06 — Data Retention (backlog Part D §5.1, Process #52). Maintains the
 * retention-period table `RetentionScheduleItem` — one row per record
 * category, pending Legal Counsel confirmation
 * (`retention-schedule.config.ts`'s header comment). `retention-
 * schedule.manage` (`[COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER]`) gates
 * the whole surface — this is the first PDPL/Domain-H-adjacent item this
 * session where no permission was pre-seeded ahead of time for the
 * SCHEDULE itself (only the disposal/legal-hold actions were).
 */
@Injectable()
export class RetentionScheduleService {
  private readonly logger = new Logger(RetentionScheduleService.name);

  constructor(
    private readonly repo: RetentionScheduleRepository,
    private readonly audit: AuditService,
    /** The ONE engine every maker/checker pair resolves through — never a second copy of the
     *  comparison. `role-scope.inventory.spec.ts`'s sibling guard refuses a second home for it. */
    private readonly dutySegregation: DutySegregationService,
  ) {}

  async create(
    dto: CreateRetentionScheduleItemDto,
    actorUserId: string,
  ): Promise<RetentionScheduleItemView> {
    let row: RetentionScheduleItem;
    try {
      row = await this.repo.create({
        recordCategory: dto.recordCategory,
        retentionPeriodMonths: dto.retentionPeriodMonths,
        legalBasis: dto.legalBasis ?? null,
        // MODULE 0 CLOSE, DECISION 3 — the MAKER, stamped on the row that will later be compared
        // against whoever confirms it.
        setByUserId: actorUserId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A retention-schedule item for record category "${dto.recordCategory}" already exists.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'RetentionScheduleItem',
      entityId: row.id,
      afterValue: retentionScheduleItemAuditSnapshot(row),
    });

    return deriveRetentionScheduleItemView(row);
  }

  async get(id: string): Promise<RetentionScheduleItemView> {
    return deriveRetentionScheduleItemView(await this.load(id));
  }

  async list(): Promise<RetentionScheduleItemView[]> {
    const rows = await this.repo.findMany();
    return rows.map((r) => deriveRetentionScheduleItemView(r));
  }

  /** Only pre-confirmation — an already-confirmed row is a settled legal
   * record, not an editable draft (the model's own `confirmedByLegalCounselAt`
   * gate). Add a NEW category row instead of editing a confirmed one. */
  async update(
    id: string,
    dto: UpdateRetentionScheduleItemDto,
    actorUserId: string,
  ): Promise<RetentionScheduleItemView> {
    const item = await this.load(id);
    if (item.confirmedByLegalCounselAt !== null) {
      throw new UnprocessableEntityException(
        `Retention schedule item ${id} is already confirmed by Legal Counsel — it is no longer editable. Add a new item instead.`,
      );
    }

    /*
     * THE MAKER IS RE-STAMPED ON EVERY EDIT, not carried forward from the create.
     *
     * The person the confirmation must differ from is whoever LAST SET the period. Carrying the
     * original creator forward would let A create a row, B edit the figure, and B then confirm their
     * own figure — a self-confirmation the constraint could not see, because it would be comparing
     * the checker against A.
     */

    const row = await this.repo.update(id, {
      // The maker, re-stamped — see the note above.
      setByUserId: actorUserId,
      retentionPeriodMonths: dto.retentionPeriodMonths,
      legalBasis: dto.legalBasis,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RetentionScheduleItem',
      entityId: row.id,
      afterValue: retentionScheduleItemAuditSnapshot(row),
    });

    return deriveRetentionScheduleItemView(row);
  }

  /** A one-time legal act, not a toggle — 422s if already confirmed. */
  async confirm(
    id: string,
    actorUserId: string,
    declaration: CombinedDutyDeclarationDto = {},
  ): Promise<RetentionScheduleItemView> {
    const item = await this.load(id);

    /*
     * MODULE 0 CLOSE, DECISION 3 — THE SIXTEENTH PAIR'S DECISION, THROUGH THE ONE ENGINE.
     *
     * `DutySegregationService.resolve` refuses a self-confirmation in a SEGREGATED office — which
     * every office is unless it has declared otherwise — and in a declared COMBINED office returns
     * the act id the write must carry. Threaded, never discarded: the CHECK constraint refuses a
     * self-confirming row whose escape column is null, so dropping the return value turns a legitimate
     * declared act into a 500. The same mistake lint caught at two call sites during item (h).
     *
     * PLACED BEFORE EVERY OTHER REFUSAL. An officer who may not confirm this row at all should hear
     * that first, rather than being told about an already-confirmed row and discovering the real
     * obstacle on their second attempt — the ordering correction item (h) made for the commission
     * scope check, for the same reason: refuse first on the thing the caller cannot fix by editing
     * their request.
     *
     * A NULL MAKER IS NOT A SELF-CONFIRMATION. The four pre-existing rows carry `setByUserId = null`
     * because nobody recorded who set them. `assertDifferentActors` compares ids, so a null maker can
     * never equal the checker and the engine returns null — which is the correct reading: an
     * unattributed period confirmed by somebody is not one person doing both halves, it is a row
     * whose first half nobody can name. Refusing it would make four seeded rows permanently
     * unconfirmable, which is § 1.62's unreachable-precondition shape.
     */
    const combinedDutyActId = await this.dutySegregation.resolve({
      constraint: 'RetentionScheduleItem_maker_checker_distinct',
      makerId: item.setByUserId ?? '',
      checkerId: actorUserId,
      entityId: id,
      context: 'RetentionScheduleItem.confirm',
      actorUserId,
      reason: declaration.combinedDutyReason,
    });

    const confirmedAt = new Date();
    const res = await this.repo.confirm(
      id,
      confirmedAt,
      actorUserId,
      combinedDutyActId,
    );
    if (res.count === 0) {
      const now = await this.load(id);
      if (now.confirmedByLegalCounselAt !== null) {
        throw new UnprocessableEntityException(
          `Retention schedule item ${id} is already confirmed by Legal Counsel.`,
        );
      }
      throw new ConflictException(
        `Retention schedule item ${id} changed concurrently — reload and retry.`,
      );
    }

    const row = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RetentionScheduleItem',
      entityId: row.id,
      afterValue: retentionScheduleItemAuditSnapshot(row),
    });
    return deriveRetentionScheduleItemView(row);
  }

  private async load(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Retention schedule item ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `RetentionScheduleItem audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
