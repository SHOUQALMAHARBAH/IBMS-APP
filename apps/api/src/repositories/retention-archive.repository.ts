import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import type { BlockedExclusion } from '../modules/pdpl/retention-archive.config';
import type { CategoryResolution } from '../modules/pdpl/retention-resolution.config';
import {
  CATEGORY_RESOLUTIONS,
  resolutionFor,
} from '../modules/pdpl/retention-resolution.config';
import { elapsedBefore } from '../modules/pdpl/retention-notice.config';

/**
 * IS THIS RECORD IN THE BLOCKED PHASE — the one home for the question, and the register of
 * retrievals from it.
 *
 * ## WHY THIS SITS IN A REPOSITORY RATHER THAN A SERVICE, WHICH IS THE RARE SHAPE HERE
 *
 * MEASURED: 102 of this project's 105 repositories take only `PrismaService`, and exactly one
 * (`policy-checking.repository.ts`) injects another repository. So a repository consumed by three
 * other repositories is the unusual arrangement and needs its reason stated.
 *
 * The alternative was to compute the exclusion in each consumer's SERVICE and pass it down, which
 * is what `RetentionNoticeRepository.countFor(resolution, cutoff, …)` does and would normally be
 * right. It was measured and rejected: the three unbounded reads have **five** service call sites
 * between them —
 *   - `loadCommissionRollupEntries` from `financial-report.service.ts` AND
 *     `financial-dashboard.service.ts`;
 *   - `loadInsurerRemittances` from `insurer-accounting.service.ts` AND the same dashboard;
 *   - `findReceiptsForSweep` from `transaction-monitoring.service.ts`.
 * A condition distributed across five call sites is a condition that fails OPEN at whichever one
 * somebody forgets, silently, which is precisely how a blocked record would keep being processed
 * while every test passed. Inside the repository there is one place and no one to forget.
 *
 * ## `now` DEFAULTS, AND THE DEFAULT IS THE SAFE DIRECTION
 *
 * Repositories here avoid clocks on purpose — `countFor` takes its cutoff so the boundary is
 * provable in a unit test without one. Here the parameter defaults to `new Date()`, so a caller who
 * passes nothing still gets the exclusion applied and a test can still pin the boundary. The
 * failure direction of forgetting is correctness, not a silent gap.
 */
