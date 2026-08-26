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
