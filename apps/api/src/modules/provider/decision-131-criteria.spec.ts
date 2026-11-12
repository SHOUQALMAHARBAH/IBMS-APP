import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Prisma } from '@ibms/db';
import { TENANT_SCOPED_MODELS } from '../../prisma/tenant-scope.extension';
import { OFFICE_ADMINISTRATOR_GRANTS } from './office-administrator-grants';

/**
 * OWNER DECISION 131 § 6 — THE FIVE QUALITY CRITERIA, EACH AS A TEST NAMED BY ITS NUMBER.
 *
 * Criterion 1 is not here: it belongs to the catalogue and lives with it, in
 * `packages/db/prisma/seed-data/permissions.spec.ts` ("DECISION 131 CRITERION 1"). Putting a copy
 * here would make two homes for one assertion, which is the drift this repository keeps paying for.
 *
 * ## WHY 4 AND 5 ASSERT A PREREQUISITE RATHER THAN THE BEHAVIOUR
 *
 * The «جديدة» mark is NOT built (message 37 §1.4 sized it; `docs/module-1-new-permission-mark.md`
 * carries the shape). A test that drove a mark which does not exist would pass vacuously, and a
 * vacuous test is worse than no test, because it reads as coverage.
 *
 * So each of 4 and 5 asserts the property its criterion RESTS on — and criterion 5's is written so
 * that it starts demanding the real thing the day the table lands, rather than needing somebody to
 * remember to come back. That is the only honest shape available before the build.
 */
