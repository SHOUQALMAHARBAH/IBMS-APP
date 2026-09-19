/**
 * Who may see a record they do not own.
 *
 * ## What this replaced
 *
 * Until Phase 2 every rule here was a list of role NAMES, matched with
 * `actor.roles.some((role) => LIST.includes(role))`. Office-scoped custom roles
 * made a name meaningful only inside one office, so a role an office defines
 * appeared in none of these lists and saw ONLY records it owned, however its
 * permissions had been granted. That failed CLOSED — the right direction to
 * fail — but it was still wrong, and nothing said so: the office would simply
 * find its own Manager role unable to see the book.
 *
 * Each rule is now a PERMISSION, granted in the seed to exactly the roles that
 * held the equivalent reach before, so no existing user's visibility changed.
 *
 * ## Why the codes are named `<family>.all-owners.read`
 *
 * `permissions.spec.ts` asserts the External Auditor is read-only BY
 * CONSTRUCTION: every code it holds ends in `.read` or `.view`. The auditor
 * holds cross-owner reach on customers, so a code named
 * `customer.view-all-owners` would have forced that check to be widened — and
 * widening a check that exists to catch a write permission leaking to an
 * auditor is the wrong trade for a nicer-reading code. `.all-owners.read`
 * follows the `customer.360-view.read` precedent already in the grid and needs
 * no change to the check at all.
 *
 * ## Resolution is synchronous, on purpose
 *
 * `AuthenticatedUser` carries its resolved permission codes
 * (`SessionService.validateAndTouch`), so these stay plain predicates and the
 * ~20 services that call them did not have to become async or take a new
 * dependency. The resolution itself is `PermissionsService.getCodesForRoles`,
 * keyed on role IDS and cached — the same call `PermissionsGuard` already makes
 * on every permission-gated request.
 */

/** The shape every rule below needs: an identity, and what that identity may
 *  do. Structurally typed so a caller can pass an `AuthenticatedUser` or a
 *  narrower object, and so this module depends on nothing. */
export interface VisibilityActor {
  id: string;
  permissions: ReadonlySet<string>;
}

/** Cross-owner reach over a Sales/Relationship Officer's own pipeline — leads
 *  and prospects. Held by Manager and Executive: an ordinary officer is scoped
 *  server-side to their own pipeline
 *  (ibms-brain/meta/context/roles-and-segregation-of-duties.md). */
export const LEAD_ALL_OWNERS_READ = 'lead.all-owners.read';

/** Cross-owner reach over any Customer file. A superset of the leads rule —
 *  Compliance needs any Sales Officer's customer to work its KYC file, and the
 *  External Auditor reads across the org by design. */
export const CUSTOMER_ALL_OWNERS_READ = 'customer.all-owners.read';

/** Cross-owner reach over a customer's COMMERCIAL file — risk profile, needs
 *  assessment, insurance program, opportunity, RFQ, quotation, comparison,
 *  client decision. The Placement/Technical Officer consumes these downstream
 *  for placement, so they work the whole book rather than one pipeline. */
export const CUSTOMER_FILE_ALL_OWNERS_READ = 'customer-file.all-owners.read';

/** Cross-owner reach over any Policy. The commercial-book roles plus the Policy
 *  Checking Officer, whose Process 20 quality control is a cross-book control
 *  function in the same way Compliance is for KYC. */
export const POLICY_ALL_OWNERS_READ = 'policy.all-owners.read';

/** Cross-owner reach over any Claim. The Claims Officer works the whole claims
 *  book; a Sales Officer holding `claim.notify`/`claim.read` still sees only
 *  claims on a Customer they own. */
export const CLAIM_ALL_OWNERS_READ = 'claim.all-owners.read';

/** Cross-owner reach over any Endorsement. The commercial-file roles plus
 *  Finance, which handles the premium adjustment an endorsement produces. */
export const ENDORSEMENT_ALL_OWNERS_READ = 'endorsement.all-owners.read';

/** Cross-owner reach over any Recommendation. The commercial-file roles plus
 *  Compliance, which must reach any recommendation to clear its
 *  conflict-of-interest disclosure — the conflicted officer cannot self-clear
 *  (maker/checker), so without this the disclosure could never be cleared. */
export const RECOMMENDATION_ALL_OWNERS_READ = 'recommendation.all-owners.read';

/** Every cross-owner code, for the seed spec and the permission grid to check
 *  against. Not used for any decision. */
export const ALL_OWNERS_READ_CODES: readonly string[] = [
  LEAD_ALL_OWNERS_READ,
  CUSTOMER_ALL_OWNERS_READ,
  CUSTOMER_FILE_ALL_OWNERS_READ,
  POLICY_ALL_OWNERS_READ,
  CLAIM_ALL_OWNERS_READ,
  ENDORSEMENT_ALL_OWNERS_READ,
  RECOMMENDATION_ALL_OWNERS_READ,
];

/** Leads and prospects (Domain A). Shared by `lead.service.ts`,
 *  `prospect.service.ts`, `cross-sell.service.ts`, `up-sell.service.ts` and
 *  `sales-performance.service.ts`. */
export function canReadAllLeadOwners(actor: VisibilityActor): boolean {
  return actor.permissions.has(LEAD_ALL_OWNERS_READ);
}

/** Any Customer file. Shared by `customer.service.ts`, `crm.service.ts` and
 *  `kyc.service.ts` — the last of which kept its own identical copy of the role
 *  list before this phase. */
export function canReadAllCustomerOwners(actor: VisibilityActor): boolean {
  return actor.permissions.has(CUSTOMER_ALL_OWNERS_READ);
}

/** A customer's commercial file. Shared by nine Domain A/B services. */
export function canReadAllCustomerFileOwners(actor: VisibilityActor): boolean {
  return actor.permissions.has(CUSTOMER_FILE_ALL_OWNERS_READ);
}

/** Any Policy. Shared by `policy.service.ts` and `policy-delivery.service.ts`.
 *  `policy.repository.ts` receives the ANSWER (a null owner filter) rather than
 *  calling this, so the window still bounds MATCHING rows. */
export function canReadAllPolicyOwners(actor: VisibilityActor): boolean {
  return actor.permissions.has(POLICY_ALL_OWNERS_READ);
}

/** Any Claim. Same query-filter arrangement as policies. */
export function canReadAllClaimOwners(actor: VisibilityActor): boolean {
  return actor.permissions.has(CLAIM_ALL_OWNERS_READ);
}

/** Any Endorsement. */
export function canReadAllEndorsementOwners(actor: VisibilityActor): boolean {
  return actor.permissions.has(ENDORSEMENT_ALL_OWNERS_READ);
}

/** Any Recommendation. */
export function canReadAllRecommendationOwners(
  actor: VisibilityActor,
): boolean {
  return actor.permissions.has(RECOMMENDATION_ALL_OWNERS_READ);
}

/**
 * The one place "may this actor see this customer's file?" is decided: the
 * owning Sales/Relationship Officer, or a holder of
 * `customer.all-owners.read`.
 *
 * `customer.service.ts` and `crm.service.ts` both resolve visibility through
 * this; the older `cross-sell.service.ts` / `insurance-program.service.ts` still
 * carry an inline equivalent and are candidates to migrate here.
 */
export function isCustomerVisibleTo(
  customer: { ownerUserId: string },
  actor: VisibilityActor,
): boolean {
  if (customer.ownerUserId === actor.id) return true;
  return canReadAllCustomerOwners(actor);
}
