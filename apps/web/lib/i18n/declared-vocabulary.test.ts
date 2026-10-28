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
