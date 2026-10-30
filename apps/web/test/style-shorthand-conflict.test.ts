import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NO STYLE OBJECT MAY SPREAD A SHORTHAND AND THEN OVERRIDE ONE OF ITS LONGHANDS.
 *
 * The owner read this on the two controls she uses most, on every screen:
 *
 *     Updating a style property during rerender (borderColor) when a conflicting
 *     property is set (border) can lead to styling bugs.
 *
 * `navbarToggleStyle` set the `border` SHORTHAND; `navbarToggleActiveStyle` spread it and
 * overrode the `borderColor` LONGHAND. React blames the element that swaps between the
 * two objects, which is why her report named `ThemeToggle.tsx:50` and `AppNavbar.tsx:123`
 * rather than the stylesheet where the conflict lives.
 *
 * ## WHY THIS IS A SOURCE GUARD AND NOT A BROWSER TEST
 *
 * It was tried as a browser test first, and the browser test PASSED ON THE BROKEN CODE —
 * both directions, every transition. Then measured rather than guessed: the warning
 * string appears in `react-dom-client.development.js` and `react-dom-profiling.development.js`
 * and in **NO production bundle** (1, 1, and 0 everywhere else). Playwright here serves
 * the `next build` output, so a production-build test is STRUCTURALLY INCAPABLE of
 * observing it — it is not a weak test, it is a test of something that cannot be there.
 *
 * And a rendered-appearance assertion cannot see it either, because both objects paint
 * the same 1px solid border: nothing about the pixels changed. The defect is observable
 * in exactly two places — the dev console, and the source.
 *
 * ## WHAT IT IS ACTUALLY ABOUT
 *
 * Not tidiness. React's own wording is *can lead to styling bugs*: when the shorthand and
 * the longhand both change in one commit, the order they are applied in is not
 * guaranteed, so the border can paint with the previous value. On a toggle whose only
 * visual difference IS the border, that is the control failing to show which side is on.
 *
 * MEASURED BEFORE FIXING: FOUR pairs had this shape, not the one she read —
 * `roleBadgeStyle`, `navbarToggleStyle`, `cardStyle` (the SIGN-IN page, the first screen
 * anybody sees) and `lineChipStyle`. All four are fixed; this keeps the fifth out.
 */

const STYLES_ROOT = join(__dirname, '..');

/** A CSS shorthand and the longhands it would conflict with. Not exhaustive over all of
 *  CSS — these are the shorthands this codebase actually uses, and a shorthand nobody
 *  writes needs no row. Add one when it appears. */
const SHORTHANDS: Record<string, readonly string[]> = {
  border: [
    'borderColor',
    'borderWidth',
    'borderStyle',
    'borderTop',
    'borderBottom',
    'borderLeft',
    'borderRight',
  ],
  background: [
    'backgroundColor',
    'backgroundImage',
    'backgroundPosition',
    'backgroundSize',
    'backgroundRepeat',
  ],
  font: ['fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'lineHeight'],
  padding: [
    'paddingTop',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'paddingInline',
    'paddingBlock',
  ],
  margin: [
    'marginTop',
    'marginBottom',
    'marginLeft',
    'marginRight',
    'marginInline',
    'marginBlock',
  ],
  flex: ['flexGrow', 'flexShrink', 'flexBasis'],
  transition: ['transitionProperty', 'transitionDuration', 'transitionTimingFunction'],
};

/** Below this, a root moved and the guard would pass over nothing. */
const MINIMUM_STYLE_OBJECTS = 60;

const SKIP = new Set(['node_modules', '.next', 'test-results', 'playwright-report']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

interface Conflict {
  file: string;
  base: string;
  derived: string;
  shorthand: string;
  longhand: string;
}

/** Every `const x: CSSProperties = { … }` in a file, by name. ONE HOME for the pattern,
 *  shared with the non-vacuity floor — a second copy over there is exactly how the floor
 *  came to be independent of the parser it was supposed to be a floor for. */
function parsedObjects(src: string): Map<string, string> {
  const objects = new Map<string, string>();
  const decl = /(?:export )?const (\w+): CSSProperties = \{([\s\S]*?)\n\};/g;
  for (let m = decl.exec(src); m !== null; m = decl.exec(src)) {
    objects.set(m[1], m[2]);
  }
  return objects;
}

function conflictsIn(src: string, file: string): Conflict[] {
  const objects = parsedObjects(src);
  const found: Conflict[] = [];
  for (const [derived, body] of objects) {
    const spread = /\.\.\.(\w+),/.exec(body);
    if (!spread) continue;
    const base = objects.get(spread[1]);
    if (base === undefined) continue; // spread from another module — out of reach here
    for (const [shorthand, longhands] of Object.entries(SHORTHANDS)) {
      if (!new RegExp(`^\\s*${shorthand}:`, 'm').test(base)) continue;
      for (const longhand of longhands) {
        if (new RegExp(`^\\s*${longhand}:`, 'm').test(body)) {
          found.push({ file, base: spread[1], derived, shorthand, longhand });
        }
      }
    }
  }
  return found;
}

describe('no style object mixes a shorthand with its own longhand', () => {
  it('finds the style objects it claims to check', () => {
    /*
     * THE NON-VACUITY FLOOR, AND IT COUNTS WHAT THE PARSER FOUND.
     *
     * Its first version counted files containing the literal `': CSSProperties = {'` with a
     * SEPARATE `readFileSync` — independent of the regex the other test relies on — so
     * breaking that regex left this floor intact. Measured by planting exactly that: the
     * declaration pattern was pointed at a type name nothing uses, the conflict list came
     * back empty, and BOTH TESTS PASSED. The plant's own `why` had predicted this test
     * failing, and that prediction was wrong; it is corrected from the run.
     *
     * A floor that does not run the thing it is a floor for is not a floor. It calls
     * `parsedObjects` now — the same function the conflict test parses with — so a pattern
     * that stops matching fails HERE by name rather than reporting a clean tree.
     */
    const objects = sourceFiles(STYLES_ROOT).reduce(
      (n, f) => n + parsedObjects(readFileSync(f, 'utf8')).size,
      0,
    );
    expect(
      objects,
      `The declaration parser found ${objects} style object(s), against a floor of ` +
        `${MINIMUM_STYLE_OBJECTS}. Either the declaration shape moved or a root did, and ` +
        'this guard is passing over nothing — which reads exactly like a clean tree.',
    ).toBeGreaterThanOrEqual(MINIMUM_STYLE_OBJECTS);
  });

  it('refuses a spread pair that overrides a longhand of a shorthand it inherited', () => {
    const conflicts = sourceFiles(STYLES_ROOT).flatMap((f) =>
      conflictsIn(readFileSync(f, 'utf8'), f.replace(/\\/g, '/').split('/apps/web/')[1] ?? f),
    );
    expect(
      conflicts.map(
        (c) =>
          `${c.file}: ${c.base} sets \`${c.shorthand}\`, ${c.derived} overrides \`${c.longhand}\``,
      ),
      'A style object spread a shorthand and then overrode one of its longhands. React ' +
        'refuses to update the longhand on a rerender while the shorthand is set — "can ' +
        'lead to styling bugs", its own words — and on a toggle whose only visual ' +
        'difference IS the border, that is the control failing to show which side is on. ' +
        'Make the BASE longhand (borderWidth / borderStyle / borderColor) so there is no ' +
        'shorthand left to conflict with. Do NOT silence this by moving the override into ' +
        'the shorthand: that re-states three values to change one, and the next person ' +
        'changes the colour and leaves the width behind.',
    ).toEqual([]);
  });
});
