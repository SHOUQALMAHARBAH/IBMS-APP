import { Injectable } from '@nestjs/common';
import type {
  CommunicationLog,
  InteractionChannel,
  LanguagePreference,
} from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RULE 2 — WHICH CUSTOMER, BY NAME, AND IT CANNOT BE AN INCLUDE.
 *
 * MEASURED: `CommunicationLog.customerId` is a bare `String?` — no `@relation`, no foreign key,
 * nothing in the database connecting it to a `Customer`. So `include: { customer: … }` does not
 * compile here, which is how this was found; it is the `Customer.ownerUserId` shape one table over
 * (register entry 63), a column naming a record with nothing enforcing that the record exists.
 *
 * The name is therefore resolved by a SECOND read over the ids a page returned — one query for the
 * page, never one per row, the shape `RetentionNoticeRepository.recordHandles` uses. And because
 * there is no FK, the name has TWO absent cases rather than one: the log may carry no customerId at
 * all, or carry one that resolves to nothing. A MISSING key means the second; the view keeps them
 * apart rather than flattening both into a blank.
 */
export type CommunicationWithCustomer = CommunicationLog;
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

  /*
   * RULE 2 — the include is on the CREATE as well as on the reads, because
   * `deriveCommunicationView` is called on the row a create returns. Without it the screen that has
   * just logged a communication would render no name for it while the list beside it does — which
   * reads as the record being wrong rather than the read, and is the worse of the two failures.
   */
  /**
   * The names for a page of communication logs. ONE query for the page.
   *
   * Returns a Map, and a MISSING key is not a null value: a log carrying a customerId that resolves
   * to nothing is absent from this map, which is a different fact from a log carrying no customerId
   * at all — and only possible here because the column has no foreign key behind it.
   */
  async customerNames(
    customerIds: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(customerIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, legalName: true },
    });
    return new Map(rows.map((r) => [r.id, r.legalName]));
  }

  create(input: CreateCommunicationInput): Promise<CommunicationWithCustomer> {
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
  findProcess44ById(id: string): Promise<CommunicationWithCustomer | null> {
    return this.prisma.client.communicationLog.findFirst({
      where: { id, rfqId: null },
    });
  }

  findManyProcess44(
    scope: CommunicationScope,
    take: number,
  ): Promise<CommunicationWithCustomer[]> {
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
