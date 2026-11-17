import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@ibms/db';
import { prisma } from './tenant-prisma';

/**
 * 🔴 OWNER DECISION 142 §٥ CRITERION 4 and OWNER DECISION 128 §٧ CRITERION 9 — ANOTHER OFFICE
 * SEES NEITHER THE CERTIFICATE NOR ITS ROW, AND NEITHER THE PROOF NOR THE DECLARATION.
 *
 * ## WHY THIS IS ITS OWN FILE AND NOT AN HTTP ASSERTION
 *
 * ⛔ AN HTTP e2e CANNOT PROVE RLS, AND NO REWRITE MAKES IT ABLE TO. `tenantScopeExtension` puts
 * `organizationId` into the query before it leaves the application, so the database is never asked
 * a question it could refuse — measured on 2026-11-11 with a `USING (true)` plant that left a
 * whole suite green. Layer 2 is observable only by going around layer 1.
 *
 * So every assertion here travels over `APP_DATABASE_URL` — the role the API itself uses — and the
 * FIRST test proves that connection is not exempt. `check:rls-proof-shape` requires exactly that
 * of any spec claiming RLS refuses something.
 *
 * ⚠️ AND NEVER THROUGH THIS SUITE'S OWN CLIENT: on db-test `ibms` is a SUPERUSER with BYPASSRLS,
 * so a refusal asserted through it passes with every policy dropped. That client is used here for
 * exactly one thing — PLANTING the other office's rows, which the app role cannot see and
 * therefore could not create.
 *
 * ## THE OTHER HALF OF THE SAME LESSON, RECORDED 2026-11-16
 *
 * The certificate migration's own CHECK probes were written without setting `app.current_org_id`
 * and passed `from-empty.sh` 174/174 green — because that script builds its throwaway database on
 * the db-test cluster, as the bypassing role. They then failed on DEV, where `ibms` is neither a
 * superuser nor BYPASSRLS. ⟶ `from-empty` is structurally blind to this class; this file is not.
 */

/** The app role's own connection — the one RLS actually applies to. */
const APP_DB_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://ibms_app:ibms_app_dev@localhost:5434/ibms_test?schema=public';

/**
 * Runs statements as the APPLICATION role, optionally with `app.current_org_id` set, inside ONE
 * transaction that is always rolled back. Returns the rows of the last `SELECT`.
 */
async function asAppRole<T>(
  organizationId: string | null,
  statements: string[],
): Promise<T[]> {
  const client = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
  try {
    let last: unknown[] = [];
    await client
      .$transaction(async (tx) => {
        if (organizationId !== null) {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.current_org_id', '${organizationId}', true)`,
          );
        }
        for (const sql of statements) {
          last = await tx.$queryRawUnsafe(sql);
        }
        // ALWAYS roll back. Nothing this spec writes may survive it.
        throw new Error('__rollback__');
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === '__rollback__') return;
        throw err;
      });
    return last as T[];
  } finally {
    await client.$disconnect();
  }
}

let officeId = '';
let otherOrgId = '';
let documentId = '';
let licenseId = '';

