import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative as relativePath, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopeCovers, withinRoleScope } from './role-scope';

/**
 * MODULE 0 ITEM (h)'s GUARD — "fails if any permission evaluation bypasses the scope".
 *
 * The design note is `docs/decision-role-scope.md`. What this file holds, and what it deliberately
 * does NOT claim, matters as much as the assertions:
 *
 * ## What it proves
 *
 *   1. Every service that WRITES a row carrying an insurance line reaches the one scope decision,
 *      or is named in `UNSCOPED_WRITERS` with a reason. Measured from the source, so a new write
 *      surface is covered without anybody remembering to extend a list.
 *   2. The decision exists in exactly ONE place. Two copies is how one of them comes back looser
 *      than it went in — this repository has measured that twice.
 *   3. No permission code names an insurance type, so "codes are not duplicated per type" cannot
 *      creep back one code at a time.
 *   4. The matcher is not vacuous: it must find the write surfaces it claims to check.
 *
 * ## What it does NOT prove, stated so nobody reads more into a green run
 *
 *   - READS are not scoped, deliberately. § 4.2 of the note: `prisma.policy` is reached from 31
 *     non-spec files, most of them dashboards and the finance report, and a silently narrowed
 *     aggregate is a confidently wrong number on a money report — a worse failure than a refusal.
 *   - It cannot prove a service reaches its repository only through its own checked method. That is
 *     what the repositories' narrow signatures are for.
 */

const API_SRC = join(__dirname, '..');

/**
 * The ONE file that may contain the comparison.
 *
 * Named rather than derived, because the property being guarded is "there is exactly one", and a
 * derived answer to that question would be the thing it is checking.
 */
const DECISION_FILE = 'common/role-scope.ts';

/** The services that WRITE a row carrying an insurance line, and therefore must decide scope. */
const SCOPED_WRITERS = [
  'modules/insurance-program/insurance-program.service.ts',
  'modules/rfq/rfq.service.ts',
  'modules/policy/policy.service.ts',
  'modules/commission/commission-agreement.service.ts',
];

/**
 * Write surfaces that carry a line and are deliberately NOT scoped, each with its reason.
 *
 * These are not exemptions of convenience. All five record what the OFFICE or one of its PEOPLE is
 * LICENSED for — which is the INPUT to scope, not a thing scope governs. Scoping them would mean a
 * GENERAL-scoped administrator could not record the office's own life licence, which inverts the
 * relationship: the licence is what makes a scope possible, so a scope cannot gate the licence.
 */
const UNSCOPED_WRITERS: Record<string, string> = {
  'modules/compliance-risk/broker-license-scope.service.ts':
    "the OFFICE's own licensed branches — the input to scope, item (e)",
  'modules/supporting-operations/employee-cbj-approval.service.ts':
    "a PERSON's CBJ approval branches — the input to scope, item (g)",
  'modules/insurer/insurer-master.service.ts':
    'the global insurer catalogue and which lines an insurer offers — not business placed in a line',
  'modules/insurer/office-insurer-form.service.ts':
    "an office's own mapping of an insurer form — a configuration row, not business",
  'modules/rbac/services/role-admin.service.ts':
    'writes the SCOPE itself; scoping that would make a scope unchangeable once set',
};

