import { Injectable, Logger } from '@nestjs/common';
import { OrganizationRepository } from '../../repositories/organization.repository';
import { UserRepository } from '../../repositories/user.repository';
import { OrgContextService } from './org-context.service';

/**
 * Kept in sync with `packages/db/prisma/seed.ts`'s `SYSTEM_ACCOUNT_EMAIL`.
 * Every Organization gets its own row under this address — the account is
 * tenant-scoped like any other `User`, so "the system account" is really
 * "this office's system account".
 */
export const SYSTEM_ACCOUNT_EMAIL = 'system@ibms.internal';

/**
 * Multi-tenancy Phase 2 (step 7) — how background work runs once tenant
 * isolation is enforced.
 *
 * A scheduler has no request to inherit an Organization from, so before this
 * existed each one simply queried every office's rows at once. That was
 * invisible while one office existed and becomes a cross-tenant read the
 * moment a second one does. Each sweep now runs once per ACTIVE Organization,
 * inside that Organization's context, so its reads are filtered and its writes
 * land in the right tenant — with no change in behaviour while there is only
 * one office.
 *
 * Shared rather than copied into all 14 call sites deliberately: this is the
 * one piece of code that decides whether background work is tenant-safe, and
 * fourteen near-identical copies is how one of them ends up subtly different.
 */
@Injectable()
export class PerOrganizationRunner {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly users: UserRepository,
    private readonly orgContext: OrgContextService,
  ) {}

  /**
   * Runs `work` once per ACTIVE Organization, inside that org's context, with
   * that org's own system service account already resolved.
   *
   * Failures are isolated per Organization: one office's sweep throwing is
   * logged and the loop continues, because a single tenant's bad data must not
   * silently stop every other tenant's overnight processing. Nothing is
   * re-thrown — a scheduled job that crashes the process is worse than one
   * that reports and moves on.
   */
  async forEach(
    jobName: string,
    logger: Logger,
    work: (systemUserId: string, organizationId: string) => Promise<void>,
  ): Promise<void> {
    // `Organization` is not tenant-scoped, so this read needs no context —
    // it is what establishes one.
    const organizations = await this.organizations.findActive();
    if (organizations.length === 0) {
      logger.warn(`${jobName} skipped — no ACTIVE Organization exists.`);
      return;
    }

    for (const organization of organizations) {
      try {
        await this.orgContext.runAs(organization.id, async () => {
          const systemUser = await this.users.findByEmailInOrganization(
            organization.id,
            SYSTEM_ACCOUNT_EMAIL,
          );
          if (!systemUser) {
            logger.error(
              `${jobName} skipped for organization ${organization.id} (${organization.legalName}) — ` +
                `no system service account "${SYSTEM_ACCOUNT_EMAIL}" in that organization (has npm run db:seed been run?)`,
            );
            return;
          }
          await work(systemUser.id, organization.id);
        });
      } catch (err) {
        logger.error(
          `${jobName} failed for organization ${organization.id} (${organization.legalName}): ${(err as Error).message}`,
        );
      }
    }
  }
}
