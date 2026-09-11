import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createAppPrismaClient, prisma, type PrismaClient } from '@ibms/db';
import { OrgContextService } from '../common/org-context/org-context.service';
import {
  buildTenantScopedClient,
  withOrgAwareTransactions,
  type TenantPrismaClient,
} from './tenant-scope.extension';

/**
 * The single point at which this application reaches the database — no other
 * file in `apps/api` imports the `@ibms/db` client, which is what makes
 * multi-tenancy enforceable here rather than at ~400 call sites.
 *
 * `client` carries BOTH isolation layers (spec §1):
 *
 *   1. Application layer — every query against a model carrying
 *      `organizationId` is filtered by the current Organization, and refuses
 *      to run at all if there isn't one.
 *   2. Database layer — the connection runs as a NON-OWNER role, so Postgres
 *      applies the row-level security policies to it, and each query sets
 *      `app.current_org_id` for the transaction those policies read.
 *
 * The two are deliberately independent: breaking the `where` injection does not
 * disable RLS, and vice versa.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO CONNECTIONS
 * ---------------------------------------------------------------------------
 * Authentication has to read across Organizations — resolving a session id, a
 * refresh-token hash or a login email is precisely how the caller's
 * Organization gets discovered in the first place, so those reads cannot
 * already be scoped to it. That is spec §3.1's own reasoning for why bearer
 * secrets stay globally unique.
 *
 * Layer 1 has always allowed this through the enumerated
 * `runUnscoped('auth-bootstrap')` bypass. Layer 2 cannot: RLS fails closed, so
 * an unscoped read on the app role returns NOTHING — which showed up as every
 * single request 401ing the moment the policies went live.
 *
 * So the bypass now also selects the connection. Inside an `auth-bootstrap`
 * block, queries run on the OWNER connection, which RLS does not constrain;
 * everywhere else they run on the non-owner role and are constrained. The
 * routing is driven by the same closed `UnscopedReason` union that gates the
 * bypass itself, so widening one necessarily means editing the other.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** The tenant-scoped, RLS-constrained client used for all ordinary work. */
  readonly client: TenantPrismaClient;

  private readonly connection: PrismaClient;
  private readonly ownsConnection: boolean;

  constructor(private readonly orgContext: OrgContextService) {
    const appUrl = process.env.APP_DATABASE_URL?.trim();

    if (appUrl) {
      this.connection = createAppPrismaClient(appUrl);
      this.ownsConnection = true;
    } else {
      // Fall back to the owner connection so a half-configured environment
      // still boots — but say so loudly, because Postgres exempts a table's
      // owner from its own policies, which makes layer 2 a silent no-op. Spec
      // §1 calls this out as the detail that quietly defeats RLS, so it must
      // never be discovered by accident.
      this.connection = prisma;
      this.ownsConnection = false;
      this.logger.error(
        'APP_DATABASE_URL is not set, so the API is connecting to Postgres as the TABLE OWNER. ' +
          'Row-level security is INERT on this connection — Postgres exempts a table owner from ' +
          'its own policies — and tenant isolation is resting on the application layer alone. ' +
          'Set APP_DATABASE_URL to the non-owner `ibms_app` role (see docs/multi-tenancy-rls.md).',
      );
    }

    const scoped = withOrgAwareTransactions(
      buildTenantScopedClient(this.orgContext, this.connection),
      this.orgContext,
    );

    // The identity connection: the OWNER client, reachable only from inside an
    // `auth-bootstrap` block. It still goes through the tenant extension, which
    // during a bypass passes queries through untouched and opens no transaction.
    const identity = withOrgAwareTransactions(
      buildTenantScopedClient(this.orgContext, prisma),
      this.orgContext,
    );

    this.client = new Proxy(scoped, {
      get: (target, property): unknown => {
        const source =
          this.orgContext.unscopedReason() !== null ? identity : target;
        const value: unknown = Reflect.get(source, property);
        // Bind to the client the value came from. Passing a foreign `receiver`
        // to Reflect.get leaves Prisma's internal getters with the wrong
        // `this`, which silently produces a client that returns nothing.
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(source)
          : value;
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connection.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    // Only close what this service opened. The `@ibms/db` singleton is shared
    // with the seed and the migration tooling.
    if (this.ownsConnection) await this.connection.$disconnect();
  }
}