beforeAll(async () => {
  /*
   * ⚠️ MEASURED RATHER THAN ASSUMED: db-test holds exactly ONE brokerage office (plus the
   * provider), which is the same thinness `license-standing.config.spec.ts` records. So the
   * «other office» cannot be a second brokerage office — there is not one.
   *
   * ⟶ THE POLICY CANNOT TELL THE DIFFERENCE, and that is why this is sound rather than a
   *   workaround. Every one of these policies reads
   *   `"organizationId" = current_setting('app.current_org_id', true)`, so the only thing that
   *   matters about the other context is that it does NOT match. A second brokerage office, the
   *   provider, and an id belonging to nobody are the same input to that predicate.
   *
   *   The real second organization is preferred where it exists, because a live id is a
   *   stronger fixture than an invented one; a non-matching uuid is the fallback, so this spec
   *   can never silently degrade into asserting nothing when the population changes.
   */
  const office = await prisma.organization.findFirst({
    where: { type: 'BROKERAGE_OFFICE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  officeId = office?.id ?? '';

  const other = await prisma.organization.findFirst({
    where: { id: { not: officeId } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  otherOrgId = other?.id ?? '00000000-0000-4000-8000-000000000000';

  const doc = await prisma.document.findFirst({
    where: { organizationId: officeId },
    select: { id: true },
  });
  documentId = doc?.id ?? '';

  const lic = await prisma.brokerLicense.findFirst({
    where: { organizationId: officeId },
    select: { id: true },
  });
  licenseId = lic?.id ?? '';
});

afterAll(async () => {
  /*
   * ⛔ NO PROBE ROW MAY SURVIVE. `DocumentContent` and `LicenseRenewalDeclaration` are APPEND-ONLY
   * by trigger — no permission deletes from either — so a committed probe row would be permanent
   * residue in tables an inspector reads, on a database that is cumulative. Every write above is
   * inside a transaction that rolls back; this counts what is left and fails on anything.
   */
  const leftovers = await prisma.documentContent.count({
    where: { id: { startsWith: 'probe-' } },
  });
  expect(leftovers, 'a probe row survived — DocumentContent is append-only').toBe(0);
});

describe('OWNER DECISION 142 §٥ criterion 4 / DECISION 128 §٧ criterion 9 — tenant isolation', () => {
  it('FIRST: the connection these assertions travel through is NOT exempt from RLS', async () => {
    /*
     * The assertion every refusal below rests on. `tenant-isolation.e2e-spec.ts` proves the ROLE
     * NAMED `ibms_app` holds no bypassing attribute; that is a DIFFERENT claim from «the
     * connection my assertions travel through is that role». Point `APP_DATABASE_URL` at the
     * owner and every refusal here goes hollow while still passing.
     *
     * Ownership is checked too: only `LegalValue`, `DeclaredAct`, `LicenseRenewalDeclaration` and
     * `DocumentContent` are FORCE ROW LEVEL SECURITY, and for every other table the OWNER is
     * exempt — a hole neither `rolsuper` nor `rolbypassrls` covers.
     */
    const who = await asAppRole<{
      super: boolean;
      bypass: boolean;
      owned: bigint;
    }>(null, [
      `SELECT rolsuper AS "super", rolbypassrls AS bypass,
              (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
                WHERE r.rolname = current_user AND c.relkind = 'r') AS owned
         FROM pg_roles WHERE rolname = current_user`,
    ]);
    expect(who).toHaveLength(1);
    expect(who[0].super, 'this connection is a SUPERUSER — RLS does not apply').toBe(false);
    expect(who[0].bypass, 'this connection has BYPASSRLS').toBe(false);
    expect(
      Number(who[0].owned),
      'this connection OWNS tables, and an owner is exempt from any policy that is not FORCED',
    ).toBe(0);
  });

  it('both DocumentContent and LicenseRenewalDeclaration are RLS ENABLED **and** FORCED', async () => {
    /*
     * Two booleans, not one. `ENABLE` alone leaves the table's OWNER exempt, which is precisely
     * the hole that makes an isolation proof hollow — and these two tables hold a customer's
     * certificate and a sworn declaration, so the owner is the wrong person to leave exempt.
     */
    const rls = await asAppRole<{
      name: string;
      enabled: boolean;
      forced: boolean;
    }>(null, [
      `SELECT relname AS name, relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class
        WHERE relname IN ('DocumentContent', 'LicenseRenewalDeclaration')
        ORDER BY relname`,
    ]);
    expect(rls.map((r) => r.name)).toEqual([
      'DocumentContent',
      'LicenseRenewalDeclaration',
    ]);
    for (const row of rls) {
      expect(row.enabled, `${row.name} does not have RLS enabled`).toBe(true);
      expect(row.forced, `${row.name} is not FORCED, so its owner is exempt`).toBe(true);
    }
  });

  it('🔴 criterion 4 — a stored certificate is invisible to another office, and to no context at all', async () => {
    if (!officeId || !otherOrgId || !documentId) {
      throw new Error(
        'db-test holds no brokerage office with a document — this spec cannot prove isolation ' +
          'against an empty population, and reporting green would be worse than failing',
      );
    }

    const insert =
      `INSERT INTO "DocumentContent"
         ("id","organizationId","documentId","bytes","byteSize","contentType","sha256")
       VALUES ('probe-cert', '${officeId}', '${documentId}', '\\x255044462d'::bytea, 5,
               'application/pdf', repeat('a', 64))`;
    const countOwn = `SELECT count(*)::int AS n FROM "DocumentContent" WHERE id = 'probe-cert'`;

    // The office that owns it SEES it — the non-vacuity half. Without this, a policy that hid the
    // row from everybody would satisfy every refusal below and look like perfect isolation.
    const own = await asAppRole<{ n: number }>(officeId, [insert, countOwn]);
    expect(own[0].n, 'the owning office cannot see its own stored certificate').toBe(1);

    // ANOTHER office sees nothing...
    const other = await asAppRole<{ n: number }>(otherOrgId, [
      `SELECT count(*)::int AS n FROM "DocumentContent" WHERE "documentId" = '${documentId}'`,
    ]);
    expect(other[0].n, 'another office can see this office’s stored certificate').toBe(0);

    // ...and nor does a connection with NO tenant context, which is what a forgotten
    // `set_config` looks like in production.
    const none = await asAppRole<{ n: number }>(null, [
      `SELECT count(*)::int AS n FROM "DocumentContent" WHERE "documentId" = '${documentId}'`,
    ]);
    expect(none[0].n, 'a connection with no tenant context can read stored certificates').toBe(0);
  });

  it('🔴 criterion 9 — another office sees neither the renewal PROOF nor the DECLARATION', async () => {
    if (!officeId || !otherOrgId || !licenseId) {
      throw new Error('db-test does not hold a brokerage office with a licence term');
    }

    /*
     * The declaration is the sworn record; the proof is a column on the licence term. Both are
     * asserted, because decision 128 criterion 9 names both and they live in different places —
     * a test of one would read as covering the pair.
     */
    const insert =
      `INSERT INTO "LicenseRenewalDeclaration"
         ("id","organizationId","brokerLicenseId","declarationTextShown","permissionCode",
          "actorUserId","actorNameShown")
       SELECT 'probe-decl', '${officeId}', '${licenseId}',
              'أُقرّ بأنه لم يصل المكتبَ من البنك المركزي رفضٌ لطلب التجديد ولا إشعارُ نقص.',
              'license-renewal.declare', u.id, 'Probe Actor'
         FROM "User" u WHERE u."organizationId" = '${officeId}' LIMIT 1`;

    const own = await asAppRole<{ n: number }>(officeId, [
      insert,
      `SELECT count(*)::int AS n FROM "LicenseRenewalDeclaration" WHERE id = 'probe-decl'`,
    ]);
    expect(
      own[0].n,
      'the owning office cannot see its own declaration — the plant did not land, so the ' +
        'refusals below would prove nothing',
    ).toBe(1);

    const other = await asAppRole<{ n: number }>(otherOrgId, [
      `SELECT count(*)::int AS n FROM "LicenseRenewalDeclaration"
         WHERE "brokerLicenseId" = '${licenseId}'`,
    ]);
    expect(other[0].n, 'another office can see this office’s renewal declaration').toBe(0);

    // And the PROOF, which is a column on the term rather than a row of its own.
    const proofOther = await asAppRole<{ n: number }>(otherOrgId, [
      `SELECT count(*)::int AS n FROM "BrokerLicense" WHERE id = '${licenseId}'`,
    ]);
    expect(
      proofOther[0].n,
      'another office can read this office’s licence term, and with it the renewal proof',
    ).toBe(0);
  });

  it('⛔ and another office cannot WRITE a certificate into this one either', async () => {
    /*
     * `USING` hides rows; `WITH CHECK` refuses writes. A policy carrying only the first would pass
     * every read assertion above and still let one office plant a certificate in another's file.
     */
    if (!officeId || !otherOrgId || !documentId) return;
    await expect(
      asAppRole(otherOrgId, [
        `INSERT INTO "DocumentContent"
           ("id","organizationId","documentId","bytes","byteSize","contentType","sha256")
         VALUES ('probe-cross', '${officeId}', '${documentId}', '\\x25'::bytea, 1,
                 'application/pdf', repeat('b', 64))`,
      ]),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});
