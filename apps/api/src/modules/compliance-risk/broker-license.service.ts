import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { BrokerLicense } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import {
  brokerLicenseAuditSnapshot,
  deriveBrokerLicenseView,
  type BrokerLicenseView,
} from './broker-license.config';
import { parseCalendarDate } from '../../common/calendar-date.util';
import type { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';
import type { RenewBrokerLicenseDto } from './dto/renew-broker-license.dto';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Process 51/Part 7.1 — the broker's own CBJ license (backlog Part C #51's
 * first checkbox). `license.manage` (`[COMPLIANCE_OFFICER]`) is the sole
 * gate on every route — a singleton resource, the #41/#44/#45 "one
 * permission for CRUD" shape. Not a `WorkflowTransitionService` entity, no
 * maker/checker — a single officer records their own regulator's record,
 * the same trust level as e.g. `finance-lifecycle.md`'s premium billing.
 */
@Injectable()
export class BrokerLicenseService {
  private readonly logger = new Logger(BrokerLicenseService.name);

  constructor(
    private readonly repo: BrokerLicenseRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateBrokerLicenseDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    const existing = await this.repo.findCurrent();
    if (existing) {
      throw new ConflictException(
        'A broker license record already exists — use renew to update it.',
      );
    }

    const issuedAt = dto.issuedAt
      ? parseCalendarDate(dto.issuedAt, 'issuedAt')
      : null;
    const expiresAt = parseCalendarDate(dto.expiresAt, 'expiresAt');

    // A @code-reviewer MAJOR: the pre-check above is not enough on its own
    // — two concurrent POST /broker-license calls can both pass it before
    // either has written the row. The fixed-id @id primary key still stops
    // a second row from ever being created (the data integrity holds), but
    // without this catch the second caller's P2002 surfaces as an
    // unhandled 500 instead of the same 409 the pre-check already gives a
    // sequential caller (the isUniqueViolation shape every other
    // create-once resource in this codebase uses — e.g. policy.service.ts,
    // watchlist-sync.service.ts).
    let row: BrokerLicense;
    try {
      row = await this.repo.create({
        licenseNumber: dto.licenseNumber,
        scopeOfAuthorization: dto.scopeOfAuthorization ?? null,
        issuedAt,
        expiresAt,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'A broker license record already exists — use renew to update it.',
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'BrokerLicense',
      entityId: row.id,
      afterValue: brokerLicenseAuditSnapshot(row),
    });

    return deriveBrokerLicenseView(row, new Date());
  }

  async renew(
    dto: RenewBrokerLicenseDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    await this.mustFindCurrent();

    const issuedAt = dto.issuedAt
      ? parseCalendarDate(dto.issuedAt, 'issuedAt')
      : null;
    const expiresAt = parseCalendarDate(dto.expiresAt, 'expiresAt');

    await this.repo.renew({
      licenseNumber: dto.licenseNumber,
      scopeOfAuthorization: dto.scopeOfAuthorization ?? null,
      issuedAt,
      expiresAt,
    });

    const after = await this.mustFindCurrent();
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'BrokerLicense',
      entityId: after.id,
      afterValue: brokerLicenseAuditSnapshot(after),
    });
    return deriveBrokerLicenseView(after, new Date());
  }

  /** Manual override — Compliance flags the license lapsed ahead of its
   * calendar expiry (e.g. a CBJ suspension). Idempotent on an
   * already-lapsed license (the `retention-case.close` shape), 404 if none
   * exists yet. */
  async markLapsed(actorUserId: string): Promise<BrokerLicenseView> {
    const existing = await this.mustFindCurrent();
    if (existing.status === 'lapsed') {
      return deriveBrokerLicenseView(existing, new Date());
    }

    const res = await this.repo.markLapsed();
    const after = await this.mustFindCurrent();
    if (res.count > 0) {
      await this.safeAudit({
        userId: actorUserId,
        action: 'UPDATE',
        entityType: 'BrokerLicense',
        entityId: after.id,
        afterValue: brokerLicenseAuditSnapshot(after),
      });
    }
    return deriveBrokerLicenseView(after, new Date());
  }

  async get(): Promise<BrokerLicenseView> {
    return deriveBrokerLicenseView(await this.mustFindCurrent(), new Date());
  }

  private async mustFindCurrent() {
    const row = await this.repo.findCurrent();
    if (!row) {
      throw new NotFoundException(
        'No broker license record exists yet — create one first.',
      );
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Broker-license audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
