import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { SlaHoliday, SlaPolicy, SlaPolicyStatus } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const SLA_POLICY_INCLUDE = {
  escalations: { orderBy: { stageOrder: 'asc' } },
} as const;

export type SlaPolicyWithEscalations = Prisma.SlaPolicyGetPayload<{
  include: typeof SLA_POLICY_INCLUDE;
}>;

/** A console listing, capped like every other unbounded read here. */
export const SLA_POLICY_PAGE_SIZE = 200;

/**
 * Owns `SlaPolicy`, `SlaPolicyEscalation` and `SlaHoliday` — the configurable
 * replacement for the hard-coded `SLA_REGISTRY` const as the RUNTIME source of
 * SLA durations.
 */
@Injectable()
export class SlaPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The ONE policy in force for a process (optionally a specific workflow
   * state) at `at`.
   *
   * A state-specific policy wins over a whole-process one, which is what makes
   * "different SLA per workflow state where necessary" work without a second
   * table. Effective dating is applied here rather than by the caller so no
   * caller can forget it.
   *
   * "At most one ACTIVE per (process, state)" is held by two partial UNIQUEs
   * (migration 20260921100000), so this ordering picks a winner between the
   * state-specific and whole-process rows — never between two rivals for the
   * same slot.
   */
  async findActiveFor(
    processType: string,
    workflowState: string | null,
    at: Date = new Date(),
  ): Promise<SlaPolicyWithEscalations | null> {
    const candidates = await this.prisma.client.slaPolicy.findMany({
      where: {
        processType,
        status: 'ACTIVE',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        // Prisma types `in` as non-nullable, so "this state OR the
        // whole-process fallback" is an explicit OR rather than `in: [x, null]`.
        ...(workflowState
          ? {
              AND: [
                {
                  OR: [{ workflowState }, { workflowState: null }],
                },
              ],
            }
          : { workflowState: null }),
      },
      include: SLA_POLICY_INCLUDE,
    });
    if (candidates.length === 0) return null;
    // Most specific first.
    return (
      candidates.find((p) => p.workflowState === workflowState) ??
      candidates.find((p) => p.workflowState === null) ??
      null
    );
  }

  findById(id: string): Promise<SlaPolicyWithEscalations | null> {
    return this.prisma.client.slaPolicy.findUnique({
      where: { id },
      include: SLA_POLICY_INCLUDE,
    });
  }

  findByCode(policyCode: string): Promise<SlaPolicyWithEscalations | null> {
    return this.prisma.client.slaPolicy.findUnique({
      where: { policyCode },
      include: SLA_POLICY_INCLUDE,
    });
  }

  findMany(filter: {
    processType?: string;
    status?: SlaPolicyStatus;
  }): Promise<SlaPolicyWithEscalations[]> {
    return this.prisma.client.slaPolicy.findMany({
      where: { processType: filter.processType, status: filter.status },
      include: SLA_POLICY_INCLUDE,
      orderBy: [{ processType: 'asc' }, { policyCode: 'asc' }],
      take: SLA_POLICY_PAGE_SIZE,
    });
  }

  create(
    data: Prisma.SlaPolicyUncheckedCreateInput,
    escalations: readonly {
      stageOrder: number;
      offsetValue: number;
      offsetUnit: Prisma.SlaPolicyEscalationUncheckedCreateInput['offsetUnit'];
      escalateTo: string | null;
    }[],
  ): Promise<SlaPolicyWithEscalations> {
    return this.prisma.client.slaPolicy.create({
      data: {
        ...data,
        escalations: { create: escalations.map((e) => ({ ...e })) },
      },
      include: SLA_POLICY_INCLUDE,
    });
  }

  update(
    id: string,
    data: Prisma.SlaPolicyUncheckedUpdateInput,
  ): Promise<SlaPolicyWithEscalations> {
    return this.prisma.client.slaPolicy.update({
      where: { id },
      data,
      include: SLA_POLICY_INCLUDE,
    });
  }

  /**
   * Activation, as a status-conditional write inside a transaction that first
   * retires whatever else is ACTIVE for the same slot.
   *
   * Without the retire step the partial UNIQUE would simply reject the
   * activation, which is correct but useless: "activate this policy" plainly
   * means "and stand the previous one down". Doing both in one transaction is
   * what stops a window where a process has NO active SLA at all.
   */
  activate(
    id: string,
    processType: string,
    workflowState: string | null,
    actorUserId: string,
  ): Promise<SlaPolicyWithEscalations | null> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.slaPolicy.updateMany({
        where: {
          processType,
          workflowState,
          status: 'ACTIVE',
          id: { not: id },
        },
        data: { status: 'INACTIVE', updatedByUserId: actorUserId },
      });
      // Conditional on the row still being the one we read — a concurrent
      // activation of the same policy is a no-op rather than a double write.
      const { count } = await tx.slaPolicy.updateMany({
        where: { id, status: { not: 'ACTIVE' } },
        data: { status: 'ACTIVE', updatedByUserId: actorUserId },
      });
      if (count === 0) return null;
      return tx.slaPolicy.findUnique({
        where: { id },
        include: SLA_POLICY_INCLUDE,
      });
    });
  }

  deactivate(id: string, actorUserId: string): Promise<{ count: number }> {
    return this.prisma.client.slaPolicy.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'INACTIVE', updatedByUserId: actorUserId },
    });
  }

  countByProcess(processType: string): Promise<number> {
    return this.prisma.client.slaPolicy.count({ where: { processType } });
  }

  // --- holidays ------------------------------------------------------------

  findHolidays(): Promise<SlaHoliday[]> {
    return this.prisma.client.slaHoliday.findMany({
      orderBy: { observedOn: 'asc' },
    });
  }

  createHoliday(data: {
    observedOn: Date;
    name: string;
    calendarType?: SlaPolicy['calendarType'] | null;
    createdByUserId: string;
  }): Promise<SlaHoliday> {
    return this.prisma.client.slaHoliday.create({
      data: {
        observedOn: data.observedOn,
        name: data.name,
        calendarType: data.calendarType ?? null,
        createdByUserId: data.createdByUserId,
      },
    });
  }

  deleteHoliday(id: string): Promise<{ count: number }> {
    return this.prisma.client.slaHoliday.deleteMany({ where: { id } });
  }
}
