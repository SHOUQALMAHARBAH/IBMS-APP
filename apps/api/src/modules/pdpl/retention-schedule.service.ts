import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { DutySegregationService } from '../duty-segregation/duty-segregation.service';
import type { CombinedDutyDeclarationDto } from '../../common/dto/combined-duty-declaration.dto';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import {
  RetentionScheduleRepository,
  type RetentionScheduleItemWithCombinedDuty,
} from '../../repositories/retention-schedule.repository';
import {
  deriveRetentionScheduleItemView,
  retentionScheduleItemAuditSnapshot,
  type RetentionScheduleItemView,
} from './retention-schedule.config';
import {
  assertMeetsStatutoryFloor,
  resolveNoFloorDeclaration,
  type NoFloorDeclaration,
} from './retention-floors.config';
import type { CreateRetentionScheduleItemDto } from './dto/create-retention-schedule-item.dto';
import type { UpdateRetentionScheduleItemDto } from './dto/update-retention-schedule-item.dto';

const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/**
 * The five declaration columns, written TOGETHER or not at all.
 *
 * The database's `RetentionScheduleItem_no_floor_declaration_complete` CHECK refuses four of five,
 * so a partial write is a 500 rather than a silent half-record. This helper is what makes that
 * backstop unreachable from application code: there is one place the five are assembled, and it
 * takes the period as an argument because `noFloorAcknowledgedMonths` must be the period the office
 * was actually acknowledging rather than whatever is on the row.
 */
function declarationColumns(
  declaration: NoFloorDeclaration | null,
  months: number,
  actorUserId: string,
) {
  if (!declaration) return {};
  return {
    noFloorNoticeShown: declaration.noticeShown,
    noFloorReason: declaration.reason,
    noFloorAcknowledgedAt: new Date(),
    noFloorAcknowledgedByUserId: actorUserId,
    noFloorAcknowledgedMonths: months,
  };
}

/**
 * THE AUDIT ROW CARRIES THE SENTENCE AND THE REASON VERBATIM — not the word "acknowledged".
 *
 * The owner's rule: what the person was TOLD is part of the record, because a year from now the
 * question is what they saw. A row saying `acknowledged: true` answers whether a box was ticked,
 * which is the thing she ruled out.
 *
 * ## WHY THIS IS NOT THE "never quote in a snapshot" RULE BEING BROKEN
 *
 * `CLAUDE.md` says never to put the COMBINED-DUTY ACT in an audit snapshot, and that still holds:
 * the act is a row with its own id, so the snapshot references it and copying it would duplicate a
 * record that already exists and can be read. The declaration is not a row anywhere else — the
 * sentence and the reason ARE its content, and there is nothing to point at.
 */
function declarationAudit(declaration: NoFloorDeclaration | null) {
  if (!declaration) return {};
  return {
    noFloorNoticeShown: declaration.noticeShown,
    noFloorReason: declaration.reason,
  };
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
    /*
     * THE STATUTORY FLOOR — A REFUSAL, and it comes FIRST.
     *
     * Before the duplicate-category check and before the write: an officer whose figure is below
     * the law should hear that rather than hearing about a row that already exists and discovering
     * the real obstacle on the second attempt. The ordering correction item (h) made for the
     * commission scope check, for the same reason — refuse first on the thing the caller cannot fix
     * by editing the rest of the request.
     *
     * A category with no decided floor returns null and is accepted with no refusal and no invented
     * number, which is the half of the instruction that is easiest to break by being helpful.
     */
    assertMeetsStatutoryFloor(dto.recordCategory, dto.retentionPeriodMonths);

    /*
     * THE SILENT CASE — batch 5 group 6. A category this system knows no minimum for is ACCEPTED,
     * and the office declares why.
     *
     * `acknowledgedMonths: null` because the row does not exist yet, so nobody has been shown the
     * sentence for this category in this office. It is always asked on a create.
     *
     * AFTER the floor, because the two are different answers to different questions and only one of
     * them can apply: a category WITH a floor is refused or accepted on the article, and
     * `resolveNoFloorDeclaration` returns null for it rather than asking a third time.
     */
    const declaration = resolveNoFloorDeclaration(
      {
        recordCategory: dto.recordCategory,
        requestedMonths: dto.retentionPeriodMonths,
        acknowledgedMonths: null,
      },
      dto.noFloorDeclaration,
    );

    let row: RetentionScheduleItemWithCombinedDuty;
    try {
      row = await this.repo.create({
        recordCategory: dto.recordCategory,
        retentionPeriodMonths: dto.retentionPeriodMonths,
        legalBasis: dto.legalBasis ?? null,
        ...declarationColumns(
          declaration,
          dto.retentionPeriodMonths,
          actorUserId,
        ),
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
      afterValue: {
        ...retentionScheduleItemAuditSnapshot(row),
        ...declarationAudit(declaration),
      },
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
     * THE STATUTORY FLOOR, on the EDIT path too — otherwise the create gate is a formality: set 60
     * months for a KYC category, then patch it to 6.
     *
     * The category comes off the LOADED ROW rather than the DTO, which deliberately cannot carry
     * one (renaming a category is a new row, not an edit of this row's identity). And it is skipped
     * when the DTO carries no period at all, because an edit that only corrects `legalBasis` must
     * not be refused over a figure it is not touching.
     */
    let declaration: NoFloorDeclaration | null = null;
    if (dto.retentionPeriodMonths !== undefined) {
      assertMeetsStatutoryFloor(item.recordCategory, dto.retentionPeriodMonths);

      /*
       * ASKED ONCE PER CATEGORY PER OFFICE, and this is where that is decided: the row carries
       * `noFloorAcknowledgedMonths`, so a save at the SAME or a LONGER period is not re-asked and a
       * SHORTENING is. Both read off the row rather than off a request, so a client cannot opt out
       * of being asked by omitting a field.
       *
       * Inside the `!== undefined` guard with the floor, for the same reason: an edit that only
       * corrects `legalBasis` is not a period decision and must not demand a declaration about one.
       */
      declaration = resolveNoFloorDeclaration(
        {
          recordCategory: item.recordCategory,
          requestedMonths: dto.retentionPeriodMonths,
          acknowledgedMonths: item.noFloorAcknowledgedMonths,
        },
        dto.noFloorDeclaration,
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
      /*
       * Only when a declaration was actually required and given. An edit that needed none leaves the
       * stored one ALONE rather than clearing it — the office's earlier acknowledgement is the
       * record of what it was told, and a longer period does not undo it.
       */
      ...(declaration && dto.retentionPeriodMonths !== undefined
        ? declarationColumns(
            declaration,
            dto.retentionPeriodMonths,
            actorUserId,
          )
        : {}),
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RetentionScheduleItem',
      entityId: row.id,
      afterValue: {
        ...retentionScheduleItemAuditSnapshot(row),
        ...declarationAudit(declaration),
      },
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
