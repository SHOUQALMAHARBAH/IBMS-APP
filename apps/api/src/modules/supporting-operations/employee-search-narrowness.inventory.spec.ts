import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * THE NARROW EMPLOYEE SEARCH MUST STAY NARROW — IMPROVEMENTS § 1.83, the owner's condition 4.
 *
 * `GET /employees/search` exists because `employee.national-id.reveal` was unusable by its only holder:
 * COMPLIANCE_OFFICER holds that code and no `employee.read`, so the route accepted the call and the
 * employee's id was undiscoverable. The owner refused the wide fix (grant Compliance `employee.read`) and
 * refused leaving it broken. This is the narrow one — find a named person, reveal, nothing more.
 *
 * She named the failure mode when she ruled: **"narrow" decays into "a directory by another name"** unless
 * something refuses the widening. Two things can widen it, and this file refuses both:
 *
 *   1. AN EMPTY SEARCH RETURNING ROWS. "An empty search that returns everyone is browsing with extra
 *      steps." Enforced by `SearchEmployeesDto` — `@Transform(trimIfString)` runs BEFORE `@MinLength(2)`,
 *      so a whitespace-only term becomes '' and is refused with a 400 rather than reaching the repository
 *      as a match-everything pattern. Asserted through real HTTP in
 *      `apps/api/test/employee-narrow-search.e2e-spec.ts`; asserted HERE as source structure, because the
 *      ORDER of those two decorators is the whole mechanism and a reordering would not fail any request
 *      test that only sends '' rather than '   '.
 *
 *   2. A FIELD OUTSIDE THE ALLOWED SET APPEARING IN A RESULT. Pinned below against the key set of
 *      `EmployeeSearchResultView` itself, so adding a sixth field fails a test instead of arriving quietly.
 *
 * ## Why source assertions rather than only request assertions
 *
 * A request test proves what one call returned. It cannot prove that the SELECT could not return more —
 * `select` could grow a column that happens not to be populated in the fixture, and every request
 * assertion would still pass. So this file reads the source: the repository's `select`, the view's key set,
 * and the decorator order. The e2e proves the behaviour; this proves the shape cannot drift.
 */

const HERE = __dirname;
const REPO = path.join(
  HERE,
  '..',
  '..',
  'repositories',
  'employee.repository.ts',
);
const SERVICE = path.join(HERE, 'employee.service.ts');
const DTO = path.join(HERE, 'dto', 'search-employees.dto.ts');

/**
 * The only facts a holder of `employee.national-id.reveal` may learn about a person WITHOUT holding
 * `employee.read`. Each earns its place: the id (the reveal needs it), the name in both languages (one
 * fact, twice, on an Arabic-first platform), the job title (what tells two people of one name apart), and
 * whether they still work here (the other real disambiguator).
 *
 * Adding to this list is a decision about what Compliance may see about staff without the read permission.
 * It is not a convenience.
 */
const ALLOWED_RESULT_FIELDS = [
  'fullName',
  'fullNameEn',
  'id',
  'isCurrentEmployee',
  'position',
];

/**
 * What the repository query is allowed to SELECT. Differs from the list above by exactly one column:
 * `terminationDate` is selected and then reduced to `isCurrentEmployee` in the service, so the date itself
 * never crosses the wire.
 */
const ALLOWED_SELECT_COLUMNS = [
  'fullName',
  'fullNameEn',
  'id',
  'position',
  'terminationDate',
];

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/** The body of a named `interface`, so a key list can be compared rather than eyeballed. */
function interfaceKeys(src: string, name: string): string[] {
  const start = src.indexOf(`export interface ${name} {`);
  if (start === -1) throw new Error(`interface ${name} not found`);
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n}', open);
  const body = src.slice(open + 1, close);
  return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort();
}

