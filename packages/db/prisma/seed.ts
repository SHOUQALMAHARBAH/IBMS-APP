import { PrismaClient, RoleName } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import {
  OFFICE_ADMINISTRATOR_ROLE,
  ROLES,
  SEEDED_ROLES_ARE_SYSTEM,
} from "./seed-data/roles";
import { PERMISSIONS } from "./seed-data/permissions";
import { INSURANCE_LINES } from "./seed-data/insurance-lines";
import {
  BANKS,
  BUSINESS_MODELS,
  CITIES,
  COUNTRIES,
  CURRENCIES,
  LEGAL_FORMS,
  LICENSING_AUTHORITIES,
  RATING_AGENCIES,
  type ReferenceSeed,
} from "./seed-data/reference-tables";

/** The eight, paired with the Prisma delegate each one seeds. A tuple list rather than eight
 *  copies of the same loop: the shape is identical by design, and eight near-identical blocks is
 *  eight places for one of them to drift. */
const REFERENCE_TABLES: [
  (
    | "country"
    | "city"
    | "bank"
    | "currency"
    | "licensingAuthority"
    | "ratingAgency"
    | "legalForm"
    | "businessModel"
  ),
  ReferenceSeed[],
][] = [
  ["country", COUNTRIES],
  ["city", CITIES],
  ["bank", BANKS],
  ["currency", CURRENCIES],
  ["licensingAuthority", LICENSING_AUTHORITIES],
  ["ratingAgency", RATING_AGENCIES],
  ["legalForm", LEGAL_FORMS],
  ["businessModel", BUSINESS_MODELS],
];
import { RETENTION_SCHEDULE } from "./seed-data/retention-schedule";
import { SAMPLE_USERS, SAMPLE_USER_PASSWORD } from "./seed-data/sample-users";
import { validatePasswordPolicy } from "../src/password-policy";
import { SAMPLE_INSURERS } from "./seed-data/insurers";
import { DOCUMENT_TEMPLATES } from "./seed-data/document-templates";
import { SLA_POLICY_SEEDS } from "./seed-data/sla-policies";

const prisma = new PrismaClient();

/**
 * Sample/demo data (fictional insurers, login-capable sample users per
 * role) must never land in a production database — same gate convention as
 * `ENABLE_DEV_RESET_TOKEN` (apps/api/.../auth.service.ts) and
 * `securityHeaders()` (apps/api/src/common/security-headers.middleware.ts).
 * Roles, permissions, the retention schedule, and document templates are
 * real configuration data and are seeded in every environment.
 */
const SEED_SAMPLE_DATA = process.env.NODE_ENV !== "production";

/**
 * Well-known service-account email for actions with no human actor (the
 * quarterly access-recertification cron). AuditLogEntry.userId is a real
 * FK to User, so scheduled jobs need a real row to attribute to — this
 * account can never log in (isActive: false, unusable passwordHash).
 * Referenced by its email (not a hardcoded id, which would differ per
 * environment) from
 * apps/api/src/modules/rbac/services/access-recertification.scheduler.ts —
 * keep both in sync if this ever changes.
 */
export const SYSTEM_ACCOUNT_EMAIL = "system@ibms.internal";

/**
 * Multi-tenancy Phase 1 — the single Organization every existing row was
 * backfilled onto.
 *
 * This id is a fixed constant in three places that must agree and cannot read
 * each other: the `@default` on every tenant-scoped `organizationId` column in
 * schema.prisma, the INSERT in migration
 * `20260925100000_add_organization_multitenancy`, and this file. A generated
 * uuid would have made the seed unable to name the row the migration created.
 *
 * Phase 4 replaces "default" with a real per-office subdomain (spec §4.10);
 * for now nothing resolves a tenant, so this row is simply where everything
 * lives.
 */
export const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Idempotent, and deliberately NOT authoritative over an existing row: an
 * operator who has renamed this Organization to their real brokerage name
 * keeps that name across every subsequent `npm run db:seed`. Only the id is
 * guaranteed.
 *
 * Runs FIRST — every seeded row below is tenant-scoped and its
 * `organizationId` foreign key needs this row to already exist.
 */
async function ensureDefaultOrganization(): Promise<void> {
  const existing = await prisma.organization.findUnique({
    where: { id: DEFAULT_ORGANIZATION_ID },
  });
  if (existing) {
    console.log(
      `Default organization already present (${existing.legalName}) — left unchanged.`,
    );
    return;
  }
  await prisma.organization.create({
    data: {
      id: DEFAULT_ORGANIZATION_ID,
      legalName: "Default Brokerage Office",
      // Arabic is this system's primary language — an office name that exists
      // only in Latin script shows up untranslated in the middle of an Arabic
      // page the moment the UI switches.
      legalNameAr: "مكتب الوساطة الافتراضي",
      subdomain: "default",
      // Brokerage office, not an insurance company. `OrganizationType` carries NO default:
      // neither kind is a safe fallback for the other, so every creator states which it is.
      type: "BROKERAGE_OFFICE",
      // Required for a brokerage office by the `Organization_broker_kind_matches_type`
      // CHECK. The compiler cannot ask for it — a nullable column is optional in
      // Prisma's CreateInput — so the database is what refuses its absence.
      brokerKind: "CORPORATE",
    },
  });
  console.log("Seeded the default organization.");
}

/**
 * MODULE 0 ITEM (j)'s GAP CLOSURE — the PROVIDER organization.
 *
 * ## In the SEED, never in a migration
 *
 * A migration that invents an organization is a migration that invents a tenant: it would arrive in
 * production with no decision behind it. This sits inside `SEED_SAMPLE_DATA` (`NODE_ENV !==
 * "production"`), the same gate the placeholder broker licence uses and for the same reason — a
 * provider organization appearing in production would hand somebody the cross-office dashboard
 * nobody asked to create.
 *
 * ## What it is allowed to hold, stated rather than implied
 *
 * ONE role, holding exactly ONE code: `provider.office-state.read`. No business permission, so every
 * business route answers 403 for this organization — a GRANT-level closure, not a schema-level one,
 * and the report says so. There is no structural refusal that stops a provider administrator
 * granting itself `customer.create`; what there is, is a provider organization that starts with
 * nothing but the dashboard.
 *
 * `brokerKind` is NULL, which `Organization_broker_kind_matches_type` requires for any type that is
 * not BROKERAGE_OFFICE — item (b) wrote that CHECK as the negation, so it covers PROVIDER unchanged.
 *
 * Idempotent: keyed on the fixed id, and the role on `(organizationId, name)`.
 */
