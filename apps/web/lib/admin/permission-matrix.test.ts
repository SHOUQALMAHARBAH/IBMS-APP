import { describe, expect, it } from 'vitest';
import {
  buildMatrix,
  codesOfRow,
  familyOf,
  grantedInModule,
  verbOf,
} from './permission-matrix';
import { machineNameProblem, toMachineName } from './role-name';
import { PERMISSION_CATALOGUE } from '../../e2e/fixtures/role-permissions';

/**
 * The catalogue fixture is generated from the seeded database (`npm run db:fixture:permissions`),
 * so these assertions run against the REAL catalogue rather than a hand-written sample — the count is
 * pinned in the test below rather than quoted here, because a figure in a comment is the half that
 * rots. That is
 * deliberate: the owner asked for the rule to be checkable rather than the number trusted, and
 * pinning the counts here means ADDING A PERMISSION FAILS THIS TEST instead of quietly changing
 * what the screen shows.
 */
describe('the permission matrix is derived from the catalogue, not hard-coded', () => {
  const matrix = buildMatrix(PERMISSION_CATALOGUE);

  it('covers every OFFICE-SCOPED code exactly once, and no PLATFORM code at all', () => {
    const covered = matrix.flatMap((m) => m.rows.flatMap(codesOfRow)).sort();
    /*
     * MODULE 0 ITEM (j)'s GAP CLOSURE narrowed this from "every code" to "every OFFICE-scoped
     * code". This screen is the OFFICE role builder, and a PLATFORM code reaches across offices, so
     * offering one would invite an administrator to tick a box the server then refuses.
     *
     * Both halves are asserted. The first alone would pass against a matrix that dropped a code for
     * any reason; the second names the property — the platform codes are ABSENT, not merely
     * uncounted.
     */
    const officeScoped = PERMISSION_CATALOGUE.filter(
      (p) => p.scope !== 'PLATFORM',
    ).map((p) => p.code);
    const platform = PERMISSION_CATALOGUE.filter(
      (p) => p.scope === 'PLATFORM',
    ).map((p) => p.code);
    expect(covered).toEqual([...officeScoped].sort());
    expect(
      platform.length,
      'no code in the catalogue is PLATFORM-scoped, so this check is vacuous — item (j) made `provider.office-state.read` the first one.',
    ).toBeGreaterThan(0);
    for (const code of platform) {
      expect(
        covered,
        `${code} is PLATFORM-scoped and appears in the OFFICE role matrix. It reaches across offices and the server refuses granting it to a brokerage office, so the screen must not offer it.`,
      ).not.toContain(code);
    }
    // No code may appear in two rows: a permission granted from two controls is a permission whose
    // state the screen cannot show honestly.
    expect(new Set(covered).size).toBe(covered.length);
  });

  it('groups into the 12 modules the catalogue declares', () => {
    expect(matrix.length).toBe(12);
    expect(matrix.map((m) => m.module)).toEqual(
      [...matrix.map((m) => m.module)].sort(),
    );
  });

  it('applies five states to exactly the CRUD-shaped families, and a toggle to the rest', () => {
    const crud = matrix.flatMap((m) => m.rows.filter((r) => r.kind === 'crud'));
    const toggles = matrix.flatMap((m) =>
      m.rows.filter((r) => r.kind === 'toggle'),
    );

    // THE MEASURED SHAPE. If a permission is added, one of these numbers changes and this test
    // fails — which is the alarm, not an inconvenience. Re-measure and update deliberately.
    // Recomputed after four-action Phase 1: four umbrellas became 14 successors and two ride-along
    // actions got their own codes. 194 -> 206. The previous pins were 194 / 15 / 35 / 159 and this test
    // FAILED on them, which is the alarm working — twice now, for the same reason. Not loosened, not a
    // range, not read from the source it checks.
    //
    // The interesting movement is 35 -> 51 five-state codes against 159 -> 155 toggles: splitting an
    // umbrella does not just add rows, it MOVES codes out of the toggle list into a family. That is the
    // scheme becoming visible on the screen, which is the point of it.
    //
    // 216 -> 217 (IMPROVEMENTS § 3.14: `customer.update`, so a customer's contact details can be
    // corrected at all). This one CREATES a family: `customer` had only `customer.create` as a CRUD verb
    // and was therefore a toggle, and two verbs is the threshold — so families go 20 -> 21, family codes
    // 56 -> 58 (create AND update), and toggles 160 -> 159 because `create` moved out of that list.
    // `customer.bulk-import` stays a toggle; it is not one of the seven CRUD verbs.
    //
    // 213 -> 216 (four-action Phase 4, second umbrella, owner-ruled: `sla.policy.manage` becomes
    // `.create` / `.update` / `.deactivate` PLUS `sla.holiday.create`). Four successors for one umbrella
    // because it gated two ENTITIES — SLA policies and the business-day holiday calendar — which is
    // `insurer.relationship.manage`'s case, not `payment-channel.manage`'s.
    //
    // The families count does NOT move: `sla.policy` was ALREADY a family, because `.read` and `.manage`
    // are both CRUD verbs and two is the threshold. It grows from 2 members to 4. And `sla.holiday.create`
    // is a lone CRUD verb in its own family, so it lands in the TOGGLE list — the mirror of what
    // `payment-channel` did one commit ago, where a toggle became a family. Same rule, opposite direction,
    // which is why the four numbers are pinned separately rather than as one total.
    //
    // 211 -> 213 (four-action Phase 4: `payment-channel.manage` becomes `.read` / `.create` /
    // `.deactivate`). This one MOVES A ROW BETWEEN THE TWO LISTS, which is the movement worth reading:
    // the umbrella was a TOGGLE, because `familyOf` gave it the family `payment-channel` with exactly one
    // member and one CRUD verb is not a family. Three members with three CRUD verbs qualifies, so
    // families go 19 -> 20, family codes 51 -> 54, and toggles go 160 -> 159 — one fewer toggle out of a
    // split that added two codes. That arithmetic is the scheme working, and it is why these four numbers
    // are pinned separately rather than as one total.
    //
    // 210 -> 211 (Part 4 step 4: `duty-segregation.mode.declare` — the office administrator declaring
    // whether this office separates the two halves of a maker/checker pair). A TOGGLE, like the four
    // discard codes below: declaring a governance posture is not a point on the
    // none/read/write/delete/full scale.
    //
    // 206 -> 210 (Class B piece 1: `policy.discard`, `claim.discard`, `endorsement.discard`,
    // `recommendation.discard`). All four land in the TOGGLE list, 155 -> 159, and the five-state rows do
    // not move: `discard` is not one of the seven CRUD verbs a family row is built from, and it should not
    // become one. A five-state control offers none / read / read+write / +delete / full, and a discard is not
    // a point on that scale — it is a separate act with its own terminal semantics. An office granting
    // "full" on policies is not thereby granting the withdrawal of a placement, and the matrix says so by
    // rendering it as its own checkbox.
    // `customer.read` (the narrow list code, split off `customer.360-view.read`) moves TWO of the four and
    // leaves two alone, which is the arithmetic worth reading: the `customer` family already held two CRUD
    // verbs (`create`, `update`), so it was already a five-state row — this adds a THIRD verb to an existing
    // row rather than creating one. Families stay at 21 and the toggle list does not move at all.
    // `diagnostics.view` (the code that replaced a ROLE-NAME read on /settings/email) moves exactly two of
    // the four: it is the only member of a `diagnostics` family, and one CRUD verb is not a family, so it
    // lands in the TOGGLE list. Families and the codes they cover do not move at all.
    // `provider.office-state.read` (Module 0 item (j), the cross-office provider dashboard) moves
    // exactly two of the four: it is the only member of a `provider` family, and one CRUD verb is
    // not a family, so it lands in the TOGGLE list. Families and the codes they cover do not move —
    // the same arithmetic `diagnostics.view` produced, for the same reason.
    // `provider.office.register` (Module 0-ب item (d), the route that creates a tenant) moves exactly
    // ONE of the four. It is PLATFORM-scoped like its sibling, so the matrix never offers it: the
    // catalogue grows and the toggle list does not. `provider` now holds TWO codes — but
    // `office-state.read` and `office.register` are two different FAMILIES by the matrix's own
    // reading (`provider.office-state` and `provider.office`), so no five-state row appears either,
    // which is the right answer for a pair an office may never hold.
    // `insurer.company.link` and `insurer.company.unlink` (module 0-ب item (e), decision 63) move
    // THREE of the four. They are OFFICE-scoped, so the matrix does offer them — and `insurer.company`
    // is a new family with exactly two members, but neither `link` nor `unlink` is one of the seven
    // CRUD verbs a five-state row is built from, so they land in the TOGGLE list and the family count
    // does not move. The same arithmetic `discard` produced, for the same reason: a five-state control
    // offers none / read / read+write / +delete / full, and "link" is not a point on that scale.
    // `provider.insurer.register` (module 0-ب item (e)) moves exactly ONE of the four: it is
    // PLATFORM-scoped like its two siblings, so the matrix never offers it and the toggle list does
    // not grow. The catalogue does.
    // `provider.office.administrator.invite` (module 0-ب item (f)) moves exactly ONE of the four,
    // for the third time and the same reason: PLATFORM-scoped, so the matrix never offers it and the
    // toggle list does not grow. It also does NOT create a family — `provider.office.register` and
    // `provider.office.administrator.invite` read as the families `provider.office` and
    // `provider.office.administrator` by the matrix's own segment rule, and a one-member family is
    // not a five-state row. So the catalogue grows and the other three figures stand.
    /*
     * MODULE 0 CLOSE, DECISION 3 — the retention umbrella SPLIT, so the catalogue moves +1 (one code
     * out, two in) and the TOGGLE list moves +1 for the same reason.
     *
     * NO NEW FAMILY, and the arithmetic is the matrix's own: a five-state row needs TWO OR MORE of
     * the seven CRUD verbs, and `retention-schedule` now holds `.update` (a verb) and `.confirm`
     * (not one — "confirm" is not a point on the none/read/write/delete/full scale, the same reason
     * `link`, `unlink` and `discard` land in the toggle list). One verb is not a family.
     */
    expect(PERMISSION_CATALOGUE.length).toBe(227);
    expect(crud.length).toBe(21);
    expect(crud.flatMap(codesOfRow).length).toBe(59);
    // 160, not 161: `provider.office-state.read` is PLATFORM-scoped since item (j)'s gap closure
    // and the matrix no longer offers it — so the toggle list loses exactly the one code it added.
    /*
     * STILL 163 AFTER A 227th CODE, and that is the PLATFORM filter being observable rather than an
     * oversight. 59 CRUD-family codes + 163 toggles = 222, not 227: the office matrix never offers a
     * PLATFORM-scoped code (module 0 item (j)), and all FIVE of them are outside these two buckets.
     * So a new PLATFORM code moves `PERMISSION_CATALOGUE.length` and moves nothing here. Raising this
     * to 164 is what I tried first; the guard refused with `expected 163 to be 164`.
     */
    expect(toggles.length).toBe(163);
    // Against the OFFICE-SCOPED count, which is what the matrix covers.
    expect(crud.flatMap(codesOfRow).length + toggles.length).toBe(
      PERMISSION_CATALOGUE.filter((p) => p.scope !== 'PLATFORM').length,
    );
  });

  it('every five-state row really has two or more CRUD verbs — the rule, not the count', () => {
    const VERBS = [
      'read',
      'create',
      'update',
      'delete',
      'deactivate',
      'view',
      'manage',
    ];
    for (const row of matrix.flatMap((m) => m.rows)) {
      if (row.kind !== 'crud') continue;
      const verbs = Object.keys(row.codes);
      expect(
        verbs.length,
        `${row.family} qualified with ${verbs.length} verb(s)`,
      ).toBeGreaterThanOrEqual(2);
      for (const verb of verbs) expect(VERBS).toContain(verb);
    }
  });

  it('never invents a state a family does not have', () => {
    // A family with read/create/update and no delete must show four controls, not five with one
    // that would grant a code the catalogue does not contain.
    for (const row of matrix.flatMap((m) => m.rows)) {
      if (row.kind !== 'crud') continue;
      for (const [verb, code] of Object.entries(row.codes)) {
        expect(code).toBe(`${row.family}.${verb}`);
        expect(PERMISSION_CATALOGUE.map((p) => p.code)).toContain(code);
      }
    }
  });

  it('counts a module the way the collapsed view shows it', () => {
    const picked = matrix.find((m) => m.codes.length > 3)!;
    const granted = new Set(picked.codes.slice(0, 3));
    expect(grantedInModule(picked, granted)).toBe(3);
    expect(grantedInModule(picked, new Set())).toBe(0);
    expect(grantedInModule(picked, new Set(picked.codes))).toBe(
      picked.codes.length,
    );
  });

  it('splits a code into family and verb', () => {
    expect(familyOf('customer.360-view.read')).toBe('customer.360-view');
    expect(verbOf('customer.360-view.read')).toBe('read');
    // A single-segment code is its own family rather than throwing.
    expect(familyOf('audit')).toBe('audit');
  });
});

