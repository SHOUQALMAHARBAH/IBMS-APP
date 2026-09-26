import { describe, expect, it } from 'vitest';
import {
  harvestExistingArabic,
  render,
  writtenLinesIn,
} from '../lib/admin/permission-descriptions-input';

/*
 * TWO REASONS THIS FILE IS HERE AND NOT UNDER `scripts/`, both of them mistakes I made first.
 *
 * (1) `turbo run test` runs each package's own test script and there is no root vitest project, so a
 * `scripts/*.spec.ts` is a guard DEFINED AND NEVER INVOKED — § 1.51(b), which this repo has already
 * been bitten by once.
 *
 * (2) Moving it here while the code it tests stayed in `scripts/` made the import cross the repo
 * root, and the DOCKER BUILD failed on it: `turbo prune web --docker` keeps only web's workspace
 * dependencies, so `scripts/` does not exist inside the image. Every local gate passed. CI is the only
 * environment that starts from nothing. The code under test now lives in `lib/admin/` beside the
 * matrix it already depended on.
 *
 * THE GENERATOR'S ONE DANGEROUS PROPERTY, TESTED RATHER THAN DESCRIBED.
 *
 * `docs/permission-catalogue-for-descriptions.txt` is where the owner writes the Arabic description of
 * every permission. Regenerating it must carry her existing lines forward. Today the file is entirely
 * unfilled — measured: 186 `ar:` slots, 0 written — which means a harvest that silently dropped
 * EVERYTHING would produce a byte-identical result and look perfect. It would then destroy three weeks
 * of her work the first time it mattered.
 *
 * That is why these are unit tests on the pure functions and not a check of the generated file: the
 * file cannot currently exhibit the bug.
 */

const CATALOGUE = [
  { code: 'vendor.read', module: 'supporting-operations', description: 'See the vendor register' },
  { code: 'vendor.create', module: 'supporting-operations', description: 'Register a vendor' },
  { code: 'vendor.update', module: 'supporting-operations', description: 'Correct a vendor record' },
  { code: 'refund.raise', module: 'insurance-operations', description: 'NOT YET ENFORCED — reserved' },
  { code: 'policy.check', module: 'insurance-operations', description: 'Check a policy' },
];

const ARABIC = 'الاطّلاع على سجل المورّدين دون تعديله.';

describe('harvestExistingArabic', () => {
  it('reads a written line and keys it by its code', () => {
    const file = [
      '  [5-STATE] vendor   (create / read / update)',
      '      vendor.read',
      '          en: See the vendor register',
      `          ar: ${ARABIC}`,
    ].join('\n');
    expect(harvestExistingArabic(file)).toEqual({ 'vendor.read': ARABIC });
  });

  it('does NOT mistake the dotted placeholder for an answer', () => {
    // The placeholder is what this generator itself writes. Treating it as content would carry rows of
    // dots forward forever and make the file look answered.
    const file = [
      '      vendor.read',
      '          en: See the vendor register',
      `          ar: ${'.'.repeat(64)}`,
    ].join('\n');
    expect(harvestExistingArabic(file)).toEqual({});
  });

  it('does not attribute one code’s line to the code above it', () => {
    const file = [
      '      vendor.read',
      '          en: See the vendor register',
      `          ar: ${'.'.repeat(64)}`,
      '      vendor.create',
      '          en: Register a vendor',
      `          ar: ${ARABIC}`,
    ].join('\n');
    // `vendor.read` is unanswered and `vendor.create` is answered. An off-by-one here would put her
    // sentence under the wrong permission, which is worse than losing it.
    expect(harvestExistingArabic(file)).toEqual({ 'vendor.create': ARABIC });
  });

  it('ignores an ar: line with no code above it', () => {
    expect(harvestExistingArabic(`          ar: ${ARABIC}`)).toEqual({});
  });
});

