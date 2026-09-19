import { RoleName } from "@prisma/client";

/**
 * Part 5.1 — the 11-role catalogue. Each description is a condensed version
 * of that role's "Can" column in
 * ibms-brain/meta/context/roles-and-segregation-of-duties.md, plus its
 * headline "Cannot" constraint so the row is self-explanatory without
 * cross-referencing the brain doc.
 */
export interface RoleSeed {
  /** The stable machine name. `ROLES` narrows this to the legacy `RoleName`
   *  enum, which survives unreferenced by the schema — those eleven ARE that
   *  catalogue, and typing them keeps a typo from seeding a twelfth. The
   *  interface itself is a plain string because `OFFICE_ADMINISTRATOR` is a
   *  seeded role that is deliberately NOT in the enum: the enum is the legacy
   *  catalogue being retired, not the list of roles the platform installs. */
  name: string;
  /** Display names. Office-scoped custom roles made these mandatory on `Role`:
   *  an office renames its own roles, and a name that exists only in Latin
   *  script shows up untranslated mid-sentence on an Arabic page. Kept
   *  byte-identical to migration 20261003100000 so a seeded database and a
   *  migrated one are indistinguishable. */
  nameEn: string;
  nameAr: string;
  description: string;
  /** Part II §4.4 / Part 10.1 — role-level security attributes, NOT
   *  permissions (a permission could be granted away from the Role screen).
   *  Both default to the STRICT value on `Role`, so these are written
   *  explicitly here for the same reason migration 20261004100000 backfills
   *  them explicitly: a seeded database and a migrated one must be
   *  indistinguishable, and relying on the column default would make every
   *  seeded role strict. */
  requiresMfaAlways: boolean;
  requiresHardwareToken: boolean;
}

/** Every role in this file is one the PLATFORM defines, so all eleven are
 *  `isSystem` — the Role screen refuses to rename, retire or re-grant them. That
 *  flag GRANTS NOTHING; it is read by the CRUD guards and by nothing else.
 *  Written here rather than per-row because there is no seeded role for which it
 *  is false, and a per-row field would invite one. */
export const SEEDED_ROLES_ARE_SYSTEM = true;

export const ROLES: (RoleSeed & { name: RoleName })[] = [
  {
    name: RoleName.SALES_RELATIONSHIP_OFFICER,
    nameEn: "Sales / Relationship Officer",
    nameAr: "موظف المبيعات وعلاقات العملاء",
    requiresMfaAlways: false,
    requiresHardwareToken: false,
    description:
      "Creates leads and prospects, captures KYC, runs needs assessments, and initiates RFQs. Cannot approve their own KYC file or a recommendation above the approval threshold.",
  },
  {
    name: RoleName.PLACEMENT_TECHNICAL_OFFICER,
    nameEn: "Placement / Technical Officer",
    nameAr: "موظف الاكتتاب والتنسيب",
    requiresMfaAlways: false,
    requiresHardwareToken: false,
    description:
      "Manages RFQs, quotations, negotiation, and drafts broker recommendations. Cannot perform policy checking on a policy they themselves placed.",
  },
  {
    name: RoleName.POLICY_CHECKING_OFFICER,
    nameEn: "Policy Checking Officer",
    nameAr: "موظف تدقيق الوثائق",
    requiresMfaAlways: false,
    requiresHardwareToken: false,
    description:
      "Independently verifies an issued policy against the requested coverage, line by line. Cannot have placed the policy under review.",
  },
  {
    name: RoleName.CLAIMS_OFFICER,
    nameEn: "Claims Officer",
    nameAr: "موظف المطالبات",
    requiresMfaAlways: false,
    requiresHardwareToken: false,
    description:
      "Registers, documents, assesses, and follows up claims. Cannot approve large claim settlements alone or approve their own claim payments.",
  },
  {
    name: RoleName.FINANCE_COLLECTIONS_OFFICER,
    nameEn: "Finance / Collections Officer",
    nameAr: "موظف المالية والتحصيل",
    requiresMfaAlways: false,
    requiresHardwareToken: false,
    description:
      "Raises invoices, records receipts, and calculates commission from governed rate tables. Cannot approve refunds/write-offs or alter commission rate tables without approval.",
  },
  {
    name: RoleName.COMPLIANCE_OFFICER,
    nameEn: "Compliance Officer",
    nameAr: "موظف الالتزام",
    requiresMfaAlways: true,
    requiresHardwareToken: true,
    description:
      "Approves KYC/EDD, runs sanctions/PEP screening, manages conflict-of-interest disclosures, broker regulatory filings, and third-party risk tiering. Cannot originate sales transactions or act as DPO on data-subject requests unless formally dual-hatted.",
  },
  {
    name: RoleName.BRANCH_DEPARTMENT_MANAGER,
    nameEn: "Branch / Department Manager",
    nameAr: "مدير الفرع أو القسم",
    requiresMfaAlways: false,
    requiresHardwareToken: true,
    description:
      "Approves escalations, refunds, and overrides within delegated authority, and signs off destruction batch lists as the maker side of dual control. Cannot bypass maker/checker above their delegated authority or self-approve their own escalations.",
  },
  {
    name: RoleName.DATA_PROTECTION_OFFICER,
    nameEn: "Data Protection Officer",
    nameAr: "مسؤول حماية البيانات",
    requiresMfaAlways: true,
    requiresHardwareToken: true,
    description:
      "Owns the consent register, the DSR queue and its SLAs, the Legal Hold register, simplified DPIA decisions, breach classification/notification, and final dual-control sign-off on destruction. Cannot originate commercial/sales transactions.",
  },
  {
    name: RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
    nameEn: "System / Security Administrator",
    nameAr: "مدير النظام والأمن",
    requiresMfaAlways: true,
    requiresHardwareToken: true,
    description:
      "Manages user provisioning, roles, and security configuration. Cannot access business data beyond what administration requires — and, unlike every other role, is explicitly NOT exempt from periodic access recertification of their own account.",
  },
  {
    name: RoleName.EXECUTIVE_MANAGEMENT,
    nameEn: "Executive Management",
    nameAr: "الإدارة التنفيذية",
    requiresMfaAlways: false,
    requiresHardwareToken: true,
    description:
      "Views dashboards and reports across the organization. Cannot perform transactional maker/checker actions.",
  },
  {
    name: RoleName.EXTERNAL_AUDITOR,
    nameEn: "External Auditor",
    nameAr: "مدقق خارجي",
    requiresMfaAlways: false,
    requiresHardwareToken: false,
    description:
      "Time-boxed, read-only access to logs, documents, and workflow history for a defined engagement period (User.accessValidFrom/accessValidUntil). Cannot modify any record.",
  },
];

