import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 157 RULING 11 — THE SENTENCE AND THE TABLE MUST AGREE ABOUT HOW MANY.
 *
 * `/settings/roles` opens the dual-control section with «… عملية في هذا النظام لا يمكن أن
 * ينفّذها شخص واحد», and the table under it is one row per registered maker/checker pair. The
 * sentence said «خمس عشرة» — fifteen — while `MAKER_CHECKER_REGISTRY` held SIXTEEN rows, because
 * needs assessment appears twice (review, then approval). A reader counting the rows found one
 * more than the sentence promised, on a screen whose whole purpose is telling an office where it
 * is one person short.
 *
 * Her ruling moves the word to «ستّ عشرة» and this file is what stops it drifting again. Decision
 * 157's English section asks for exactly this: *«a test asserts the number in the sentence equals
 * the row count from `maker-checker-pairs.config.ts`, so the next pair added fails a test rather
 * than a reader»*.
 *
 * ## ⚠️ WHY THIS CANNOT COMPUTE THE WORD
 *
 * The count is written as an Arabic NUMBER WORD, not digits, and a number word is hers. So this
 * cannot derive «سبع عشرة» for a seventeenth pair and must not try — composing one would be
 * inventing Arabic, which decision 125 forbids. What it CAN do is fail: the day the registry
 * gains a row, this test goes red naming both figures, and the new word is asked for.
 *
 * ## ⚠️ AND THE TWO NEEDS-ASSESSMENT ROWS WERE A KNOWN DEFECT SHE ACCEPTED — SHE HAS NOW RULED IT
 *
 * They carry the same checker permission, so with the operation column removed they read alike,
 * and decision 157 recorded that in her own words: «عيب معلوم قبلته الإدارة». 🔴 OWNER DECISION
 * 163 RULING 4 ENDS IT: each row is qualified with the word the needs-assessment screen itself
 * uses — «(راجعه)» and «(اعتمده)» — and `lib/admin/duty-segregation-rows.test.ts` is what holds
 * that, in both directions.
 *
 * ⛔ THE ⛔ BELOW STILL STANDS, AND IS WHY THIS COUNT DID NOT MOVE: the registry is NOT
 * de-duplicated. They are two different acts with two different escape columns, and collapsing
 * them would let a declared combined REVIEW excuse a self-APPROVAL. What ruling 4 changed is the
 * DISPLAY, so the sentence still says «ستّ عشرة» and this file still measures sixteen.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const REGISTRY = join(
  REPO,
  'apps',
  'api',
  'src',
  'common',
  'maker-checker-pairs.config.ts',
);
const PAPER = join(REPO, 'docs', 'decision-157-answer-sheet-4.md');

/** The number of pairs the api registers, parsed from the file that declares them. */
function registeredPairCount(): number {
  const source = readFileSync(REGISTRY, 'utf8');
  const start = source.indexOf('export const MAKER_CHECKER_REGISTRY = [');
  expect(start, 'MAKER_CHECKER_REGISTRY not found').toBeGreaterThanOrEqual(0);
  // Comments stripped FIRST. This file documents each pair above its entry, and a comment that
  // quotes `entityType:` while explaining one would be counted as a row — the
  // comment-quotes-the-pattern class this repository has now hit nine times.
  const body = source
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  return [...body.matchAll(/^\s{4}entityType: '/gm)].length;
}

/** The word decision 157 table د ratified for the sentence. */
function ratifiedCountWord(): string {
  const body = readFileSync(PAPER, 'utf8');
  const at = body.indexOf('### د');
  expect(at, 'table د not found in decision 157').toBeGreaterThanOrEqual(0);
  const ends = [body.indexOf('\n### ', at + 1), body.indexOf('\n## ', at + 1)]
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  const section = ends.length > 0 ? body.slice(at, ends[0]) : body.slice(at);
  const rows = [...section.matchAll(/^\|([^\n]*)\|\s*$/gm)]
    .map((m) => m[1].split('|').map((c) => c.trim()))
    .filter((c) => c.length === 4 && c[0].includes('dutySegIntro'));
  expect(rows, 'table د must carry one dutySegIntro row').toHaveLength(1);
  return rows[0][3];
}

describe('owner decision 157 ruling 11 — the sentence counts the table', () => {
  it('the registry holds exactly the sixteen pairs her word names', () => {
    expect(
      registeredPairCount(),
      'MAKER_CHECKER_REGISTRY has changed size. `dutySegIntro` says «ستّ عشرة عملية» in ' +
        'words, and a number word is the owner\'s to give — it cannot be computed here. Ask ' +
        'her for the new word (decision 157 ruling 11), then move this figure with it.',
    ).toBe(16);
  });

  it('and the shipping sentence carries that word', () => {
    const sentence = lookupOptional('AR', 'dutySegIntro');
    expect(sentence).toBeTruthy();
    expect(sentence).toContain(ratifiedCountWord());
  });

  it('the parse is not vacuous — it finds rows, and comments are not rows', () => {
    // A matcher that found nothing would make the first test fail rather than pass, but a
    // matcher that found the SAME wrong thing in a comment would not. This pins both ends.
    const raw = readFileSync(REGISTRY, 'utf8');
    expect(raw).toContain('entityType');
    expect(registeredPairCount()).toBeGreaterThan(0);
  });

  it('⛔ the two NeedsAssessment rows are still two rows, as she ruled', () => {
    // «عيب معلوم قبلته الإدارة» — review and approval are different acts that happen to share a
    // checker permission. De-duplicating them would make the sentence right for the wrong reason.
    const source = readFileSync(REGISTRY, 'utf8');
    const needs = [...source.matchAll(/entityType: 'NeedsAssessment'/g)];
    expect(needs).toHaveLength(2);
  });
});