describe('writtenLinesIn — the safety check that must not be built out of the harvest', () => {
  /*
   * `--check` warns when a regenerate would DELETE a line somebody wrote. Its first version asked
   * `harvestExistingArabic` what had been written, which made the warning unreachable in the one case
   * that matters most: break the harvest and it returns nothing, so there is nothing it can report as
   * dropped — the worst failure printed the mildest message. Proven by planting a harvest that keeps
   * nothing and watching `--check` say only "STALE".
   *
   * So this reads the file independently. These tests are what stop it quietly growing a dependency
   * on the thing it checks.
   */
  it('finds a written line without needing to know which code it belongs to', () => {
    const file = ['      vendor.read', '          en: x', `          ar: ${ARABIC}`].join('\n');
    expect(writtenLinesIn(file)).toEqual([ARABIC]);
  });

  it('treats the dotted placeholder as nothing written', () => {
    expect(writtenLinesIn(`          ar: ${'.'.repeat(64)}`)).toEqual([]);
  });

  it('still sees a written line when the code above it is unparseable', () => {
    // The independence property, stated as a test rather than as a comment: a file whose structure
    // this tool cannot follow must still be recognised as containing her work, because that is
    // exactly when refusing to overwrite it matters.
    const file = ['  ???? not a code line at all', `          ar: ${ARABIC}`].join('\n');
    expect(harvestExistingArabic(file)).toEqual({});
    expect(writtenLinesIn(file)).toEqual([ARABIC]);
  });
});

describe('render', () => {
  it('round-trips every written line — harvest(render(harvest(x))) is stable', () => {
    // The actual guarantee the owner needs, stated as a property rather than a sample: whatever the
    // file holds, regenerating and re-reading it returns the same answers.
    const written = { 'vendor.read': ARABIC, 'policy.check': 'فحص الوثيقة قبل تسليمها للعميل.' };
    const once = render(CATALOGUE, written);
    const reharvested = harvestExistingArabic(once);
    expect(reharvested).toEqual(written);
    // And a second pass changes nothing, which is what `--check` compares.
    expect(render(CATALOGUE, reharvested)).toBe(once);
  });

  it('emits a placeholder only where nothing is written', () => {
    const out = render(CATALOGUE, { 'vendor.read': ARABIC });
    expect(out).toContain(`ar: ${ARABIC}`);
    // Four of the five codes are unanswered, so four placeholder lines.
    expect(out.split(`ar: ${'.'.repeat(64)}`).length - 1).toBe(4);
  });

  it('carries the stored English for every code, so she is never asked to describe a bare code', () => {
    const out = render(CATALOGUE, {});
    for (const permission of CATALOGUE) {
      expect(out).toContain(`      ${permission.code}`);
      expect(out).toContain(`en: ${permission.description}`);
    }
  });

  it('tells her to skip a code that is not yet enforced', () => {
    const out = render(CATALOGUE, {});
    expect(out).toContain('NOT YET ENFORCED needs NO Arabic line');
    // And the code itself still appears, because vanishing it would leave her wondering.
    expect(out).toContain('      refund.raise');
  });

  it('marks a CRUD-shaped family as one screen row and a lone code as a toggle', () => {
    const out = render(CATALOGUE, {});
    expect(out).toContain('[5-STATE] vendor');
    expect(out).toContain('[toggle]  policy.check');
    // The states are named, because "one row" without them does not say what the row decides.
    expect(out).toContain('(create / read / update)');
  });

  it('counts what it emitted rather than asserting a figure', () => {
    const out = render(CATALOGUE, {});
    expect(out).toContain('TOTALS: 1 five-state families covering 3 codes, 2 toggles, 5 codes in all.');
  });

  it('does not go stale because she wrote a line', () => {
    // THE DEFECT THIS REPLACED AN ASSERTION ABOUT.
    //
    // The first version counted her written lines INTO the file's TOTALS block. That made the content
    // depend on how much she had filled in, so writing one Arabic line made `--check` report STALE
    // until a developer regenerated — `verify.sh` going red because the owner did the work the file
    // exists for. Found by writing a real line into the real file and running the gate.
    //
    // The property that fixes it: the bytes depend only on the catalogue and on her own lines.
    const before = render(CATALOGUE, {});
    const withOneLine = before.replace(`ar: ${'.'.repeat(64)}`, `ar: ${ARABIC}`);
    expect(withOneLine).not.toBe(before);
    expect(render(CATALOGUE, harvestExistingArabic(withOneLine))).toBe(withOneLine);
  });
});
