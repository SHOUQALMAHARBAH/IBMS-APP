/**
 * ⚠️ PHASE 2 CONVERSION TARGET — every list in this file matches on role NAME.
 *
 * Office-scoped custom roles made a name meaningful only within one office, so
 * an office-defined role appears in none of these lists and sees ONLY records
 * it owns, however its permissions were granted. That fails CLOSED, which is
 * the right direction to fail — but it is still wrong, and no error says so.
 *
 * The approved fix is a `*.view-all-owners` permission per resource family
 * (customer, customer-file, policy, claim, lead), granted to the roles that
 * hold the equivalent reach today. Phase 2.
 *
 * Phase 1 only widened the types from `RoleName[]` to `readonly string[]`: the
 * roles migrated to per-office rows kept their legacy names, so every list
 * still matches exactly who it matched before, and no custom role can exist
 * until Phase 3's Role screen. Phase 2 must land before Phase 3.
 */

/** Roles the seeded permission grid trusts with cross-owner visibility on a
 * Sales/Relationship Officer's own records (leads, prospects, ...) — an
 * ordinary officer is scoped server-side to their own pipeline,
 * Manager/Executive get the org-wide view
 * (ibms-brain/meta/context/roles-and-segregation-of-duties.md). Shared by
 * `lead.service.ts` and `prospect.service.ts`; more Domain A modules are
 * expected to need the identical rule as Processes 3-10 land. */
export const VIEW_ALL_OWNERS_ROLES: readonly string[] = [
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
];

/** Roles the seeded `customer.360-view.read` grant trusts with cross-owner
 * visibility on any Customer file — Manager/Executive (the org-wide view)
 * plus Compliance (needs to open any Sales Officer's customer to work its
 * KYC file) and External Auditor (read-only across the org by design,
 * ibms-brain/meta/context/roles-and-segregation-of-duties.md). A superset of
 * VIEW_ALL_OWNERS_ROLES. Shared by `customer.service.ts` and the CRM module
 * (Part C #10) — both resolve "who may view this customer" the same way. */
export const CUSTOMER_CROSS_OWNER_ROLES: readonly string[] = [
  ...VIEW_ALL_OWNERS_ROLES,
  'COMPLIANCE_OFFICER',
  'EXTERNAL_AUDITOR',
];

/** The one place "may this actor see this customer's file?" is decided:
 * the owning Sales/Relationship Officer, or a `CUSTOMER_CROSS_OWNER_ROLES`
 * holder. Structurally typed (an `{ ownerUserId }` row + an `{ id, roles }`
 * actor) so it stays dependency-free. `customer.service.ts` and
 * `crm.service.ts` both resolve visibility through this; the older
 * `cross-sell.service.ts` / `insurance-program.service.ts` still carry an
 * inline equivalent and are candidates to migrate here. */
export function isCustomerVisibleTo(
  customer: { ownerUserId: string },
  actor: { id: string; roles: readonly string[] },
): boolean {
  if (customer.ownerUserId === actor.id) return true;
  return actor.roles.some((role) => CUSTOMER_CROSS_OWNER_ROLES.includes(role));
}

/** Roles that work a customer's commercial file across the whole book, not
 * just a Sales/Relationship Officer's own pipeline — the Placement/Technical
 * Officer consumes the Risk Profile and Needs Assessment downstream for
 * RFQ/placement, and Manager/Executive get the org-wide view
 * (ibms-brain/meta/context/roles-and-segregation-of-duties.md). A Sales
 * Officer holding `risk-profile.*`/`needs-assessment.*` still only sees
 * records tied to a Customer they own (or, for a Needs Assessment, that
 * they captured). Shared by the risk-profile and needs-assessment modules
 * (Part C #5). */
export const CUSTOMER_FILE_CROSS_OWNER_ROLES: readonly string[] = [
  'PLACEMENT_TECHNICAL_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
];

/** Roles that reach any `Policy` regardless of who owns the Customer — the
 * whole-commercial-book roles plus the Policy Checking Officer (Process 20
 * quality control is a cross-book control function, like Compliance for KYC).
 * Shared by `PolicyService` and `PolicyCheckingService` (backlog Part C
 * #18-20). */
export const POLICY_CROSS_OWNER_ROLES: readonly string[] = [
  ...CUSTOMER_FILE_CROSS_OWNER_ROLES,
  'POLICY_CHECKING_OFFICER',
];

/** Roles that reach any `Claim` regardless of who owns the Customer — the
 * Claims Officer works the whole claims book (a cross-book operational role,
 * like the Policy Checking Officer for QC) and Manager/Executive get the
 * org-wide view (ibms-brain/meta/context/roles-and-segregation-of-duties.md).
 * A Sales/Relationship Officer holding `claim.notify` / `claim.read` still
 * sees only claims on a Customer they own. Shared by the claim module (backlog
 * Part C #23+). */
export const CLAIM_CROSS_OWNER_ROLES: readonly string[] = [
  'CLAIMS_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
];