describe('the narrow employee search stays narrow (§ 1.83)', () => {
  it('returns only the fields that distinguish one person from another', () => {
    expect(
      interfaceKeys(read(SERVICE), 'EmployeeSearchResultView'),
      'A field was added to the employee search result. This search is the ONLY thing a Compliance ' +
        'Officer may learn about staff without holding `employee.read`, and the owner ruled it must stay ' +
        '"find a named person, reveal, nothing more". Adding a field is a decision about staff privacy: ' +
        'make it deliberately, update ALLOWED_RESULT_FIELDS, and say why in the interface.',
    ).toEqual([...ALLOWED_RESULT_FIELDS].sort());
  });

  it('selects only those columns from the database, plus the one it reduces to a boolean', () => {
    const src = read(REPO);
    const start = src.indexOf('searchByName(');
    expect(
      start,
      'searchByName is gone from EmployeeRepository',
    ).toBeGreaterThan(-1);
    const selectAt = src.indexOf('select: {', start);
    const columns = [
      ...src
        .slice(selectAt, src.indexOf('},', selectAt))
        .matchAll(/^\s*(\w+):\s*true/gm),
    ]
      .map((m) => m[1])
      .sort();
    expect(
      columns,
      'The narrow search query selects a column outside the allowed set. A request test cannot catch ' +
        'this — a new column can be selected and simply be null in the fixture — which is why the SELECT ' +
        'is asserted here.',
    ).toEqual([...ALLOWED_SELECT_COLUMNS].sort());
  });

  it('cannot be asked for everyone: the term is trimmed BEFORE its length is checked', () => {
    const src = read(DTO);
    // DECORATOR LINES ONLY, anchored at the line start. A bare `indexOf` reads the doc comment above the
    // field, which explains the mechanism and therefore NAMES both decorators — so the first version of
    // this assertion compared two prose positions and failed against a correct DTO. Same class as the `;`
    // in a comment that once truncated the AuditAction parser: never bound a source matcher on a token
    // that can appear in prose.
    const decoratorAt = (name: string): number => {
      const m = new RegExp(`^\\s*@${name}\\b`, 'm').exec(src);
      return m ? m.index : -1;
    };
    const transformAt = decoratorAt('Transform');
    const minLengthAt = decoratorAt('MinLength');
    expect(transformAt, '@Transform(trimIfString) is gone').toBeGreaterThan(-1);
    expect(minLengthAt, '@MinLength(2) is gone').toBeGreaterThan(-1);
    // ORDER IS THE MECHANISM. class-validator applies @Transform first only because it is declared first;
    // reversed, '   ' passes the length check and reaches the repository as a match-everything pattern —
    // the owner's "an empty search that returns everyone is browsing with extra steps".
    expect(
      transformAt,
      'The trim must be declared BEFORE @MinLength, or a whitespace-only search term passes the length ' +
        'floor and matches every employee. A test that only sends an empty string would not notice.',
    ).toBeLessThan(minLengthAt);
  });

  it('has no pagination or take parameter that could walk the whole staff list', () => {
    const src = read(DTO);
    for (const widener of [
      'page',
      'take',
      'limit',
      'offset',
      'cursor',
      'all',
    ]) {
      expect(
        new RegExp(`^\\s*${widener}[?!]?:`, 'm').test(src),
        `SearchEmployeesDto gained a "${widener}" parameter. There is deliberately no second page: ` +
          'pagination makes "walk the whole staff list two at a time" reachable, which is what the ' +
          'mandatory search term exists to prevent.',
      ).toBe(false);
    }
  });

  it('is not vacuous — the files really do parse', () => {
    // Without this, a wrong path or a renamed symbol would make every matcher above operate on an empty
    // string, the lists would have to be emptied to match, and the guard would pass while asserting
    // nothing. The same non-vacuity floor the multer-reachability and audit-action guards carry.
    expect(read(SERVICE)).toContain('EmployeeSearchResultView');
    expect(read(REPO)).toContain('searchByName');
    expect(read(DTO)).toContain('SearchEmployeesDto');
  });
});
