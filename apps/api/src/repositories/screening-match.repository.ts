import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { ScreeningMatch } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const SCREENING_MATCH_INCLUDE = {
  watchlistEntry: {
    select: {
      id: true,
      source: true,
      sourceRecordId: true,
      fullName: true,
      listProgram: true,
      remarks: true,
    },
  },
  kycRecord: {
    select: {
      id: true,
      customerId: true,
      status: true,
      isEdd: true,
      customer: { select: { id: true, legalName: true, status: true } },
    },
  },
} as const;

export type ScreeningMatchWithContext = Prisma.ScreeningMatchGetPayload<{
  include: typeof SCREENING_MATCH_INCLUDE;
}>;

/** A book-wide queue read is a console view, not a report — capped like every
 * other unbounded read here. */
export const SCREENING_MATCH_PAGE_SIZE = 200;

/**
 * Process 49 — owns `ScreeningMatch`, the human review queue fuzzy matching
 * feeds. Wraps `PrismaService` (services depend on repositories in this
 * codebase, never on Prisma directly).
 */
@Injectable()
export class ScreeningMatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a candidate, or do nothing if this (KYC file, list entry, CANONICAL
   * subject name) is already queued. Canonical, not raw: re-casing or
   * re-spacing a customer's legal name must not mint a second queue item that
   * a prior `cleared` decision no longer suppresses.
   *
   * The `@@unique` is the invariant, not a preceding `findFirst` — the
   * 4-hourly recurring batch re-screens every active customer, so this is
   * called repeatedly with the same triple by design and a check-then-act
   * would race with itself (`race-safe-invariants.md`). `P2002` is the
   * expected, uninteresting outcome and is swallowed deliberately.
   *
   * A previously REVIEWED match is left exactly as the reviewer left it: a
   * re-screen must never quietly reopen a decision a person already made,
   * nor overwrite their reason. `update: {}` expresses that.
   */
  async recordCandidate(input: {
    kycRecordId: string;
    watchlistEntryId: string;
    subjectName: string;
    subjectCanonical: string;
    matchType: string;
    entrySource: string;
    entrySourceRecordId: string | null;
    entryFullName: string;
    entryListProgram: string | null;
    /** Part B §13 — the matcher that raised this candidate and the review
     * threshold it was measured against. Written on CREATE only: a re-screen
     * under a newer matcher must not rewrite the provenance of a match a
     * reviewer is already working, or has already decided. */
    algorithmVersion?: string;
    reviewThreshold?: number;
  }): Promise<{ id: string; created: boolean }> {
    const before = await this.prisma.client.screeningMatch.findUnique({
      where: {
        kycRecordId_watchlistEntryId_subjectCanonical: {
          kycRecordId: input.kycRecordId,
          watchlistEntryId: input.watchlistEntryId,
          subjectCanonical: input.subjectCanonical,
        },
      },
      select: { id: true },
    });

    const row = await this.prisma.client.screeningMatch.upsert({
      where: {
        kycRecordId_watchlistEntryId_subjectCanonical: {
          kycRecordId: input.kycRecordId,
          watchlistEntryId: input.watchlistEntryId,
          subjectCanonical: input.subjectCanonical,
        },
      },
      create: {
        kycRecordId: input.kycRecordId,
        watchlistEntryId: input.watchlistEntryId,
        subjectName: input.subjectName,
        subjectCanonical: input.subjectCanonical,
        matchType: input.matchType,
        entrySource: input.entrySource,
        entrySourceRecordId: input.entrySourceRecordId,
        entryFullName: input.entryFullName,
        entryListProgram: input.entryListProgram,
        algorithmVersion: input.algorithmVersion,
        reviewThreshold: input.reviewThreshold,
      },
      update: {},
      select: { id: true },
    });

    // `created` drives the SLA timer, so it must not fire for a re-screen of
    // a match that is already queued — the 4-hourly batch would otherwise
    // start a fresh deadline every four hours for the same pending item. A
    // concurrent duplicate resolves to `created: false` here, which is the
    // safe direction: a missing timer is visible in the queue, a storm of
    // them is not.
    return { id: row.id, created: before === null };
  }

  findMany(filter: {
    status?: string;
    kycRecordId?: string;
  }): Promise<ScreeningMatchWithContext[]> {
    return this.prisma.client.screeningMatch.findMany({
      where: { status: filter.status, kycRecordId: filter.kycRecordId },
      include: SCREENING_MATCH_INCLUDE,
      // Oldest first: a sanctions match that has sat unreviewed longest is
      // the most urgent, and this is a work queue, not a newsfeed.
      orderBy: { detectedAt: 'asc' },
      take: SCREENING_MATCH_PAGE_SIZE,
    });
  }

  findById(id: string): Promise<ScreeningMatchWithContext | null> {
    return this.prisma.client.screeningMatch.findUnique({
      where: { id },
      include: SCREENING_MATCH_INCLUDE,
    });
  }

  countPending(): Promise<number> {
    return this.prisma.client.screeningMatch.count({
      where: { status: 'pending' },
    });
  }

  /**
   * Record a review decision, conditional on the item still being `pending`.
   *
   * A status-conditional `updateMany` rather than a read-then-write: two
   * compliance officers opening the same queue item is an entirely ordinary
   * thing to happen, and the loser must get a clean 0-row conflict instead of
   * silently overwriting the winner's decision and reason
   * (`race-safe-invariants.md`).
   */
  async recordDecision(input: {
    id: string;
    status: 'cleared' | 'confirmed';
    reviewedByUserId: string;
    reviewReason: string;
    reviewedAt: Date;
  }): Promise<ScreeningMatch | null> {
    const { count } = await this.prisma.client.screeningMatch.updateMany({
      where: { id: input.id, status: 'pending' },
      data: {
        status: input.status,
        reviewedByUserId: input.reviewedByUserId,
        reviewReason: input.reviewReason,
        reviewedAt: input.reviewedAt,
      },
    });
    if (count === 0) return null;
    return this.prisma.client.screeningMatch.findUniqueOrThrow({
      where: { id: input.id },
    });
  }
}
