import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OrgContextService } from '../common/org-context/org-context.service';
import {
  buildTenantScopedClient,
  type TenantPrismaClient,
} from './tenant-scope.extension';

/**
 * The single point at which this application reaches the database — no other
 * file in `apps/api` imports the `@ibms/db` client, which is what makes
 * multi-tenancy enforceable here rather than at ~400 call sites.
 *
 * `client` is the TENANT-SCOPED client: every query it runs against a model
 * carrying `organizationId` is filtered by the current Organization, and
 * refuses to run at all if there isn't one (spec §1, Phase 2 step 7).
 *
 * `$extends` returns a NEW client rather than mutating the singleton, so the
 * raw client underneath stays untouched — which matters because
 * `prisma/seed.ts` and the migration tooling use it directly and must not be
 * tenant-filtered.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: TenantPrismaClient;

  constructor(private readonly orgContext: OrgContextService) {
    this.client = buildTenantScopedClient(this.orgContext);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
