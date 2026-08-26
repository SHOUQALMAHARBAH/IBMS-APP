import { PrismaClient } from '@prisma/client';
import { ROLES } from './seed-data/roles';
import { PERMISSIONS } from './seed-data/permissions';
import { RETENTION_SCHEDULE } from './seed-data/retention-schedule';

const prisma = new PrismaClient();

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
 * Part B — "Seed data: the 11 roles + the full permission grid". Idempotent
 * (upsert-based) so it's safe to re-run in CI/dev without duplicating rows
 * or clobbering roles/permissions added by hand since the last run.
 */
async function main() {
  await ensureSystemAccount();
  await ensureRetentionSchedule();

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
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
