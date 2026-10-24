import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_CATALOGUE } from '../e2e/fixtures/role-permissions';
import { lookupOptional } from '../lib/i18n/translations';

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

/** Every non-test source file that can render a refusal: the screens plus the shared components. */
function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push([
          path.relative(WEB, full).split(path.sep).join('/'),
          fs.readFileSync(full, 'utf8'),
        ]);
      }
    }
  };
  walk(APP);
  walk(path.join(WEB, 'components'));
  return out;
}

describe('every screen speaks both languages (rule 6)', () => {
  /*
   * AN EXPLICIT TIMEOUT, AND IT RETIRES A RECORDED FLAKE RATHER THAN HIDING ONE.
   *
   * This test SHELLS OUT to `scripts/measurements/hardcoded-ui-english.py`, which takes ~0.8s alone
   * and has been measured at 20,980ms under a full four-workspace parallel run — against vitest's
   * 5000ms default, which `apps/web` does not override. It was recorded as a known fragility with
   * the note that CI cannot reach it because the frontend job runs `--filter=web` alone; it was then
   * hit again locally at 5556ms in an ordinary `vitest run` of this workspace, which is well inside
   * what CI does.
   *
   * Raising a timeout is normally the wrong move and this repository has the lesson written down.
   * The distinction is the same one `role-scope.inventory.spec.ts` makes: nothing is being hidden.
   * The assertion is correct, the work is a Python subprocess over the whole screen tree, and 5s is
   * simply the wrong budget for it. Leaving it means a red build nobody believes.
   */
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

    /*
     * RE-POINTED FROM `strings` TO `undeclared`, AND THE REVERSAL IS STATED.
     *
     * This read the TOTAL and required zero — a flat ban, which is what it should be and
     * what it stays for every shape the detector knew about. What changed is that the
     * detector learned FAILURE MODE 7 (a parenthetical, in two forms) and the total went
     * 0 -> 10 across nine screens: markers like `(capped)`, `(overdue)` and `(lapsed)`
     * that were there all along and that no pattern could see.
     *
     * THE TEN ARE DECLARED, NOT FORGIVEN, and the distinction is the whole design.
     * `DECLARED_PARENTHETICALS` in the script names each `screen|string` pair with what it
     * MEANS, and the script fails on a finding nobody declared AND on a declared row that
     * no longer occurs — so a translation is recorded by DELETING its row, and a stale row
     * cannot sit there covering whatever lands next. Keyed on the exact pair, so the
     * declaration cannot become a hiding place for a DIFFERENT kind of finding on the same
     * screen: a `PROSE` or `ONE_WORD_LABEL` hit still fails flat.
     *
     * Each of the ten needs an Arabic word from the owner, which is why they are declared
     * rather than fixed — they are ten decisions, not ten engineering tasks, and they are
     * listed in `docs/screen-pass-measurement.md` § 9 as NOT-YET-WRITTEN for her walk.
     *
     * THE TOTAL IS STILL READ AND STILL PRINTED in the failure message below, so the real
     * figure is never hidden behind the declaration.
     */
    const total = /strings\s+(\d+)/.exec(output);
    const m = /undeclared\s+(\d+)/.exec(output);
    // A scan that produced no parsable total is NOT a pass — the same rule `test-summary.mjs` enforces
    // one level up. Blank is not zero.
    expect(
      total,
      'The hardcoded-English scan produced no total. That is not a clean result — it means the scan did ' +
        `not run. Output was:\n${output.slice(-1500)}`,
    ).not.toBeNull();
    expect(
      m,
      'The scan printed no `undeclared` line. Blank is not zero — if that line is gone the ' +
        'declaration machinery has been removed and this gate is reading nothing. Output ' +
        `was:\n${output.slice(-1500)}`,
    ).not.toBeNull();
    expect(failed, `the scan exited non-zero:\n${output.slice(-1500)}`).toBe(
      false,
    );
    expect(
      Number(m?.[1]),
      `UNDECLARED hardcoded user-facing English found (the total is ${total?.[1]}, of which ` +
        `${m?.[1]} is not declared). This platform is Arabic-first, so an untranslated ` +
        `string is read by nobody in the primary language. Add the key to a dictionary in ` +
        `lib/i18n/translations/ and render it through t(). DECLARING it is not the ordinary ` +
        `fix — the rows in DECLARED_PARENTHETICALS are the owner's own backlog, each one a ` +
        `status marker whose meaning she has to decide. Full output:\n${output}`,
    ).toBe(0);
  }, 60_000);
});

