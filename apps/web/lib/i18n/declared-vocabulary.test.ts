import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENUM_LABEL, isDeclaredTransactionPattern } from './enum-labels';
import { LANGUAGES, lookupOptional } from './translations';

/**
 * OWNER DECISION 59 — THE DECLARED VOCABULARIES, AS A TEST.
 *
 * Group 4 found ten sites rendering a declared value AS STORED. Five turned out to be pure
 * oversight — a complete bilingual label map already shipped and the screen simply did not
 * reach for it — and one needed her word. This file holds the two properties that neither
 * the compiler nor `raw-stored-values.py` can see.
 *
 * (1) TOTALITY AGAINST THE API'S OWN VOCABULARY. `satisfies Labels<Union>` makes the web map
 *     total over the WEB union, which is a hand-copied mirror of a Prisma enum — so the
 *     compiler proves the two halves of the web agree and says nothing about whether the web
 *     union still matches the database. A seventh `ConsentPurpose` member would type-check
 *     perfectly here and render `undefined` on `/consent`. So the members are PARSED out of
 *     `schema.prisma` and the api's own DTO rather than restated: a member added there fails
 *     this spec by name on the commit that adds it, which is the only moment anybody knows
 *     which word is owed. Same argument as `record-entity-types.test.ts` one directory over.
 *
 * (2) HER WORD HAS ONE HOME AND ONE CONSUMER. Decision 59 changed the VALUE of
 *     `matchStatusPending` rather than adding a second key, on her reasoning that «مستبعد»
 *     and «مؤكَّد» are verdicts so the trio must read as one family. A second key carrying
 *     the same Arabic, or a screen carrying it as a literal, would undo that silently — the
 *     «التعديلات»/«الملحقات» divergence class, which is what her walk reported.
 *
 * WHAT THIS DOES NOT CLAIM. It does not check that a label is the RIGHT word; that is the
 * owner's, and decision 94 governs it. It checks that every member HAS one and that one
 * member has exactly one.
 */

const WEB = join(__dirname, '../..');
const SCHEMA = join(WEB, '../../packages/db/prisma/schema.prisma');
const API = join(WEB, '../api/src');

/** Her word, by decision 59. Written once here so the assertions below cannot drift apart. */
const PENDING_AR = 'لم يُبَتَّ فيه';

function schemaEnumMembers(name: string): string[] {
  const source = readFileSync(SCHEMA, 'utf8');
  const block = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(source);
  if (!block) throw new Error(`enum ${name} not found in schema.prisma`);
  return block[1]
    .split('\n')
    // `///` doc comments sit between members in this schema — a member named only in
    // prose must not read as declared.
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line))
    .sort();
}