export const PROVIDER_ORGANIZATION_ID = "00000000-0000-0000-0000-0000000000f0";

async function ensureProviderOrganization(): Promise<void> {
  const existing = await prisma.organization.findUnique({
    where: { id: PROVIDER_ORGANIZATION_ID },
  });
  if (!existing) {
    // A second PROVIDER row is refused by the partial unique `Organization_one_provider`, so this
    // also guards against a hand-created provider elsewhere: the create would fail loudly rather
    // than produce two.
    await prisma.organization.create({
      data: {
        id: PROVIDER_ORGANIZATION_ID,
        legalName: "IBMS Platform Operator",
        legalNameAr: "مُشغّل منصّة IBMS",
        subdomain: "provider",
        type: "PROVIDER",
        // NULL, required by the item (b) CHECK for every type that is not a brokerage office.
        brokerKind: null,
      },
    });
  }

  /*
   * MODULE 0-ب ITEM (b) — THE PROVIDER ADMINISTERS ITSELF, AND NOTHING ELSE.
   *
   * Item (j) gave this role one code. That left the provider organization unable to add a second
   * operator, change a role, or repair itself from inside the application — the same shape as an
   * office with no administrator, which `office-administrator.e2e-spec.ts` calls a defect in its
   * own failure message.
   *
   * WHAT BOUNDS IT TO ITS OWN ORGANIZATION IS TENANCY, NOT A NEW MECHANISM. `User`, `Role`,
   * `UserRoleAssignment` and `RolePermission` all carry `organizationId` and are therefore in the
   * DMMF-derived `TENANT_SCOPED_MODELS`, so every read and write the provider makes through these
   * codes is filtered to the provider organization before it reaches the database. A provider
   * operator cannot see, let alone change, an office's users or roles — and that is a property of
   * the extension plus RLS rather than of anything written here, which is why the e2e proves it by
   * ASKING FOR an office's role by id and getting a 404.
   *
   * WHAT IS DELIBERATELY ABSENT: every brokerage code. No policy, customer, commission,
   * collection, claim or employee capability. The count check below is what keeps that true.
   *
   * THE DECLARED GAP STAYS DECLARED: nothing structurally stops a provider administrator granting
   * their own role an office-scoped code — they hold `role.update` and the catalogue is global.
   * What bounds it is that the provider starts with exactly this set and a seed check that fails
   * if the set changes. That is a GRANT-level closure, not a schema-level one, and it is stated
   * here and in README § Known gaps rather than left for a reader to assume otherwise.
   */
  const PROVIDER_CODES = [
    // The capabilities the organization exists for.
    "provider.office-state.read",
    // Item (d) — registering a brokerage office. One of the two routes in this product that create
    // a tenant.
    "provider.office.register",
    // Item (e) — registering an insurance company. The other one.
    "provider.insurer.register",
    // Item (b) — self-administration. Its own users, its own roles, bounded by tenancy.
    "user.manage",
    "role.read",
    "role.create",
    "role.update",
    "role.deactivate",
    "permission.read",
  ] as const;

  const permissions = await prisma.permission.findMany({
    where: { code: { in: [...PROVIDER_CODES] } },
    select: { id: true, code: true },
  });
  if (permissions.length !== PROVIDER_CODES.length) {
    const found = new Set(permissions.map((x) => x.code));
    const missing = PROVIDER_CODES.filter((c) => !found.has(c));
    throw new Error(
      `${missing.join(", ")} is not in the permission catalogue, so the provider organization cannot be given the capabilities it needs. Seed the catalogue first.`,
    );
  }

  const role = await prisma.role.upsert({
    where: {
      organizationId_name: {
        organizationId: PROVIDER_ORGANIZATION_ID,
        name: "PLATFORM_OPERATOR",
      },
    },
    update: {},
    create: {
      organizationId: PROVIDER_ORGANIZATION_ID,
      name: "PLATFORM_OPERATOR",
      nameEn: "Platform operator",
      nameAr: "مُشغّل المنصّة",
      description:
        "Reads the cross-office provider dashboard. Holds no brokerage capability at all.",
      isSystem: true,
    },
  });

  const expectedCodes = [...PROVIDER_CODES].sort();

  /*
   * GRANT AND VERIFY IN ONE TRANSACTION, so a failing check UNDOES the grants rather than
   * reporting them.
   *
   * ## This is a repair, and the incident that produced it is worth keeping
   *
   * The first version granted in a loop and then checked. A plant swapping `customer.create` into
   * `PROVIDER_CODES` made the check fire exactly as designed — and the row was already written, so
   * the provider organization really held a brokerage capability in db-test afterwards. The guard
   * REPORTED the state it existed to prevent.
   *
   * That is the difference between a guard and a decoration restated at the level of a write: a
   * check after an unconditional write can only ever describe the damage. Inside a transaction the
   * throw rolls the grants back, so the only states that survive are "exactly the intended set" and
   * "nothing changed".
   *
   * ## MEASURED, not assumed: this role holds EXACTLY these codes and no others
   *
   * The check this replaces demanded exactly ONE and said in its own message: "if that is changing,
   * change this check deliberately." This is that deliberate change — item (b) widened the set from
   * the dashboard alone to the dashboard plus self-administration.
   *
   * It compares the SET and not the COUNT, and that distinction was demonstrated rather than
   * argued: with the check reduced to a count, a swapped-in `customer.create` was accepted and
   * granted. A count of seven is satisfied by a set containing a brokerage capability.
   */
  await prisma.$transaction(async (tx) => {
    for (const permission of permissions) {
      const alreadyGranted = await tx.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: permission.id },
      });
      if (!alreadyGranted) {
        await tx.rolePermission.create({
          data: {
            organizationId: PROVIDER_ORGANIZATION_ID,
            roleId: role.id,
            permissionId: permission.id,
          },
        });
      }
    }

    const grantedCodes = (
      await tx.rolePermission.findMany({
        where: { roleId: role.id },
        select: { permission: { select: { code: true } } },
      })
    )
      .map((g) => g.permission.code)
      .sort();
    if (grantedCodes.join(",") !== expectedCodes.join(",")) {
      throw new Error(
        `PLATFORM_OPERATOR holds [${grantedCodes.join(", ")}]; it must hold exactly [${expectedCodes.join(", ")}]. The provider administers ITSELF and reads the dashboard — it holds no brokerage capability at all. If that is changing, change this list deliberately. (No grant was written: this check runs inside the same transaction.)`,
      );
    }
  });

  console.log(
    `Seeded the PROVIDER organization and its PLATFORM_OPERATOR role (${PROVIDER_CODES.length} permissions: ${expectedCodes.join(", ")}).`,
  );
}

