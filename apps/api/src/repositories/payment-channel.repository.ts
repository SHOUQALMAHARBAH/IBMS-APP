import { Injectable } from '@nestjs/common';
import type { PaymentChannel, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Process 38 — Payment Processing (backlog Part C #38, Domain D). Owns the
 * `PaymentChannel` governed reference list (approved payment channels per
 * customer / insurer), wrapping `PrismaService` (services depend on
 * repositories in this codebase, never on Prisma directly).
 *
 * The `PaymentChannel_owner_exactly_one` CHECK (migration `20260903140000`) is
 * the structural backstop for "exactly one of (customerId, insurerId) is set
 * and matches `ownerType`"; the service validates it up front for a friendly
 * 4xx.
 */
@Injectable()
export class PaymentChannelRepository {
  constructor(private readonly prisma: PrismaService) {}

  customerExists(customerId: string): Promise<boolean> {
    return this.prisma.client.customer
      .count({ where: { id: customerId } })
      .then((n) => n > 0);
  }

  insurerExists(insurerId: string): Promise<boolean> {
    return this.prisma.client.insurer
      .count({ where: { id: insurerId } })
      .then((n) => n > 0);
  }

  create(input: {
    ownerType: string;
    customerId: string | null;
    insurerId: string | null;
    channelType: string;
    label: string;
    bankName: string | null;
    accountLast4: string | null;
    currency: string;
  }): Promise<PaymentChannel> {
    return this.prisma.client.paymentChannel.create({
      data: {
        ownerType: input.ownerType,
        customerId: input.customerId,
        insurerId: input.insurerId,
        channelType: input.channelType,
        label: input.label,
        bankName: input.bankName,
        accountLast4: input.accountLast4,
        currency: input.currency,
        status: 'active',
      },
    });
  }

  findById(id: string): Promise<PaymentChannel | null> {
    return this.prisma.client.paymentChannel.findUnique({ where: { id } });
  }

  /** Book-wide list, optionally narrowed. Newest first. */
  findMany(scope: {
    ownerType?: string;
    customerId?: string;
    insurerId?: string;
    status?: string;
  }): Promise<PaymentChannel[]> {
    return this.prisma.client.paymentChannel.findMany({
      where: {
        ...(scope.ownerType ? { ownerType: scope.ownerType } : {}),
        ...(scope.customerId ? { customerId: scope.customerId } : {}),
        ...(scope.insurerId ? { insurerId: scope.insurerId } : {}),
        ...(scope.status ? { status: scope.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Disable an active channel. Status-conditional `updateMany` — a 0-row
   * result means it was already disabled (or gone). */
  disable(id: string): Promise<Prisma.BatchPayload> {
    return this.prisma.client.paymentChannel.updateMany({
      where: { id, status: 'active' },
      data: { status: 'disabled', disabledAt: new Date() },
    });
  }
}