describe('the machine name is generated, and refused when it would be unreadable', () => {
  it('reads back to the role it names', () => {
    expect(toMachineName('Claims Triage Desk')).toBe('CLAIMS_TRIAGE_DESK');
    expect(toMachineName('  Senior   Underwriter  ')).toBe(
      'SENIOR_UNDERWRITER',
    );
    expect(toMachineName('Finance / Collections')).toBe('FINANCE_COLLECTIONS');
    expect(toMachineName('Café Manager')).toBe('CAFE_MANAGER');
    expect(toMachineName('HR')).toBe('HR');
  });

  it('never leaves a dangling or doubled underscore', () => {
    expect(toMachineName('!!Claims!!')).toBe('CLAIMS');
    expect(toMachineName('a---b')).toBe('A_B');
    expect(toMachineName('_lead_')).toBe('LEAD');
  });

  it('caps at the 100 characters the API accepts', () => {
    const generated = toMachineName('x'.repeat(250));
    expect(generated.length).toBeLessThanOrEqual(100);
    expect(generated.endsWith('_')).toBe(false);
  });

  it('REFUSES the cases that would store an identifier nobody can read', () => {
    // Arabic in the English-name field folds away entirely — the measured real-world failure.
    expect(machineNameProblem('دور جديد')).toBe('unreadable');
    expect(toMachineName('دور جديد')).toBe('');
    // Digits say nothing about which role this is.
    expect(machineNameProblem('2024')).toBe('unreadable');
    // Punctuation collapses to nothing.
    expect(machineNameProblem('!!!')).toBe('unreadable');
    // A single letter is not a name.
    expect(machineNameProblem('A')).toBe('unreadable');
    // Empty is its own case, so the screen can say "required" rather than "unreadable".
    expect(machineNameProblem('   ')).toBe('empty');
  });

  it('accepts the shortest name that is still readable', () => {
    expect(machineNameProblem('HR')).toBeNull();
    expect(machineNameProblem('Claims Triage Desk')).toBeNull();
    // Letters plus digits is fine — the letters carry the meaning.
    expect(machineNameProblem('Tier 2 Support')).toBeNull();
    expect(toMachineName('Tier 2 Support')).toBe('TIER_2_SUPPORT');
  });
});