/**
 * MODULE 0-ب ITEM (a) — the provider's own sign-in, with NO PASSWORD ANYWHERE.
 *
 * Item (j) created the provider organization and its role and stopped there, so the dashboard had
 * no hand-walkable path at all: nobody could sign in as the operator, and nobody in that
 * organization holds `user.manage`, so no account could be provisioned from inside the application
 * either. This closes that.
 *
 * ## THE PASSWORD DOES NOT EXIST — it is not withheld, it is never created
 *
 * `User.passwordHash` is NOT NULL, so the row needs *something*. It gets the hash of 32 random
 * bytes that are discarded in the same expression: nothing can present the plaintext because
 * nothing ever held it. Not in this file, not in the environment, not in the seed's output.
 *
 * That is stronger than a generated-and-printed password, and it is the owner's instruction: the
 * provider is never handed a password, and sets their own.
 *
 * ## HOW THE PROVIDER ACTUALLY GETS IN, through the EXISTING flow
 *
 * `POST /auth/forgot-password` -> the emailed link -> `POST /auth/reset-password` -> sign in ->
 * enrol TOTP at /settings/security.
 *
 * Measured rather than assumed, because the brief asked for the measurement if the existing path
 * could NOT be reused:
 *
 *   * `forgotPassword` resolves the account with `findByEmailAcrossOrganizations` inside
 *     `runUnscoped("auth-bootstrap")` and then adopts the user's own organization, so a PROVIDER
 *     user is found exactly like any office user — tenancy is no obstacle.
 *   * `resetPassword` looks the token up unscoped too.
 *   * MFA is already FORCED, by nothing more than the schema: `Role.requiresMfaAlways` defaults to
 *     `true` (Phase 2 made both MFA attributes default to the STRICT value), and the
 *     PLATFORM_OPERATOR role carries it.
 *   * `requiresHardwareToken` also defaults true and does NOT block: `mfaPolicySatisfied` returns
 *     `user.mfaEnabled && !requiresHardwareToken`, and its own comment says the flag is surfaced
 *     as a banner because WebAuthn is not implemented. So TOTP enrolment is reachable.
 *
 * So no second enrolment path is built, and none is needed.
 *
 * ## WHY NO RESET LINK IS PRINTED HERE
 *
 * Generating one in the seed would put a live credential-equivalent in script output and in every
 * terminal scrollback that ever ran it, to save one click. The account exists; the owner uses the
 * ordinary "forgot password" path, which is also the path they will use the next time they need it.
 *
 * ## THE ADDRESS IS CONFIGURABLE AND DEFAULTS TO A NON-PERSONAL ONE
 *
 * `PROVIDER_ADMIN_EMAIL` overrides it. The default is deliberately not a real person's address: a
 * personal email committed to a seed file is in git history for good, and this file is public.
 *
 * ## INSIDE `SEED_SAMPLE_DATA`, like the organization it belongs to
 *
 * A seeded operator account on a production database is a credential nobody asked for. The
 * migration that created the type says the same thing in its own words: the dashboard is
 * unreachable until somebody deliberately creates the operator.
 */
async function ensureProviderAdminUser(): Promise<void> {
  const email = process.env.PROVIDER_ADMIN_EMAIL ?? "operator@ibms.local";

  const existing = await prisma.user.findUnique({
    where: {
      organizationId_email: {
        organizationId: PROVIDER_ORGANIZATION_ID,
        email,
      },
    },
  });

  // IDEMPOTENT, and the branch matters: re-running the seed must never reset a password the owner
  // has already chosen. An upsert with a fresh random hash in its `update` would silently lock
  // them out on every re-seed.
  if (existing) {
    console.log(
      `Provider operator ${email} already exists — password untouched.`,
    );
    return;
  }

  // 32 random bytes, hashed, and the plaintext is discarded in the same expression. There is no
  // variable holding it and no way to recover it: the account is unusable until the owner sets
  // their own password through the reset flow.
  const unusablePassword = randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(unusablePassword, 12);

  const role = await prisma.role.findUnique({
    where: {
      organizationId_name: {
        organizationId: PROVIDER_ORGANIZATION_ID,
        name: "PLATFORM_OPERATOR",
      },
    },
  });
  if (!role) {
    throw new Error(
      "PLATFORM_OPERATOR does not exist, so the provider operator cannot be given the one role it needs. ensureProviderOrganization() must run first.",
    );
  }

  const user = await prisma.user.create({
    data: {
      organizationId: PROVIDER_ORGANIZATION_ID,
      email,
      fullName: "Platform Operator",
      passwordHash,
      // FALSE on purpose. `mustChangePassword` is for an administrator who HANDED somebody a
      // password and wants it changed on first use. Nobody was handed anything here — the account
      // has no usable password at all, so the forced-change prompt would be a second gate in front
      // of a door that is already locked.
      mustChangePassword: false,
      languagePreference: "AR",
    },
  });

  await prisma.userRoleAssignment.create({
    data: {
      organizationId: PROVIDER_ORGANIZATION_ID,
      userId: user.id,
      roleId: role.id,
    },
  });

  console.log(
    `Seeded the provider operator ${email} with NO usable password. ` +
      `Sign in by requesting a password reset for that address — nothing here knows a password, ` +
      `and MFA is forced by the PLATFORM_OPERATOR role.`,
  );
}