/**
 * The office administrator, and the only role a NEW office is given.
 *
 * ## Why this role exists
 *
 * Every office needs somebody who can provision a user and define a role, or
 * the office cannot be set up at all — and until now that person had to be a
 * `SYSTEM_SECURITY_ADMINISTRATOR`, a platform-catalogue role from the fixed
 * eleven this rework is retiring. An office that defines its own roles needs its
 * administrator to be an ordinary per-office row like any other.
 *
 * ## It is a strict subset, and that is load-bearing
 *
 * Its 22 codes are a verified strict subset of what
 * `SYSTEM_SECURITY_ADMINISTRATOR` already holds. That is what lets the migration
 * grant this role to every existing administrator with a provably EMPTY
 * effective-permission diff: nobody gains anything, the role simply becomes the
 * per-office name for what they could already do. `permissions.spec.ts` asserts
 * the subset property so it cannot quietly stop holding.
 *
 * What it deliberately does NOT hold, all of it verified against the grid:
 * `claim.delete` and `document.delete-override` (destructive business actions an
 * administrator has no business performing), `insurer.form.map` and
 * `insurer.master.manage` (the global insurer catalogue is a platform concern),
 * `access-recertification.review` and `.review.routine` (an administrator
 * reviewing their own access is the control this system exists to prevent), and
 * `employee.national-id.reveal` / `customer.national-id.reveal` (Part 10.2
 * Highly Confidential — provisioning an account does not require reading
 * somebody's national identity number).
 *
 * ## isSystem, and what it does not mean
 *
 * `isSystem` protects the row from being renamed, retired or re-granted from the
 * Role screen. It GRANTS NOTHING. There is no wildcard, no `ALL_PERMISSIONS`,
 * no `if (isSystem) allow` — this role reaches exactly the 22 codes below, the
 * same way every other role reaches its grants.
 */
export const OFFICE_ADMINISTRATOR_ROLE: RoleSeed = {
  name: "OFFICE_ADMINISTRATOR",
  nameEn: "Office Administrator",
  nameAr: "مدير المكتب",
  // Strict, like every administration role in the catalogue. Part II §4.4 —
  // and this one can provision accounts, which is the capability an attacker
  // wants most.
  requiresMfaAlways: true,
  requiresHardwareToken: true,
  description:
    "Provisions users, defines the office's own roles and their permissions, and manages office security configuration, email integration and the operational registers. Cannot delete business records, touch the global insurer catalogue, review its own access recertification, or reveal a national ID.",
};