describe('owner decision 59: every declared vocabulary the screens render has a word', () => {
  /*
   * THE NON-VACUITY FLOOR FIRST. Every totality assertion below compares a map's keys against
   * a PARSED set, and an empty parsed set makes "every member is worded" vacuously true — the
   * clean-nothing shape this repository has paid for repeatedly. A parser that stops matching
   * must fail here rather than report four clean results.
   */
  it('parses a real member set out of the schema for each enum under test', () => {
    for (const [name, expected] of [
      ['ConsentPurpose', 6],
      ['CustomerStatus', 4],
      ['SlaDurationUnit', 5],
      ['SlaSourceType', 5],
    ] as const) {
      const members = schemaEnumMembers(name);
      expect(members.length, `${name} parsed ${members.length} member(s)`).toBe(
        expected,
      );
    }
  });

  it.each([
    ['ConsentPurpose', 'ConsentPurpose'],
    ['CustomerStatus', 'CustomerStatus'],
    ['SlaDurationUnit', 'SlaDurationUnit'],
    ['SlaSourceType', 'SlaSourceType'],
  ])(
    'ENUM_LABEL.%s is total over the database enum, and every key resolves in both languages',
    (mapName, enumName) => {
      const map = ENUM_LABEL[mapName as keyof typeof ENUM_LABEL] as Record<
        string,
        string
      >;
      expect(Object.keys(map).sort()).toEqual(schemaEnumMembers(enumName));
      for (const key of Object.values(map)) {
        for (const language of LANGUAGES) {
          expect(
            lookupOptional(language, key),
            `${key} has no ${language} value`,
          ).toBeTruthy();
        }
      }
    },
  );

  /*
   * `ScreeningMatchStatus` is NOT a Prisma enum — the column is a `String` whose vocabulary is
   * declared by the api's own DTO (`@IsIn([...])`, which is what refuses a fourth value over
   * HTTP). So that `@IsIn` is the source of truth, and it is parsed rather than restated for
   * exactly the same reason.
   */
  it('ENUM_LABEL.ScreeningMatchStatus is total over the api DTO that refuses a fourth value', () => {
    const dto = readFileSync(
      join(API, 'modules/customer/dto/review-screening-match.dto.ts'),
      'utf8',
    );
    const found = /@IsIn\(\[('pending'[^\]]*)\]/.exec(dto);
    expect(found, 'the status @IsIn vocabulary was not found in the DTO').toBeTruthy();
    const members = [...found![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(members.length, 'parsed no members out of the DTO').toBe(3);
    expect(Object.keys(ENUM_LABEL.ScreeningMatchStatus).sort()).toEqual(members);
  });

  describe("decision 59's word has ONE home and ONE consumer", () => {
    it('`matchStatusPending` carries it, and it is the label the map points at', () => {
      expect(ENUM_LABEL.ScreeningMatchStatus.pending).toBe('matchStatusPending');
      expect(lookupOptional('AR', 'matchStatusPending')).toBe(PENDING_AR);
    });

    it('no OTHER dictionary key carries the same Arabic', () => {
      const dir = join(__dirname, 'translations');
      const carriers: string[] = [];
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
        const source = readFileSync(join(dir, file), 'utf8');
        for (const line of source.split('\n')) {
          // The comment recording her reasoning quotes the word; a comment is not a key.
          const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
          if (!code.includes(PENDING_AR)) continue;
          const key = /^\s*([A-Za-z0-9_]+)\s*:/.exec(code);
          carriers.push(`${file}:${key ? key[1] : code.trim()}`);
        }
      }
      // A second key with the same value is a second answer to one question, free to stop
      // agreeing the next time either is reworded.
      expect(carriers).toEqual(['enums.ts:matchStatusPending']);
    });

    it('no screen or component carries it as a literal', () => {
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) {
            if (entry === 'node_modules' || entry === '.next') continue;
            walk(full);
            continue;
          }
          if (!/\.tsx?$/.test(entry)) continue;
          // COMMENTS STRIPPED, and this is not a nicety: `/screening-matches` records her
          // reasoning in a `{/* … */}` block that QUOTES all three words, and the first run
          // of this test reported that screen as an offender. A word named only in a comment
          // is not a second home — reading one as a render is the recorded class that once
          // made `check:seed-sweeps` call a commented-out model "cleared".
          const code = readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
          if (code.includes(PENDING_AR)) {
            offenders.push(full.slice(WEB.length + 1).replace(/\\/g, '/'));
          }
        }
      };
      walk(join(WEB, 'app'));
      walk(join(WEB, 'components'));
      expect(offenders).toEqual([]);
    });
  });

  /*
   * `patternType` is the one of the six that is NOT closed by the database: a free `String`
   * whose five values live only in a schema doc comment, so a sixth is representable and
   * `/transaction-monitoring` renders it through decision 49's declared fallback. Two
   * properties, and the second is the one that matters.
   */
  describe('transaction-monitoring patterns: five declared, and an unlisted sixth falls back', () => {
    it('the five declared keys are exactly the schema comment vocabulary', () => {
      const line = /patternType\s+String \/\/ (.+)/.exec(
        readFileSync(SCHEMA, 'utf8'),
      );
      expect(line, 'the patternType vocabulary comment was not found').toBeTruthy();
      const documented = line![1]
        .split('|')
        .map((v) => v.trim())
        .filter((v) => /^[a-z_]+$/.test(v))
        .sort();
      expect(documented.length, 'parsed no values out of the comment').toBe(5);
      expect(
        Object.keys(ENUM_LABEL.TransactionMonitoringPattern).sort(),
      ).toEqual(documented);
    });

    /*
     * THE HOLE THIS CLOSES IS ONE I SHIPPED. `raw-stored-values.py` reports `{r.patternType}`
     * as a shape-A render whether it sits inside the fallback branch or in a bare cell with
     * no branch at all — a text scanner cannot tell those apart. So when my edit to this
     * screen silently failed to apply, the DECLARATION I wrote blessed a defect in exactly
     * the owner's own words, an instrument that looked like it was watching. The screen's
     * source is the only thing that can see the difference.
     *
     * It also refuses the dead-helper class, which this predicate genuinely was for a few
     * hours: a type predicate and a tooltip key both shipped with ZERO consumers while the
     * cell they exist for rendered raw.
     */
    it('the screen actually REACHES for the predicate and the tooltip key', () => {
      const screen = readFileSync(
        join(WEB, 'app/(app)/transaction-monitoring/page.tsx'),
        'utf8',
      )
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
      expect(
        screen.includes('isDeclaredTransactionPattern(r.patternType)'),
        'the pattern cell does not narrow — it renders the stored value unconditionally',
      ).toBe(true);
      expect(
        screen.includes("t('tmPatternUnlabelled')"),
        'the fallback renders no tooltip, so the stored value is dressed up as a name',
      ).toBe(true);
      expect(
        screen.includes('ENUM_LABEL.TransactionMonitoringPattern[r.patternType]'),
        'the declared branch does not reach the label map',
      ).toBe(true);
    });

    it('the predicate is DERIVED from the map rather than a second list of five', () => {
      for (const key of Object.keys(ENUM_LABEL.TransactionMonitoringPattern)) {
        expect(isDeclaredTransactionPattern(key), `${key} is declared`).toBe(true);
      }
      // The whole point of the fallback: a value nobody has decided a word for must be
      // recognised as undecided, never handed to `t()` as `undefined`.
      expect(isDeclaredTransactionPattern('structuring_deposits')).toBe(false);
      expect(isDeclaredTransactionPattern('')).toBe(false);
    });
  });
});