async function ensureSystemAccount(): Promise<void> {
  // `User.email` is unique per organization now, not globally (spec §3.2), so
  // the upsert keys on the compound constraint rather than on email alone.
  await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        email: SYSTEM_ACCOUNT_EMAIL,
      },
    },
    update: {},
    create: {
      organizationId: DEFAULT_ORGANIZATION_ID,
      fullName: "IBMS System (scheduled jobs)",
      email: SYSTEM_ACCOUNT_EMAIL,
      passwordHash: "disabled-service-account-no-password-login",
      isActive: false,
    },
  });
  console.log("Seeded system service account.");
}

/**
 * Backlog A.2 — the BOOTSTRAP ADMINISTRATOR.
 *
 * `ensureSampleUsers()` below seats one login-capable account per role, but
 * it is gated on `NODE_ENV !== 'production'`. A production seed therefore
 * produced a database with the full 11-role catalogue and permission grid and
 * NOT ONE user able to use it — and since role assignment is itself gated by
 * `user.manage` (SYSTEM_SECURITY_ADMINISTRATOR only), there was no way in.
 *
 * This closes that: when `BOOTSTRAP_ADMIN_EMAIL` and
 * `BOOTSTRAP_ADMIN_PASSWORD` are both set, seed a single
 * SYSTEM_SECURITY_ADMINISTRATOR who can then provision everyone else through
 * `POST /admin/users`. Deliberately opt-in via environment rather than a
 * hardcoded default account — a well-known admin credential shipped in a
 * repo is exactly the finding `sensitive-data-handling.md` exists to prevent.
 *
 * Idempotent: an existing account keeps its current password (this never
 * resets a live credential), and its existing role grant is left exactly as
 * it is. A grant that has been REVOKED is NOT restored — the seed throws
 * instead, because re-granting it would silently undo an offboarding on the
 * next routine deploy. See the check below.
 *
 * NOTE: the account is created with `mfaEnabled` at its schema default. A
 * break-glass administrator should enrol MFA immediately after first login.
 */
async function ensureBootstrapAdmin(
  roleIdByName: Map<string, string>,
): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) {
    if (!SEED_SAMPLE_DATA) {
      console.warn(
        "No BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD set and sample users are skipped outside dev — this database will have NO user able to sign in. Set both and re-run `npm run db:seed`.",
      );
    }
    return;
  }

  const violations = validatePasswordPolicy(password);
  if (violations.length > 0) {
    throw new Error(
      `BOOTSTRAP_ADMIN_PASSWORD does not satisfy the Part 10.1 password policy: ${violations.join("; ")}`,
    );
  }

  const roleId = roleIdByName.get(RoleName.SYSTEM_SECURITY_ADMINISTRATOR);
  if (!roleId) {
    throw new Error(
      "SYSTEM_SECURITY_ADMINISTRATOR role was not seeded — is it missing from seed-data/roles.ts?",
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // Per-organization uniqueness (spec §3.2) — see ensureSystemAccount().
  const existing = await prisma.user.findUnique({
    where: {
      organizationId_email: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        email,
      },
    },
  });
  const user = existing
    ? existing
    : await prisma.user.create({
        data: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          fullName: "IBMS Bootstrap Administrator",
          email,
          passwordHash,
          passwordUpdatedAt: new Date(),
        },
      });

  // The grant is created ONLY for a new account, and a REVOKED grant on an
  // existing one is refused loudly rather than quietly restored.
  //
  // This used to `upsert(..., update: { revokedAt: null })` on every seed run.
  // BOOTSTRAP_ADMIN_EMAIL/PASSWORD normally stay set in the deployment
  // environment and `npm run db:seed` is a routine step alongside migrations,
  // so an operator who offboarded the shared break-glass account by revoking
  // its SYSTEM_SECURITY_ADMINISTRATOR grant got it SILENTLY re-granted on the
  // next deploy — with no AuditLogEntry, because the seed writes Prisma
  // directly. A revocation that undoes itself is not a revocation.
  // Newest grant first: with the partial UNIQUE a (user, role) pair may now
  // carry a history of revoked rows alongside at most one active one.
  const grant = await prisma.userRoleAssignment.findFirst({
    where: { userId: user.id, roleId },
    orderBy: { grantedAt: "desc" },
  });

  if (grant?.revokedAt) {
    throw new Error(
      `Bootstrap administrator ${email} exists but its SYSTEM_SECURITY_ADMINISTRATOR grant was REVOKED on ${grant.revokedAt.toISOString()}. Refusing to silently restore it — that would undo a deliberate offboarding. Either unset BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD, or re-grant the role deliberately through POST /admin/users/:id/roles so the action is audited.`,
    );
  }

  if (!grant) {
    await prisma.userRoleAssignment.create({
      data: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        userId: user.id,
        roleId,
      },
    });
  }

  console.log(
    existing
      ? `Bootstrap administrator ${email} already exists — password left unchanged, existing role grant untouched.`
      : `Seeded bootstrap administrator ${email}.`,
  );
}

/**
 * Part 6.2 (M06) — seeds the retention-schedule row(s). `recordCategory` is
 * now a real unique constraint (backlog Part D §5.1's Retention & Disposal
 * build) — a genuine Prisma `upsert`, not the hand-rolled findFirst/
 * create-or-update this used before that constraint existed.
 */
async function ensureRetentionSchedule(): Promise<void> {
  for (const item of RETENTION_SCHEDULE) {
    await prisma.retentionScheduleItem.upsert({
      where: {
        organizationId_recordCategory: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          recordCategory: item.recordCategory,
        },
      },
      update: {
        retentionPeriodMonths: item.retentionPeriodMonths,
        legalBasis: item.legalBasis,
      },
      create: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        recordCategory: item.recordCategory,
        retentionPeriodMonths: item.retentionPeriodMonths,
        legalBasis: item.legalBasis,
      },
    });
  }
  console.log(
    `Seeded ${RETENTION_SCHEDULE.length} retention schedule item(s).`,
  );
}

/**
 * Part B / Part 11.2 — bilingual document templates (quotation comparison,
 * proposal forms, ...). `DocumentTemplate` has no unique constraint on
 * `templateType` (a future version-history use might want more than one row
 * per type), so this upserts by hand via findFirst, same as
 * `ensureRetentionSchedule()`.
 */
