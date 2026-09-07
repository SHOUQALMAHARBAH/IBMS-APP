/**
 * Process 10 — Relationship Management (CRM) (backlog Part C #10, Domain A).
 *
 * The pure, deterministic part of the "360° customer view": given a
 * customer's interaction log plus their policies, claims and complaints, it
 * merges them into ONE reverse-chronological timeline the customer-timeline
 * screen renders directly. Same philosophy as needs-assessment.config.ts /
 * cross-sell.config.ts / up-sell.config.ts — no I/O, no `Date.now()`, so the
 * same inputs always produce the same timeline and a reviewer can reason
 * about the ordering.
 *
 * Projections only. `Claim` is HIGHLY_CONFIDENTIAL
 * (ibms-brain/meta/lex/sensitive-data-handling.md — medical/clinical loss
 * detail): the claim shape here carries an id, a number, a status and dates,
 * never `causeOfLoss`, `lossLocation`, or any money figure or money-derived
 * signal (`isLargeClaim` is a loss-value threshold flag — deliberately left
 * out). Money is dropped from the policy shape too — it is not needed to
 * render a relationship timeline. The repository's `select` is the
 * enforcement; these interfaces are the widest thing it is allowed to hand
 * back.
 *
 * `Policy` / `Claim` / `Complaint` have no application module yet (Domains B,
 * C, E are not built), so those three collections are always empty today and
 * the timeline is interactions-only until they land — the same "built ahead
 * of its data source" shape as cross-sell.config.ts (README § Known gaps,
 * Part C #10).
 */

export interface TimelineInteraction {
  id: string;
  channel: string;
  summary: string;
  occurredAt: Date;
  loggedByUserId: string;
}

export interface TimelinePolicy {
  id: string;
  policyNumber: string | null;
  insuranceLine: string;
  status: string;
  inceptionDate: Date | null;
  expiryDate: Date | null;
  createdAt: Date;
}

export interface TimelineClaim {
  id: string;
  claimNumber: string | null;
  status: string;
  lossDate: Date;
  createdAt: Date;
}

export interface TimelineComplaint {
  id: string;
  /** Free-text complaint summary. `Complaint` carries no classification flag
   * in the schema (unlike `Claim`), so this operational text is shown on the
   * timeline the same way `Interaction.summary` is. */
  issue: string;
  category: string | null;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
}

export type TimelineEventKind =
  'INTERACTION' | 'POLICY' | 'CLAIM' | 'COMPLAINT';

export interface TimelineEvent {
  kind: TimelineEventKind;
  /** The source row's id (Interaction / Policy / Claim / Complaint). */
  refId: string;
  /** The instant the event is placed at on the timeline (see below). */
  at: Date;
  /** Short label — e.g. "CALL", "Policy MP-2024-11", "Claim (unnumbered)". */
  title: string;
  /** One line of context — the interaction summary, the insurance line, the
   * complaint text — or null when the title already says it all. Never a
   * HIGHLY_CONFIDENTIAL claim field. */
  detail: string | null;
  /** The workflow status of a policy / claim / complaint; null for an
   * interaction (which has no status). */
  status: string | null;
}

export interface CustomerTimelineInput {
  interactions: readonly TimelineInteraction[];
  policies: readonly TimelinePolicy[];
  claims: readonly TimelineClaim[];
  complaints: readonly TimelineComplaint[];
}

/** Stable order for events that share the exact same `at` instant, so the
 * merged timeline is deterministic regardless of the order the four
 * collections arrived in. */
const KIND_ORDER: Record<TimelineEventKind, number> = {
  INTERACTION: 0,
  CLAIM: 1,
  POLICY: 2,
  COMPLAINT: 3,
};

/**
 * Merge every relationship touchpoint into ONE reverse-chronological
 * (newest first) list. Pure and deterministic: ties on `at` break by a
 * fixed kind order, then by `refId`, so the output never depends on the
 * order the four collections were passed in.
 *
 * Representative instant per kind:
 *   - interaction -> `occurredAt`
 *   - policy      -> `inceptionDate` if set, else `createdAt` (a placement
 *                    still being issued has no inception date yet)
 *   - claim       -> `lossDate` (when the loss happened, not when it was filed)
 *   - complaint   -> `createdAt` (when it was logged)
 */
export function buildCustomerTimeline(
  input: CustomerTimelineInput,
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...input.interactions.map((i): TimelineEvent => ({
      kind: 'INTERACTION',
      refId: i.id,
      at: i.occurredAt,
      title: i.channel,
      detail: i.summary,
      status: null,
    })),
    ...input.policies.map((p): TimelineEvent => ({
      kind: 'POLICY',
      refId: p.id,
      at: p.inceptionDate ?? p.createdAt,
      title: `Policy ${p.policyNumber ?? '(unnumbered)'}`,
      detail: p.insuranceLine,
      status: p.status,
    })),
    ...input.claims.map((c): TimelineEvent => ({
      kind: 'CLAIM',
      refId: c.id,
      at: c.lossDate,
      title: `Claim ${c.claimNumber ?? '(unnumbered)'}`,
      // No `detail` — a claim's loss detail and value (incl. the
      // `isLargeClaim` threshold flag) are HIGHLY_CONFIDENTIAL and never
      // surface on the timeline.
      detail: null,
      status: c.status,
    })),
    ...input.complaints.map((c): TimelineEvent => ({
      kind: 'COMPLAINT',
      refId: c.id,
      at: c.createdAt,
      title: c.category ? `Complaint — ${c.category}` : 'Complaint',
      detail: c.issue,
      status: c.status,
    })),
  ];

  return events.sort((a, b) => {
    const byTime = b.at.getTime() - a.at.getTime();
    if (byTime !== 0) return byTime;
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (byKind !== 0) return byKind;
    return a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0;
  });
}
