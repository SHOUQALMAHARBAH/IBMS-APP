import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import {
  InsuranceLineRepository,
  type OfficeLineRow,
} from '../../repositories/insurance-line.repository';
import {
  canonicalKeysFor,
  officeLineView,
  pickableLines,
  standardLineColliding,
  type InsuranceLineView,
} from './insurance-line.config';
import type {
  AddInsuranceLineDto,
  UpdateInsuranceLineDto,
} from './dto/insurance-line.dto';

/**
 * The insurance-line vocabulary: the standard list, and what an office adds to it.
 *
 * ## Why a managed list at all
 *
 * Free text means "مركبات", "تأمين مركبات" and "سيارات" are three unrelated values.
 * Directory search fails, a policy's line never matches an insurer's, and every
 * report fragments along spellings. A closed list means waiting for a release
 * whenever the market invents a product — the external dependency this whole feature
 * exists to remove. So staff PICK, and an office can ADD.
 *
 * ## What an addition has to get past
 *
 * Two checks, both blocking, and they refuse different things:
 *
 *  1. **A standard line that already means this.** Adding a private copy of Motor
 *     Comprehensive creates precisely the fragmentation the list prevents, so it is
 *     refused with the name that already exists.
 *  2. **An addition this office already made.** Enforced by a unique index on the
 *     stored canonical key, per script — a database invariant rather than a check a
 *     writer remembers (`ibms-brain/meta/lex/race-safe-invariants.md`), so two people
 *     adding the same type at the same moment cannot both win.
 *
 * Both compare CANONICAL keys, so orthography and word order do not create a second
 * entry. What neither catches is a synonym: "سيارات شامل" and "تأمين المركبات الشامل"
 * share no words, and no normalisation will ever equate them. That is a similarity
 * suggestion — "did you mean …?" — and it belongs with the directory's own matching,
 * on top of this exact guarantee rather than instead of it. Until then an office can
 * add a synonym of a line it already has, which is a real and accepted gap.
 */
@Injectable()
export class InsuranceLineService {
  constructor(
    private readonly lines: InsuranceLineRepository,
    private readonly audit: AuditService,
  ) {}

  /** Everything this office can pick from: the standard 32 plus its own additions. */
  async list(): Promise<InsuranceLineView[]> {
    const [standard, additions] = await Promise.all([
      this.lines.listStandard(),
      this.lines.listOfficeAdditions(),
    ]);
    return pickableLines(standard, additions);
  }

  async add(
    dto: AddInsuranceLineDto,
    actorUserId: string,
  ): Promise<InsuranceLineView> {
    const keys = canonicalKeysFor(dto);
    const standard = await this.lines.listStandard();
    const collision = standardLineColliding(standard, keys);
    if (collision) {
      throw new ConflictException(
        `"${collision.nameEn}" / "${collision.nameAr}" is already a standard insurance line. Pick it from the list instead of adding a second entry for the same type.`,
      );
    }

    let created: OfficeLineRow;
    try {
      created = await this.lines.createOfficeLine({
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        category: dto.category,
        ...keys,
        createdByUserId: actorUserId,
      });
    } catch (err) {
      throw this.asDuplicate(err, dto);
    }

    await this.audit.record({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'OfficeInsuranceLine',
      entityId: created.id,
      afterValue: {
        nameEn: created.nameEn,
        nameAr: created.nameAr,
        category: created.category,
      },
    });
    return officeLineView(created);
  }

  /**
   * Corrects an office's own addition.
   *
   * Only an addition — a standard line is not this office's to rename, and there is
   * no route here that could. Renaming is allowed even when insurers already
   * reference the line: it is the same line under a corrected name, and the
   * alternative is a permanent typo in a vocabulary the whole office picks from. The
   * audit row carries how many insurers were affected, because a rename that moves
   * under 40 insurer records is worth being able to see later.
   */
  async rename(
    id: string,
    dto: UpdateInsuranceLineDto,
    actorUserId: string,
  ): Promise<InsuranceLineView> {
    const existing = await this.lines.findOfficeLineById(id);
    if (!existing) {
      // Absent, not forbidden: another office's addition and an id that never
      // existed have to be indistinguishable. A standard line's id also lands here,
      // which is correct — it is not an office addition.
      throw new NotFoundException(`Insurance line ${id} not found.`);
    }

    const nameEn = dto.nameEn ?? existing.nameEn;
    const nameAr = dto.nameAr ?? existing.nameAr;
    const keys = canonicalKeysFor({ nameEn, nameAr });
    const standard = await this.lines.listStandard();
    const collision = standardLineColliding(standard, keys);
    if (collision) {
      throw new ConflictException(
        `"${collision.nameEn}" / "${collision.nameAr}" is already a standard insurance line.`,
      );
    }

    const patch = {
      ...(dto.nameEn === undefined ? {} : { nameEn: dto.nameEn }),
      ...(dto.nameAr === undefined ? {} : { nameAr: dto.nameAr }),
      ...(dto.category === undefined ? {} : { category: dto.category }),
      ...(keys.canonicalEn === existing.canonicalEn
        ? {}
        : { canonicalEn: keys.canonicalEn }),
      ...(keys.canonicalAr === existing.canonicalAr
        ? {}
        : { canonicalAr: keys.canonicalAr }),
    };
    if (Object.keys(patch).length === 0) return officeLineView(existing);

    const affected = await this.lines.countInsurersOffering(id);
    let updated: OfficeLineRow;
    try {
      updated = await this.lines.updateOfficeLine(id, patch);
    } catch (err) {
      throw this.asDuplicate(err, { nameEn, nameAr });
    }

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'OfficeInsuranceLine',
      entityId: id,
      beforeValue: {
        nameEn: existing.nameEn,
        nameAr: existing.nameAr,
        category: existing.category,
      },
      afterValue: {
        nameEn: updated.nameEn,
        nameAr: updated.nameAr,
        category: updated.category,
        insurersOffering: affected,
      },
    });
    return officeLineView(updated);
  }

  /**
   * The unique index refused it, so this office already has this line.
   *
   * The kind comes from the operation rather than from `err.meta.target`, for the
   * reason recorded in `InsurerService.asCollision`: Prisma reports a null target on
   * this codebase's write path, and only one uniqueness can fire here anyway — both
   * indexes on this table mean the same thing to the caller.
   */
  private asDuplicate(
    err: unknown,
    names: { nameEn: string; nameAr: string },
  ): unknown {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new ConflictException(
        `This office already has an insurance line meaning "${names.nameEn}" / "${names.nameAr}". Names are compared ignoring spelling variants, the definite article and word order, so a different spelling of the same type is still the same line.`,
      );
    }
    return err;
  }
}