async function ensureDocumentTemplates(): Promise<void> {
  for (const template of DOCUMENT_TEMPLATES) {
    const existing = await prisma.documentTemplate.findFirst({
      where: { templateType: template.templateType },
    });
    if (existing) {
      await prisma.documentTemplate.update({
        where: { id: existing.id },
        data: {
          nameEn: template.nameEn,
          nameAr: template.nameAr,
          bodyEn: template.bodyEn,
          bodyAr: template.bodyAr,
        },
      });
    } else {
      await prisma.documentTemplate.create({
        data: { organizationId: DEFAULT_ORGANIZATION_ID, ...template },
      });
    }
  }
  console.log(`Seeded ${DOCUMENT_TEMPLATES.length} document template(s).`);
}

/**
 * Part B — "sample insurers". Dev/demo-only fictional insurer master data
 * (see seed-data/insurers.ts). Skipped entirely once created — `Insurer`
 * has no unique key to upsert nested `products`/`slaAgreements` against
 * without either duplicating them or hand-rolling per-child reconciliation,
 * neither of which is worth it for sample data.
 *
 * Part I §5 (Phase 3 step 10): the company's IDENTITY is now global
 * (`InsurerMaster`, shared by every office) and only this office's
 * relationship with it is tenant-scoped. The master is upserted on its unique
 * legal name — a second office seeded later must attach to the SAME master,
 * not mint a rival copy of the same company, which is the whole point of the
 * split.
 */
async function ensureSampleInsurers(): Promise<void> {
  let created = 0;
  for (const insurer of SAMPLE_INSURERS) {
    const master = await prisma.insurerMaster.upsert({
      where: { legalName: insurer.name },
      update: {},
      create: {
        legalName: insurer.name,
        legalNameAr: insurer.nameAr,
        linesOffered: [
          ...new Set(insurer.products.map((p) => p.insuranceLine)),
        ].sort(),
      },
    });
    const existing = await prisma.insurer.findFirst({
      where: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        insurerMasterId: master.id,
      },
    });
    if (existing) {
      /*
       * MODULE 0-ب ITEM (e) — THE ONE FIELD THIS SEED UPDATES ON AN EXISTING ROW, and why.
       *
       * `Insurer_rating_carries_its_date` is `NOT VALID` because the three sample insurers already
       * carried a rating when the date column was added. Leaving them that way ships a declared rule
       * with three standing exceptions; a migration backfilling a date would invent an unsourceable
       * fact. Giving a SAMPLE row a sample date invents nothing — its rating says "(sample rating)" in
       * its own value — so the repair belongs here, and the `VALIDATE CONSTRAINT` migration that
       * follows can then hold for every row.
       *
       * Scoped to the one field deliberately: this branch must not become a general "refresh the
       * sample insurers" path, which would overwrite whatever an office has since recorded about a
       * counterparty it genuinely uses.
       */
      if (existing.financialStrengthRatingAsOf === null) {
        await prisma.insurer.update({
          where: { id: existing.id },
          data: {
            financialStrengthRating: insurer.financialStrengthRating,
            financialStrengthRatingAsOf: new Date(
              `${insurer.financialStrengthRatingAsOf}T00:00:00.000Z`,
            ),
          },
        });
      }
      continue;
    }
    await prisma.insurer.create({
      data: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        insurerMasterId: master.id,
        // Part I §10.2 — three distinct contacts, not one generic one. The
        // sample data carries an address for each.
        rfqContactEmail: insurer.contactEmail,
        rfqContactPhone: insurer.contactPhone,
        claimsContactEmail: insurer.claimsContact,
        underwriterContact: insurer.underwriterContact,
        creditTermsDays: insurer.creditTermsDays,
        financialStrengthRating: insurer.financialStrengthRating,
        // THE PAIR, because `Insurer_rating_carries_its_date` refuses either half alone. Writing the
        // rating without it here would make a fresh seed fail on its own constraint — and the field
        // is OPTIONAL in Prisma's input type, so the compiler cannot ask for it. Caught by reading
        // the create path after patching the update path, not by a failing typecheck.
        financialStrengthRatingAsOf: new Date(
          `${insurer.financialStrengthRatingAsOf}T00:00:00.000Z`,
        ),
        // InsurerProduct and InsurerSlaAgreement are tenant-scoped in their
        // own right (spec §3.2 — so RLS can enforce them independently in
        // Phase 2, not only transitively through the parent Insurer).
        products: {
          create: insurer.products.map((product) => ({
            organizationId: DEFAULT_ORGANIZATION_ID,
            ...product,
          })),
        },
        slaAgreements: {
          create: insurer.slaAgreements.map((sla) => ({
            organizationId: DEFAULT_ORGANIZATION_ID,
            ...sla,
          })),
        },
      },
    });
    created += 1;
  }
  console.log(
    `Seeded ${created} sample insurer(s) (${SAMPLE_INSURERS.length - created} already present).`,
  );
}

/**
 * Part B — "a sample user per role". Dev/demo-only login-capable accounts,
 * one per `RoleName` (see seed-data/sample-users.ts). Requires
 * `roleIdByName` from the roles seeded earlier in `main()`.
 */
async function ensureSampleUsers(
  roleIdByName: Map<string, string>,
): Promise<void> {
  const passwordHash = await bcrypt.hash(SAMPLE_USER_PASSWORD, 12);

  for (const sampleUser of SAMPLE_USERS) {
    const user = await prisma.user.upsert({
      where: {
        organizationId_email: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          email: sampleUser.email,
        },
      },
      update: { fullName: sampleUser.fullName },
      create: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        fullName: sampleUser.fullName,
        email: sampleUser.email,
        passwordHash,
      },
    });

    const roleId = roleIdByName.get(sampleUser.role);
    if (!roleId) {
      throw new Error(
        `Sample user "${sampleUser.email}" references role "${sampleUser.role}", which was not seeded — is it missing from seed-data/roles.ts?`,
      );
    }
    const activeGrant = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId, revokedAt: null },
    });
    if (!activeGrant) {
      await prisma.userRoleAssignment.create({
        data: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          userId: user.id,
          roleId,
        },
      });
    }
  }
  console.log(`Seeded ${SAMPLE_USERS.length} sample user(s), one per role.`);
}

/**
 * Part B — "Seed data: the 11 roles + the full permission grid". Idempotent
 * (upsert-based) so it's safe to re-run in CI/dev without duplicating rows
 * or clobbering roles/permissions added by hand since the last run.
 */