/*
 * RULE 2 — no identifier reaches a reader.
 *
 * This guard exists because the RULE 6 guard above could not stand in for it, and the reason is the
 * finding: `hardcoded-ui-english.py` STRIPS `t(...)` calls before looking at a line, because a key is not
 * prose. So an identifier passed as a translation PARAMETER was invisible to it — which is exactly where
 * an identifier ends up, because it is being put INTO a sentence.
 *
 * Found on `/claims/[id]`, whose page heading read
 * `t('claimsDetailHeading', { name: … ?? claim.id.slice(0, 8) })`. Rule 6's guard reported that screen
 * clean, correctly, and rule 2 had nothing looking at it at all — it had only ever been swept by hand.
 *
 * The threshold is CURRENT, not zero. 16 sites were display-only and are fixed; **29 remain**, and each
 * needs a decision about what identifies that record to a person — several need a name the API does not
 * return, two record types (an opportunity, a needs assessment) have NO NAME AT ALL, and one is a privacy
 * decision. That is broker question 16, so the 29 are deferred rather than pending.
 *
 * 44 minus 16 is 28, and the real number is 29: a SIXTH blind spot in the detector was hiding one, and it
 * was introduced by a REFORMAT — prettier wrapped a line and `{r.entityId}` moved to a JSX-text position
 * the rule did not recognise. The violation never changed; only its formatting did. So this budget pins
 * what the detector can currently see, which is not the same as what exists.
 *
 * 29 -> 24 on 2026-10-23 (batch five item 1a), lowered by exactly what was fixed: five screens whose
 * Customer column rendered the first eight characters of a uuid now render the customer's name,
 * resolved by the api. `/complaints`, `/feedback`, `/service-requests`, `/retention-cases`,
 * `/communications`.
 *
 * THIS FIGURE IS A SECOND HOME FOR THE ONE IN `scripts/measurements/rendered-identifiers.py`, and
 * that is not an oversight: the two detectors are different implementations (this one is this file's
 * own regex pass, the script's is its own), so a shared constant would couple two measurements that
 * are deliberately independent. What keeps them honest is that BOTH fail in both directions — this
 * one caught the stale 29 the moment the script's count fell, which is the ratchet's second half
 * doing the job the second half exists for.
 *
 * 24 -> 19 on 2026-10-23 (batch six item 2). The floor cannot reach 0 in this module: six of the
 * nineteen are DEFERRED-BY-DECISION to module 7 (owner decision 46 — a readable handle for a
 * settlement or a commission entry means inventing this product's first numbering scheme, and
 * that belongs with the money), and four more need a decision rather than a name.
 *
 * 19 -> 18 on 2026-10-23 (batch seven item 2).
 *
 * 18 -> 16 on 2026-10-23 (batch eight). The floor still cannot be 0: six rows are
 * DEFERRED-BY-DECISION to module 7 (decision 46), and `/audit-trail`'s polymorphic `entityId`
 * counts BY DECISION 49 — it is labelled with its type's Arabic word now, and the id stays.
 */
const RENDERED_IDENTIFIER_BUDGET = 10;

