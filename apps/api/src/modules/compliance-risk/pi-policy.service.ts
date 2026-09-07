import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { PiPolicyRepository } from '../../repositories/pi-policy.repository';
import {
  derivePiPolicyView,
  piPolicyAuditSnapshot,
  type PiPolicyRow,
  type PiPolicyView,
} from './pi-policy.config';
import { parseCalendarDate } from '../../common/calendar-date.util';
import { toMoney } from '../../common/money.util';
import type { CreatePiPolicyDto } from './dto/create-pi-policy.dto';
import type { RecordPiClaimsHistoryDto } from './dto/record-pi-claims-history.dto';

/** Cap on a book-wide `ProfessionalIndemnityPolicy` list — a broker logs
 * roughly one of these a year, so this is generous headroom, not a real
 * limit anyone should hit. */
const PI_POLICY_READ_LIMIT = 5000;

/**
 * Process 53-54/Part 7.1 — the broker's own Professional Indemnity policy.
 * `pi-policy.manage` (`[COMPLIANCE_OFFICER]`) is the sole gate on every
 * route — a Compliance-only record, no maker/checker (a single officer logs
 * their own insurer's renewal particulars, the `BrokerLicense`/
 * `finance-lifecycle.md` premium-billing trust level).
 */
@Injectable()
export class PiPolicyService {
  private readonly logger = new Logger(PiPolicyService.name);

  constructor(
    private readonly repo: PiPolicyRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreatePiPolicyDto,
    actorUserId: string,
  ): Promise<PiPolicyView> {
    const row = await this.repo.create({
      insurerName: dto.insurerName,
      coverageLimit: toMoney(dto.coverageLimit, 'coverageLimit'),
      expiresAt: parseCalendarDate(dto.expiresAt, 'expiresAt'),
      claimsHistorySummary: dto.claimsHistorySummary ?? null,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'ProfessionalIndemnityPolicy',
      entityId: row.id,
      afterValue: piPolicyAuditSnapshot(row),
    });

    const current = await this.repo.findCurrent();
    return derivePiPolicyView(row, new Date(), current?.id ?? null);
  }

  /** A plain field overwrite, no optimistic-concurrency guard — a
   * `@code-reviewer` MINOR: two Compliance officers editing the SAME
   * record's `claimsHistorySummary` concurrently get silent last-writer-wins
   * with no conflict signal to either caller. Accepted deliberately, not an
   * oversight: `ProfessionalIndemnityPolicy` has no `updatedAt`/version
   * column to build a real guard from without a migration this checkbox
   * ("track... claims history") doesn't call for, the small single-role
   * (`pi-policy.manage` is COMPLIANCE_OFFICER-only) user pool makes a
   * genuine concurrent edit rare, and each write still produces its own
   * accurate `UPDATE` audit row — so the CONTENT is never unrecoverable,
   * only the live column's value is momentarily contested. The exact
   * `BrokerLicense.scopeOfAuthorization` trust-level reasoning, stated
   * explicitly here rather than left implicit. */
  async recordClaimsHistory(
    id: string,
    dto: RecordPiClaimsHistoryDto,
    actorUserId: string,
  ): Promise<PiPolicyView> {
    await this.mustFind(id);
    const row = await this.repo.updateClaimsHistory(
      id,
      dto.claimsHistorySummary,
    );

    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'ProfessionalIndemnityPolicy',
      entityId: row.id,
      afterValue: piPolicyAuditSnapshot(row),
    });

    const current = await this.repo.findCurrent();
    return derivePiPolicyView(row, new Date(), current?.id ?? null);
  }

  /** The broker's most-recently-expiring PI policy on record. 404 until
   * Compliance logs the first one — the `BrokerLicense.get()` shape; this is
   * a tracking record, not an issuance gate, so nothing else in this
   * codebase depends on a configured value existing. */
  async getCurrent(): Promise<PiPolicyView> {
    const current = await this.repo.findCurrent();
    if (!current) {
      throw new NotFoundException(
        'No Professional Indemnity policy record exists yet.',
      );
    }
    return derivePiPolicyView(current, new Date(), current.id);
  }

  async get(id: string): Promise<PiPolicyView> {
    const row = await this.mustFind(id);
    const current = await this.repo.findCurrent();
    return derivePiPolicyView(row, new Date(), current?.id ?? null);
  }

  async list(): Promise<PiPolicyView[]> {
    const now = new Date();
    const [rows, current] = await Promise.all([
      this.repo.findMany(PI_POLICY_READ_LIMIT),
      this.repo.findCurrent(),
    ]);
    if (rows.length >= PI_POLICY_READ_LIMIT) {
      this.logger.warn(
        `PI policy list truncated at ${PI_POLICY_READ_LIMIT} rows.`,
      );
    }
    return rows.map((r) => derivePiPolicyView(r, now, current?.id ?? null));
  }

  private async mustFind(id: string): Promise<PiPolicyRow> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException(
        `Professional Indemnity policy ${id} not found.`,
      );
    }
    return row;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `PI-policy audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
