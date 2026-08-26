import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLES } from './seed-data/roles';
import { PERMISSIONS } from './seed-data/permissions';
import { RETENTION_SCHEDULE } from './seed-data/retention-schedule';
import { SAMPLE_USERS, SAMPLE_USER_PASSWORD } from './seed-data/sample-users';
import { SAMPLE_INSURERS } from './seed-data/insurers';
import { DOCUMENT_TEMPLATES } from './seed-data/document-templates';

const prisma = new PrismaClient();

/**
 * Sample/demo data (fictional insurers, login-capable sample users per
 * role) must never land in a production database — same gate convention as
 * `ENABLE_DEV_RESET_TOKEN` (apps/api/.../auth.service.ts) and
 * `securityHeaders()` (apps/api/src/common/security-headers.middleware.ts).
 * Roles, permissions, the retention schedule, and document templates are
 * real configuration data and are seeded in every environment.
 */
const SEED_SAMPLE_DATA = process.env.NODE_ENV !== 'production';

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
export const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

async function ensureSystemAccount(): Promise<void> {
  await prisma.user.upsert({
    where: { email: SYSTEM_ACCOUNT_EMAIL },
    update: {},
    create: {
      fullName: 'IBMS System (scheduled jobs)',
      email: SYSTEM_ACCOUNT_EMAIL,
      passwordHash: 'disabled-service-account-no-password-login',
      isActive: false,
    },
  });
  console.log('Seeded system service account.');
}

/**
 * Part 6.2 (M06) — seeds the retention-schedule row(s). RetentionScheduleItem
 * has no unique constraint on recordCategory (future M06 work may want to
 * version these), so this upserts by hand via findFirst instead of a real
 * Prisma upsert.
 */
async function ensureRetentionSchedule(): Promise<void> {
  for (const item of RETENTION_SCHEDULE) {
    const existing = await prisma.retentionScheduleItem.findFirst({
      where: { recordCategory: item.recordCategory },
    });
    if (existing) {
      await prisma.retentionScheduleItem.update({
        where: { id: existing.id },
        data: {
          retentionPeriodMonths: item.retentionPeriodMonths,
          legalBasis: item.legalBasis,
        },
      });
    } else {
      await prisma.retentionScheduleItem.create({
        data: {
          recordCategory: item.recordCategory,
          retentionPeriodMonths: item.retentionPeriodMonths,
          legalBasis: item.legalBasis,
        },
      });
    }
  }
  console.log(`Seeded ${RETENTION_SCHEDULE.length} retention schedule item(s).`);
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
    const existing = await prisma.insurer.findFirst({ where: { name: insurer.name } });
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
  console.log(`Seeded ${created} sample insurer(s) (${SAMPLE_INSURERS.length - created} already present).`);
}

/**
 * Part B — "a sample user per role". Dev/demo-only login-capable accounts,
 * one per `RoleName` (see seed-data/sample-users.ts). Requires
 * `roleIdByName` from the roles seeded earlier in `main()`.
 */
async function ensureSampleUsers(roleIdByName: Map<string, string>): Promise<void> {
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
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });
  }
  console.log(`Seeded ${SAMPLE_USERS.length} sample user(s), one per role.`);
}

/**
 * Part B — "Seed data: the 11 roles + the full permission grid". Idempotent
 * (upsert-based) so it's safe to re-run in CI/dev without duplicating rows
 * or clobbering roles/permissions added by hand since the last run.
 */
async function main() {
  await ensureSystemAccount();
  await ensureRetentionSchedule();
  await ensureDocumentTemplates();

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
    console.log('NODE_ENV=production — skipping sample insurers/users.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