/**
 * OWNER DECISION 60 — THREE WORDS FOR THE EM DASH, AND ONLY THREE.
 *
 * A bare em dash leaves a reader asking *was this forgotten, or does it not apply?* Her ruling
 * gives a word to exactly three cases and leaves every other em dash alone, and her instruction
 * with the words was explicit: do not substitute a different word, do not widen these three into a
 * general vocabulary, and a site that does not fall cleanly into one of them keeps its dash and is
 * RECORDED. 16 sites of 107 converted on that basis; the other 91 are in
 * `docs/design-pass-register.md` and `scripts/measurements/em-dash-sites.py` re-derives them.
 */
describe('owner decision 60: three words for the em dash, and only three', () => {
  /** Hers, verbatim. Written once here so the assertions below cannot drift apart. */
  const DECISION_60: Record<string, string> = {
    commonNotAssessedYet: 'لم يُقيَّم بعد',
    commonNotApplicable: 'لا ينطبق',
    commonNameNotResolved: 'غير متوفّر',
  };

  it('ships all three in BOTH languages, and the Arabic is hers verbatim', () => {
    for (const language of LANGUAGES) {
      for (const key of Object.keys(DECISION_60)) {
        expect(lookupOptional(language, key), `${key} is missing in ${language}`).toBeTruthy();
      }
    }
    for (const [key, word] of Object.entries(DECISION_60)) {
      expect(lookupOptional('AR', key), `${key}'s Arabic is not hers`).toBe(word);
    }
  });

  it('has no FOURTH key carrying one of the three words', () => {
    // A fourth key type-checks perfectly, which is why the compiler cannot see this. Her
    // instruction was not to widen the three into a general vocabulary; a second key is how a
    // vocabulary of three quietly becomes one of six, each free to be reworded alone.
    const dir = join(__dirname, 'translations');
    for (const [owner, word] of Object.entries(DECISION_60)) {
      const carriers: string[] = [];
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
        for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
          const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
          // EQUALITY, NOT CONTAINMENT, and the first run is why. A `includes` check reported two
          // offenders and BOTH were legitimate: `providerOfficesLicenceNotApplicable` reads
          // «لا ينطبق — ليست مكتب وساطة», which is the richer string the OWNER herself named as
          // where this word already ships, and a dashboard paragraph uses «ولا ينطبق» as ordinary
          // prose. The hazard is a second key whose value IS the word — a duplicate free to be
          // reworded alone — not a longer sentence built from it or a sentence that mentions it.
          const entry = /^\s*([A-Za-z0-9_]+)\s*:\s*'([^']*)'/.exec(code);
          if (!entry || entry[2] !== word) continue;
          carriers.push(entry[1]);
        }
      }
      expect(carriers, `«${word}» belongs to ${owner} alone`).toEqual([owner]);
    }
  });

  it('is never spelled as a literal on a screen', () => {
    // A literal is a second home for the word — the «التعديلات»/«الملحقات» divergence class.
    // Comments are stripped for the reason decision 59's own version records: `common.ts`'s
    // header quotes all three while explaining which case each is for, and screens quote them
    // too; a word named only in a comment is not a second home.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === 'node_modules' || entry === '.next') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
        for (const word of Object.values(DECISION_60)) {
          if (code.includes(word)) {
            offenders.push(`${full.slice(WEB.length + 1).replace(/\\/g, '/')} spells «${word}»`);
          }
        }
      }
    };
    walk(join(WEB, 'app'));
    walk(join(WEB, 'components'));
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
