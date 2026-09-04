import { Injectable } from '@nestjs/common';
import type {
  CommunicationLog,
  InteractionChannel,
  LanguagePreference,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { MarketingConsentRow } from '../modules/customer-service/communication.config';

export interface CommunicationCustomer {
  id: string;
  languagePreference: LanguagePreference;
  preferredContactChannel: InteractionChannel | null;
}

export interface CreateCommunicationInput {
  customerId: string;
  channel: InteractionChannel;
  templateId: string | null;
  languageUsed: LanguagePreference;
  subject: string | null;
  body: string | null;
  isMarketing: boolean;
  consentRecordId: string | null;
  loggedByUserId: string;
  sentAt: Date | undefined;
}

export interface CommunicationScope {
  customerId?: string;
  /** already narrowed to `COMMUNICATION_CHANNELS` by the list DTO */
  channel?: string;
  isMarketing?: boolean;
  /** already narrowed to `CommunicationDirection` by the list DTO */
  direction?: string;
}

/**
 * Process 44 — Customer Communication (backlog Part C #44, Domain E). Owns the
 * Process-44 subset of `CommunicationLog` (`rfqId IS NULL` — a `rfqId IS NOT
 * NULL` row is Process-12 RFQ correspondence, owned by `RfqRepository`), plus
 * the `Customer` channel/language lookup and the `ConsentRecord` marketing
 * lookup the send gate needs. Wraps `PrismaService` (services depend on
 * repositories here, never on Prisma directly).
 */
@Injectable()
export class CommunicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The recorded channel + language preference the send derives from. Null
   * when the customer does not exist. */
  customerForCommunication(
    customerId: string,
  ): Promise<CommunicationCustomer | null> {
    return this.prisma.client.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        languagePreference: true,
        preferredContactChannel: true,
      },
    });
  }

  /** The customer's MARKETING consent records — `purpose = MARKETING` OR the
   * explicit `isMarketing` flag (`PRIV-SOP-04` keeps them as separate
   * controls; either identifies a marketing-consent row). Which one governs
   * is `evaluateMarketingConsent`'s (pure) call. */
  marketingConsentRecords(customerId: string): Promise<MarketingConsentRow[]> {
    return this.prisma.client.consentRecord.findMany({
      where: {
        customerId,
        OR: [{ purpose: 'MARKETING' }, { isMarketing: true }],
      },
      select: {
        id: true,
        granted: true,
        withdrawnAt: true,
        grantedAt: true,
        createdAt: true,
      },
    });
  }

  create(input: CreateCommunicationInput): Promise<CommunicationLog> {
    return this.prisma.client.communicationLog.create({
      data: {
        customerId: input.customerId,
        channel: input.channel,
        templateId: input.templateId,
        languageUsed: input.languageUsed,
        direction: 'OUTBOUND',
        subject: input.subject,
        body: input.body,
        isMarketing: input.isMarketing,
        respectedConsent: true,
        consentRecordId: input.consentRecordId,
        loggedByUserId: input.loggedByUserId,
        ...(input.sentAt ? { sentAt: input.sentAt } : {}),
      },
    });
  }

  /** A Process-44 row by id — `rfqId IS NULL` so an RFQ-correspondence id
   * 404s here (it is not a customer communication). */
  findProcess44ById(id: string): Promise<CommunicationLog | null> {
    return this.prisma.client.communicationLog.findFirst({
      where: { id, rfqId: null },
    });
  }

  findManyProcess44(
    scope: CommunicationScope,
    take: number,
  ): Promise<CommunicationLog[]> {
    return this.prisma.client.communicationLog.findMany({
      where: {
        rfqId: null,
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.channel
          ? { channel: scope.channel as CommunicationLog['channel'] }
          : {}),
        ...(scope.isMarketing !== undefined
          ? { isMarketing: scope.isMarketing }
          : {}),
        ...(scope.direction
          ? { direction: scope.direction as CommunicationLog['direction'] }
          : {}),
      },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      take,
    });
  }
}
