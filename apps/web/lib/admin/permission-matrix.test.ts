import { describe, expect, it } from 'vitest';
import { buildMatrix, codesOfRow, familyOf, grantedInModule, verbOf } from './permission-matrix';
import { machineNameProblem, toMachineName } from './role-name';
import { PERMISSION_CATALOGUE } from '../../e2e/fixtures/role-permissions';

/**
 * The catalogue fixture is generated from the seeded database (`npm run db:fixture:permissions`),
 * so these assertions run against the REAL 186 codes rather than a hand-written sample. That is
 * deliberate: the owner asked for the rule to be checkable rather than the number trusted, and
 * pinning the counts here means ADDING A PERMISSION FAILS THIS TEST instead of quietly changing
 * what the screen shows.
 */
describe('the permission matrix is derived from the catalogue, not hard-coded', () => {
  const matrix = buildMatrix(PERMISSION_CATALOGUE);

  it('covers every code exactly once', () => {
    const covered = matrix.flatMap((m) => m.rows.flatMap(codesOfRow)).sort();
    const all = PERMISSION_CATALOGUE.map((p) => p.code).sort();
    expect(covered).toEqual(all);
    // No code may appear in two rows: a permission granted from two controls is a permission whose
    // state the screen cannot show honestly.
    expect(new Set(covered).size).toBe(covered.length);
  });

  it('groups into the 12 modules the catalogue declares', () => {
    expect(matrix.length).toBe(12);
    expect(matrix.map((m) => m.module)).toEqual([...matrix.map((m) => m.module)].sort());
  });

  it('applies five states to exactly the CRUD-shaped families, and a toggle to the rest', () => {
    const crud = matrix.flatMap((m) => m.rows.filter((r) => r.kind === 'crud'));
    const toggles = matrix.flatMap((m) => m.rows.filter((r) => r.kind === 'toggle'));

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
    expect(PERMISSION_CATALOGUE.length).toBe(206);
    expect(crud.length).toBe(19);
    expect(crud.flatMap(codesOfRow).length).toBe(51);
    expect(toggles.length).toBe(155);
    expect(crud.flatMap(codesOfRow).length + toggles.length).toBe(PERMISSION_CATALOGUE.length);
  });

  it('every five-state row really has two or more CRUD verbs — the rule, not the count', () => {
    const VERBS = ['read', 'create', 'update', 'delete', 'deactivate', 'view', 'manage'];
    for (const row of matrix.flatMap((m) => m.rows)) {
      if (row.kind !== 'crud') continue;
      const verbs = Object.keys(row.codes);
      expect(verbs.length, `${row.family} qualified with ${verbs.length} verb(s)`).toBeGreaterThanOrEqual(2);
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
    expect(grantedInModule(picked, new Set(picked.codes))).toBe(picked.codes.length);
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
    expect(toMachineName('  Senior   Underwriter  ')).toBe('SENIOR_UNDERWRITER');
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
