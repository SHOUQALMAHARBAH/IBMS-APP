import { Injectable } from '@nestjs/common';
import type { CrossSellOpportunity, CrossSellStatus } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
// The gap scan wants the NARROW reading of "in force" — see the constant's own
// comment. It lives with the policy repository now that a second caller needed a
// different one; both meanings are named there, side by side.
import { IN_FORCE_POLICY_STATUSES } from './policy.repository';

export interface CreateCrossSellGapInput {
  customerId: string;
  gapLine: string;
  detectedByUserId: string;
}

/**
 * Process 8 — Cross-Selling (backlog Part C #8). Owns `CrossSellOpportunity`
 * plus the read-only `Policy` lookups the gap scan needs (there is no Policy
 * module / repository yet — Domain B is not built). `status` is never
 * written here — it moves only through WorkflowTransitionService (A.6); see
 * cross-sell.service.ts.
 */
@Injectable()
export class CrossSellOpportunityRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<CrossSellOpportunity | null> {
    return this.prisma.client.crossSellOpportunity.findUnique({
      where: { id },
    });
  }

  findManyByCustomerId(
    customerId: string,
    status?: CrossSellStatus,
  ): Promise<CrossSellOpportunity[]> {
    return this.prisma.client.crossSellOpportunity.findMany({
      where: { customerId, status },
      orderBy: { detectedAt: 'desc' },
    });
  }

  /** The `gapLine` values that already have a `CrossSellOpportunity` row for
   * this customer, in ANY status — so the detection scan can tell a
   * genuinely new gap from one that was already flagged, converted, or
   * dismissed. The `@@unique([customerId, gapLine])` is what actually
   * enforces "one per (customer, line)"; this read only keeps the scan quiet
   * and its audit rows honest (ibms-brain/meta/lex/race-safe-invariants.md). */
  async findExistingGapLines(
    customerId: string,
    gapLines: readonly string[],
  ): Promise<string[]> {
    const rows = await this.prisma.client.crossSellOpportunity.findMany({
      where: { customerId, gapLine: { in: [...gapLines] } },
      select: { gapLine: true },
    });
    return rows.map((r) => r.gapLine);
  }

  /** Inserts one OPEN opportunity for a (customer, line). Throws Prisma
   * `P2002` when the row already exists — the caller treats that as "another
   * scan flagged this gap first, skip". The `@@unique([customerId, gapLine])`
   * index is the race-safe enforcement
   * (ibms-brain/meta/lex/race-safe-invariants.md); this is the write that
   * hits it. Per-row rather than `createMany` so the caller can attribute a
   * CREATE audit row to exactly the opportunities it actually inserted. */
  createGap(input: CreateCrossSellGapInput): Promise<CrossSellOpportunity> {
    return this.prisma.client.crossSellOpportunity.create({ data: input });
  }

  /** The distinct `insuranceLine` values of a customer's in-force policies —
   * the "held lines" side of the gap comparison. */
  async findInForcePolicyLinesByCustomerId(
    customerId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.client.policy.findMany({
      where: { customerId, status: { in: [...IN_FORCE_POLICY_STATUSES] } },
      select: { insuranceLine: true },
      distinct: ['insuranceLine'],
    });
    return rows.map((r) => r.insuranceLine);
  }

  /** Every customer with at least one in-force policy — the set the nightly
   * sweep scans (a customer with no cover is a new-business prospect, not a
   * cross-sell target). */
  async findCustomerIdsWithInForcePolicy(): Promise<string[]> {
    const rows = await this.prisma.client.policy.findMany({
      where: { status: { in: [...IN_FORCE_POLICY_STATUSES] } },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    return rows.map((r) => r.customerId);
  }
}
