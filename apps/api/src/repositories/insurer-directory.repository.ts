import { Injectable } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The cross-office insurer directory.
 *
 * ## The one read in this codebase that deliberately crosses an office boundary
 *
 * Everything else here is tenant-scoped: `tenantScopeExtension` filters by
 * `organizationId` and an RLS policy backs it. This reads `InsurerDirectory`, a
 * SECURITY DEFINER view that aggregates every office's `Insurer` rows into one entry per
 * company — and that is the point of the feature, because an office looking for who
 * writes a line should not have to discover the market by asking around.
 *
 * ## Why a view and not a query with a careful `select`
 *
 * The app role cannot read another office's `Insurer` row at all; the view can, and the
 * view has no office-scoped column in it to leak. So the boundary is a property of the
 * schema rather than of this file. A filtered query would have put the boundary in a
 * `select` clause that has to stay correct forever — and a shared select in this codebase
 * has already grown a column twice.
 *
 * Confirmed rather than assumed, against the live database: as `ibms_app` with no org
 * context, `SELECT count(*) FROM "Insurer"` returns 0 while the view returns every
 * entry; and `DELETE FROM "InsurerDirectory"` is refused outright, because an aggregating
 * view is not auto-updatable in Postgres.
 *
 * ## Raw SQL, because Prisma does not model views
 *
 * Without the `views` preview feature there is no model to query, so this is
 * `$queryRaw`. The columns are therefore listed explicitly below AND asserted against
 * `information_schema` by `insurer-directory.e2e-spec.ts` — a column added to the view
 * next year has to fail a test rather than quietly become readable.
 */

/**
 * Exactly what the directory exposes. The ALLOW-LIST, and the only definition of it.
 *
 * Read by the row type below, by the service's mapping, and by two tests: one asserting
 * the API response has these keys and no others, one asserting the VIEW has these
 * columns and no others. The second is the one that matters — the view is what the app
 * role can actually read, so a column added there is reachable by anything that can run
 * a query, whatever this repository chooses to map.
 *
 * What is deliberately absent, and must stay absent: `organizationId`, `isActive`,
 * `creditTermsDays`, `financialStrengthRating`, every `rfqContact*` / `claimsContact*` /
 * `underwriterContact`, any count of offices, and any registration timestamp. The first
 * two are office-scoped facts; the next three are commercial terms; a count or a date is
 * a fact about other offices' behaviour, which is the disclosure this boundary exists to
 * prevent even in weakened form.
 */
export const INSURER_DIRECTORY_COLUMNS = [
  'directoryKey',
  'name',
  'nameAr',
  'structure',
  'companyPhone',
  'companyEmail',
  'companyWebsite',
  'companyCorrespondenceAddress',
  'lines',
] as const;

export interface DirectoryLine {
  /** NULL for a line an office added itself — a code is platform-wide and an office
   *  cannot mint one. Carries no hint of WHICH office added it. */
  code: string | null;
  nameEn: string;
  nameAr: string;
}

export interface InsurerDirectoryRow {
  directoryKey: string;
  name: string | null;
  nameAr: string | null;
  structure: 'CONVENTIONAL' | 'TAKAFUL' | 'TAKAFUL_WINDOW' | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyCorrespondenceAddress: string | null;
  lines: DirectoryLine[];
}

@Injectable()
export class InsurerDirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of the directory, newest-first by name.
   *
   * Ordered by name and not by anything temporal, deliberately: a "recently registered"
   * ordering would let an office infer when other offices added companies, which is the
   * behaviour-of-other-offices disclosure the boundary forbids. Alphabetical is also what
   * a person scanning a market list wants.
   *
   * There is NO filter on whether anybody currently deals with the company. Presence
   * depends on having been registered, full stop — a company disappearing when the last
   * office stopped dealing with it would itself be a signal about other offices.
   */
  async findPage(
    search: string | undefined,
    window: { take: number; skip: number },
  ): Promise<InsurerDirectoryRow[]> {
    const pattern = search?.trim() ? `%${search.trim()}%` : null;
    return this.prisma.client.$queryRaw<InsurerDirectoryRow[]>(Prisma.sql`
      SELECT
        "directoryKey",
        "name",
        "nameAr",
        "structure"::text AS "structure",
        "companyPhone",
        "companyEmail",
        "companyWebsite",
        "companyCorrespondenceAddress",
        "lines"
      FROM "InsurerDirectory"
      WHERE ${pattern}::text IS NULL
         OR "name" ILIKE ${pattern}
         OR "nameAr" ILIKE ${pattern}
      ORDER BY "name" ASC NULLS LAST, "directoryKey" ASC
      LIMIT ${window.take} OFFSET ${window.skip}
    `);
  }

  /** Entries matching the same filter. A separate count over the same predicate, so the
   *  total never describes a different set than the page. */
  async countPage(search: string | undefined): Promise<number> {
    const pattern = search?.trim() ? `%${search.trim()}%` : null;
    const rows = await this.prisma.client.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`
        SELECT count(*)::bigint AS total
        FROM "InsurerDirectory"
        WHERE ${pattern}::text IS NULL
           OR "name" ILIKE ${pattern}
           OR "nameAr" ILIKE ${pattern}
      `,
    );
    // `count(*)` comes back as a bigint, which JSON cannot serialise — a `total` that
    // reaches the wire as a BigInt throws on `JSON.stringify` rather than returning a
    // number.
    return Number(rows[0]?.total ?? 0);
  }
}
