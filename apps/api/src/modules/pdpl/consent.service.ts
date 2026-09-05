import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { ConsentRecordRepository } from '../../repositories/consent-record.repository';
import {
  CONSENT_READ_LIMIT,
  CONSENT_SLA_WORKFLOW,
  consentAuditSnapshot,
  consentWithdrawalAuditSnapshot,
  deriveConsentView,
  hasExactlyOneOwner,
  type ConsentRecordRow,
  type ConsentRecordView,
} from './consent.config';
import type { CreateConsentRecordDto } from './dto/create-consent-record.dto';
import type { ListConsentRecordsQueryDto } from './dto/list-consent-records-query.dto';

export interface RequestWithdrawalResult {
  consentRecordId: string;
  requestedAt: string;
  dueAt: string | null;
}

/**
 * M03 — Consent Management (backlog Part D §5.1 / `IMPROVEMENTS.md` §5.1;
 * Process #52 "Data Protection Compliance" bundles all of Part D). Captures
 * a consent decision (grant or explicit decline) at a defined touchpoint and
 * withdraws it through a two-step flow that gives the `consent_withdrawal`
 * SLA timer (`sla-registry.config.ts`, 2 business days, `PRIV-STD-01` §6.3)
 * a real, meaningful window rather than one that is always trivially met:
 *
 *   1. `requestWithdrawal` — logs that a withdrawal was asked for (in person,
 *      by phone, by email, or self-service) and starts the SLA clock. No
 *      `ConsentRecord` field changes yet — the schema's own comment on
 *      `withdrawnAt` ("must reflect in register within 2 business days")
 *      only makes sense if intake and reflection can be genuinely separate
 *      events; if they always collapsed into one atomic call, the SLA would
 *      be vacuous by construction.
 *   2. `confirmWithdrawal` — the register is actually updated (`withdrawnAt`
 *      stamped) and the timer resolves. Callable standalone too (an
 *      immediate self-service withdrawal with no prior "request" step is
 *      legitimate — `SlaTimerService.resolve` is a documented no-op when
 *      nothing is open, so this never errors on a same-day withdrawal).
 *
 * `#44`'s marketing-send gate (`evaluateMarketingConsent`) already reads the
 * live `withdrawnAt` on every send — once `confirmWithdrawal` sets it,
 * "affected communications suppressed immediately" (the backlog's second
 * clause) is enforced for free, by code that shipped before this module did.
 *
 * No maker/checker (`maker-checker-segregation.md` — a single-actor
 * compliance capture, the #41/#44/#45 shape; nothing here approves a refund,
 * closes a DSR, or signs off a disposal). Not a `WorkflowTransitionService`
 * entity (`consent.config.ts`'s header). `consent.manage`
 * (`[SALES_RELATIONSHIP_OFFICER, PLACEMENT_TECHNICAL_OFFICER, CLAIMS_OFFICER,
 * DATA_PROTECTION_OFFICER]`) covers capture, withdrawal, and reads alike —
 * the #41/#44/#45 "one perm for CRUD" shape.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly repo: ConsentRecordRepository,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
  ) {}

  // --- 1. capture (grant or explicit decline) -------------------------

  async create(
    dto: CreateConsentRecordDto,
    actorUserId: string,
  ): Promise<ConsentRecordView> {
    if (!hasExactlyOneOwner(dto)) {
      throw new UnprocessableEntityException(
        'Exactly one of customerId / insuredPersonId must identify the data subject.',
      );
    }
    if (dto.customerId && !(await this.repo.customerExists(dto.customerId))) {
      throw new NotFoundException(`Customer ${dto.customerId} not found.`);
    }
    if (
      dto.insuredPersonId &&
      !(await this.repo.insuredPersonExists(dto.insuredPersonId))
    ) {
      throw new NotFoundException(
        `Insured person ${dto.insuredPersonId} not found.`,
      );
    }

    const isMarketing = dto.purpose === 'MARKETING';
    const grantedAt = dto.granted ? new Date() : null;

    const row = await this.repo.create({
      customerId: dto.customerId ?? null,
      insuredPersonId: dto.insuredPersonId ?? null,
      purpose: dto.purpose,
      isMarketing,
      granted: dto.granted,
      consentTextVersion: dto.consentTextVersion,
      grantedAt,
    });

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'ConsentRecord',
      entityId: row.id,
      afterValue: consentAuditSnapshot({
        consentRecordId: row.id,
        customerId: row.customerId,
        insuredPersonId: row.insuredPersonId,
        purpose: row.purpose,
        isMarketing: row.isMarketing,
        granted: row.granted,
        consentTextVersion: row.consentTextVersion,
      }),
    });

    return deriveConsentView(row);
  }

  // --- 2. request-withdrawal (logs intake, starts the SLA clock) -----

  async requestWithdrawal(
    id: string,
    actorUserId: string,
  ): Promise<RequestWithdrawalResult> {
    const record = await this.load(id);
    this.assertWithdrawable(record);

    const requestedAt = new Date();
    let dueAt: Date | null = null;
    try {
      const dueAtComputed = this.slaTimer.computeDueAt(
        CONSENT_SLA_WORKFLOW,
        requestedAt,
      );
      const [timer] = await this.slaTimer.startTimer({
        entityType: 'ConsentRecord',
        entityId: id,
        workflowName: CONSENT_SLA_WORKFLOW,
        dueAt: dueAtComputed,
        actorUserId,
      });
      dueAt = timer?.dueAt ?? null;
    } catch (err) {
      // Best-effort, the A.8 / #41 precedent — the intake itself (this call
      // returning 200) is what tells staff the clock has started; a timer
      // bookkeeping failure must not block that from being logged.
      this.logger.warn(
        `ConsentRecord ${id}: failed to start its withdrawal SLA timer: ${(err as Error).message}`,
      );
    }

    return {
      consentRecordId: id,
      requestedAt: requestedAt.toISOString(),
      dueAt: dueAt ? dueAt.toISOString() : null,
    };
  }

  // --- 3. confirm-withdrawal (reflects it, resolves the SLA) ---------

  async confirmWithdrawal(
    id: string,
    actorUserId: string,
  ): Promise<ConsentRecordView> {
    const record = await this.load(id);

    if (!record.granted) {
      throw new UnprocessableEntityException(
        `Consent record ${id} was never granted — there is nothing to withdraw.`,
      );
    }
    if (record.withdrawnAt !== null) {
      return deriveConsentView(record); // idempotent
    }

    const withdrawnAt = new Date();
    const res = await this.repo.recordWithdrawal(id, withdrawnAt);
    if (res.count === 0) {
      const now = await this.load(id);
      if (now.withdrawnAt !== null) {
        return deriveConsentView(now); // concurrent confirm landed first
      }
      throw new ConflictException(
        `Consent record ${id} changed concurrently — reload and retry.`,
      );
    }

    // Best-effort — the withdrawal is committed; a no-op if nothing was open
    // (a standalone confirm with no prior requestWithdrawal call).
    try {
      await this.slaTimer.resolve({
        entityType: 'ConsentRecord',
        entityId: id,
        workflowName: CONSENT_SLA_WORKFLOW,
        actorUserId,
        resolvedAt: withdrawnAt,
      });
    } catch (err) {
      this.logger.warn(
        `ConsentRecord ${id}: failed to resolve its withdrawal SLA timer (non-fatal): ${(err as Error).message}`,
      );
    }

    const after = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'ConsentRecord',
      entityId: id,
      afterValue: consentWithdrawalAuditSnapshot({
        consentRecordId: id,
        customerId: after.customerId,
        insuredPersonId: after.insuredPersonId,
        purpose: after.purpose,
        withdrawnAt,
      }),
    });

    return deriveConsentView(after);
  }

  // --- reads -----------------------------------------------------

  async get(id: string): Promise<ConsentRecordView> {
    return deriveConsentView(await this.load(id));
  }

  async list(query: ListConsentRecordsQueryDto): Promise<ConsentRecordView[]> {
    const rows = await this.repo.findMany(
      {
        customerId: query.customerId,
        insuredPersonId: query.insuredPersonId,
        purpose: query.purpose,
        granted: query.granted,
      },
      CONSENT_READ_LIMIT,
    );
    if (rows.length >= CONSENT_READ_LIMIT) {
      this.logger.warn(
        `Consent-record list truncated at ${CONSENT_READ_LIMIT} rows — narrow with customerId / insuredPersonId / purpose / granted.`,
      );
    }
    return rows.map((r) => deriveConsentView(r));
  }

  // --- helpers -------------------------------------------------

  private async load(id: string): Promise<ConsentRecordRow> {
    const record = await this.repo.findById(id);
    if (!record) {
      throw new NotFoundException(`Consent record ${id} not found.`);
    }
    return record;
  }

  private assertWithdrawable(record: ConsentRecordRow): void {
    if (!record.granted) {
      throw new UnprocessableEntityException(
        `Consent record ${record.id} was never granted — there is nothing to withdraw.`,
      );
    }
    if (record.withdrawnAt !== null) {
      throw new UnprocessableEntityException(
        `Consent record ${record.id} is already withdrawn.`,
      );
    }
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Consent audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
