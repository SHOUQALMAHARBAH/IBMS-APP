import { Injectable } from '@nestjs/common';
import { DsrStatus, ScreeningCaseStatus } from '@ibms/db';
import { DsrRepository } from '../../repositories/dsr.repository';
import { ScreeningMatchRepository } from '../../repositories/screening-match.repository';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * AN OVERSIGHT ROLE MAY READ A CUSTOMER'S RFQ CHAIN ONLY WHILE AN OPEN PIECE OF WORK ON THAT
 * CUSTOMER IS ASSIGNED TO THEM. The window closes when the work closes.
 *
 * ## WHY THIS EXISTS, AND WHY IT IS NOT A PERMISSION CODE
 *
 * The decision was that Claims, Compliance and the DPO may read an RFQ and its correspondence. The
 * obvious way — grant them `customer-file.all-owners.read` — was MEASURED and refused: that code is
 * read by 8 services across 46 routes, so it would hand those roles every customer's needs
 * assessment, risk profile, insurance programme, opportunities, quotations, comparison and client
 * decision, across all owners, to deliver one screen.
 *
 * The owner's test for the difference, in her words: *could this person open a customer's file for
 * no reason at all?* With the blanket code, yes. Anchored, no. And her reason for paying for the
 * extra engineering: the work is recoverable and the disclosure is not — a blanket grant made to a
 * one-person office stays a blanket grant when that office has five people, and nobody remembers it
 * was granted when it was harmless.
 *
 * ## IT IS DELIBERATELY LOCAL TO THIS MODULE
 *
 * `assertCustomerVisible` exists in ten services. If this lived in `common/` the next service
 * wanting cross-owner reach would reach for it, and the widening we refused would arrive one import
 * at a time. So it lives beside its ONE consumer, and
 * `customer-file-anchor.inventory.spec.ts` fails if a second module imports it. Widening the set of
 * consumers is a decision, not a convenience.
 *
 * ## WHAT AN ANCHOR OPENS, AND WHAT IT DOES NOT
 *
 * THAT customer's RFQ chain and its communications, READ ONLY. Not another customer. Not a write —
 * `RfqService` applies this on its two read paths and nowhere else, which is why the read path is a
 * separate method rather than a boolean on the shared one. And nothing survives the anchor's
 * closure: the queries below ask about state NOW, so closing the DSR or the screening case shuts
 * the window on the next request.
 *
 * ## THE WEAKNESS, DECLARED — THE LOG IS HALF OF THIS GUARD, NOT AN ENHANCEMENT TO IT
 *
 * An anchored visibility can be abused by opening a sham review or a sham DSR. **This service does
 * not prevent that and cannot.** What it buys over the blanket code is that the read is tied to a
 * NAMED record at a NAMED time: somebody opening five screening cases in a day on customers they
 * have no connection to is visible in the audit trail, and a blanket grant leaves no trace at all.
 * So the audit row `RfqService` writes when an anchor admits a read is part of this control. If it
 * is ever made best-effort, this guard is halved.
 *
 * ## THE CLAIMS ANCHOR IS MISSING AND THAT IS A PRODUCT GAP, NOT AN OVERSIGHT HERE
 *
 * The third anchor was to be *a claim assigned to him*, and this product cannot express it: `Claim`
 * carries no staff user field at all (its `adjuster` relation is an external loss-adjusting FIRM).
 * The near-neighbour — a `ClaimStatusHistory` row in his name — was measured and REFUSED, twice
 * over: it means *acted on once* rather than *assigned to*, and such a row NEVER CLOSES, so the
 * window it opens would never shut, which is the entire property this service exists for. Claim
 * assignment is recorded as a missing CAPABILITY for the claims module — today nobody in this
 * system can say who is handling a claim — not as a column to be added here to satisfy a
 * visibility check. See `docs/deferred-register.md`.
 */

/**
 * CLOSED, listed exhaustively rather than as a negation, so a NEW status added later is OPEN by
 * omission — and `customer-file-anchor.inventory.spec.ts` then fails by name against the generated
 * Prisma enum. A new status must be classified deliberately.
 *
 * Reading these as closed is the owner's: FULFILLED, REJECTED and CLOSED are answers. The other
 * four, PARTIALLY_FULFILLED included, are a request still being handled — the correction flow is
 * what keeps a partially fulfilled request open, so a DSR still being corrected is still live work.
 */
export const CLOSED_DSR_STATUSES: readonly DsrStatus[] = [
  DsrStatus.FULFILLED,
  DsrStatus.REJECTED,
  DsrStatus.CLOSED,
];

export const OPEN_DSR_STATUSES: readonly DsrStatus[] = (
  Object.values(DsrStatus) as DsrStatus[]
).filter((s) => !CLOSED_DSR_STATUSES.includes(s));

/** Same construction, same reason. Only CLOSED is closed; OPEN/ASSIGNED/UNDER_REVIEW/ESCALATED are
 *  all live review work. */
export const CLOSED_SCREENING_CASE_STATUSES: readonly ScreeningCaseStatus[] = [
  ScreeningCaseStatus.CLOSED,
];

export const OPEN_SCREENING_CASE_STATUSES: readonly ScreeningCaseStatus[] = (
  Object.values(ScreeningCaseStatus) as ScreeningCaseStatus[]
).filter((s) => !CLOSED_SCREENING_CASE_STATUSES.includes(s));

export type CustomerFileAnchorType = 'DSR' | 'SCREENING_CASE';

export interface CustomerFileAnchor {
  type: CustomerFileAnchorType;
  /** The record that opened the window. Recorded in the audit row, so "why was this read allowed"
   *  is answerable from the log alone rather than by re-running the query later. */
  id: string;
}

@Injectable()
export class CustomerFileAnchorService {
  constructor(
    private readonly dsrs: DsrRepository,
    private readonly screeningMatches: ScreeningMatchRepository,
  ) {}

  /**
   * The first open piece of work on this customer assigned to this actor, or null.
   *
   * Order is DSR then screening case, and it does not matter which is reported: either one opens
   * exactly the same read. What matters is that an anchor is NAMED, so the audit row says which
   * record justified the disclosure.
   */
  async resolve(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<CustomerFileAnchor | null> {
    const dsrId = await this.dsrs.findOpenRequestHandledBy(
      customerId,
      actor.id,
      OPEN_DSR_STATUSES,
    );
    if (dsrId) return { type: 'DSR', id: dsrId };

    const matchId = await this.screeningMatches.findOpenCaseAssignedTo(
      customerId,
      actor.id,
      OPEN_SCREENING_CASE_STATUSES,
    );
    if (matchId) return { type: 'SCREENING_CASE', id: matchId };

    return null;
  }
}