describe('no identifier reaches a reader (rule 2)', () => {
  it('does not render more identifiers than the recorded budget', () => {
    let output = '';
    try {
      output = execFileSync(
        'python',
        ['scripts/measurements/rendered-identifiers.py'],
        { cwd: REPO, encoding: 'utf8' },
      );
    } catch (err) {
      output = String((err as { stdout?: string }).stdout ?? err);
    }
    const m = /identifiers reaching a reader\s+(\d+)/.exec(output);
    expect(
      m,
      `The rendered-identifier scan produced no total — it did not run. Output:
${output.slice(-1200)}`,
    ).not.toBeNull();
    const count = Number(m?.[1]);
    expect(
      count,
      `Rendered identifiers went UP (${count} > ${RENDERED_IDENTIFIER_BUDGET}). A uuid identifies nothing ` +
        'to a person: rule 2. Give the record something readable — a name, a reference, a date — and if ' +
        'the payload has none, that is an API change and a decision, not a display fix.',
    ).toBeLessThanOrEqual(RENDERED_IDENTIFIER_BUDGET);
    // And the budget must come DOWN as sites are fixed, never quietly stay high: if the real count has
    // dropped, this fails until the budget is lowered to match.
    expect(
      count,
      `The budget is stale — only ${count} identifiers remain, so lower RENDERED_IDENTIFIER_BUDGET to ` +
        'that number. A budget that stays above the real count stops being a ratchet.',
    ).toBe(RENDERED_IDENTIFIER_BUDGET);
    // THE SAME EXPLICIT TIMEOUT RULE 6 ALREADY CARRIES, applied to its sibling. This test shells
    // out to a Python measurement over the whole screen tree exactly as that one does, and it was
    // left on vitest's 5000ms default — so it failed once in a full workspace run while the repo's
    // 6-workspace typecheck was executing, and passed twice cleanly on its own. Rule 6's own note
    // above makes the argument and this is the other half of it: the assertion is correct, the work
    // is a subprocess, and 5s is the wrong budget for it. The gap was a fix applied to one of two
    // identical mechanisms.
  }, 60_000);
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
        offenders.push(
          `${rel}  <${m[1]}> renders {${value}} with no role="alert"`,
        );
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

/*
 * THE PERMISSION REFUSAL — one sentence, 100 acts, and a guard so it stays that way.
 *
 * ## What was measured
 *
 * 100 refusal strings, across 89 files (87 screens and 2 components), each wrote their own sentence. They
 * became 102 act keys — one of the 100 was a parameterised generic used for three different sections — at
 * 106 call sites. Those four numbers count four different things and are kept distinct deliberately. The survey
 * found three things, and each is checked below:
 *
 *   * The ENGLISH never named the act — every string named the CODE and stopped ("You do not hold
 *     insurer.read, so there is nothing to show here"). A dotted identifier is the name of the thing you
 *     have to go and ask somebody else about, not an answer to "what can I not do here".
 *   * The ARABIC named the act (`اللازمة ل<act>`), so 52 acts were recoverable there and 50 had to be
 *     written. The two languages were therefore generated independently, each read for the half it held.
 *   * Not one of the 100 said WHO could grant it.
 *
 * ## THE DENOMINATOR WAS WRONG THREE TIMES, each time because a KEY NAME was trusted
 *
 *     91   keys ending in `NoPermission`                      — the first pass
 *     +6   keys CONTAINING it with a suffix                    — `crmNoPermissionLog`, `atNoPermissionFor`
 *     +3   keys with no `NoPermission` in them at all          — `smYouDonTHoldThe`, auto-named from its
 *                                                                own English text
 *
 * Each undercount was found by a different accident, and the third only because a floor in
 * `lib/i18n/translations.test.ts` failed for an unrelated reason. So the guard below keys on the SHAPE —
 * what the code does — and never on what a key is called.
 */
describe('a permission refusal is worded in exactly one place', () => {
  // All FIVE exported shapes, not just the three refusals. The two reduced-capability shapes
  // (`reducedCapability`, `permissionMayBeMissing`) pass codes and act keys exactly as the refusals do, so
  // leaving them out would exempt their call sites from every check below — and this guard caught precisely
  // that omission the moment they were added, which is what it is for.
  const HELPERS = [
    'permissionRefusal',
    'permissionRefusalAnyOf',
    'permissionRefusalAllOf',
    'reducedCapability',
    'permissionMayBeMissing',
  ];
  const CODES = new Set(PERMISSION_CATALOGUE.map((entry) => entry.code));

  /** Every `permissionRefusal*(t, 'key', <codes>)` call, with its code arguments. */
  function calls(): Array<{ file: string; act: string; codes: string[] }> {
    const found: Array<{ file: string; act: string; codes: string[] }> = [];
    // A LITERAL regex, deliberately, and not one built from HELPERS through a template string: this host
    // mangles backslashes inside a heredoc, so the first version of this line arrived as `\b…\s…\w` where
    // it needed `\\b…\\s…\\w`, and in a template literal `\b` is a BACKSPACE CHARACTER. It compiled, ran,
    // matched nothing, and the two checks above passed on an empty set — caught only by the non-vacuity
    // floor below. A regex that cannot be written wrongly beats one that has to be written carefully.
    // The optional second quoted argument covers `reducedCapability(t, can, cannot, code)`, which carries TWO
    // act keys where the refusals carry one.
    //
    // THE CODE SLOT MUST CONTAIN A QUOTE, and that is not decoration. A prettier reflow puts a
    // TRAILING COMMA after the last argument, and with the slot allowed to be empty the optional
    // act-key group then swallowed the CODE and matched the trailing comma as its separator —
    // leaving the code slot blank. The call was correct; the matcher read it as codeless, and the
    // non-vacuity floor below is the only thing that said so (`expected 115 to be 116`). Requiring a
    // quote makes that match backtrack into the right shape, so the guard survives a reflow instead
    // of reporting a defect in the formatter's choices.
    //
    // The quote inside the code slot excludes `)` as well — `[^')]+` and not `[^']+`. The first
    // version did not, and `[^']` ADMITS a closing paren, so the quoted run reached past the end of
    // the call and swallowed the next `t('…LoadError')` on the line below: five screens were
    // reported as naming a permission code that does not exist, when what they named was a
    // translation key two expressions away. A greedy class that can cross the thing it is supposed
    // to stop at is the same defect as a matcher that finds nothing, in the loud direction.
    const pattern =
      /\b(permissionRefusal|permissionRefusalAnyOf|permissionRefusalAllOf|reducedCapability|permissionMayBeMissing)\(\s*\w+\s*,\s*'([^']+)'(?:\s*,\s*'[^']+')?\s*,\s*([^)]*'[^')]+'[^)]*)\)/g;
    for (const [file, src] of sources()) {
      for (const m of src.matchAll(pattern)) {
        found.push({
          file,
          act: m[2],
          codes: [...m[3].matchAll(/'([^']+)'/g)].map((c) => c[1]),
        });
      }
    }
    return found;
  }

  it('every code handed to the shared sentence names a permission that exists', () => {
    // This is where the codes went when they left the dictionaries, so this is where the stale-code bug
    // class now lives. `/` separates genuine alternatives in one slot (`nominate / approve`), which is a
    // code LIST rather than prose and so is split before checking — otherwise the pair reads as one
    // unknown code and the guard would report a violation that is not there.
    const offenders: string[] = [];
    for (const call of calls()) {
      for (const raw of call.codes) {
        for (const code of raw.split('/').map((c) => c.trim())) {
          if (!CODES.has(code)) offenders.push(`${call.file}: "${code}"`);
        }
      }
    }
    expect(
      offenders,
      'A refusal names a permission code that is not in the catalogue. Either the code was renamed and the ' +
        'refusal was not, which is the bug this checks for, or it is a typo — and a reader told to ask for a ' +
        'grant that does not exist is worse off than one told nothing.',
    ).toEqual([]);
  });

  it('no screen renders an act key outside the shared sentence', () => {
    // THE PROPERTY THAT KEEPS THE SHAPE IN ONE PLACE. An act phrase is half a sentence — "view payment
    // channels" — so rendering one through a bare `t()` puts a fragment on screen, and rebuilding the
    // sentence around it puts the wording back in 100 places, which is what this replaced.
    const offenders: string[] = [];
    for (const [file, src] of sources()) {
      for (const m of src.matchAll(
        /\b(t|tr)\(\s*'(\w*(?:Refusal|Can|Cannot)?Act)'/g,
      )) {
        offenders.push(`${file}: ${m[1]}('${m[2]}')`);
      }
    }
    expect(
      offenders,
      'An act key is being rendered directly instead of through permissionRefusal(). The act is a fragment, ' +
        'not a sentence: pass it to the helper, which supplies the sentence, the grantor and the code.',
    ).toEqual([]);
  });

  it('the matcher names every helper the module exports', () => {
    // The regex above is a literal, so a FOURTH helper added to `permission-refusal.ts` would be invisible
    // to it — and invisible in the safe-looking direction: the checks would keep passing while one shape's
    // call sites went unchecked. This is the one thing the non-vacuity floor cannot catch, because the
    // other three helpers would still be found.
    const src = fs.readFileSync(
      path.join(WEB, 'lib', 'i18n', 'permission-refusal.ts'),
      'utf8',
    );
    const exported = [...src.matchAll(/export function (\w+)/g)].map(
      (m) => m[1],
    );
    expect(
      exported.sort(),
      'permission-refusal.ts exports a helper the matcher in this file does not name. Add it to the literal ' +
        'regex in calls() as well as to HELPERS, or its call sites are never checked.',
    ).toEqual([...HELPERS].sort());
  });

  it('the strict matcher reads EVERY call site — none is silently skipped', () => {
    /*
     * THE HOLE THE FLOOR BELOW CANNOT SEE, found by planting an empty code.
     *
     * The floor asserts that every call the strict pattern FINDS carries a code. A call the pattern
     * cannot parse at all is not found, so it is not counted, so it is not checked — and the floor
     * stays green because the calls it did find are all fine. Planting `permissionRefusal(t, act,
     * '')` proved exactly that: the call vanished from the set and every assertion passed.
     *
     * So the call sites are counted a SECOND way, by the helper name alone, and the two counts must
     * agree. This is the shape that refuses "a matcher that quietly reads fewer things than exist" —
     * the failure mode behind three separate false-clean results in this repository.
     */
    const loose: string[] = [];
    for (const [file, src] of sources()) {
      for (const m of src.matchAll(
        /\b(permissionRefusal|permissionRefusalAnyOf|permissionRefusalAllOf|reducedCapability|permissionMayBeMissing)\(/g,
      )) {
        loose.push(`${file}: ${m[1]}`);
      }
    }
    expect(
      calls().length,
      `the strict matcher read ${calls().length} refusal calls but ${loose.length} call sites exist. ` +
        'One of them is in a shape the pattern cannot parse — an empty code, a code held in a ' +
        'variable, a reflow it does not expect — and an unparsed call is an UNCHECKED call. Fix the ' +
        'pattern or the call; do not leave them disagreeing.',
    ).toBe(loose.length);
  });

  it('is not vacuous — the calls really are being found', () => {
    // Without this the two checks above pass forever on a regex that matches nothing, which is exactly how
    // the 91 came to be reported as complete three times.
    const found = calls();
    expect(
      found.length,
      'no refusal calls found at all — the matcher has drifted',
    ).toBeGreaterThan(95);
    const withCode = found.filter((c) => c.codes.length > 0);
    expect(
      withCode.length,
      'calls were found but none carried a code — the code argument is not being captured',
    ).toBe(found.length);
  });
});

/*
 * TWO KEYS, ONE ACT — and a guard so they cannot drift apart.
 *
 * `/customers/[id]` has a needs-assessment SECTION and `/needs-assessments/new` is the standalone create
 * screen. Two genuine entry points to the same act on the same code (`needs-assessment.create`), so they
 * keep two keys — deleting either would leave a screen with no refusal — but the ACT is one act, and two
 * copies of one sentence is one place for it to be edited and one place for it to be forgotten.
 *
 * `insList` shows the other resolution already in the file: ONE key serving both `/insurers` and
 * `/insurers/[id]`. That works where the two screens are the same screen at two depths. It does not work
 * here, because these two keys live in different dictionary FILES (`customers.ts` and `detail-pages.ts`).
 */
describe('two entry points to one act say the same thing', () => {
  const PAIRS: Array<[string, string]> = [
    ['customerNeedsAssessmentRefusalAct', 'nanRefusalAct'],
  ];

  function actValues(): Map<string, string[]> {
    const dir = path.join(WEB, 'lib', 'i18n', 'translations');
    const found = new Map<string, string[]>();
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of src.matchAll(
        /^[ \t]*(\w*(?:Refusal|Can|Cannot)?Act)\s*:\s*(?:\n[ \t]*)?(['"])(.*?)\2,/gm,
      )) {
        found.set(m[1], [...(found.get(m[1]) ?? []), m[3]]);
      }
    }
    return found;
  }

  it('holds the identical act in both keys, in both languages', () => {
    const values = actValues();
    for (const [a, b] of PAIRS) {
      const left = values.get(a);
      const right = values.get(b);
      // Both keys must EXIST with both language halves — a missing key would make the comparison below
      // trivially true, which is the vacuity this whole file keeps running into.
      expect(left, `${a} not found in any dictionary`).toHaveLength(2);
      expect(right, `${b} not found in any dictionary`).toHaveLength(2);
      expect(
        [...(left ?? [])].sort(),
        `${a} and ${b} are two entry points to the SAME act and their wording has drifted. Change both or ` +
          'neither — a reader meeting the same refusal on two screens must not be told two different things.',
      ).toEqual([...(right ?? [])].sort());
    }
  });
});

describe('every act key is reachable, and every reachable key exists', () => {
  it('has no orphaned act key and no undeclared one', () => {
    // BOTH DIRECTIONS, because they fail differently and only one of them is loud.
    //
    // An UNDECLARED key (a call site naming a key no dictionary holds) already breaks at runtime — `t()`
    // returns the key and the reader sees `venRefusalAct` in a sentence.
    //
    // An ORPHANED key (declared, no call site) is the silent one, and it is the failure this whole exercise
    // is about: it means a screen that used to refuse a reader now says NOTHING. The reader gets an empty
    // table and no reason for it, which is indistinguishable from having no data.
    const dir = path.join(WEB, 'lib', 'i18n', 'translations');
    const declared = new Set<string>();
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      for (const m of fs
        .readFileSync(path.join(dir, file), 'utf8')
        .matchAll(/^[ \t]*(\w*(?:Refusal|Can|Cannot)?Act)\s*:/gm)) {
        declared.add(m[1]);
      }
    }
    const used = new Set<string>();
    for (const [, src] of sources()) {
      for (const m of src.matchAll(/'(\w*(?:Refusal|Can|Cannot)?Act)'/g))
        used.add(m[1]);
    }
    expect(
      declared.size,
      'no act keys declared — the matcher has drifted',
    ).toBeGreaterThan(95);
    expect(
      [...declared].filter((k) => !used.has(k)).sort(),
      'An act key is declared and no screen uses it. If a screen dropped its refusal, it now renders an empty ' +
        'state where it should say why — silence, which reads to the user as "there is no data".',
    ).toEqual([]);
    expect(
      [...used].filter((k) => !declared.has(k)).sort(),
      'A screen names an act key no dictionary holds, so t() returns the key itself and the reader sees a ' +
        'camelCase identifier inside a sentence.',
    ).toEqual([]);
  });
});

