import { PrismaClient, RoleName } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { ROLES } from "./seed-data/roles";
import { PERMISSIONS } from "./seed-data/permissions";
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

async function ensureSystemAccount(): Promise<void> {
  await prisma.user.upsert({
    where: { email: SYSTEM_ACCOUNT_EMAIL },
    update: {},
    create: {
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
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? existing
    : await prisma.user.create({
        data: {
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
      data: { userId: user.id, roleId },
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
      where: { recordCategory: item.recordCategory },
      update: {
        retentionPeriodMonths: item.retentionPeriodMonths,
        legalBasis: item.legalBasis,
      },
      create: {
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
      await prisma.documentTemplate.create({ data: template });
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
 */
async function ensureSampleInsurers(): Promise<void> {
  let created = 0;
  for (const insurer of SAMPLE_INSURERS) {
    const existing = await prisma.insurer.findFirst({
      where: { name: insurer.name },
    });
    if (existing) continue;
    await prisma.insurer.create({
      data: {
        name: insurer.name,
        nameAr: insurer.nameAr,
        contactEmail: insurer.contactEmail,
        contactPhone: insurer.contactPhone,
        claimsContact: insurer.claimsContact,
        underwriterContact: insurer.underwriterContact,
        creditTermsDays: insurer.creditTermsDays,
        financialStrengthRating: insurer.financialStrengthRating,
        products: { create: insurer.products },
        slaAgreements: { create: insurer.slaAgreements },
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
      where: { email: sampleUser.email },
      update: { fullName: sampleUser.fullName },
      create: {
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
        data: { userId: user.id, roleId },
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
    where: { email: SYSTEM_ACCOUNT_EMAIL },
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
  await ensureSystemAccount();
  await ensureRetentionSchedule();
  await ensureDocumentTemplates();
  await ensureSlaPolicies();

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });
  }
  console.log(`Seeded ${ROLES.length} roles.`);

  const roleIdByName = new Map(
    (await prisma.role.findMany()).map((r) => [r.name, r.id]),
  );

  for (const permission of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        module: permission.module,
        description: permission.description,
      },
      create: {
        code: permission.code,
        module: permission.module,
        description: permission.description,
      },
    });

    for (const roleName of permission.roles) {
      const roleId = roleIdByName.get(roleName);
      if (!roleId) {
        throw new Error(
          `Permission "${permission.code}" references role "${roleName}", which was not seeded — is it missing from seed-data/roles.ts?`,
        );
      }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: perm.id } },
        update: {},
        create: { roleId, permissionId: perm.id },
      });
    }
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);

  if (SEED_SAMPLE_DATA) {
    await ensureSampleInsurers();
    await ensureSampleUsers(roleIdByName);
  } else {
    console.log("NODE_ENV=production — skipping sample insurers/users.");
  }

  // Runs in EVERY environment: in dev it is an optional extra alongside the
  // sample users, in production it is the only way anyone gets in at all.
  await ensureBootstrapAdmin(roleIdByName);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
