import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * MODULE 0 ITEM (j) — the provider dashboard's one read.
 *
 * Every other repository in this project is tenant-scoped: the model carries `organizationId` and
 * `tenantScopeExtension` filters it, with an RLS policy behind that. This reads
 * `ProviderOfficeState`, a `security_invoker = false` VIEW that sees every office by design and
 * discards everything it must not disclose before returning anything — the `InsurerDirectory`
 * pattern, migration `20261116100000`.
 *
 * ## `$queryRaw`, because Prisma does not model the view
 *
 * The view is not in `schema.prisma` (neither is `InsurerDirectory`), so the columns are listed
 * explicitly below AND asserted against the view's own column set. Two reasons that assertion is
 * not decoration:
 *
 *   * a `$queryRaw` row shape is a CAST — TypeScript cannot check that the database returns what
 *     this interface claims, which is the same drift class that breaks the hand-copied web clients,
 *   * and a WIDENED view is the one way this becomes a disclosure. The migration asserts no banned
 *     column exists; this asserts the application reads no column it did not declare, so a column
 *     added by a future migration cannot reach a caller just because it is there.
 *
 * ## No `SELECT *`, ever
 *
 * `SELECT *` would carry a future column straight to the screen. The list is the boundary.
 */

/** One office's state, exactly as the view returns it. */
export interface ProviderOfficeStateRow {
  organizationId: string;
  legalName: string;
  legalNameAr: string | null;
  subdomain: string;
  organizationType: string;
  brokerKind: string | null;
  organizationStatus: string;
  onboardedAt: Date;
  /** NULL when the office holds no licence term at all — which is a real state, and the one that
   *  blocks new business (item (c)). */
  licenseNumber: string | null;
  licenseIssuedAt: Date | null;
  licenseExpiresAt: Date | null;
  licenseStatus: string | null;
  renewalRequestedAt: Date | null;
  licensedBranches: number;
  dormantLicensedBranches: number;
  users: number;
  activeUsers: number;
  /** An OFFICE-level MAX, never a person's. NULL when nobody has ever signed in. */
  lastActivityAt: Date | null;
}

/**
 * The columns this repository reads, and the complete set it expects the view to have.
 *
 * Kept as one list used for BOTH, so "what we select" and "what we checked" cannot diverge — which
 * they would the first time somebody added a column to one of two lists.
 */
export const PROVIDER_OFFICE_STATE_COLUMNS = [
  'organizationId',
  'legalName',
  'legalNameAr',
  'subdomain',
  'organizationType',
  'brokerKind',
  'organizationStatus',
  'onboardedAt',
  'licenseNumber',
  'licenseIssuedAt',
  'licenseExpiresAt',
  'licenseStatus',
  'renewalRequestedAt',
  'licensedBranches',
  'dormantLicensedBranches',
  'users',
  'activeUsers',
  'lastActivityAt',
] as const;

@Injectable()
export class ProviderOfficeStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every office's state, newest-onboarded last.
   *
   * Ordered by `legalName` so the list is stable and readable rather than in whatever order the
   * planner returns — a dashboard whose rows move between reloads is one somebody stops trusting.
   */
  async findAll(): Promise<ProviderOfficeStateRow[]> {
    await this.assertViewShape();
    return this.prisma.client.$queryRaw<ProviderOfficeStateRow[]>(Prisma.sql`
      SELECT
        "organizationId", "legalName", "legalNameAr", "subdomain",
        "organizationType", "brokerKind", "organizationStatus", "onboardedAt",
        "licenseNumber", "licenseIssuedAt", "licenseExpiresAt", "licenseStatus",
        "renewalRequestedAt", "licensedBranches", "dormantLicensedBranches",
        "users", "activeUsers", "lastActivityAt"
      FROM "ProviderOfficeState"
      ORDER BY "legalName" ASC
    `);
  }

  /**
   * THE VIEW HAS EXACTLY THE COLUMNS THIS CODE KNOWS ABOUT — both directions.
   *
   * A MISSING column is a runtime failure in a raw query, and the message Postgres gives
   * (`column "x" does not exist`) names the column but not why anybody expected it. An EXTRA column
   * is the disclosure risk: somebody widens the view for one reason, and the next `SELECT *` or
   * careless addition here carries it to a cross-office screen.
   *
   * `db:divergence` cannot see a view at all — it compares `schema.prisma` to the database, and the
   * view is in neither — so this and the migration's own DO block are the only two things standing
   * between the column list and a future change.
   *
   * Runs on every call. It is one catalogue query against a tiny table, and a check that runs only
   * at boot is a check that does not run in a test.
   */
  private async assertViewShape(): Promise<void> {
    const rows = await this.prisma.client.$queryRaw<{ attname: string }[]>(
      Prisma.sql`
        SELECT a."attname"
          FROM pg_attribute a
         WHERE a."attrelid" = '"ProviderOfficeState"'::regclass
           AND a."attnum" > 0 AND NOT a."attisdropped"
      `,
    );
    const actual = new Set(rows.map((r) => r.attname));
    const declared = new Set<string>(PROVIDER_OFFICE_STATE_COLUMNS);

    const missing = [...declared].filter((c) => !actual.has(c));
    const extra = [...actual].filter((c) => !declared.has(c));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        'ProviderOfficeState: the view and this repository disagree about its columns. ' +
          `Missing from the view: [${missing.join(', ')}]. ` +
          `Present in the view and NOT declared here: [${extra.join(', ')}]. ` +
          'This is a CROSS-OFFICE read — an undeclared column is a column nobody argued for. ' +
          'See migration 20261116100000 before widening either side.',
      );
    }
  }
}
