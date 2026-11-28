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
  renewalRequestedAt: Date | null;
  /*
   * THE THREE RENEWAL BITS — the full walk §A item 10. Decision 128's four conditions need five
   * licence fields and this view carried two, so the provider screen could not tell a licence
   * genuinely under renewal from one that merely filed on time and stopped. Three PRESENCE TESTS
   * close that, and they are bits on purpose: not the proof document, not the Central Bank's
   * reference number, and not the declaring employee's name or date — see the migration's
   * argument and the ban list below.
   *
   * FALSE, never null, where there is no term: the service reads them only inside a term.
   */
  renewalProofOnRecord: boolean;
  renewalReferenceOnRecord: boolean;
  renewalDeclarationOnRecord: boolean;
  /** The one regulatory fact — derived in the view, because `RegulatoryAction` is tenant-scoped and
   *  unreachable from another office by RLS. See `PROVIDER_OFFICE_STATE_COLUMNS` below. */
  mayNotIssue: boolean;
  licensedBranches: number;
  dormantLicensedBranches: number;
  users: number;
  activeUsers: number;
  /*
   * THE FULL WALK §A ITEM 11 — HOW MANY ACCOUNTS HAVE EVER BEEN USED.
   *
   * The SAME predicate `resolveInvitationTarget` tests (`lastLoginAt IS NOT NULL OR
   * passwordUpdatedAt IS NOT NULL`), so the screen's re-invite control and the route it calls
   * cannot disagree. ⚠️ `lastActivityAt` below is NOT that predicate — it is a MAX over
   * `UserSession`, null for somebody who set their password and never completed a session — which
   * is why it could not be reused.
   *
   * A COUNT, of the same class as `users` and `activeUsers`. ⛔ Not `lastLoginAt` and not
   * `passwordUpdatedAt`: when a named individual in another office last signed in is that office's
   * record. The migration bans both by name.
   */
  enteredUsers: number;
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
  'renewalRequestedAt',
  /*
   * THE THREE RENEWAL BITS — the full walk §A item 10, decision 167/17.
   *
   * *Has the proof been filed*, *did the Central Bank issue a reference*, *has anybody sworn the
   * standing declaration.* Facts about the renewal of a licence the PROVIDER ITSELF REGISTERED, of
   * the same class as `licenseNumber`, `licenseExpiresAt` and `renewalRequestedAt` three lines up
   * — which register entry 97 calls, in terms, «the provider's own registration record».
   *
   * ⛔ AND THEY ARE BITS, WHICH IS THE WHOLE NARROWING. Not the proof document id, not the
   * reference number itself, and not `actorNameShown` / `declaredAt`: the person who swore it is an
   * employee of ANOTHER office and that is their office's record. `/regulatory-compliance` prints
   * both names to the office that owns them; the provider gets neither. The migration bans all four
   * by name.
   *
   * The argument for growing this list is in the migration, because this list IS the boundary.
   */
  'renewalProofOnRecord',
  'renewalReferenceOnRecord',
  'renewalDeclarationOnRecord',
  /*
   * THE ONE REGULATORY FACT — register entry 97, closed by the owner's decision.
   *
   * *This office may not issue.* Nothing behind it: not the decision reference, not the basis, not
   * the effective date, not the suspended-until date, not the letter, not the kind. A sanction's
   * contents are the OFFICE'S, and the provider neither corrects them nor is bound by any deadline
   * they carry (decision 92).
   *
   * The argument for growing this list at all is in the migration, because this list IS the privacy
   * boundary: the provider registers organizations and may not put a live one in front of customers
   * while it is barred, which is a fact about the platform's own duty rather than about the office's
   * regulator file.
   *
   * It is derived inside the view — the one place this product otherwise refuses to put a licence
   * rule — because `RegulatoryAction` is tenant-scoped and unreachable from another office by RLS.
   * That is exactly the gap entry 97 declared, and it is why the fact can come from nowhere else.
   */
  'mayNotIssue',
  'licensedBranches',
  'dormantLicensedBranches',
  'users',
  'activeUsers',
  /* THE FULL WALK §A ITEM 11 — see the row type. A count, the route's own predicate, no person
   * named and no date exposed. */
  'enteredUsers',
  'lastActivityAt',
] as const;

/**
 * 🔴 THE SELECT LIST, DERIVED FROM THE DECLARED COLUMNS — IT USED TO BE A SECOND COPY, AND THE
 * COMMENT ON `PROVIDER_OFFICE_STATE_COLUMNS` CLAIMED IT COULD NOT BE.
 *
 * That constant's header says it is «kept as one list used for BOTH, so ‘what we select’ and
 * ‘what we checked’ cannot diverge — which they would the first time somebody added a column to one
 * of two lists». There really were two lists: `findAll` named its eighteen columns in a hand-written
 * SQL string, and nothing compared the two.
 *
 * ⚠️ AND THAT IS EXACTLY WHAT HAPPENED, ON THE COMMIT THAT ADDED FOUR COLUMNS (the full walk §A
 * items 10 and 11). The four names reached the constant, the row type and `assertViewShape` — so the
 * per-call check passed, because it compares the CONSTANT to the VIEW and never the SELECT to
 * either — while the SELECT still named eighteen. The rows came back without the fields,
 * `JSON.stringify` DROPS an undefined key, and the payload simply had no `enteredUsers`. No error,
 * no 500: a missing field that reads exactly like a field nobody added.
 *
 * `provider-office-state.e2e-spec.ts` caught it in CI, which is the only place it could be caught —
 * the api e2e cannot run on the authoring machine (db-test credentials), and tsc cannot see across
 * a raw query.
 *
 * ⟶ So the comment's claim is now TRUE rather than aspirational: there is one list, and the SELECT
 *   is built from it. A column added to the constant is selected; one removed stops being selected;
 *   and `assertViewShape` keeps the constant honest against the view.
 *
 * ⛔ `Prisma.raw` is safe HERE and would not be anywhere else: every element of
 * `PROVIDER_OFFICE_STATE_COLUMNS` is a compile-time literal in an `as const` array in this file, so
 * nothing from a request reaches it. The assertion below refuses any name that is not a plain
 * identifier, so a future entry cannot smuggle SQL in through the quoting.
 */
const SELECT_LIST = Prisma.raw(
  PROVIDER_OFFICE_STATE_COLUMNS.map((column) => {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(column)) {
      throw new Error(
        `ProviderOfficeState: the declared column "${column}" is not a plain identifier, and this ` +
          'list is interpolated into SQL. Every entry must be a bare camelCase name.',
      );
    }
    return `"${column}"`;
  }).join(', '),
);

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
      SELECT ${SELECT_LIST}
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
