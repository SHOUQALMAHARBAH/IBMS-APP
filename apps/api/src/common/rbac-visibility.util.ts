import type { RoleName } from '@ibms/db';

/** Roles the seeded permission grid trusts with cross-owner visibility on a
 * Sales/Relationship Officer's own records (leads, prospects, ...) — an
 * ordinary officer is scoped server-side to their own pipeline,
 * Manager/Executive get the org-wide view
 * (ibms-brain/meta/context/roles-and-segregation-of-duties.md). Shared by
 * `lead.service.ts` and `prospect.service.ts`; more Domain A modules are
 * expected to need the identical rule as Processes 3-10 land. */
export const VIEW_ALL_OWNERS_ROLES: RoleName[] = [
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
export const CUSTOMER_CROSS_OWNER_ROLES: RoleName[] = [
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
  return actor.roles.some((role) =>
    (CUSTOMER_CROSS_OWNER_ROLES as readonly string[]).includes(role),
  );
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
export const CUSTOMER_FILE_CROSS_OWNER_ROLES: RoleName[] = [
  'PLACEMENT_TECHNICAL_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
];
