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
  pickCurrentTerm,
  type BrokerLicenseView,
} from './broker-license.config';
import { parseCalendarDate } from '../../common/calendar-date.util';
import type { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';
import type { RenewBrokerLicenseDto } from './dto/renew-broker-license.dto';
import type { RecordRenewalRequestDto } from './dto/record-renewal-request.dto';
import type { BrokerLicenseTermDto } from './dto/broker-license-term.dto';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/** What `GET /broker-license` answers: the term that decides whether the office may practise, plus
 *  the series behind it. `current` is NULL for an office that holds no licence — which is a state
 *  the screen has to be able to render, because it is also the state that BLOCKS new business. */
export interface BrokerLicenseSeriesView {
  current: BrokerLicenseView | null;
  terms: BrokerLicenseView[];
}

/**
 * Module 0 item (c) — the office's CBJ licence, as a series of terms.
 *
 * `license.manage` (`[COMPLIANCE_OFFICER]`) gates every route, unchanged. Not a
 * `WorkflowTransitionService` entity and no maker/checker — a single officer records their own
 * regulator's record.
 *
 * ## Renewal APPENDS. It used to overwrite.
 *
 * The old `renew` was an `updateMany` over one globally-keyed row, so the term being replaced was
 * erased: the office could not show a regulator what it had been licensed for in a previous period.
 * A renewal now writes a new term and leaves the old one, with its own certificate and dates.
 */
@Injectable()
export class BrokerLicenseService {
  private readonly logger = new Logger(BrokerLicenseService.name);

  constructor(
    private readonly repo: BrokerLicenseRepository,
    private readonly audit: AuditService,
  ) {}

  /** This office's FIRST term. 409 if it already holds one — per office now, where the old 409 was
   *  effectively per platform because the row was keyed by a global constant. */
  async create(
    dto: CreateBrokerLicenseDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    const existing = await this.repo.findTerms();
    if (existing.length > 0) {
      throw new ConflictException(
        'This office already holds a broker license — use renew to record the next term.',
      );
    }
    return this.appendTerm(dto, actorUserId);
  }

  /** The NEXT term. 404 if the office holds none yet. */
  async renew(
    dto: RenewBrokerLicenseDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    await this.mustFindCurrentTerm();
    return this.appendTerm(dto, actorUserId);
  }

  /**
   * Records that the renewal application for the next term has been filed, against the CURRENT
   * term — because art. 11's 45-day deadline is measured from THAT term's expiry.
   */
  async recordRenewalRequest(
    dto: RecordRenewalRequestDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    const current = await this.mustFindCurrentTerm();
    const supplied = dto.requestedAt !== undefined;
    const requestedAt = supplied
      ? parseCalendarDate(dto.requestedAt as string, 'requestedAt')
      : new Date();

    const res = await this.repo.recordRenewalRequest(current.id, requestedAt);
    if (res.count === 0) {
      // Already recorded. Deliberately not an error and deliberately not an overwrite: this date is
      // what art. 11 lateness is measured against, so a second call must not be able to move it.
      throw new ConflictException(
        'A renewal application is already recorded for the current term; its filing date cannot be changed.',
      );
    }

    const after = await this.mustFindCurrentTerm();
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'BrokerLicense',
      entityId: after.id,
      afterValue: {
        ...brokerLicenseAuditSnapshot(after),
        // WHICH date, and whether a human chose it. The DTO explains why a supplied date is
        // allowed; this is what makes a backdated filing answerable rather than invisible.
        renewalRequestedAtWasSupplied: supplied,
      },
    });
    return deriveBrokerLicenseView(after, new Date());
  }

  /** Manual override — Compliance flags the CURRENT term lapsed ahead of its calendar expiry (e.g.
   *  a CBJ suspension). Idempotent on an already-lapsed term, 404 if the office holds none. */
  async markLapsed(actorUserId: string): Promise<BrokerLicenseView> {
    const current = await this.mustFindCurrentTerm();
    if (current.status === 'lapsed') {
      return deriveBrokerLicenseView(current, new Date());
    }

    const res = await this.repo.markLapsed(current.id);
    const after = await this.mustFindCurrentTerm();
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

  /**
   * The current term and the whole series.
   *
   * NO LONGER 404s when the office holds no licence. That was defensible while a licence was one
   * global row somebody had either created or not; it is wrong now, because "this office holds no
   * licence" is a real, renderable state AND the state that blocks new business. A screen that gets
   * a 404 cannot tell the reader that.
   */
  async get(): Promise<BrokerLicenseSeriesView> {
    const now = new Date();
    const terms = await this.repo.findTerms();
    const current = pickCurrentTerm(terms);
    return {
      current: current ? deriveBrokerLicenseView(current, now) : null,
      terms: terms.map((t) => deriveBrokerLicenseView(t, now)),
    };
  }

  private async appendTerm(
    dto: BrokerLicenseTermDto,
    actorUserId: string,
  ): Promise<BrokerLicenseView> {
    const issuedAt = dto.issuedAt
      ? parseCalendarDate(dto.issuedAt, 'issuedAt')
      : null;
    const expiresAt = parseCalendarDate(dto.expiresAt, 'expiresAt');

    let row: BrokerLicense;
    try {
      row = await this.repo.createTerm({
        licenseNumber: dto.licenseNumber,
        scopeOfAuthorization: dto.scopeOfAuthorization ?? null,
        issuedAt,
        expiresAt,
        certificate: {
          fileName: dto.certificateFileName,
          storageRef: dto.certificateStorageRef,
          uploadedByUserId: actorUserId,
        },
      });
    } catch (err) {
      // `@@unique([organizationId, licenseNumber, expiresAt])`. Two officers recording the same
      // term, or one clicking twice — a 409 naming the term, not an unhandled 500.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `This office already holds a term for license ${dto.licenseNumber} expiring ${dto.expiresAt}.`,
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

  private async mustFindCurrentTerm(): Promise<BrokerLicense> {
    const current = pickCurrentTerm(await this.repo.findTerms());
    if (!current) {
      throw new NotFoundException(
        'This office holds no broker license term yet — record one first.',
      );
    }
    return current;
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