/**
 * Seeds the configurable SLA policies that replace the hard-coded
 * `SLA_REGISTRY` as the runtime source of every deadline.
 *
 * Seeded ACTIVE, because the values are the ones the system has been using all
 * along — this is a migration of where they LIVE, not a change to what they
 * are. A deployment that seeds and changes nothing behaves exactly as before.
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE. An existing policy is left completely
 * untouched: once Compliance has edited a duration or re-cited a source, a
 * later `npm run db:seed` (a routine step alongside migrations) must not
 * silently revert it. That is the same failure the bootstrap-administrator
 * grant had — a change that undoes itself on the next deploy is not a change.
 * Only genuinely NEW policy codes are inserted.
 *
 * The five entries whose registry citation reads "DRAFT, UNSOURCED" seed as
 * INTERNAL_POLICY, and three business-process targets as OPERATIONAL. Only
 * figures traceable to a governing document section seed as REGULATORY — and
 * the DB CHECK refuses that classification without a named instrument, so this
 * cannot drift into over-claiming.
 */
async function ensureSlaPolicies(): Promise<void> {
  // The scheduled-jobs service account owns the seeded baseline — these
  // policies were not authored by any human operator, and attributing them to
  // one would be a small lie in an audit-relevant field.
  const systemUser = await prisma.user.findUnique({
    where: {
      organizationId_email: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        email: SYSTEM_ACCOUNT_EMAIL,
      },
    },
    select: { id: true },
  });
  if (!systemUser) {
    throw new Error(
      "System service account missing — ensureSystemAccount() must run before ensureSlaPolicies().",
    );
  }

  const existing = new Set(
    (await prisma.slaPolicy.findMany({ select: { policyCode: true } })).map(
      (p) => p.policyCode,
    ),
  );

  let created = 0;
  for (const seed of SLA_POLICY_SEEDS) {
    if (existing.has(seed.policyCode)) continue;
    await prisma.slaPolicy.create({
      data: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        policyCode: seed.policyCode,
        policyName: seed.policyName,
        processType: seed.processType,
        description: seed.description,
        durationValue: seed.durationValue,
        durationUnit: seed.durationUnit,
        calendarType: seed.calendarType,
        sourceType: seed.sourceType,
        sourceReference: seed.sourceReference,
        sourceDocument: seed.sourceDocument,
        sourceSection: seed.sourceSection,
        status: "ACTIVE",
        createdByUserId: systemUser.id,
        escalations: {
          create: seed.escalations.map((e) => ({
            // Tenant-scoped in its own right, so RLS can enforce it
            // independently in Phase 2 — not only through the parent policy.
            organizationId: DEFAULT_ORGANIZATION_ID,
            stageOrder: e.stageOrder,
            offsetValue: e.offsetValue,
            offsetUnit: e.offsetUnit,
            escalateTo: e.escalateTo,
          })),
        },
      },
    });
    created += 1;
  }

  const byType = SLA_POLICY_SEEDS.reduce<Record<string, number>>((acc, s) => {
    acc[s.sourceType] = (acc[s.sourceType] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Seeded ${created} new SLA policy/policies (${SLA_POLICY_SEEDS.length} defined, ${existing.size} already present and left untouched). ` +
      `Provenance: ${Object.entries(byType)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ")}.`,
  );
}

async function main() {
  // MUST be first: every seeded row below carries an organizationId foreign
  // key pointing at this row.
  await ensureDefaultOrganization();
  await ensureSystemAccount();
  await ensureRetentionSchedule();
  await ensureDocumentTemplates();
  await ensureSlaPolicies();

  // Roles are OFFICE-SCOPED now, so every one of these belongs to the default
  // organization and is keyed on `(organizationId, name)` rather than a name
  // that used to be globally unique. This script runs on the RAW client, which
  // nothing tenant-scopes, so the Organization is named explicitly.
  //
  // The legacy eleven are still seeded because they are the DEFAULT office's own
  // roles — the same rows a migrated database already has, so a fresh seed and a
  // migrated database end up indistinguishable. The seed must not start removing
  // them, for the same reason it must not prune grants: people hold them.
  //
  // `OFFICE_ADMINISTRATOR` joins them here, and this is where the rule for a NEW
  // office differs. The approved design gives a brand-new Organization the
  // administrator role and NOTHING ELSE — no business roles at all, its
  // administrator builds whatever the office needs. There is no application path
  // that creates an Organization (verified: the only two writers are this file
  // and `apps/api/scripts/seed-demo.script.ts`), so the rule is encoded as
  // `ensureOfficeAdministrator()` below, called by both writers, plus a test
  // asserting that any Organization without an administrator role is a defect.
  // When org provisioning does land it therefore cannot ship without one.
  for (const role of [...ROLES, OFFICE_ADMINISTRATOR_ROLE]) {
    await prisma.role.upsert({
      where: {
        organizationId_name: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          name: role.name,
        },
      },
      update: {
        description: role.description,
        nameEn: role.nameEn,
        nameAr: role.nameAr,
        // Written on BOTH paths. `Role.requiresMfaAlways`/
        // `requiresHardwareToken` default to the strict value, so a create that
        // omitted them would seed eleven roles that all demand MFA on every
        // login — and an update that omitted them would leave a database
        // migrated before this seed ran disagreeing with a freshly seeded one.
        requiresMfaAlways: role.requiresMfaAlways,
        requiresHardwareToken: role.requiresHardwareToken,
        // Written on the update path too: a database migrated before this seed
        // ran must end up agreeing with a freshly seeded one, and `isSystem`
        // defaults to FALSE on the column (an office's own roles are the common
        // case), so omitting it here would leave the legacy eleven editable on a
        // seeded-from-empty database.
        isSystem: SEEDED_ROLES_ARE_SYSTEM,
      },
      create: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        name: role.name,
        nameEn: role.nameEn,
        nameAr: role.nameAr,
        description: role.description,
        requiresMfaAlways: role.requiresMfaAlways,
        requiresHardwareToken: role.requiresHardwareToken,
        isSystem: SEEDED_ROLES_ARE_SYSTEM,
      },
    });
  }
  console.log(
    `Seeded ${ROLES.length + 1} roles for the default organization (the legacy ${ROLES.length} plus ${OFFICE_ADMINISTRATOR_ROLE.name}).`,
  );

  // Scoped to the default organization for the same reason: on a database that
  // already holds a second office, an unfiltered read would return two roles
  // sharing a name and the Map would silently keep whichever came last.
  const roleIdByName = new Map(
    (
      await prisma.role.findMany({
        where: { organizationId: DEFAULT_ORGANIZATION_ID },
      })
    ).map((r) => [r.name, r.id]),
  );

  for (const permission of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        module: permission.module,
        description: permission.description,
        // Module 0 item (j). On the UPDATE branch too, deliberately: a code whose scope is widened
        // or narrowed in the catalogue must take effect on a re-seed, and a field only written on
        // CREATE is a field that silently keeps its first value forever.
        scope: permission.scope ?? "OFFICE",
      },
      create: {
        code: permission.code,
        module: permission.module,
        description: permission.description,
        scope: permission.scope ?? "OFFICE",
      },
    });

    for (const roleName of permission.roles) {
      const roleId = roleIdByName.get(roleName);
      if (!roleId) {
        throw new Error(
          `Permission "${permission.code}" references role "${roleName}", which was not seeded — is it missing from seed-data/roles.ts?`,
        );
      }
      // `organizationId` named explicitly: `RolePermission` is tenant-scoped
      // now, and on the raw client the column's default
      // (`current_setting('app.current_org_id', true)`) is NULL, which the
      // composite FK to `Role(id, organizationId)` rejects rather than
      // accepting an unattributed grant. Every `roleId` here came from
      // `roleIdByName`, which is scoped to this same Organization, so the pair
      // always agrees.
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: perm.id } },
        update: {},
        create: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          roleId,
          permissionId: perm.id,
        },
      });
    }
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);

  // The standard insurance-line vocabulary. GLOBAL — no Organization column, and
  // this is the ONLY writer of the table anywhere: no service, endpoint or
  // repository writes it, which is what keeps "no code has an effect outside the
  // granting office" true without copying 32 rows into every office.
  //
  // Upserted on `code`, never on the uuid: each database generates its own ids, so a
  // re-seed has to recognise a line by the one value that is stable across all of
  // them. `displayOrder` comes from the array index, so reordering the seed file
  // reorders every picker and nothing else.
  for (const [index, line] of INSURANCE_LINES.entries()) {
    await prisma.insuranceLine.upsert({
      where: { code: line.code },
      update: {
        nameEn: line.nameEn,
        nameAr: line.nameAr,
        category: line.category,
        displayOrder: index,
      },
      create: {
        code: line.code,
        nameEn: line.nameEn,
        nameAr: line.nameAr,
        category: line.category,
        displayOrder: index,
      },
    });
  }
  console.log(`Seeded ${INSURANCE_LINES.length} standard insurance lines.`);

  // MODULE 0-ب ITEM (c) — the eight provider-maintained reference tables.
  //
  // Same upsert shape as the insurance lines above and for the same reasons: keyed on `code`
  // because each database generates its own uuids, and `displayOrder` taken from the array index
  // so reordering a seed list reorders every picker and nothing else.
  //
  // PLATFORM-SCOPED and therefore seeded OUTSIDE `SEED_SAMPLE_DATA`: an office picks its city and
  // its bank from these on a production database too, and a catalogue that only existed in
  // development would make the registration form unusable where it matters.
  for (const [table, rows] of REFERENCE_TABLES) {
    for (const [index, ref] of rows.entries()) {
      await (
        prisma[table] as {
          upsert: (args: unknown) => Promise<unknown>;
        }
      ).upsert({
        where: { code: ref.code },
        update: {
          nameEn: ref.nameEn,
          nameAr: ref.nameAr,
          displayOrder: index,
          // Written on BOTH paths. On `update` because a re-seed must carry a corrected description
          // through; on `create` because `LegalForm` and `BusinessModel` carry a CHECK requiring
          // one, so a from-empty seed that omitted it would be REFUSED by the database rather than
          // quietly producing rows with no explanation.
          descriptionAr: ref.descriptionAr ?? null,
        },
        create: {
          code: ref.code,
          nameEn: ref.nameEn,
          nameAr: ref.nameAr,
          displayOrder: index,
          descriptionAr: ref.descriptionAr ?? null,
        },
      });
    }
    console.log(`Seeded ${rows.length} ${table} reference row(s).`);
  }

  if (SEED_SAMPLE_DATA) {
    // Module 0 item (j)'s gap closure. BEFORE the sample users, so a future provider user has an
    // organization and a role to be attached to.
    await ensureProviderOrganization();
    // Item (a) — immediately after, because it needs that organization and its role.
    await ensureProviderAdminUser();
    await ensureSampleInsurers();
    await ensureSampleUsers(roleIdByName);
    // AFTER the sample users: the certificate is attributed to a real user of the office, and in a
    // fresh dev database the sample users are the only ones that exist.
    await ensureBrokerLicenseTerms();
  } else {
    console.log(
      "NODE_ENV=production — skipping sample insurers/users and the placeholder broker licence.",
    );
  }

  // Every office, every environment: a business-day deadline counted against an
  // empty calendar lands earlier than the law requires, and the error runs against
  // the brokerage (IMPROVEMENTS § 1.57).
  await ensureJordanFixedHolidays();

  // Runs in EVERY environment: in dev it is an optional extra alongside the
  // sample users, in production it is the only way anyone gets in at all.
  await ensureBootstrapAdmin(roleIdByName);
}

