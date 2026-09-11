import { Injectable } from '@nestjs/common';
import type { SecurityConfig } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { OrgContextService } from '../common/org-context/org-context.service';

@Injectable()
export class SecurityConfigRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
  ) {}

  /**
   * The calling Organization's security configuration, created on first read.
   *
   * Multi-tenancy Phase 2 step 8 — keyed by `organizationId`, not by a fixed
   * `"default"` row id. `tenantScopeExtension` supplies the Organization on
   * both halves of the upsert, so this reads and creates the CALLER's config;
   * under the old singleton id a second Organization's first read would have
   * collided on the primary key instead of creating its own row.
   */
  async get(): Promise<SecurityConfig> {
    const organizationId = this.orgContext.currentOrNull();
    if (organizationId === null) {
      throw new Error(
        'SecurityConfigRepository.get() needs an Organization in context — there is ' +
          'one security configuration per office, not one for the platform.',
      );
    }
    return this.prisma.client.securityConfig.upsert({
      where: { organizationId },
      update: {},
      create: {},
    });
  }

  update(
    patch: Partial<
      Pick<
        SecurityConfig,
        | 'idleTimeoutMinutes'
        | 'hardLogoutAfterIdleMinutes'
        | 'accessTokenTtlMinutes'
        | 'refreshTokenTtlDays'
        | 'stepUpMaxAgeMinutes'
        | 'maxFailedLoginAttempts'
        | 'lockoutMinutes'
      >
    >,
    updatedByUserId: string,
  ): Promise<SecurityConfig> {
    const organizationId = this.orgContext.currentOrNull();
    if (organizationId === null) {
      throw new Error(
        'SecurityConfigRepository.update() needs an Organization in context — an ' +
          "administrator edits their OWN office's configuration, never the platform's.",
      );
    }
    return this.prisma.client.securityConfig.upsert({
      where: { organizationId },
      update: { ...patch, updatedByUserId },
      create: { ...patch, updatedByUserId },
    });
  }
}
