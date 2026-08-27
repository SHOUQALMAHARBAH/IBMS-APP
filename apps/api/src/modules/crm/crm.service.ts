import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Customer, Interaction } from '@ibms/db';
import { InteractionRepository } from '../../repositories/interaction.repository';
import { CustomerRepository } from '../../repositories/customer.repository';
import { AuditService } from '../audit/audit.service';
import { isCustomerVisibleTo } from '../../common/rbac-visibility.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { LogInteractionDto } from './dto/log-interaction.dto';
import {
  buildCustomerTimeline,
  type TimelineClaim,
  type TimelineComplaint,
  type TimelineEvent,
  type TimelinePolicy,
} from './crm.config';

/** The aggregated "360°" read for one customer — the interaction log plus
 * the customer's policies, claims and complaints, and the single merged
 * timeline the customer-timeline screen renders. Policy/Claim/Complaint are
 * always empty today (Domains B/C/E are not built). */
export interface Customer360View {
  customer: {
    id: string;
    legalName: string;
    customerType: string;
    status: string;
    ownerUserId: string;
  };
  interactions: Interaction[];
  policies: TimelinePolicy[];
  claims: TimelineClaim[];
  complaints: TimelineComplaint[];
  timeline: TimelineEvent[];
  counts: {
    interactions: number;
    policies: number;
    claims: number;
    complaints: number;
  };
}

/** ~1 minute of clock-skew tolerance on a backdated `occurredAt` before it
 * counts as a (nonsensical) future instant. */
const FUTURE_SKEW_MS = 60_000;

/**
 * Process 10 — Relationship Management (CRM) (backlog Part C #10, Domain A).
 *
 * `Interaction` carries no workflow status and no maker/checker — it is a
 * factual log, create + read only. Two visibility rules apply:
 *
 *   - LOGGING is gated by the `interaction.log` permission alone, NOT by
 *     customer ownership. Relationship touchpoints are cross-functional (a
 *     Claims Officer logs a claim call, a Finance Officer a collection call)
 *     and the permission is granted to six roles precisely so any of them
 *     can record one against a customer they do not "own". The customer must
 *     still exist (404 otherwise).
 *
 *   - READING (the interaction list, the 360° view) mirrors
 *     `CustomerService.get()`: the owning Sales Officer, or a
 *     `CUSTOMER_CROSS_OWNER_ROLES` holder (Manager / Executive / Compliance
 *     / External Auditor). NotFoundException either way so a response can't
 *     be used as an existence oracle — same pattern as
 *     `cross-sell.service.ts`.
 *
 * The 360° view reads `Claim` rows (HIGHLY_CONFIDENTIAL) — it writes a READ
 * `AuditLogEntry` (counts only, never claim content) flagged
 * `isSensitiveDataAccess` when the aggregate actually surfaced a claim
 * (Part 10.3 / ibms-brain/meta/lex/sensitive-data-handling.md).
 */
