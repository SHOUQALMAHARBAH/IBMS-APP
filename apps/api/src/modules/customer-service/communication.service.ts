import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { parseHistoricalInstant } from '../../common/historical-instant.util';
import { CommunicationRepository } from '../../repositories/communication.repository';
import {
  blockedCommunicationAuditSnapshot,
  communicationAuditSnapshot,
  COMMUNICATION_READ_LIMIT,
  deriveCommunicationView,
  evaluateMarketingConsent,
  resolveChannel,
  resolveLanguage,
  type CommunicationView,
  type MarketingConsentDecision,
} from './communication.config';
import type { CreateCommunicationDto } from './dto/create-communication.dto';
import type { ListCommunicationsQueryDto } from './dto/list-communications-query.dto';

export interface MarketingConsentStatusView {
  customerId: string;
  marketing: MarketingConsentDecision;
}

/**
 * Process 44 — Customer Communication (backlog Part C #44, Domain E — Customer
 * Service). Records an outbound customer communication on `CommunicationLog`,
 * respecting the customer's recorded channel and language, and — for a
 * marketing send — only after the customer's MARKETING `ConsentRecord` is
 * granted and not withdrawn (PDPL / `PRIV-SOP-04`; M03 is the source of truth
 * for consent — this only *reads* it).
 *
 * `CommunicationLog` is a factual log: no `WorkflowTransitionService`, no
 * maker/checker (the `Interaction` #10 / RFQ-correspondence #12 shape). A
 * Process-44 row is the `rfqId IS NULL` subset. `communication.send`
 * (`[SALES_RELATIONSHIP_OFFICER, PLACEMENT_TECHNICAL_OFFICER, CLAIMS_OFFICER,
 * FINANCE_COLLECTIONS_OFFICER]`).
 */
@Injectable()
export class CommunicationService {
  private readonly logger = new Logger(CommunicationService.name);

  constructor(
    private readonly repo: CommunicationRepository,
    private readonly audit: AuditService,
  ) {}

  // --- 1. send (log an outbound communication) -----------------------

  async create(
    dto: CreateCommunicationDto,
    actorUserId: string,
  ): Promise<CommunicationView> {
    const customer = await this.repo.customerForCommunication(dto.customerId);
    if (!customer) {
      throw new NotFoundException(`Customer ${dto.customerId} not found.`);
    }

    // "Respect the customer's recorded channel and language" — both are
    // derived from the customer record; a disagreeing explicit value is a 422
    // (the "computed, not an input, when derivable" rule — #28 / #31 / #38).
    const channelRes = resolveChannel(
      dto.channel,
      customer.preferredContactChannel,
    );
    if (channelRes.error !== null) {
      throw new UnprocessableEntityException(channelRes.error);
    }
    const channel = channelRes.value!;

    const languageRes = resolveLanguage(
      dto.languageUsed,
      customer.languagePreference,
    );
    if (languageRes.error !== null) {
      throw new UnprocessableEntityException(languageRes.error);
    }
    const languageUsed = languageRes.value!;

    const isMarketing = dto.isMarketing ?? false;
    let consentRecordId: string | null = null;

    if (isMarketing) {
      // The gate is a read-then-write with no DB constraint tying the two: a
      // withdrawal landing between here and the `create()` below would leave a
      // marketing row citing consent that was withdrawn moments earlier. Tolerable
      // while this is a *log*, not a sender (delivery is deferred) — the
      // `consentRecordId` is the forensic trail and the M03 register-reflection
      // SLA is 2 business days. A real email/SMS dispatch MUST re-check consent
      // at send time, inside the same guard.
      const records = await this.repo.marketingConsentRecords(dto.customerId);
      const decision = evaluateMarketingConsent(records);
      if (!decision.allowed) {
        // A blocked marketing send is a compliance-relevant event — record it
        // (best-effort). No `CommunicationLog` row: the send did not happen.
        await this.safeAudit({
          userId: actorUserId,
          action: 'REJECT',
          entityType: 'CommunicationLog',
          entityId: 'blocked',
          afterValue: blockedCommunicationAuditSnapshot({
            customerId: dto.customerId,
            channel,
            reason: decision.reason,
            consentRecordId: decision.consentRecordId,
          }),
        });
        throw new UnprocessableEntityException(
          `Marketing consent for customer ${dto.customerId} is ${
            decision.reason === 'no_record'
              ? 'not on record'
              : decision.reason.replace('_', ' ')
          } — a marketing communication cannot be sent (PDPL / PRIV-SOP-04). Record a granted MARKETING ConsentRecord first, or send this as a non-marketing (service) message.`,
        );
      }
      consentRecordId = decision.consentRecordId;
    }

    const sentAt =
      dto.sentAt !== undefined
        ? parseHistoricalInstant(dto.sentAt, 'sentAt')
        : undefined;

    const row = await this.repo.create({
      customerId: dto.customerId,
      channel,
      templateId: dto.templateId ?? null,
      languageUsed,
      subject: dto.subject ?? null,
      body: dto.body ?? null,
      isMarketing,
      consentRecordId,
      loggedByUserId: actorUserId,
      sentAt,
    });

    // Structural metadata only — `subject` / `body` are Confidential free text
    // and never enter an audit row (the #12 RfqCommunication / CRM Interaction
    // precedent). Best-effort: the send is committed.
    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'CommunicationLog',
      entityId: row.id,
      afterValue: communicationAuditSnapshot({
        communicationLogId: row.id,
        customerId: row.customerId,
        channel: row.channel,
        templateId: row.templateId,
        languageUsed: row.languageUsed,
        direction: row.direction,
        isMarketing: row.isMarketing,
        respectedConsent: row.respectedConsent,
        consentRecordId: row.consentRecordId,
        sentAt: row.sentAt,
      }),
    });

    return deriveCommunicationView(row);
  }

  // --- 2. consent status (a pre-compose check) ----------------------

  async marketingConsentStatus(
    customerId: string,
  ): Promise<MarketingConsentStatusView> {
    if (!(await this.repo.customerForCommunication(customerId))) {
      throw new NotFoundException(`Customer ${customerId} not found.`);
    }
    const records = await this.repo.marketingConsentRecords(customerId);
    return { customerId, marketing: evaluateMarketingConsent(records) };
  }

  // --- 3. reads ----------------------------------------------------

  async get(id: string): Promise<CommunicationView> {
    const row = await this.repo.findProcess44ById(id);
    if (!row) {
      throw new NotFoundException(`Communication ${id} not found.`);
    }
    return deriveCommunicationView(row);
  }

  async list(query: ListCommunicationsQueryDto): Promise<CommunicationView[]> {
    const rows = await this.repo.findManyProcess44(
      {
        customerId: query.customerId,
        channel: query.channel,
        isMarketing: query.isMarketing,
        direction: query.direction,
      },
      COMMUNICATION_READ_LIMIT,
    );
    if (rows.length >= COMMUNICATION_READ_LIMIT) {
      this.logger.warn(
        `Communication list truncated at ${COMMUNICATION_READ_LIMIT} rows — narrow with customerId / channel / isMarketing / direction.`,
      );
    }
    return rows.map((r) => deriveCommunicationView(r));
  }

  // --- helpers ---------------------------------------------------

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Communication audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
