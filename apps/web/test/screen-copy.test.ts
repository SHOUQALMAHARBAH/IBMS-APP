import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/*
 * TWO RULES THAT COVER EVERY SCREEN — item 5, rules 6 and 3.
 *
 * Both were swept per batch first and both under-counted, so they are guards over ALL 102 screens rather
 * than a slice: covering screens as a sweep reaches them leaves a window in which a new violation lands on
 * a screen already passed, and the owner's instruction was to close that window rather than widen it five
 * more times.
 *
 *   RULE 6 — no user-facing English written into a screen. Delegated to
 *            `scripts/measurements/hardcoded-ui-english.py`, which has its own `--self-test` built from
 *            the three real misses that made three ad-hoc greps under-count. One implementation, so the
 *            number in a report and the number in the build are the same number.
 *
 *   RULE 3 — a load-error branch announces itself. `<div style={errorStyle}>{loadError}</div>` shows a
 *            sighted reader the failure and tells a screen-reader user NOTHING. Two screens did this
 *            (`leads/[id]`, `policies/[id]`) while every other screen in the app used
 *            `<p role="alert">` — the screen lying by omission to one class of user, and the affected
 *            reader has no way to notice.
 */

const WEB = path.join(__dirname, '..');
const APP = path.join(WEB, 'app', '(app)');
const REPO = path.join(WEB, '..', '..');

function screens(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === 'page.tsx') out.push(full);
    }
  };
  walk(APP);
  return out.sort();
}

describe('every screen speaks both languages (rule 6)', () => {
  it('has no user-facing English written into it', () => {
    // The MEASUREMENT is the guard. Re-implementing the scan in TypeScript would give two detectors that
    // can disagree, and the one behind the build would be the one nobody re-runs by hand.
    let output = '';
    let failed = false;
    try {
      output = execFileSync(
        'python',
        ['scripts/measurements/hardcoded-ui-english.py'],
        { cwd: REPO, encoding: 'utf8' },
      );
    } catch (err) {
      failed = true;
      output = String((err as { stdout?: string }).stdout ?? err);
    }

    const m = /strings\s+(\d+)/.exec(output);
    // A scan that produced no parsable total is NOT a pass — the same rule `test-summary.mjs` enforces
    // one level up. Blank is not zero.
    expect(
      m,
      'The hardcoded-English scan produced no total. That is not a clean result — it means the scan did ' +
        `not run. Output was:\n${output.slice(-1500)}`,
    ).not.toBeNull();
    expect(failed, `the scan exited non-zero:\n${output.slice(-1500)}`).toBe(
      false,
    );
    expect(
      Number(m?.[1]),
      `Hardcoded user-facing English found. This platform is Arabic-first, so an untranslated string is ` +
        `read by nobody in the primary language. Add the key to a dictionary in ` +
        `lib/i18n/translations/ and render it through t(). Full output:\n${output}`,
    ).toBe(0);
  });
});

describe('a load error announces itself (rule 3)', () => {
  it('no screen renders a load error without an alert role', () => {
    const offenders: string[] = [];
    for (const file of screens()) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(APP, file).split(path.sep).join('/');
      // Every element that renders an error-ish value. The `role="alert"` may sit on the same tag, so the
      // match is on the OPENING TAG THROUGH the interpolation.
      for (const m of src.matchAll(
        /<(\w+)([^>]*)>\s*\{?\s*(\w*[eE]rror\w*)\s*\}/g,
      )) {
        const [, , attrs, value] = m;
        // Only load/fetch failures: a form error rendered inline beside its field is a different thing,
        // and sweeping those in is how a guard gets a reputation for crying wolf.
        if (!/^(loadError|fetchError|viewError|searchError)$/.test(value)) {
          continue;
        }
        if (attrs.includes('role="alert"')) continue;
        offenders.push(`${rel}  <${m[1]}> renders {${value}} with no role="alert"`);
      }
    }
    expect(
      offenders,
      'A screen renders a load failure without announcing it. A sighted reader sees the message and a ' +
        'screen-reader user is told nothing — the screen lying by omission to one class of user, who has ' +
        'no way to notice. Use `<p role="alert" style={errorStyle}>`, which every other screen uses.',
    ).toEqual([]);
  });

  it('is not vacuous — load-error branches really are being found', () => {
    // Without this, a regex that matched nothing would report every screen clean forever. The same floor
    // the provenance and narrowness guards carry, and for the same measured reason: a silently empty scan
    // is what under-counted rule 6 three times.
    let withLoadError = 0;
    for (const file of screens()) {
      if (/\{\s*loadError\s*\}/.test(fs.readFileSync(file, 'utf8'))) {
        withLoadError += 1;
      }
    }
    expect(screens().length).toBeGreaterThan(95);
    expect(
      withLoadError,
      'no screen appears to render a loadError — the matcher has drifted',
    ).toBeGreaterThan(20);
  });
});