/**
 * Jordan's four FIXED-DATE public holidays, for every office, for this year and next.
 *
 * Source: Jordan's Ministry of Foreign Affairs,
 * https://www.mfa.gov.jo/content/public-holidays.
 *
 * ## WHY ONLY FOUR, AND WHY ONLY TWO YEARS
 *
 * Jordan also observes the Islamic New Year, the Prophet's Birthday, Eid al-Fitr (four
 * days) and Eid al-Adha (five days) — **and those are deliberately not seeded and must
 * never be computed.** In Jordan the actual date is fixed by official announcement and
 * can differ by a day from any calendar conversion, so a generated Hijri calendar would
 * be wrong most years and nobody would know why: every business-day deadline would
 * simply be off, and the error would look like arithmetic rather than a wrong input. An
 * office enters them from the announcement, and `/sla-policies` tells it which ones a
 * year is still missing.
 *
 * The fixed four are a different matter: 1 January is 1 January, so generating them is
 * not a conversion and carries no risk.
 *
 * TWO YEARS, not ten: a horizon further out is a guess about how long this seed's output
 * stays untouched, and the screen fills any year on demand. This year and next means an
 * office is never looking at an empty calendar for the year it is working in.
 *
 * Idempotent per (office, date) — the table carries a partial unique on an
 * all-calendars entry per date, so a re-run must skip rather than collide.
 */