/*
 * RULE 3'S FOURTH STATE IS TWO THINGS, and the second half had never been measured.
 *
 * Rule 3 ends a screen in one of four states, the fourth being "something went wrong" WITH THE WAY TO
 * RETRY. The formal pass measured whether the error BRANCH exists — it does, on 89 of 102 screens. Whether
 * the message tells the reader anything they can act on is rule 4, and nothing checked it.
 *
 * Measured: 104 of 109 load-error messages already read `<what failed> — try again.` in both languages.
 * Five stopped at the failure, and all five failed in BOTH languages, so there was no bilingual asymmetry
 * to argue about — just drift. The 104-against-5 disagreement is what makes it drift rather than a
 * decision, which is the same standard the glossary uses.
 *
 * ZERO SCREENS IN THE APP HAVE A RETRY CONTROL, measured separately. So the sentence is not a nicety that
 * a button makes redundant — today it is the only way forward there is.
 *
 * THE FIRST VERSION OF THIS MEASUREMENT WAS WRONG IN THE USEFUL-LOOKING DIRECTION: it keyed on
 * `commonTryAgain`, the shared key, and reported 4 of 102. True, and useless — 98 screens use a
 * screen-specific key and most of them say "try again" in their own words. It was measuring which screens
 * share a string, not which screens help a reader.
 */