@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly interactions: InteractionRepository,
    private readonly customers: CustomerRepository,
    private readonly audit: AuditService,
  ) {}

  /** Logged, not thrown — the real write already committed; an audit hiccup
   * must not turn a successful operation into a reported failure (same
   * philosophy as CrossSellService.safeAudit and the workflow engine's own
   * sideEffect catch). */
  private async safeAudit(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `CRM ${input.entityType} ${input.entityId}: audit record (${input.action}) failed after the operation already committed`,
        err as Error,
      );
    }
  }

  /** Write path — the customer must exist to hang an interaction off it, but
   * logging is deliberately NOT owner-gated (see the class comment). */
  private async mustFindCustomer(customerId: string): Promise<Customer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Read path — owner or a cross-owner role, else NotFoundException (no
   * existence oracle). */
  private async findVisibleCustomer(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<Customer> {
    const customer = await this.customers.findById(customerId);
    if (!customer || !isCustomerVisibleTo(customer, actor)) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  /** `occurredAt` (optional) is a record of when a touchpoint happened.
   * `@IsISO8601()` on the DTO lets both a date (`2026-02-01`) and an
   * offset-less datetime (`2026-02-01T09:00:00`) through — but
   * `new Date("2026-02-01T09:00:00")` is parsed as *server-local* time by
   * the JS engine, silently shifting the recorded instant for any caller
   * that isn't the web client (which always sends `...Z`). So a datetime
   * MUST carry an explicit offset; a bare date is fine (parsed as UTC
   * midnight, unambiguous). A future instant is rejected — an interaction
   * is something that already happened. */
  private parseOccurredAt(raw: string): Date {
    const hasTimeComponent = /\d{2}:\d{2}/.test(raw);
    const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
    if (hasTimeComponent && !hasOffset) {
      throw new UnprocessableEntityException(
        'occurredAt must carry an explicit timezone offset (e.g. "2026-02-01T09:00:00Z" or "2026-02-01T09:00:00+03:00"), or be a plain date',
      );
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new UnprocessableEntityException('occurredAt is not a valid date');
    }
    if (parsed.getTime() > Date.now() + FUTURE_SKEW_MS) {
      throw new UnprocessableEntityException(
        'occurredAt cannot be in the future — an interaction is a record of something that already happened',
      );
    }
    return parsed;
  }

  async logInteraction(
    customerId: string,
    dto: LogInteractionDto,
    actor: AuthenticatedUser,
  ): Promise<Interaction> {
    await this.mustFindCustomer(customerId);

    let occurredAt: Date | undefined;
    if (dto.occurredAt !== undefined) {
      occurredAt = this.parseOccurredAt(dto.occurredAt);
    }

    const interaction = await this.interactions.create({
      customerId,
      channel: dto.channel,
      summary: dto.summary,
      occurredAt,
      loggedByUserId: actor.id,
    });

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Interaction',
      entityId: interaction.id,
      afterValue: {
        customerId,
        channel: interaction.channel,
        occurredAt: interaction.occurredAt.toISOString(),
      },
    });

    return interaction;
  }

  async listInteractions(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<Interaction[]> {
    await this.findVisibleCustomer(customerId, actor);
    return this.interactions.findManyByCustomerId(customerId);
  }

  async get360View(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<Customer360View> {
    const customer = await this.findVisibleCustomer(customerId, actor);

    const [interactions, policies, claims, complaints] = await Promise.all([
      this.interactions.findManyByCustomerId(customerId),
      this.interactions.findPoliciesForTimeline(customerId),
      this.interactions.findClaimsForTimeline(customerId),
      this.interactions.findComplaintsForTimeline(customerId),
    ]);

    const timeline = buildCustomerTimeline({
      interactions,
      policies,
      claims,
      complaints,
    });

    // Part 10.3 / sensitive-data-handling.md: the 360° view reads `Claim`
    // rows (HIGHLY_CONFIDENTIAL). Record the READ — counts only, never any
    // claim content — and flag it as a sensitive-data access whenever the
    // aggregate actually surfaced a claim, so the audit anomaly detector
    // (repeated / bulk sensitive reads) can see it.
    await this.safeAudit({
      userId: actor.id,
      action: 'READ',
      entityType: 'Customer',
      entityId: customerId,
      isSensitiveDataAccess: claims.length > 0,
      afterValue: {
        view: '360',
        interactions: interactions.length,
        policies: policies.length,
        claims: claims.length,
        complaints: complaints.length,
      },
    });

    return {
      customer: {
        id: customer.id,
        legalName: customer.legalName,
        customerType: customer.customerType,
        status: customer.status,
        ownerUserId: customer.ownerUserId,
      },
      interactions,
      policies,
      claims,
      complaints,
      timeline,
      counts: {
        interactions: interactions.length,
        policies: policies.length,
        claims: claims.length,
        complaints: complaints.length,
      },
    };
  }
}
