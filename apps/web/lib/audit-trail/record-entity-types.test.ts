import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAKER_CHECKER_ENTITY_LABEL,
  SLA_ENTITY_LABEL,
  makerCheckerEntityLabel,
  slaEntityLabel,
} from './record-entity-types';
import { LANGUAGES, lookupOptional } from '../i18n/translations';

/**
 * OWNER DECISION 53's SEQUENCING RULE, AS A TEST.
 *
 * Her rule was *do not switch either screen to names until its set is COMPLETE* — because a map
 * naming twelve of fifteen and rendering a member name for the other three is the same defect
 * batch eight refused to build. Both sets came out complete by derivation, so both screens DID
 * switch; this is what keeps that true.
 *
 * TOTALITY IS READ FROM THE API, NEVER RESTATED HERE. A hand-written list of fifteen members in
 * this file would be a second home for one fact, and the copy is the one that drifts — so the
 * members are parsed out of `maker-checker-pairs.config.ts` and `sla-registry.config.ts`
 * themselves. A sixteenth maker/checker pair or a seventeenth SLA workflow therefore fails this
 * spec by name on the commit that adds it, which is the only moment anybody will know which word
 * is owed.
 *
 * THIS IS THE ONLY PLACE THAT CAN SEE BOTH SIDES. No TypeScript type connects an api config to a
 * web label map, which is the same reason `workflow-entity-type-parity.spec.ts` exists one level
 * over.
 */

const API = join(__dirname, '../../../api/src');

function entityTypesIn(relative: string): string[] {
  const source = readFileSync(join(API, relative), 'utf8')
    // Comments stripped: both files discuss entity types in prose at length, and a type named
    // only in a comment must not read as declared.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  return [
    ...new Set(
      [...source.matchAll(/entityType:\s*'([^']+)'/g)].map((m) => m[1]),
    ),
  ].sort();
}

describe('owner decision 53: every record type on both screens has a word', () => {
  /*
   * THE NON-VACUITY FLOOR FIRST. Every assertion below compares against a parsed set, and an
   * empty parsed set makes "every member is worded" vacuously true — the clean-nothing failure
   * this repository has paid for repeatedly. The floors are the counts batch eight measured by
   * hand, so a parser that stops working disagrees with a figure rather than reporting agreement
   * with nothing.
   */
  it('parses both source-of-truth lists — a clean nothing here is a broken parser', () => {
    const makerChecker = entityTypesIn('common/maker-checker-pairs.config.ts');
    const sla = entityTypesIn('modules/sla/sla-registry.config.ts');
    expect(
      makerChecker.length,
      'No entityType parsed out of maker-checker-pairs.config.ts. That is this parser breaking, ' +
        'not the pairs going away — there are sixteen pairs across fifteen entity types.',
    ).toBe(15);
    expect(
      sla.length,
      'No entityType parsed out of sla-registry.config.ts. Sixteen workflows are tracked.',
    ).toBe(16);
  });

  it('the maker/checker map is TOTAL over the registry — nothing renders a member name', () => {
    const members = entityTypesIn('common/maker-checker-pairs.config.ts');
    const unworded = members.filter((m) => makerCheckerEntityLabel(m) === null);
    expect(
      unworded,
      'A maker/checker entity type has no word, so `/internal-controls` would render its MEMBER ' +
        'NAME — raw machine text where a reader expects a record type. That is the defect owner ' +
        'decision 53 sequenced against: derive the word from a string already in the product ' +
        '(the screen heading for that entity is the first place to look — decision 41 points at ' +
        'fifteen of them), add it to MAKER_CHECKER_ENTITY_LABEL, and if it is BROADER than the ' +
        'member then ship it and say so in a comment rather than narrowing it, because narrowing ' +
        'means writing Arabic and that is the owner\'s.',
    ).toEqual([]);
    // And the other direction: a map entry for a pair that no longer exists is a stale row, which
    // would quietly stop being checked.
    expect(
      Object.keys(MAKER_CHECKER_ENTITY_LABEL).filter((k) => !members.includes(k)),
      'MAKER_CHECKER_ENTITY_LABEL names an entity type the registry no longer has — remove the ' +
        'row rather than leaving it, or the map stops describing the set it claims to cover.',
    ).toEqual([]);
  });

  it('the SLA map is TOTAL over the registry — nothing renders a member name', () => {
    const members = entityTypesIn('modules/sla/sla-registry.config.ts');
    expect(
      members.filter((m) => slaEntityLabel(m) === null),
      'An SLA-tracked entity type has no word, so `/sla-dashboard` would render its MEMBER NAME. ' +
        'See the maker/checker message above — the procedure is the same.',
    ).toEqual([]);
    expect(
      Object.keys(SLA_ENTITY_LABEL).filter((k) => !members.includes(k)),
      'SLA_ENTITY_LABEL names an entity type the registry no longer tracks — remove the row.',
    ).toEqual([]);
  });

  it('every key both maps point at resolves in BOTH languages', () => {
    /*
     * The maps are `satisfies Record<string, TranslationKey>`, so a TYPO is already a compile
     * error. What the type cannot see is a key that exists in the union but is missing from one
     * language's dictionary — which renders the key name to an Arabic reader and nothing to an
     * English one. Fifteen of these sixteen entries point at a key some OTHER screen owns, so the
     * risk is somebody deleting that screen's heading without knowing this map reads it.
     */
    const keys = [
      ...new Set([
        ...Object.values(MAKER_CHECKER_ENTITY_LABEL),
        ...Object.values(SLA_ENTITY_LABEL),
      ]),
    ];
    expect(keys.length).toBeGreaterThan(0);
    for (const lang of LANGUAGES) {
      // `lookupOptional`, not the dictionary object — `translations` is deliberately NOT exported,
      // so a key is resolved through the one accessor every screen uses rather than by reaching
      // past it. It takes a `string`, which is what lets this loop check a key the type system
      // already accepts.
      const missing = keys.filter((k) => {
        const value = lookupOptional(lang, k);
        return typeof value !== 'string' || value === '';
      });
      expect(
        missing,
        `These keys are missing from the ${lang} dictionary. Fifteen of the sixteen ` +
          'entries POINT AT another screen\'s heading rather than owning their own string, which ' +
          'is decision 41\'s mechanism — so deleting that heading breaks a record label here. ' +
          'Either restore the key or re-point the map row at a string that still exists.',
      ).toEqual([]);
    }
  });

  it('the two maps never give one entity two different words', () => {
    /*
     * The sets overlap without either containing the other — six entity types are in both — and
     * two words for one entity across two screens is the «التعديلات»/«الملحقات» divergence
     * (decision 42) waiting to happen. Pinned here rather than trusted, because the maps are
     * deliberately separate.
     */
    const disagreements: string[] = [];
    for (const [member, key] of Object.entries(MAKER_CHECKER_ENTITY_LABEL)) {
      const other = slaEntityLabel(member);
      if (other !== null && other !== key) {
        disagreements.push(`${member}: ${key} vs ${other}`);
      }
    }
    expect(
      disagreements,
      'An entity type is worded one way on `/internal-controls` and another on `/sla-dashboard`. ' +
        'A reader who sees both screens sees two names for one kind of record — decision 42 ' +
        'settled that exact divergence for endorsements. Point both rows at the same key.',
    ).toEqual([]);
  });
});
