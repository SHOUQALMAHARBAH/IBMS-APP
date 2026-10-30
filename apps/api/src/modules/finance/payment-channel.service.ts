import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { PaymentChannelRepository } from '../../repositories/payment-channel.repository';
import {
  derivePaymentChannelView,
  paymentChannelAuditSnapshot,
  type PaymentChannelView,
} from './finance.config';
import type { CreatePaymentChannelDto } from './dto/create-payment-channel.dto';
import type { ListPaymentChannelsQueryDto } from './dto/list-payment-channels-query.dto';
import { CustomerRepository } from '../../repositories/customer.repository';
import { InsurerRepository } from '../../repositories/insurer.repository';

/**
 * Process 38 — the approved `PaymentChannel` list (`payment-channel.read`/`.create`/`.deactivate` /
 * Finance). A governed reference list: Finance adds a channel (it is `active`
 * = approved on creation) and disables one it no longer uses. #32's collection
 * cycle validates a supplied `paymentChannelId` against this list
 * (active + right owner) and records it on the `Receipt` / `Remittance`.
 *
 * Masked-only: the service never receives or stores a full account number
 * (`sensitive-data-handling.md`); `accountLast4` is the only fragment.
 * No maker/checker (maintaining a reference list is single-actor Finance work,
 * `roles-and-segregation-of-duties.md`).
 */
@Injectable()
export class PaymentChannelService {
  private readonly logger = new Logger(PaymentChannelService.name);

  constructor(
    private readonly channels: PaymentChannelRepository,
    /* ITEM 1 — the owner's name, through each entity's OWN resolver. Provided independently rather
     * than imported as a service: this codebase's cross-module rule. */
    private readonly customers: CustomerRepository,
    private readonly insurers: InsurerRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreatePaymentChannelDto,
    actorId: string,
  ): Promise<PaymentChannelView> {
    const customerId = dto.customerId ?? null;
    const insurerId = dto.insurerId ?? null;

    if (dto.ownerType === 'customer') {
      if (!customerId || insurerId) {
        throw new UnprocessableEntityException(
          'A customer channel needs exactly a customerId (no insurerId).',
        );
      }
      if (!(await this.channels.customerExists(customerId))) {
        throw new NotFoundException(`Customer ${customerId} not found.`);
      }
    } else {
      if (!insurerId || customerId) {
        throw new UnprocessableEntityException(
          'An insurer channel needs exactly an insurerId (no customerId).',
        );
      }
      if (!(await this.channels.insurerExists(insurerId))) {
        throw new NotFoundException(`Insurer ${insurerId} not found.`);
      }
    }

    const created = await this.channels.create({
      ownerType: dto.ownerType,
      customerId,
      insurerId,
      channelType: dto.channelType,
      label: dto.label.trim(),
      bankName: dto.bankName?.trim() || null,
      accountLast4: dto.accountLast4 ?? null,
      currency: (dto.currency ?? 'JOD').toUpperCase(),
    });

    await this.safeAudit({
      userId: actorId,
      action: 'CREATE',
      entityType: 'PaymentChannel',
      entityId: created.id,
      afterValue: paymentChannelAuditSnapshot({
        channelId: created.id,
        ownerType: created.ownerType,
        customerId: created.customerId,
        insurerId: created.insurerId,
        channelType: created.channelType,
        label: created.label,
        bankName: created.bankName,
        status: created.status,
      }),
    });

    return derivePaymentChannelView(created, await this.ownerNames([created]));
  }

  async disable(id: string, actorId: string): Promise<PaymentChannelView> {
    const existing = await this.channels.findById(id);
    if (!existing) {
      throw new NotFoundException(`Payment channel ${id} not found.`);
    }
    if (existing.status === 'disabled') {
      // idempotent
      return derivePaymentChannelView(
        existing,
        await this.ownerNames([existing]),
      );
    }

    const res = await this.channels.disable(id);
    if (res.count === 0) {
      // Raced to disabled by a concurrent call — reload and return it.
      const now = await this.channels.findById(id);
      if (now)
        return derivePaymentChannelView(now, await this.ownerNames([now]));
      throw new NotFoundException(`Payment channel ${id} not found.`);
    }

    const after = await this.channels.findById(id);
    if (after) {
      await this.safeAudit({
        userId: actorId,
        action: 'UPDATE',
        entityType: 'PaymentChannel',
        entityId: id,
        afterValue: paymentChannelAuditSnapshot({
          channelId: after.id,
          ownerType: after.ownerType,
          customerId: after.customerId,
          insurerId: after.insurerId,
          channelType: after.channelType,
          label: after.label,
          bankName: after.bankName,
          status: after.status,
        }),
      });
      return derivePaymentChannelView(after, await this.ownerNames([after]));
    }
    throw new NotFoundException(`Payment channel ${id} not found.`);
  }

  async list(
    query: ListPaymentChannelsQueryDto,
  ): Promise<PaymentChannelView[]> {
    const rows = await this.channels.findMany({
      ownerType: query.ownerType,
      customerId: query.customerId,
      insurerId: query.insurerId,
      status: query.status,
    });
    const names = await this.ownerNames(rows);
    return rows.map((r) => derivePaymentChannelView(r, names));
  }

  /**
   * ONE place the six projection sites get their names, so the either-or is spelled once. A channel
   * carries exactly one of the two ids (the service refuses anything else on create), so the two
   * resolvers' answers can share one Map keyed on whichever is set.
   *
   * BATCHED and run in PARALLEL: the two reads are independent, and a list of channels is as long
   * as the office's bank arrangements.
   */
  private async ownerNames(
    rows: readonly { customerId: string | null; insurerId: string | null }[],
  ): Promise<Map<string, string>> {
    const [byCustomer, byInsurer] = await Promise.all([
      this.customers.namesForCustomerIds(rows.map((r) => r.customerId)),
      this.insurers.namesForInsurerIds(rows.map((r) => r.insurerId)),
    ]);
    return new Map([...byCustomer, ...byInsurer]);
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Payment-channel audit (${input.action} ${input.entityType} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
