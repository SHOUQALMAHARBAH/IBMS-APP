import type { ClientDecisionType, OpportunityStatus, Prisma } from '@ibms/db';

/**
 * Process 17 — Client Decision Handling (backlog Part C #17, Domain B). The
 * pure, deterministic core: map one of the six `ClientDecisionType` values
 * to the single Opportunity route it takes, and validate the evidence.
 *
 * `ibms-brain/meta/context/policy-lifecycle.md` § "The shapes": the client
 * decision "branches ... each is a distinct next step (Placement, RFQ
 * closed, or renewed Negotiation), not a single generic 'declined' state".
 * Six decision types, three routes.
 */

/** The three routes a client decision takes — each is the Opportunity status
 * the decision drives the parent toward (via `SENT_TO_CLIENT ->
 * CLIENT_DECISION -> <this>` through the workflow engine). */
export type ClientDecisionRoute = Extract<
  OpportunityStatus,
  'PLACEMENT' | 'CLOSED_LOST' | 'RENEGOTIATE'
>;

/** The six decision types, and the route each one takes:
 *   - ACCEPT                     -> PLACEMENT     ("proceed to place the cover")
 *   - REJECT                     -> CLOSED_LOST   ("close the request")
 *   - REQUEST_FURTHER_NEGOTIATION,
 *     REQUEST_ALTERNATIVE_OPTIONS,
 *     REQUEST_PRICE_REDUCTION,
 *     REQUEST_COVERAGE_INCREASE  -> RENEGOTIATE   ("renewed negotiation")
 */
export const CLIENT_DECISION_ROUTES: Record<
  ClientDecisionType,
  ClientDecisionRoute
> = {
  ACCEPT: 'PLACEMENT',
  REJECT: 'CLOSED_LOST',
  REQUEST_FURTHER_NEGOTIATION: 'RENEGOTIATE',
  REQUEST_ALTERNATIVE_OPTIONS: 'RENEGOTIATE',
  REQUEST_PRICE_REDUCTION: 'RENEGOTIATE',
  REQUEST_COVERAGE_INCREASE: 'RENEGOTIATE',
};

/** The Opportunity route for a decision. Total over the enum — a new
 * `ClientDecisionType` value would fail the `Record<...>` type above until
 * it is mapped here. */
export function routeFor(decision: ClientDecisionType): ClientDecisionRoute {
  return CLIENT_DECISION_ROUTES[decision];
}

/** A short human label for the route, for API responses / the UI. */
export function routeLabel(route: ClientDecisionRoute): string {
  switch (route) {
    case 'PLACEMENT':
      return 'Proceed to placement';
    case 'CLOSED_LOST':
      return 'Close the request';
    case 'RENEGOTIATE':
      return 'Renewed negotiation';
  }
}

/** How the client's decision was evidenced (Part 4.1 — a decision of record
 * needs a reference, not a bare enum). */
export const EVIDENCE_TYPES = [
  'signature',
  'e-signature',
  'email_confirmation',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/**
 * The audit `afterValue` for a captured client decision — the decision, its
 * route, the evidence *type* and *reference* (a document id / email ref,
 * not content), and provenance. The free-text `notes` are excluded (they can
 * carry commercially sensitive context about what the client wants changed —
 * same "metadata not body" shape as #12 / #13 / #15 / #16).
 */
export function clientDecisionAuditSnapshot(row: {
  opportunityId: string;
  decision: ClientDecisionType;
  evidenceType: string | null;
  evidenceRef: string | null;
  capturedByUserId: string | null;
  notes: string | null;
}): Prisma.InputJsonObject {
  return {
    opportunityId: row.opportunityId,
    decision: row.decision,
    route: routeFor(row.decision),
    evidenceType: row.evidenceType,
    evidenceRef: row.evidenceRef,
    capturedByUserId: row.capturedByUserId,
    hasNotes: row.notes !== null && row.notes.trim().length > 0,
  };
}
