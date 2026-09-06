import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type PrivacyNotice } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { PrivacyNoticeRepository } from '../../repositories/privacy-notice.repository';
import {
  derivePrivacyNoticeView,
  privacyNoticeAuditSnapshot,
  type PrivacyNoticeView,
} from './privacy-notice.config';
import type { CreatePrivacyNoticeDto } from './dto/create-privacy-notice.dto';
import type { ListPrivacyNoticesQueryDto } from './dto/list-privacy-notices-query.dto';

const DEFAULT_LIST_TAKE = 500;
const P2002 = 'P2002';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
  );
}

/** Notices (Part 6.2 — no M01-M12 module name applies, see
 * `privacy-notice.config.ts`'s header comment). `privacy-notice.publish` (DPO + Compliance) gates
 * create/list-all/legal-review. `GET /privacy-notices/current` additionally
 * accepts `consent.manage` — the same touchpoint-facing roles that capture
 * consent at a touchpoint (`ConsentCaptureWidget`'s `CONSENT_ROLES`) need
 * to read the notice text that applies there; this is a deliberate reuse
 * of an existing permission, not a new one, since "displayed at every
 * touchpoint" would otherwise be unreachable by the staff actually
 * standing at that touchpoint. */
@Injectable()
export class PrivacyNoticeService {
  private readonly logger = new Logger(PrivacyNoticeService.name);

  constructor(
    private readonly repo: PrivacyNoticeRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreatePrivacyNoticeDto,
    actorUserId: string,
  ): Promise<PrivacyNoticeView> {
    const versionNumber = await this.repo.nextVersionNumber(dto.touchpoint);

    let row: PrivacyNotice;
    try {
      row = await this.repo.create({
        touchpoint: dto.touchpoint,
        versionNumber,
        textAr: dto.textAr,
        textEn: dto.textEn,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `A privacy notice version ${versionNumber} for touchpoint "${dto.touchpoint}" was published concurrently — reload and retry.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'PrivacyNotice',
      entityId: row.id,
      afterValue: privacyNoticeAuditSnapshot(row),
    });

    return derivePrivacyNoticeView(row);
  }

  async get(id: string): Promise<PrivacyNoticeView> {
    return derivePrivacyNoticeView(await this.load(id));
  }

  async list(query: ListPrivacyNoticesQueryDto): Promise<PrivacyNoticeView[]> {
    const rows = await this.repo.findMany(
      { touchpoint: query.touchpoint },
      DEFAULT_LIST_TAKE,
    );
    return rows.map((r) => derivePrivacyNoticeView(r));
  }

  /** The highest-versionNumber notice for a touchpoint, or `{ notice: null
   * }` if none has ever been published — a caller-facing "not published
   * yet" state, not a 404 (the touchpoint itself is always valid). Wrapped
   * in an object rather than returning a bare `null` — Nest sends an EMPTY
   * body for a `null`/`undefined` controller return value, not the JSON
   * literal `null`, which a caller can't distinguish from an empty/absent
   * response at all. */
  async current(
    touchpoint: string,
  ): Promise<{ notice: PrivacyNoticeView | null }> {
    const row = await this.repo.findCurrent(touchpoint);
    return { notice: row ? derivePrivacyNoticeView(row) : null };
  }

  async recordLegalReview(
    id: string,
    actorUserId: string,
  ): Promise<PrivacyNoticeView> {
    await this.load(id);
    const res = await this.repo.recordLegalReview(id, new Date());
    if (res.count === 0) {
      throw new UnprocessableEntityException(
        `Privacy notice ${id} has already been legally reviewed.`,
      );
    }

    const row = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'PrivacyNotice',
      entityId: row.id,
      afterValue: privacyNoticeAuditSnapshot(row),
    });

    return derivePrivacyNoticeView(row);
  }

  private async load(id: string) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(`Privacy notice ${id} not found.`);
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `PrivacyNotice audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