function read(relative: string): string | null {
  try {
    const path = join(API_SRC, relative);
    if (!statSync(path).isFile()) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function allSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allSources(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      out.push(full);
  }
  return out;
}

/** A file that WRITES a row carrying an insurance line, found by shape rather than by a list. */
function writesALine(source: string): boolean {
  // A write, not a read: the id appears inside a `create`/`update` data object. Approximated by
  // "mentions a line id AND calls a write", which over-selects rather than under-selects — the
  // direction a guard should err in, because an over-selected file is answered by a row in
  // UNSCOPED_WRITERS with a reason, while an under-selected one is silently unchecked.
  const namesALine = /\b(insuranceLineId|officeInsuranceLineId)\b/.test(source);
  const writes =
    /\.(create|createMany|update|updateMany|upsert)\(/.test(source) ||
    /\b(create|createLines|reassembleLines|addLine|addBranch|supersedeAndCreateAgreement)\(/.test(
      source,
    );
  return namesALine && writes;
}

describe('item (h): every line-writing service decides the role scope', () => {
  it('the named write surfaces exist — the guard is not checking nothing', () => {
    // Without this, renaming `policy.service.ts` would turn the check below into a loop over one
    // file fewer and pass. This repository has been bitten by a measurement that found nothing and
    // read exactly like a measurement that found no problem.
    for (const relative of SCOPED_WRITERS) {
      expect(
        read(relative),
        `${relative} is named in SCOPED_WRITERS and does not exist — re-point the row rather than deleting it.`,
      ).not.toBeNull();
    }
    for (const relative of Object.keys(UNSCOPED_WRITERS)) {
      expect(
        read(relative),
        `${relative} is named in UNSCOPED_WRITERS and does not exist — re-point the row rather than deleting it.`,
      ).not.toBeNull();
    }
  }, 30_000);

  it('each one calls assertWithinRoleScope', () => {
    for (const relative of SCOPED_WRITERS) {
      const source = read(relative);
      if (source === null) continue; // the test above is what fails for this
      expect(
        source.includes('assertWithinRoleScope('),
        `${relative} writes a row carrying an insurance line and never calls assertWithinRoleScope. ` +
          'Module 0 item (h): a role scoped to one insurance type must not be able to write ' +
          'business in the other. Call the decision in `common/role-scope.ts` where the line is ' +
          'known, or add a row to UNSCOPED_WRITERS with a reason that survives review.',
      ).toBe(true);
    }
  }, 30_000);

  /*
   * AN EXPLICIT TIMEOUT, AND IT IS NOT A MITIGATION FOR A FLAKE.
   *
   * Every test in this file READS THE WHOLE API SOURCE TREE from disk. Measured under a parallel
   * `vitest run src/common`: 6915ms, against vitest's 5000ms default — so it passes alone every
   * time and fails under load, which looks exactly like flakiness and is not. It is I/O cost.
   *
   * Raising a timeout is normally the wrong move — this repository has a recorded lesson about
   * mitigations that buy time and hide the next crossing. The distinction here is that nothing is
   * being hidden: the assertion is correct, the work is genuinely file I/O over hundreds of files,
   * and 5s is simply the wrong budget for it. The alternative — leaving it — means CI goes red on
   * load and somebody learns to re-run the suite until it is green, which is how a real failure
   * gets dismissed later.
   *
   * `screen-copy.test.ts` has the same shape for the same reason and is recorded as a known flake;
   * this one is fixed rather than recorded, because CI does run `src/common`.
   */
  it('NO OTHER service writes a line without deciding scope', () => {
    /*
     * The half that makes this a guard rather than a checklist: a NEW write surface is found by
     * shape, so it is covered the moment it is written rather than when somebody remembers.
     */
    const offenders: string[] = [];
    for (const file of allSources(join(API_SRC, 'modules'))) {
      // `path.relative` + `split(sep)`, NOT a hand-built `API_SRC + sep` prefix strip: the
      // first version used a literal backslash, which is WINDOWS-ONLY — on CI's Linux every
      // path would have stayed absolute, matched no UNSCOPED_WRITERS row, and this guard would
      // have gone red on a clean tree. Found by reading it, not by a failing build.
      const relative = relativePath(API_SRC, file).split(sep).join('/');
      const source = readFileSync(file, 'utf8');
      if (!writesALine(source)) continue;
      if (source.includes('assertWithinRoleScope(')) continue;
      if (relative in UNSCOPED_WRITERS) continue;
      offenders.push(relative);
    }
    expect(
      offenders,
      'a service writes a row carrying an insurance line and decides no role scope. Module 0 item ' +
        '(h): either call `assertWithinRoleScope` where the line is known, or add the file to ' +
        'UNSCOPED_WRITERS in this spec with a reason. An over-selected file is a one-line row with ' +
        'an argument; an unchecked one is a scope a request walks around.',
    ).toEqual([]);
  }, 30_000);

  it('the matcher really does find line-writing files — not vacuous', () => {
    // If `writesALine` ever stops recognising the shape, every assertion above passes over an
    // empty set. Four is the measured number of scoped writers; the floor is deliberately lower so
    // this does not fail on an unrelated refactor, and higher than zero so it cannot be empty.
    const found = allSources(join(API_SRC, 'modules')).filter((f) =>
      writesALine(readFileSync(f, 'utf8')),
    );
    expect(
      found.length,
      'the line-writing matcher found nothing at all — its shape has drifted and every check in this file is now vacuous.',
    ).toBeGreaterThanOrEqual(4);
  }, 30_000);
});

describe('item (h): the scope decision has exactly one home', () => {
  it('no file outside common/role-scope.ts compares a scope category to a resource category', () => {
    /*
     * TWO COPIES IS HOW ONE COMES BACK LOOSER. This repository has measured that twice — the
     * `canActToday` predicate that omitted the access-window half, and the two copies of the
     * combined-duty condition that one screen computed twice.
     *
     * Matched on the SHAPE of the comparison rather than on a function name, so a hand-rolled
     * version that does not call the helper is still caught.
     */
    const offenders: string[] = [];
    for (const file of allSources(API_SRC)) {
      // `path.relative` + `split(sep)`, NOT a hand-built `API_SRC + sep` prefix strip: the
      // first version used a literal backslash, which is WINDOWS-ONLY — on CI's Linux every
      // path would have stayed absolute, matched no UNSCOPED_WRITERS row, and this guard would
      // have gone red on a clean tree. Found by reading it, not by a failing build.
      const relative = relativePath(API_SRC, file).split(sep).join('/');
      if (relative === DECISION_FILE) continue;
      const source = readFileSync(file, 'utf8');
      /*
       * A PRESENCE CHECK IS NOT THE COMPARISON. `dto.insuranceLineCategory === undefined` asks
       * "did the caller send this field", which the role-admin service legitimately does to tell
       * "leave it alone" from "clear it".
       *
       * The right-hand token is CAPTURED and compared in JS rather than excluded by a negative
       * lookahead, and that is not style. `===\s*(?!undefined)` BACKTRACKS `\s*` to zero width, so
       * the lookahead then tests " undefined" — which does not start with `undefined` — and the
       * exclusion silently does nothing. It flagged the file anyway and read like a real finding.
       */
      const comparisons = [
        ...source.matchAll(
          /insuranceLineCategory\s*[!=]==\s*([A-Za-z_$][\w$.?]*)/g,
        ),
      ].filter((m) => m[1] !== 'undefined' && m[1] !== 'null');
      // `\??\.` and not `\.`, found by a plant rather than by reading: `roleScopes` is an
      // OPTIONAL field, so `actor.roleScopes?.some(...)` is the IDIOMATIC way to write a second
      // copy — and the first version of this pattern required a plain dot, so it would have
      // missed every realistic instance while passing on a clean tree.
      const unions = /roleScopes\s*\??\.\s*(some|every|filter)\s*\(/.test(
        source,
      );
      if (comparisons.length > 0 || unions) {
        offenders.push(relative);
      }
    }
    expect(
      offenders,
      'a file outside `common/role-scope.ts` reasons about a role scope directly. The decision has ' +
        'ONE home: call `withinRoleScope` or `assertWithinRoleScope`. A second copy of the ' +
        'comparison is how one of the two comes back looser than it went in.',
    ).toEqual([]);
  }, 30_000);

  it('and the one home really contains the comparison — not vacuous', () => {
    const decision = read(DECISION_FILE);
    expect(decision).not.toBeNull();
    expect(decision).toContain('scope.category');
    expect(decision).toContain('lineIds');
  }, 30_000);
});

/**
 * The permission codes, read from the seed's own source TEXT rather than imported.
 *
 * `PERMISSIONS` lives in `packages/db/prisma/seed-data/`, which is OUTSIDE `@ibms/db`'s exported
 * `src` — and an api spec importing across the repo root typechecks on a laptop and fails inside
 * the pruned Docker image, a trap this repository has already paid for once. Reading the text is
 * what several guards here already do (the schema, the generated client, the dictionaries), and it
 * costs a non-vacuity floor rather than a build.
 */
function permissionCodes(): string[] {
  const source = readFileSync(
    join(API_SRC, '../../../packages/db/prisma/seed-data/permissions.ts'),
    'utf8',
  );
  return [...source.matchAll(/\bcode:\s*'([^']+)'|\bcode:\s*"([^"]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((c): c is string => typeof c === 'string');
}

describe('item (h): permission codes are not duplicated per insurance type', () => {
  it('no permission code names an insurance type', () => {
    // Scope is a second dimension ON THE ROLE, not a prefix on the code: there is no
    // `policy.place.general`, there is `policy.place` held by a GENERAL-scoped role. Asserted so
    // the duplication cannot creep back one code at a time — which is how a catalogue doubles.
    // Anchored on a separator rather than `\b`, so a code that merely CONTAINS the letters —
    // `claim.lifecycle.read` would match a bare `\blife\b`-less substring test — is not flagged.
    const offenders = permissionCodes().filter((code) =>
      /(^|[.-])(general|life)([.-]|$)/i.test(code),
    );
    expect(
      offenders,
      'a permission code names an insurance type. Module 0 item (h): the TYPE belongs to the role ' +
        "scope, not to the code — otherwise the catalogue doubles and an office's grid becomes two " +
        'grids that can disagree.',
    ).toEqual([]);
  }, 30_000);

  it('the catalogue is really being read — not vacuous', () => {
    // 219 codes at the time of writing. The floor is lower so an unrelated catalogue change does
    // not fail this, and far above zero so a drifted regex cannot pass over an empty set.
    expect(permissionCodes().length).toBeGreaterThan(200);
  }, 30_000);
});

describe('item (h): the decision itself', () => {
  const GENERAL = { category: 'GENERAL' as const, lineId: 'line-g' };
  const LIFE = { category: 'LIFE' as const, lineId: 'line-l' };

  it('a NULL category covers every type — the only backward-compatible reading', () => {
    /*
     * The assertion the whole migration rests on. Every role that existed before item (h) carries
     * no scope, so if NULL meant "scoped to nothing" the first deploy would refuse every write in
     * the system. See `docs/decision-role-scope.md` § 5.
     */
    const unscoped = { roleId: 'r1', category: null, lineIds: [] };
    expect(scopeCovers(unscoped, GENERAL)).toBe(true);
    expect(scopeCovers(unscoped, LIFE)).toBe(true);
  }, 30_000);

  it('an EMPTY branch list covers every branch within the type', () => {
    const general = { roleId: 'r1', category: 'GENERAL' as const, lineIds: [] };
    expect(scopeCovers(general, GENERAL)).toBe(true);
    expect(scopeCovers(general, { category: 'GENERAL', lineId: 'other' })).toBe(
      true,
    );
    expect(scopeCovers(general, LIFE)).toBe(false);
  }, 30_000);

  it('a named branch list covers only those branches', () => {
    const narrow = {
      roleId: 'r1',
      category: 'GENERAL' as const,
      lineIds: ['line-g'],
    };
    expect(scopeCovers(narrow, GENERAL)).toBe(true);
    expect(scopeCovers(narrow, { category: 'GENERAL', lineId: 'line-x' })).toBe(
      false,
    );
  }, 30_000);

  it('several roles UNION, never intersect', () => {
    /*
     * The case that would otherwise be wrong in the worst way. A GENERAL-scoped Manager role plus
     * an unscoped Compliance role must leave the person able to act on both — intersecting would
     * leave them able to act on NOTHING, which is not what either grant says.
     */
    const user = {
      roleScopes: [
        { roleId: 'r1', category: 'GENERAL' as const, lineIds: [] },
        { roleId: 'r2', category: 'LIFE' as const, lineIds: [] },
      ],
    };
    expect(withinRoleScope(user, GENERAL)).toBe(true);
    expect(withinRoleScope(user, LIFE)).toBe(true);

    const onlyGeneral = {
      roleScopes: [{ roleId: 'r1', category: 'GENERAL' as const, lineIds: [] }],
    };
    expect(withinRoleScope(onlyGeneral, LIFE)).toBe(false);
  }, 30_000);

  it('NO scopes at all is unrestricted, and so is an absent field', () => {
    // The ordinary case for every office that has not configured a scope, and the reason this
    // returns true rather than false on an empty set: `false` here would have been a system-wide
    // outage on the deploy that added the column.
    expect(withinRoleScope({ roleScopes: [] }, GENERAL)).toBe(true);
    expect(withinRoleScope({ roleScopes: undefined }, LIFE)).toBe(true);
  }, 30_000);
});