@Injectable()
export class RetentionArchiveRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What a read needs in order to leave this category's blocked records out, or `null` when nothing
   * in it can be blocked.
   *
   * THREE WAYS TO `null`, and each is a real state rather than a guard:
   *   - the category has no resolution, so there is no clock at all (register entry 88 — the
   *     customer file is here, because no date records a relationship ending);
   *   - the office set no retention period for it, so nothing has elapsed;
   *   - an ACTIVE LEGAL HOLD covers the category. `LegalHold` attaches to the schedule ITEM, not to
   *     a record, so a hold suspends the whole category's blocked phase. Treating a held category as
   *     blocked would stop processing records a court has specifically required be kept.
   */
  async blockedExclusionFor(
    recordCategory: string,
    now: Date = new Date(),
  ): Promise<BlockedExclusion | null> {
    const resolution = resolutionFor(recordCategory);
    if (resolution === null) return null;

    const item = await this.prisma.client.retentionScheduleItem.findFirst({
      where: { recordCategory },
      select: { id: true, retentionPeriodMonths: true },
    });
    if (item === null) return null;

    const held = await this.prisma.client.legalHold.count({
      where: { retentionScheduleItemId: item.id, releasedAt: null },
    });
    if (held > 0) return null;

    const extensions = await this.prisma.client.retentionExtension.findMany({
      where: { recordCategory, extendedUntil: { gt: now } },
      select: { recordId: true },
    });

    return {
      cutoff: elapsedBefore(now, item.retentionPeriodMonths),
      extendedRecordIds: extensions.map((e) => e.recordId),
    };
  }

  /**
   * The exclusion for whichever category resolves to this Prisma model, or `null`.
   *
   * The reverse lookup is IN MEMORY rather than a query: `CATEGORY_RESOLUTIONS` maps one category to
   * one model, and `retention-resolution.config.spec.ts` pins that set, so scanning the schedule
   * table for a match would be a second answer to a question the declared table already settles.
   */
  async blockedExclusionForModel(
    modelProperty: CategoryResolution['modelProperty'],
    now: Date = new Date(),
  ): Promise<BlockedExclusion | null> {
    const resolution = CATEGORY_RESOLUTIONS.find(
      (r) => r.modelProperty === modelProperty,
    );
    if (resolution === undefined) return null;
    return this.blockedExclusionFor(resolution.recordCategory, now);
  }

  /**
   * Which of these ids are actually in the blocked phase.
   *
   * Four explicit branches again, for the sibling's stated reason: the trigger column differs per
   * model, and a dynamic client access types as `any` — so a wrong column name would answer from a
   * date that means something else, here deciding whether a judicial-basis row gets written.
   */
  async blockedIdsIn(
    recordCategory: string,
    recordIds: string[],
    now: Date = new Date(),
  ): Promise<string[]> {
    const exclusion = await this.blockedExclusionFor(recordCategory, now);
    const resolution = resolutionFor(recordCategory);
    if (exclusion === null || resolution === null || recordIds.length === 0) {
      return [];
    }
    const notExtended =
      exclusion.extendedRecordIds.length === 0
        ? {}
        : { id: { notIn: exclusion.extendedRecordIds } };
    const select = { id: true } as const;

    switch (resolution.modelProperty) {
      case 'receipt': {
        const rows = await this.prisma.client.receipt.findMany({
          where: {
            id: { in: recordIds },
            receivedAt: { lte: exclusion.cutoff },
            ...notExtended,
          },
          select,
        });
        return rows.map((r) => r.id);
      }
      case 'remittance': {
        const rows = await this.prisma.client.remittance.findMany({
          where: {
            id: { in: recordIds },
            remittedAt: { lte: exclusion.cutoff },
            ...notExtended,
          },
          select,
        });
        return rows.map((r) => r.id);
      }
      case 'commissionLedgerEntry': {
        const rows = await this.prisma.client.commissionLedgerEntry.findMany({
          where: {
            id: { in: recordIds },
            paidAt: { lte: exclusion.cutoff },
            ...notExtended,
          },
          select,
        });
        return rows.map((r) => r.id);
      }
      case 'settlement': {
        const rows = await this.prisma.client.settlement.findMany({
          where: {
            id: { in: recordIds },
            clientPaymentConfirmedAt: { lte: exclusion.cutoff },
            ...notExtended,
          },
          select,
        });
        return rows.map((r) => r.id);
      }
    }
  }

  /**
   * CONDITION 4's INPUT — which of this data subject's records are in the blocked phase.
   *
   * ## THE JOIN EXISTS, AND IT IS ONE HOP THROUGH NOT-NULL KEYS
   *
   * The four blockable models carry no identity at all, so "is any of this customer's data blocked"
   * looked at first like a question they could not answer. MEASURED, it is shorter than feared:
   * `Invoice.customerId`, `Policy.customerId` and `Claim.customerId` are each NOT NULL, so
   * `Receipt → Invoice`, `CommissionLedgerEntry → Policy` and `Settlement → Claim` are one hop, and
   * `Remittance → Receipt → Invoice` is two.
   *
   * ## AN INSURED PERSON REACHES FEWER OF THEM, AND THE LIMIT IS REAL
   *
   * `InsuredPerson` hangs off `Policy`, so the commission and settlement sides reach it. A RECEIPT
   * reaches it only through `Invoice.policyId`, which is NULLABLE — an invoice raised with no policy
   * reaches no insured person at all. That is a stated limit rather than a silent one: the refusal
   * reports the categories it CAN see, and a DSR naming only an insured person may therefore not see
   * a blocked receipt.
   *
   * ## FOUR EXPLICIT BRANCHES, THE SIBLING'S OWN DECISION
   *
   * `idsElapsedBefore` writes its four out rather than indexing the client dynamically, because the
   * trigger column differs per model and a dynamic access types as `any` — so a wrong column name
   * would produce a count from a date that means something else. Same here, for the same reason,
   * and the compiler is what refuses a fifth category until somebody writes its join.
   */
  async blockedCountsForSubject(
    subject: { customerId: string | null; insuredPersonId: string | null },
    now: Date = new Date(),
  ): Promise<{ recordCategory: string; count: number }[]> {
    if (subject.customerId === null && subject.insuredPersonId === null) {
      return [];
    }
    const out: { recordCategory: string; count: number }[] = [];

    for (const resolution of CATEGORY_RESOLUTIONS) {
      const exclusion = await this.blockedExclusionFor(
        resolution.recordCategory,
        now,
      );
      if (exclusion === null) continue;

      // ELAPSED AND NOT EXTENDED, spelled the same way `notBlockedWhere` negates it: `lte` treats a
      // NULL trigger as not-elapsed, which is the correct reading for the three nullable ones.
      const notExtended =
        exclusion.extendedRecordIds.length === 0
          ? {}
          : { id: { notIn: exclusion.extendedRecordIds } };
      const byCustomer = subject.customerId;
      const byInsured = subject.insuredPersonId;

      let count = 0;
      switch (resolution.modelProperty) {
        case 'receipt':
          count = await this.prisma.client.receipt.count({
            where: {
              receivedAt: { lte: exclusion.cutoff },
              ...notExtended,
              invoice: {
                is: {
                  ...(byCustomer === null ? {} : { customerId: byCustomer }),
                  ...(byInsured === null
                    ? {}
                    : {
                        policy: {
                          is: { insuredPersons: { some: { id: byInsured } } },
                        },
                      }),
                },
              },
            },
          });
          break;
        case 'remittance':
          count = await this.prisma.client.remittance.count({
            where: {
              remittedAt: { lte: exclusion.cutoff },
              ...notExtended,
              receipt: {
                is: {
                  invoice: {
                    is: {
                      ...(byCustomer === null
                        ? {}
                        : { customerId: byCustomer }),
                      ...(byInsured === null
                        ? {}
                        : {
                            policy: {
                              is: {
                                insuredPersons: { some: { id: byInsured } },
                              },
                            },
                          }),
                    },
                  },
                },
              },
            },
          });
          break;
        case 'commissionLedgerEntry':
          count = await this.prisma.client.commissionLedgerEntry.count({
            where: {
              paidAt: { lte: exclusion.cutoff },
              ...notExtended,
              policy: {
                is: {
                  ...(byCustomer === null ? {} : { customerId: byCustomer }),
                  ...(byInsured === null
                    ? {}
                    : { insuredPersons: { some: { id: byInsured } } }),
                },
              },
            },
          });
          break;
        case 'settlement':
          count = await this.prisma.client.settlement.count({
            where: {
              clientPaymentConfirmedAt: { lte: exclusion.cutoff },
              ...notExtended,
              claim: {
                is: {
                  ...(byCustomer === null ? {} : { customerId: byCustomer }),
                  ...(byInsured === null
                    ? {}
                    : {
                        policy: {
                          is: { insuredPersons: { some: { id: byInsured } } },
                        },
                      }),
                },
              },
            },
          });
          break;
      }
      if (count > 0) {
        out.push({ recordCategory: resolution.recordCategory, count });
      }
    }
    return out;
  }

  /**
   * THE RETRIEVAL REGISTER — condition 3's recorded basis.
   *
   * INSERT only. The table's own triggers refuse an UPDATE or a DELETE, because a retrieval from a
   * legal block is a fact that occurred: rewriting the basis somebody claimed, or removing the
   * record of having looked, are the two things this register exists to make impossible.
   */
  recordRetrieval(
    data: Prisma.RetentionArchiveRetrievalUncheckedCreateInput,
  ): Promise<{ id: string }> {
    return this.prisma.client.retentionArchiveRetrieval.create({
      data,
      select: { id: true },
    });
  }

  /** The register, newest first. */
  listRetrievals(recordCategory?: string) {
    return this.prisma.client.retentionArchiveRetrieval.findMany({
      where: recordCategory ? { recordCategory } : {},
      orderBy: { retrievedAt: 'desc' },
      include: {
        retrievedBy: { select: { id: true, fullName: true } },
      },
    });
  }
}
