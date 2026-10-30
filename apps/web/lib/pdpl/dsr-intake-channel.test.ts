import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENUM_LABEL } from '../i18n/enum-labels';
import { LANGUAGES, lookupOptional } from '../i18n/translations';
import { DSR_INTAKE_CHANNELS } from './dsr-api';

/**
 * HOW A DATA SUBJECT REQUEST ARRIVED — three copies of one vocabulary, and nothing checked them.
 *
 * `DsrIntakeChannel` exists in the database; `DSR_INTAKE_CHANNELS` is a hand-copied list in
 * `dsr-api.ts` because the web cannot import from the api; `ENUM_LABEL.DsrIntakeChannel` is the
 * bilingual map the `<select>` renders. A fifth channel added to the schema would reach the api's
 * DTO automatically — `DSR_INTAKE_CHANNELS` there is `Object.values` of the generated enum — and
 * would reach NEITHER of the web's two copies. The option would simply not be offered, which is
 * silent, or would render through `t(undefined)` and show NO WORDS AT ALL.
 *
 * That is the notification-bell defect, and it is why this parses the SCHEMA rather than restating
 * the four: the test fails by name on the commit that adds the fifth, which is the only moment
 * anybody knows which Arabic word is owed.
 *
 * ## Why here rather than in `packages/db`
 *
 * `workflow-entity-type-parity.spec.ts` lives in `packages/db` because it compares an api union
 * against a web union and only that package can see both. This one needs the WEB's label map and
 * the SCHEMA, and `turbo prune web --docker` keeps the web workspace's own dependencies — of which
 * `packages/db` is one — so reading `schema.prisma` from here is the same reach
 * `declared-vocabulary.test.ts` already uses one directory over.
 *
 * ## What this does NOT claim
 *
 * It does not check that a label is the RIGHT word — the four Arabic labels are the owner's and
 * decision 94 governs them. It checks that every member HAS one, in both languages.
 */

const SCHEMA = join(
  __dirname,
  '../../../../packages/db/prisma/schema.prisma',
);

function schemaChannels(): string[] {
  const source = readFileSync(SCHEMA, 'utf8');
  const block = /enum DsrIntakeChannel \{([^}]*)\}/.exec(source);
  if (!block) {
    throw new Error('enum DsrIntakeChannel not found in schema.prisma');
  }
  return block[1]
    .split('\n')
    // `///` doc comments sit above the members in this schema — a member named only in prose must
    // not read as declared.
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line))
    .sort();
}

describe('the DSR intake channel has one vocabulary in three places', () => {
  /*
   * THE NON-VACUITY FLOOR FIRST. Both assertions below compare against a PARSED set, and an empty
   * parsed set makes them vacuously true — the clean-nothing shape this repository has paid for
   * repeatedly. A parser that stops matching must fail HERE rather than report two clean results.
   */
  it('parses a real member set out of the schema', () => {
    const members = schemaChannels();
    expect(members.length, `parsed ${members.length} member(s)`).toBe(4);
  });

  it('the client list is exactly the database enum', () => {
    expect([...DSR_INTAKE_CHANNELS].sort()).toEqual(schemaChannels());
  });

  it('every channel has a label, and every label resolves in BOTH languages', () => {
    expect(Object.keys(ENUM_LABEL.DsrIntakeChannel).sort()).toEqual(
      schemaChannels(),
    );
    for (const key of Object.values(ENUM_LABEL.DsrIntakeChannel)) {
      for (const language of LANGUAGES) {
        expect(
          lookupOptional(language, key),
          `${key} has no ${language} value`,
        ).toBeTruthy();
      }
    }
  });

  it('the four Arabic labels are distinct and Arabic', () => {
    /*
     * The owner supplied «بريد · هاتف · حضورٌ شخصيّ · نموذجُ الموقع». Two channels sharing a label
     * is a copy-paste, and an English label here is the defect the map exists to prevent — a
     * length check alone would catch neither.
     */
    const arabic = Object.values(ENUM_LABEL.DsrIntakeChannel).map((key) =>
      lookupOptional('AR', key),
    );
    expect(new Set(arabic).size).toBe(4);
    for (const value of arabic) {
      expect(/[ؠ-ي]/.test(value ?? ''), `${value} is not Arabic`).toBe(
        true,
      );
    }
  });
});