describe('a load failure tells the reader what to do (rules 3 and 4)', () => {
  it('every load-error message names a way forward, in both languages', () => {
    let output = '';
    let failed = false;
    try {
      output = execFileSync(
        'python',
        ['scripts/measurements/load-error-way-forward.py'],
        { cwd: REPO, encoding: 'utf8' },
      );
    } catch (err) {
      failed = true;
      output = String((err as { stdout?: string }).stdout ?? err);
    }
    const found = /keys found\s+(\d+)/.exec(output);
    expect(
      found,
      `The load-error scan produced no total, so it did not run. Blank is not zero. Output:\n${output.slice(-1200)}`,
    ).not.toBeNull();
    expect(failed, `the scan exited non-zero:\n${output.slice(-1200)}`).toBe(
      false,
    );
    // The script carries its own floor (it refuses below 80 keys), so a drifted extraction fails above
    // rather than reporting a clean sweep of nothing.
    expect(
      Number(found?.[1]),
      'far fewer keys than this codebase has',
    ).toBeGreaterThan(95);

    // LITERAL regexes, not ones built from a string: this host mangles backslashes in a heredoc, so the
    // first version of this loop arrived with `'\s+'` where it needed `'\\s+'` — and in a JS string
    // literal `\s` is just the letter s. Both patterns matched nothing, and the assertion that caught it
    // was the null check rather than the count. Fifth occurrence of that trap in one session.
    const ONE_LANGUAGE = /in ONE language only\s+(\d+)/;
    const NEITHER = /in NEITHER\s+(\d+)/;
    for (const [label, pattern, what] of [
      ['in ONE language only', ONE_LANGUAGE, 'name one in only ONE language'],
      ['in NEITHER', NEITHER, 'name no way forward'],
    ] as Array<[string, RegExp, string]>) {
      const m = pattern.exec(output);
      expect(m, `the scan did not report "${label}"`).not.toBeNull();
      expect(
        Number(m?.[1]),
        `${Number(m?.[1])} load-error message(s) ${what}. ` +
          'The house convention is `<what failed> — try again.` / `<...> — حاول مرة أخرى.` — 109 of 109 ' +
          `follow it. Full output:\n${output}`,
      ).toBe(0);
    }
    // The THIRD subprocess in this file, and the last one still on the 5000ms default. Timed for the
    // same reason as the two above rather than waiting for it to be the one that goes red.
  }, 60_000);
});

