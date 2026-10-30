import { Injectable } from '@nestjs/common';
import type { Prisma, RegulatoryAction } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * THE OFFICE'S OWN RECORD OF A REGULATOR'S DECISION — and this table's FIRST writer.
 *
 * ## THERE IS NO REGULATOR IN THIS SYSTEM
 *
 * Three organization types exist — brokerage office, insurance company, provider. The CBJ acts ON
 * the office outside this product, on paper or electronically. So every row here is the OFFICE'S
 * OWN RECORD of a letter it received: there is no regulator account, no regulator screen, and
 * nothing in this module may assume one.
 *
 * ## MEASURED: NOTHING WROTE THIS TABLE UNTIL NOW
 *
 * `RegulatoryAction` appeared in exactly ONE non-spec file — `license-standing.config.ts`, which
 * READS it — so `deriveLicenseStanding`'s suspension and cancellation branches consumed rows that
 * no code path could create. The only live way to say "the regulator stopped this office" was
 * `BrokerLicense.status = 'lapsed'`, a bare two-value flag with no basis, no date, no decision
 * reference and no document.
 *
 * That is why this repository exists before the column is dropped, and in that order:
 * `docs/deferred-register.md` entry 12 records it as **"record acts for whatever the marker was
 * standing in for, THEN drop the column — never the reverse, which would lose the fact before it
 * was recorded anywhere."** Measured first, so the precondition is known rather than assumed: dev
 * holds 3 licence terms, ALL `active`; db-test holds 4 active and 3 lapsed, every one an e2e
 * artefact. Nothing real is standing in for the marker, so there is nothing to convert — only a
 * capability to replace.
 */
@Injectable()
export class RegulatoryActionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every act recorded against this office, newest first.
   *
   * NO FILTERING HERE, deliberately. `deriveLicenseStanding` takes the whole set and folds it
   * itself, and its own header says why: *"the filtering happens here rather than in the query so
   * the caller cannot narrow it wrongly."* A `where` that dropped an expired suspension would make
   * the derivation's art. 14/c branch unreachable without anything failing.
   */
  findAll(): Promise<RegulatoryAction[]> {
    return this.prisma.client.regulatoryAction.findMany({
      /*
       * A TOTAL ORDER, even though the consumer re-sorts.
       *
       * `effectiveFrom` is `@db.Date`, so it alone leaves two acts bearing one day in whatever
       * order the plan returns — which is how a suspension and its same-day reinstatement folded
       * either way and left the office's standing decided by the query plan. The fold is total now;
       * so is this, because a partial `orderBy` feeding a fold is the trap one layer down, and the
       * next consumer may not re-sort.
       */
      orderBy: [
        { effectiveFrom: 'desc' },
        { recordedAt: 'desc' },
        { id: 'desc' },
      ],
    });
  }

  create(
    data: Prisma.RegulatoryActionUncheckedCreateInput,
  ): Promise<RegulatoryAction> {
    return this.prisma.client.regulatoryAction.create({ data });
  }
}
