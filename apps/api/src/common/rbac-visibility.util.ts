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
