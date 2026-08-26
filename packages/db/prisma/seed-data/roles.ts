import { RoleName } from '@prisma/client';

/**
 * Part 5.1 — the 11-role catalogue. Each description is a condensed version
 * of that role's "Can" column in
 * ibms-brain/meta/context/roles-and-segregation-of-duties.md, plus its
 * headline "Cannot" constraint so the row is self-explanatory without
 * cross-referencing the brain doc.
 */
export interface RoleSeed {
  name: RoleName;
  description: string;
}

export const ROLES: RoleSeed[] = [
  {
    name: RoleName.SALES_RELATIONSHIP_OFFICER,
    description:
      'Creates leads and prospects, captures KYC, runs needs assessments, and initiates RFQs. Cannot approve their own KYC file or a recommendation above the approval threshold.',
  },
  {
    name: RoleName.PLACEMENT_TECHNICAL_OFFICER,
    description:
      'Manages RFQs, quotations, negotiation, and drafts broker recommendations. Cannot perform policy checking on a policy they themselves placed.',
  },
  {
    name: RoleName.POLICY_CHECKING_OFFICER,
    description:
      'Independently verifies an issued policy against the requested coverage, line by line. Cannot have placed the policy under review.',
  },
  {
    name: RoleName.CLAIMS_OFFICER,
    description:
      'Registers, documents, assesses, and follows up claims. Cannot approve large claim settlements alone or approve their own claim payments.',
  },
  {
    name: RoleName.FINANCE_COLLECTIONS_OFFICER,
    description:
      'Raises invoices, records receipts, and calculates commission from governed rate tables. Cannot approve refunds/write-offs or alter commission rate tables without approval.',
  },
  {
    name: RoleName.COMPLIANCE_OFFICER,
    description:
      'Approves KYC/EDD, runs sanctions/PEP screening, manages conflict-of-interest disclosures, broker regulatory filings, and third-party risk tiering. Cannot originate sales transactions or act as DPO on data-subject requests unless formally dual-hatted.',
  },
  {
    name: RoleName.BRANCH_DEPARTMENT_MANAGER,
    description:
      'Approves escalations, refunds, and overrides within delegated authority, and signs off destruction batch lists as the maker side of dual control. Cannot bypass maker/checker above their delegated authority or self-approve their own escalations.',
  },
  {
    name: RoleName.DATA_PROTECTION_OFFICER,
    description:
      'Owns the consent register, the DSR queue and its SLAs, the Legal Hold register, simplified DPIA decisions, breach classification/notification, and final dual-control sign-off on destruction. Cannot originate commercial/sales transactions.',
  },
  {
    name: RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
    description:
      'Manages user provisioning, roles, and security configuration. Cannot access business data beyond what administration requires — and, unlike every other role, is explicitly NOT exempt from periodic access recertification of their own account.',
  },
  {
    name: RoleName.EXECUTIVE_MANAGEMENT,
    description:
      'Views dashboards and reports across the organization. Cannot perform transactional maker/checker actions.',
  },
  {
    name: RoleName.EXTERNAL_AUDITOR,
    description:
      'Time-boxed, read-only access to logs, documents, and workflow history for a defined engagement period (User.accessValidFrom/accessValidUntil). Cannot modify any record.',
  },
];