describe('OWNER DECISION 131 § 6 — the five criteria', () => {
  const API_SRC = join(__dirname, '..', '..');
  const catalogue = readFileSync(
    join(API_SRC, '../../../packages/db/prisma/seed-data/permissions.ts'),
    'utf8',
  );
  /** Read off disk rather than imported: `prisma/seed-data/` sits outside `@ibms/db`'s export
   *  surface, so the api cannot import it. `role-scope.inventory.spec.ts` reads it the same way,
   *  for the same reason. */
  const catalogueCodes = [
    ...catalogue.matchAll(/code:\s*"([^"]+)",\s*\n\s*module:\s*"([^"]+)"/g),
  ].map((m) => m[1]);

  /**
   * WHAT «صلاحية عمل» IS, MEASURABLY — the acts that place, price, issue or settle business, by
   * the entity they name. Declared rather than derived from `module`, because the module is the
   * wrong unit: `insurance-operations` holds `policy.issue` (a business act) AND
   * `insurer.create` (the office recording which companies it deals with, which is set-up and IS
   * in the starting set). A module-level rule would therefore have to either refuse the starting
   * set as it stands or permit `policy.issue` into it.
   *
   * Every prefix below is asserted to match at least one catalogue code, so the list cannot
   * silently stop measuring anything.
   */
  const BUSINESS_ENTITY_PREFIXES = [
    'lead',
    'prospect',
    'needs-assessment',
    'risk-profile',
    'program',
    'opportunity',
    'rfq',
    'quotation',
    'comparison',
    'recommendation',
    'client-decision',
    'policy',
    'endorsement',
    'cancellation',
    'renewal',
    'claim',
    'invoice',
    'receipt',
    'commission',
    'refund',
    'cross-sell',
    'up-sell',
  ];

  it('CRITERION 2 — a registered office gets ONE role, and not one business capability on it', () => {
    /**
     * The ONE-role half is asserted end to end in `brokerage-office-registration.e2e-spec.ts`,
     * against a real registration: the new office holds exactly one role and its grants equal
     * `OFFICE_ADMINISTRATOR_GRANTS` exactly, in both directions.
     *
     * What nothing asserted is the half decision 131 added — «ولا صلاحية عمل عليه». That is a
     * property of the DECLARED SET, so it is checkable here with no database, and it is the half
     * that will be under pressure: the easy way to answer "the new office cannot do anything" is
     * to put a business code in this list.
     */
    const offenders = OFFICE_ADMINISTRATOR_GRANTS.filter((code) =>
      BUSINESS_ENTITY_PREFIXES.includes(code.split('.')[0]),
    );
    expect(
      offenders,
      `OWNER DECISION 131 criterion 2: a newly registered office gets ONE role and NO business ` +
        `capability on it. These codes in OFFICE_ADMINISTRATOR_GRANTS name a business entity: ` +
        `${offenders.join(', ')}. An office DECIDES its own business grants at /settings/roles — ` +
        `that is the whole of decision 131. If one of these genuinely belongs in the starting set, ` +
        `it is an owner decision, not a list edit.`,
    ).toEqual([]);

    // Non-vacuity, both ways: the set is the real 47, and every declared prefix still names
    // something in the catalogue. A prefix that has been renamed away stops measuring in silence.
    expect(OFFICE_ADMINISTRATOR_GRANTS.length).toBeGreaterThanOrEqual(40);
    const unmatched = BUSINESS_ENTITY_PREFIXES.filter(
      (prefix) => !catalogueCodes.some((code) => code.split('.')[0] === prefix),
    );
    expect(
      unmatched,
      `These prefixes match no catalogue code, so they measure nothing: ${unmatched.join(', ')}`,
    ).toEqual([]);
    const measured = catalogueCodes.filter((code) =>
      BUSINESS_ENTITY_PREFIXES.includes(code.split('.')[0]),
    );
    expect(measured.length).toBeGreaterThanOrEqual(60);
  });

  it('CRITERION 3 — the notification goes to the holder of a PERMISSION, and that permission gates the matrix', () => {
    /**
     * «يصل إشعار لحامل صلاحية تعديل الأدوار» — a PERMISSION, never a role name, which is the
     * office-scoped RBAC rule as well as decision 131's own wording.
     *
     * The recipient query exists and is already correct (`findActiveHoldersOfPermission` excludes a
     * RETIRED role, a revoked assignment and an account that cannot act today). What this pins is
     * the code to pass it: if the route that edits a role's grants ever moves to a different
     * permission, the notification would go to the wrong set, silently.
     */
    const controller = readFileSync(
      join(API_SRC, 'modules/rbac/controllers/rbac.controller.ts'),
      'utf8',
    );
    const matrixRoute =
      /@RequirePermissions\('([a-z0-9.-]+)'\)\s*\n\s*@Put\('roles\/:id\/permissions'\)/.exec(
        controller,
      );
    expect(
      matrixRoute,
      `PUT roles/:id/permissions must carry a @RequirePermissions decorator immediately above it — ` +
        `that code IS the notification's recipient set under decision 131 § 6 criterion 3.`,
    ).not.toBeNull();
    expect(matrixRoute?.[1]).toBe('role.update');

    // The permission has to be one an OFFICE can hold, or no office administrator is ever a recipient.
    expect(catalogueCodes).toContain('role.update');
    const entry = /code:\s*"role\.update",[\s\S]{0,1200}?\n\s{2}\},/.exec(
      catalogue,
    );
    expect(entry).not.toBeNull();
    expect(entry?.[0].includes('scope: "PLATFORM"')).toBe(false);

    const userRepository = readFileSync(
      join(API_SRC, 'repositories/user.repository.ts'),
      'utf8',
    );
    expect(userRepository).toContain('findActiveHoldersOfPermission');
  });

  it('CRITERION 4 — the per-office property it rests on is guarded, in ONE home, and still is', () => {
    /**
     * «الأدمن يمنحها لدور ⟵ تزول العلامة في مكتبه وحده.» The clearing fact is the `RolePermission`
     * row itself — which is why the shape in `docs/module-1-new-permission-mark.md` records only a
     * DISMISSAL and never a grant: a second record of the grant could disagree with the first.
     *
     * So "in their office alone" is not a filter anybody writes. It holds because `Role` and
     * `RolePermission` are tenant-scoped while `Permission` is not — and MEASURED 2026-11-12, all
     * three of those are ALREADY asserted, each with its own written reason, in
     * `src/prisma/tenant-scope.extension.spec.ts`.
     *
     * ⛔ So this does not restate them. Restating would be the two-homes defect this file refuses
     * for criterion 1 one paragraph above, committed in the same file that refuses it. What it does
     * instead is pin the POINTER: delete or rename those assertions and criterion 4 loses its guard
     * silently, which is the only way this can go wrong.
     */
    const tenantScopeSpec = readFileSync(
      join(API_SRC, 'prisma/tenant-scope.extension.spec.ts'),
      'utf8',
    );
    for (const assertion of [
      // the grant is per-office — the two models the clearing fact lives in
      "expect(TENANT_SCOPED_MODELS.has('Role')).toBe(true)",
      "expect(TENANT_SCOPED_MODELS.has('RolePermission')).toBe(true)",
      // and the catalogue the mark is computed against is NOT per-office: one global catalogue
      // with per-office grants, which is what «تظهر في مصفوفة كل مكتب» requires
      "'Permission',",
      'expect(TENANT_SCOPED_MODELS.has(global)).toBe(false)',
    ]) {
      expect(
        tenantScopeSpec.includes(assertion),
        `OWNER DECISION 131 § 6 criterion 4 rests on this assertion in ` +
          `src/prisma/tenant-scope.extension.spec.ts and it is gone: ${assertion}. ` +
          `Either restore it there — it is the one home — or move it here deliberately and say so.`,
      ).toBe(true);
    }
    // Non-vacuity: the file really was read, rather than an empty string satisfying `includes`.
    expect(tenantScopeSpec.length).toBeGreaterThan(2000);
  });

  it("CRITERION 5 — one office cannot see another office's decision, and this starts demanding it the day the table lands", () => {
    /**
     * «مكتب آخر لا يرى قرار مكتب.» The only state not already recorded by a grant is the
     * DISMISSAL — the administrator looked and chose not to grant — and that table does not exist
     * yet.
     *
     * Rather than assert nothing until it does, this reads the DMMF: while the model is absent the
     * test records that and passes; the moment it appears it must be tenant-scoped, i.e. carry
     * `organizationId`, or this fails by name. There is no window in which the table exists and
     * nothing checks its isolation.
     */
    const DISMISSAL_MODEL = 'OfficePermissionDismissal';
    const models = Prisma.dmmf.datamodel.models.map((model) => model.name);
    if (!models.includes(DISMISSAL_MODEL)) {
      // Declared, with its home. Non-vacuity: the DMMF really was read, and really does hold the
      // models this file reasons about.
      expect(models).toContain('Role');
      expect(models).toContain('Permission');
      expect(models.length).toBeGreaterThan(100);
      return;
    }
    expect(
      TENANT_SCOPED_MODELS.has(DISMISSAL_MODEL),
      `${DISMISSAL_MODEL} now exists and is NOT tenant-scoped, so one office's decision is ` +
        `readable by another — OWNER DECISION 131 § 6 criterion 5. It needs organizationId, an ` +
        `RLS policy ENABLEd and FORCEd, and the DEFAULT current_setting('app.current_org_id', ` +
        `true). See docs/module-1-new-permission-mark.md.`,
    ).toBe(true);
  });
});