async function ensureJordanFixedHolidays(): Promise<void> {
  // Month is 1-based here and 0-based in `Date.UTC`, which is exactly the kind of
  // off-by-one that silently moves a holiday; the conversion happens once, below.
  const FIXED: { month: number; day: number; name: string }[] = [
    { month: 1, day: 1, name: "New Year's Day" },
    { month: 5, day: 1, name: "Labour Day" },
    { month: 5, day: 25, name: "Independence Day" },
    { month: 12, day: 25, name: "Christmas" },
  ];

  const organizations = await prisma.organization.findMany({
    select: { id: true },
  });
  const thisYear = new Date().getUTCFullYear();
  let created = 0;

  for (const org of organizations) {
    for (const year of [thisYear, thisYear + 1]) {
      for (const h of FIXED) {
        const observedOn = new Date(Date.UTC(year, h.month - 1, h.day));
        // An all-calendars entry is `calendarType: null`, and Postgres treats NULLs as
        // distinct — so `findFirst` rather than an upsert on a unique that a null key
        // cannot address.
        const existing = await prisma.slaHoliday.findFirst({
          where: { organizationId: org.id, observedOn, calendarType: null },
          select: { id: true },
        });
        if (existing) continue;
        await prisma.slaHoliday.create({
          data: {
            organizationId: org.id,
            observedOn,
            name: h.name,
            calendarType: null,
          },
        });
        created += 1;
      }
    }
  }

  console.log(
    `Seeded ${created} fixed-date Jordanian public holiday(s) across ${organizations.length} office(s) for ${thisYear} and ${thisYear + 1}. ` +
      "The Islamic occasions are NOT seeded — they are set by official announcement and are entered per year.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * A CURRENT LICENCE TERM for every brokerage office that holds none — Module 0 item (c).
 *
 * ## Why the seed has to do this at all
 *
 * Item (c) made the absence of a licence BLOCK new business: practising with none on record is a
 * ground for administrative sanction (CBJ Instructions No. 9 of 2026, art. 21/a/9). Before that,
 * absence passed, which is what let dozens of policy/endorsement/claim/finance specs place a Policy
 * without ever thinking about a licence. Those specs are not wrong — the gate was — so the data
 * they run against now provides what the gate requires.
 *
 * ## DEV AND TEST ONLY, and this gate is load-bearing rather than tidy
 *
 * It sits inside `SEED_SAMPLE_DATA` (`NODE_ENV !== "production"`). A placeholder licence in a
 * production database would hand an office the one thing the new gate exists to withhold, and the
 * gate would then report every unlicensed office as licensed. That is a worse failure than the one
 * item (c) fixed, because it would look like compliance.
 *
 * ## EVERY brokerage office, not the first one
 *
 * Seeding only the default office would reproduce exactly the defect item (c) removed — one licence
 * for the platform — and would hide it from every walkthrough, because the second office would fail
 * to place business for a reason nobody would connect to the seed.
 *
 * The licence number says SEED in it on purpose. Nobody should be able to mistake this for a real
 * CBJ number, and the certificate document says the same in its own filename.
 *
 * Idempotent: an office that already holds a term is skipped, so a re-run never appends a second.
 */
async function ensureBrokerLicenseTerms(): Promise<void> {
  const offices = await prisma.organization.findMany({
    where: { type: "BROKERAGE_OFFICE" },
    select: { id: true, subdomain: true },
    orderBy: { subdomain: "asc" },
  });

  // Three calendar years ending 31 December (art. 10/b), issued at the start of this year. Derived
  // from the current year rather than pinned, so a seed run in 2030 does not produce an expired
  // licence — which would block new business just as thoroughly as no licence at all.
  const year = new Date().getUTCFullYear();
  const issuedAt = new Date(Date.UTC(year, 0, 1));
  const expiresAt = new Date(Date.UTC(year + 2, 11, 31));

  let created = 0;
  let skipped = 0;
  for (const office of offices) {
    const existing = await prisma.brokerLicense.count({
      where: { organizationId: office.id },
    });
    if (existing > 0) {
      skipped += 1;
      continue;
    }

    // `Document.uploadedByUserId` is NOT NULL and no real uploader exists for seeded data. The
    // office's earliest user is a real row rather than an invented id; it is not a claim that this
    // person filed anything, which is why the filename says the document is a placeholder.
    const uploader = await prisma.user.findFirst({
      where: { organizationId: office.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!uploader) {
      console.log(
        `  ${office.subdomain}: no user to attribute a certificate to — skipping its licence.`,
      );
      continue;
    }

    // Both rows or neither: a Document with no term pointing at it is an orphaned certificate in
    // the office's records, which is the same reasoning as the repository's createTerm.
    await prisma.$transaction(async (tx) => {
      const certificate = await tx.document.create({
        data: {
          organizationId: office.id,
          category: "BROKER_LICENSE_CERTIFICATE",
          classification: "INTERNAL",
          fileName:
            "seeded-placeholder-licence-certificate--not-a-real-cbj-document.pdf",
          storageRef: `seed:placeholder-licence-certificate:${office.subdomain}`,
          uploadedByUserId: uploader.id,
        },
      });
      await tx.brokerLicense.create({
        data: {
          organizationId: office.id,
          licenseNumber: `CBJ-SEED-${office.subdomain.toUpperCase()}`,
          scopeOfAuthorization:
            "Seeded placeholder — general insurance brokerage",
          issuedAt,
          expiresAt,
          status: "active",
          certificateDocumentId: certificate.id,
        },
      });
    });
    created += 1;
  }

  console.log(
    `Seeded ${created} placeholder broker licence term(s) across ${offices.length} brokerage office(s) (${skipped} already held one), each expiring ${expiresAt.toISOString().slice(0, 10)}.`,
  );
}
