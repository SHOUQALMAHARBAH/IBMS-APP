import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { CategoryResolution } from '../modules/pdpl/retention-resolution.config';

export interface ElapsedCounts {
  /** Past their period, not held, not extended — the number the notice reports. */
  elapsed: number;
  /** Excluded by an active legal hold. Reported, never silently subtracted. */
  held: number;
  /** Excluded because an extension still covers them. */
  extended: number;
}

/**
 * THE RETENTION CLOCK — how many records of a category have passed the period the office set.
 *
 * ## FOUR EXPLICIT BRANCHES, NOT A DYNAMIC MODEL LOOKUP
 *
 * `this.prisma.client[resolution.modelProperty]` would be shorter and would type as `any`, which is
 * the one thing that must not happen here: the trigger COLUMN differs per model (`receivedAt`,
 * `remittedAt`, `paidAt`, `clientPaymentConfirmedAt`), so a dynamic access would let a wrong column
 * name through the compiler and produce a count from a date that means something else. A wrong count
 * on a destruction notice is worse than no notice.
 *
 * So each of the four is written out, and `retention-resolution.config.spec.ts` pins the set — a
 * fifth category cannot be declared without this file failing to compile against it.
 *
 * ## THE HOLD AND THE EXTENSION ARE COUNTED, NOT FILTERED AWAY
 *
 * Both exclusions are returned as their own numbers. Records disappearing from a count with no
 * explanation is how an officer concludes the system has lost them — and a held record is precisely
 * the one somebody will come looking for.
 */