describe('owner decision 54: the truncation note still names the real scan limit', () => {
  /*
   * THE STRING NAMES A NUMBER THAT LIVES SOMEWHERE ELSE, WHICH IS A LIE WAITING TO HAPPEN.
   *
   * «فُحِص أول ٢٠٠٠٠ سجل» — *the first 20000 records were scanned* — is the owner's own wording,
   * and `INTERNAL_CONTROLS_SCAN_LIMIT` is declared in the API. If that constant ever moves, the
   * sentence on screen becomes false and nothing else in this repository can see it: no type
   * connects an api constant to an i18n string, and the screen renders whatever the dictionary
   * says.
   *
   * TIED BY AN ASSERTION RATHER THAN INTERPOLATED, and the reason is the owner's digits.
   * Interpolating would render the figure through `formatNumber`, which keeps digits WESTERN —
   * silently overruling her «٢٠٠٠٠». Arabic-Indic numerals written INTO prose are this
   * dictionary's established convention (measured: 210 such characters across 14 files, including
   * `dsrExtendButton`'s «١٥ يوماً»), while `formatNumber`'s Western digits are for figures
   * rendered from DATA. So her bytes stand and this test is what keeps them true.
   *
   * BOTH LANGUAGES, each against its own rendering of the same constant — the Arabic in
   * Arabic-Indic digits, the English in Western ones with a thousands separator. A test checking
   * only one half would pass while the other went stale.
   */
  const limit = (() => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../api/src/modules/internal-controls/internal-controls.config.ts',
      ),
      'utf8',
    );
    const m = /INTERNAL_CONTROLS_SCAN_LIMIT\s*=\s*(\d+)/.exec(source);
    return m ? Number(m[1]) : null;
  })();

  it('reads the constant at all — a null here is a broken parser, not a missing limit', () => {
    expect(
      limit,
      'INTERNAL_CONTROLS_SCAN_LIMIT could not be read out of internal-controls.config.ts. That is ' +
        'this parser breaking rather than the constant going away; without it both assertions ' +
        'below would compare against NaN and pass on nothing.',
    ).not.toBeNull();
    expect(limit).toBeGreaterThan(0);
  });

  it('both truncation notes name the limit the scan actually uses', () => {
    const arabicIndic = String(limit).replace(/\d/g, (d) =>
      String.fromCharCode(0x0660 + Number(d)),
    );
    const message =
      'The truncation note on /internal-controls names a different number from ' +
      `INTERNAL_CONTROLS_SCAN_LIMIT (${String(limit)}). That note is the only thing telling a ` +
      'reader the scan was INCOMPLETE — there may be self-approval violations past the limit — ' +
      'so a wrong figure there makes a partial scan look like a measured one. Update the string ' +
      'to match the constant (the Arabic is the OWNER\'S, decision 54: change the digits only, ' +
      'in Arabic-Indic, and nothing else).';
    expect(lookupOptional('AR', 'icTruncatedNote') ?? '', message).toContain(arabicIndic);
    expect(lookupOptional('EN', 'icTruncatedNote') ?? '', message).toContain(
      String(limit).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
    );
  });
});
