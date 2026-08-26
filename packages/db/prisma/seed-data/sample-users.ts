import { RoleName } from '@prisma/client';

/**
 * Part B — "sample user per role". One local-login demo account per role in
 * the `RoleName` enum, so RBAC/permission work can be exercised end-to-end
 * without a real onboarding flow (Part C isn't built yet — see CLAUDE.md).
 *
 * Every account shares `SAMPLE_USER_PASSWORD` (below) purely so this list
 * doesn't have to enumerate 11 secrets — it satisfies
 * `validatePasswordPolicy()` (apps/api/src/modules/auth/services/password.service.ts)
 * but is not meant to be a real credential anywhere. Seeding these is gated
 * on `NODE_ENV !== 'production'` in seed.ts — same convention as
 * `ENABLE_DEV_RESET_TOKEN` (apps/api/src/modules/auth/services/auth.service.ts)
 * and `securityHeaders()` (apps/api/src/common/security-headers.middleware.ts).
 */
export const SAMPLE_USER_PASSWORD = 'SampleUser#2026!';

export interface SampleUserSeed {
  email: string;
  fullName: string;
  role: RoleName;
}

export const SAMPLE_USERS: SampleUserSeed[] = [
  {
    email: 'sample.sales@ibms.internal',
    fullName: 'Sample Sales & Relationship Officer',
    role: RoleName.SALES_RELATIONSHIP_OFFICER,
  },
  {
    email: 'sample.placement@ibms.internal',
    fullName: 'Sample Placement & Technical Officer',
    role: RoleName.PLACEMENT_TECHNICAL_OFFICER,
  },
  {
    email: 'sample.policy-checking@ibms.internal',
    fullName: 'Sample Policy Checking Officer',
    role: RoleName.POLICY_CHECKING_OFFICER,
  },
  {
    email: 'sample.claims@ibms.internal',
    fullName: 'Sample Claims Officer',
    role: RoleName.CLAIMS_OFFICER,
  },
  {
    email: 'sample.finance@ibms.internal',
    fullName: 'Sample Finance & Collections Officer',
    role: RoleName.FINANCE_COLLECTIONS_OFFICER,
  },
  {
    email: 'sample.compliance@ibms.internal',
    fullName: 'Sample Compliance Officer',
    role: RoleName.COMPLIANCE_OFFICER,
  },
  {
    email: 'sample.manager@ibms.internal',
    fullName: 'Sample Branch/Department Manager',
    role: RoleName.BRANCH_DEPARTMENT_MANAGER,
  },
  {
    email: 'sample.dpo@ibms.internal',
    fullName: 'Sample Data Protection Officer',
    role: RoleName.DATA_PROTECTION_OFFICER,
  },
  {
    email: 'sample.sysadmin@ibms.internal',
    fullName: 'Sample System/Security Administrator',
    role: RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
  },
  {
    email: 'sample.exec@ibms.internal',
    fullName: 'Sample Executive Management',
    role: RoleName.EXECUTIVE_MANAGEMENT,
  },
  {
    email: 'sample.auditor@ibms.internal',
    fullName: 'Sample External Auditor',
    role: RoleName.EXTERNAL_AUDITOR,
  },
];