@Injectable()
export class RetentionNoticeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Counts for one category.
   *
   * `cutoff` is computed by the caller from the period, so the boundary is provable in a unit test
   * without a clock — the same reason `isBrokerLicenseCurrentlyLapsed` takes `now`.
   */
  async countFor(
    resolution: CategoryResolution,
    cutoff: Date,
    heldRecordIds: readonly string[],
    extendedRecordIds: readonly string[],
  ): Promise<ElapsedCounts> {
    const ids = await this.idsElapsedBefore(resolution, cutoff);
    const held = new Set(heldRecordIds);
    const extended = new Set(extendedRecordIds);

    let elapsed = 0;
    let heldCount = 0;
    let extendedCount = 0;
    for (const id of ids) {
      if (held.has(id)) heldCount += 1;
      else if (extended.has(id)) extendedCount += 1;
      else elapsed += 1;
    }
    return { elapsed, held: heldCount, extended: extendedCount };
  }

  /** The ids of records whose trigger date is at or before the cutoff. */
  async idsElapsedBefore(
    resolution: CategoryResolution,
    cutoff: Date,
  ): Promise<string[]> {
    const select = { id: true } as const;
    switch (resolution.modelProperty) {
      case 'receipt': {
        const rows = await this.prisma.client.receipt.findMany({
          where: { receivedAt: { lte: cutoff } },
          select,
        });
        return rows.map((r) => r.id);
      }
      case 'remittance': {
        const rows = await this.prisma.client.remittance.findMany({
          // `remittedAt` is NULLABLE — an unremitted premium has not closed its transaction, so
          // `not: null` is part of the trigger rather than a tidy-up. Without it every unremitted
          // row would read as elapsed the moment `lte` saw a null.
          where: { remittedAt: { lte: cutoff, not: null } },
          select,
        });
        return rows.map((r) => r.id);
      }
      case 'commissionLedgerEntry': {
        const rows = await this.prisma.client.commissionLedgerEntry.findMany({
          // Same: `paidAt` is nullable and an unpaid commission has not closed.
          where: { paidAt: { lte: cutoff, not: null } },
          select,
        });
        return rows.map((r) => r.id);
      }
      case 'settlement': {
        const rows = await this.prisma.client.settlement.findMany({
          where: { clientPaymentConfirmedAt: { lte: cutoff, not: null } },
          select,
        });
        return rows.map((r) => r.id);
      }
      case 'quotation': {
        /*
         * A QUOTE REQUESTED AND NEVER BOUGHT. The only resolution here whose trigger is not a
         * column on its own model — it is two hops away, and the filter is a RELATION filter for
         * that reason rather than a dotted column name Prisma could not take.
         *
         * `decision: 'REJECT'` is the END OF THE PURPOSE, which is the owner's instruction and the
         * whole design: a month counted from arrival would delete a quote the customer is still
         * considering. Three cases fall out of this one `where` and all three are intended —
         *
         *   * the client REFUSED: the clock ran from `decidedAt`, and `lte` is the elapsed test;
         *   * the client ACCEPTED: `decision` is not REJECT, so the relation filter excludes it;
         *   * the client has not answered: there is NO `clientDecision` row, so `is` excludes it.
         *
         * The last two need no null handling of their own precisely because the filter is a
         * relation `is` — an absent related row does not match, where a null COLUMN would have been
         * swept in by `lte`. That is the `remittedAt` trap avoided by shape rather than by a flag.
         */
        const rows = await this.prisma.client.quotation.findMany({
          where: {
            rfq: {
              opportunity: {
                clientDecision: {
                  is: { decision: 'REJECT', decidedAt: { lte: cutoff } },
                },
              },
            },
          },
          select,
        });
        return rows.map((r) => r.id);
      }
    }
  }

  /** Extensions still covering a record as at `now`, by record id. */
  async extendedRecordIds(
    recordCategory: string,
    now: Date,
  ): Promise<string[]> {
    const rows = await this.prisma.client.retentionExtension.findMany({
      where: { recordCategory, extendedUntil: { gt: now } },
      select: { recordId: true },
    });
    return rows.map((r) => r.recordId);
  }

  createExtension(
    data: Prisma.RetentionExtensionUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return this.prisma.client.retentionExtension.create({
      data,
      select: { id: true },
    });
  }

  /** The register, newest first — "every extension can be justified from one place". */
  listExtensions(recordCategory?: string) {
    return this.prisma.client.retentionExtension.findMany({
      where: recordCategory ? { recordCategory } : {},
      orderBy: { extendedAt: 'desc' },
      include: {
        legalHold: { select: { id: true, scope: true, reason: true } },
        // WHO extended it, by NAME. The sibling retrieval register already resolves its actor this
        // way (`retention-archive.service.ts`), and without it the only thing the register could
        // say about the actor is a uuid — which rule 2 refuses to render and which identifies
        // nobody to the person reading the register.
        extendedBy: { select: { fullName: true } },
      },
    });
  }

  /**
   * THE HUMAN-READABLE HANDLE FOR A SET OF RECORDS IN ONE CATEGORY — owner decision 44.
   *
   * ONE QUERY PER CATEGORY, never one per record: the extension register is one row per extended
   * record, so resolving each handle on its own would be N queries to render a table whose whole
   * purpose is to be read in one go.
   *
   * THE SWITCH IS EXHAUSTIVE OVER `modelProperty` AND MUST STAY SO. A sixth category added to
   * `CATEGORY_RESOLUTIONS` is a compile error here until somebody decides whether its records can be
   * named — which is the decision, not an implementation detail. `recordHandle.kind === 'NONE'`
   * short-circuits before any query, so the two categories that carry no reference cost nothing.
   *
   * IT RETURNS A MAP AND NOT AN ARRAY, and a MISSING key is not the same as a null value: a record
   * whose row has been destroyed since the extension was written is absent from the map, while a
   * record that exists and carries no reference maps to `null`. The register renders those
   * differently, because "this record is gone" and "nobody wrote its reference down" are different
   * answers to a regulator.
   */
  async recordHandles(
    resolution: CategoryResolution,
    recordIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (resolution.recordHandle.kind === 'NONE' || recordIds.length === 0) {
      return out;
    }
    const ids = [...new Set(recordIds)];

    switch (resolution.modelProperty) {
      case 'receipt': {
        const rows = await this.prisma.client.receipt.findMany({
          where: { id: { in: ids } },
          select: { id: true, reference: true },
        });
        for (const r of rows) out.set(r.id, r.reference ?? null);
        return out;
      }
      case 'remittance': {
        const rows = await this.prisma.client.remittance.findMany({
          where: { id: { in: ids } },
          select: { id: true, receipt: { select: { reference: true } } },
        });
        for (const r of rows) out.set(r.id, r.receipt.reference ?? null);
        return out;
      }
      case 'commissionLedgerEntry': {
        const rows = await this.prisma.client.commissionLedgerEntry.findMany({
          where: { id: { in: ids } },
          select: { id: true, paymentReference: true },
        });
        for (const r of rows) out.set(r.id, r.paymentReference ?? null);
        return out;
      }
      /*
       * Unreachable while both of these declare `NONE` — the guard above returns first — and
       * present so the switch is exhaustive over the union rather than relying on a `default`. A
       * `default` here would silently return an empty map the day one of them gained a handle,
       * which is the same class as a label map that quietly renders nothing.
       */
      case 'settlement':
      case 'quotation':
        return out;
    }
  }
}
