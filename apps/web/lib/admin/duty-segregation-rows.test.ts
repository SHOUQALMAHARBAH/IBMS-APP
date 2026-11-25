import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dutyRowName, dutyRowQualifierKey } from './duty-segregation-rows';
import { lookupOptional } from '../i18n/translations';

/**
 * 🔴 OWNER DECISION 163 RULING 4 — NO TWO ROWS OF THE DUAL-CONTROL TABLE MAY READ ALIKE.
 *
 * `/settings/roles` renders one row per registered maker/checker pair, labelled by the CHECKER's
 * permission since decision 157 ruling 11 removed the programmatic operation column.
 * `NeedsAssessment` has two pairs sharing one permission, so two rows printed «يعتمد تقييم حاجات
 * العميل» with nothing to distinguish them.
 *
 * ## WHAT THIS ASSERTS, AND IT IS THE PROPERTY RATHER THAN THE INSTANCE
 *
 * Both directions, over the REGISTRY the api actually ships:
 *
 *   1. no two rows display the same name — so a seventeenth pair colliding with an existing
 *      name fails HERE and asks for a word, instead of shipping a table a reader cannot use;
 *   2. a row whose name is already unique carries NO qualifier — so the qualifier cannot be
 *      sprinkled onto rows that do not need one.
 *
 * ⚠️ LIKE `duty-segregation-count.test.ts`, THIS CANNOT INVENT THE WORD a new collision would
 * need. An Arabic word is hers. What it can do is fail by name and ask for one.
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
const PAPER = join(REPO, 'docs', 'decision-163-msg-53-five-answers.md');

interface Row {
  checkerPermission: string;
  checkerField: string;
}

/**
 * The pairs the api registers, read out of the file that declares them.
 *
 * ⚠️ COMMENTS ARE STRIPPED FIRST, and not as a precaution: that file documents every pair in a
 * block comment above it, and those comments quote `checkerPermission:` while explaining one —
 * the comment-quotes-the-pattern class this repository has now hit ten times.
 */
function registeredRows(): Row[] {
  const source = readFileSync(REGISTRY, 'utf8');
  const start = source.indexOf('export const MAKER_CHECKER_REGISTRY = [');
  expect(start, 'MAKER_CHECKER_REGISTRY not found').toBeGreaterThanOrEqual(0);
  const body = source
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  const rows: Row[] = [];
  // One entry per `entityType:` line; the two fields are read from the same entry's span, so a
  // pair missing either is a parse failure rather than a silently dropped row.
  const entries = body.split(/^\s{4}entityType: '/m).slice(1);
  for (const entry of entries) {
    const perm = /checkerPermission: '([^']*)'/.exec(entry);
    const field = /checkerField: '([^']*)'/.exec(entry);
    expect(
      field,
      `a registry entry has no checkerField: ${entry.slice(0, 60)}`,
    ).not.toBeNull();
    rows.push({
      // `makerPermission` may be null; the CHECKER half never is on a shipped pair.
      checkerPermission: perm ? perm[1] : '',
      checkerField: field![1],
    });
  }
  return rows;
}

/** Substitutes the way `translate()` does, so the test reads what the screen renders. */
function t(key: string, params?: Record<string, string | number>): string {
  const raw = lookupOptional('AR', key);
  expect(raw, `AR dictionary has no key ${key}`).toBeTruthy();
  if (!params) return raw as string;
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    raw as string,
  );
}

describe('decision 163 ruling 4 — the dual-control table', () => {
  it('registers at least the two needs-assessment pairs it is about', () => {
    const rows = registeredRows();
    // NON-VACUITY. Without this, a parse that returned [] would make every assertion below
    // pass over nothing — the shape this repository has been caught by more than once.
    expect(rows.length).toBeGreaterThanOrEqual(16);
    const na = rows.filter(
      (r) => r.checkerPermission === 'needs-assessment.approve',
    );
    expect(
      na.map((r) => r.checkerField).sort(),
      'the two needs-assessment pairs are what this ruling is about',
    ).toEqual(['approvedByUserId', 'reviewedByUserId']);
  });

  it('shows no two rows under the same name, in either language', () => {
    for (const language of ['AR', 'EN'] as const) {
      const rows = registeredRows();
      const names = rows.map((r) => dutyRowName(r, rows, language, t));
      const seen = new Map<string, number>();
      for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
      const repeated = [...seen.entries()]
        .filter(([, n]) => n > 1)
        .map(([name]) => name);
      expect(
        repeated,
        `two rows of the dual-control table read alike in ${language}. ` +
          'Decision 163 ruling 4 qualifies a colliding row with a word ALREADY on the screen ' +
          'that owns the act — add it to CHECKER_FIELD_QUALIFIER keyed on the checker FIELD. ' +
          'An Arabic word that does not already ship is the owner’s to give: ask, do not compose.',
      ).toEqual([]);
    }
  });

  it('qualifies only the rows that would otherwise collide', () => {
    const rows = registeredRows();
    const bare = new Map<string, number>();
    for (const r of rows) {
      const name = r.checkerPermission;
      bare.set(name, (bare.get(name) ?? 0) + 1);
    }
    for (const r of rows) {
      const collides = (bare.get(r.checkerPermission) ?? 0) > 1;
      const qualified = dutyRowQualifierKey(r, rows) !== null;
      expect(
        qualified,
        `${r.checkerPermission} / ${r.checkerField}: a qualifier belongs only on a row whose ` +
          'permission name is not unique — otherwise it is noise on a table that is read by ' +
          'scanning',
      ).toBe(collides);
    }
  });

  it('renders her two sentences, every span SLICED from decision 163 and not retyped', () => {
    const paper = readFileSync(PAPER, 'utf8');
    // Her table cell, which carries both sentences. Sliced rather than spelled: the nouns here
    // carry combining marks and a retyped copy fails silently.
    const cell =
      /\|\s*٤\s*\|[^|]*\|([^|]*)\|/.exec(paper) ??
      (() => {
        throw new Error('decision 163 row ٤ not found in its own paper');
      })();
    const quoted = [...cell[1].matchAll(/«([^»]+)»/g)].map((m) => m[1]);
    expect(
      quoted.length,
      'decision 163 row ٤ no longer quotes two sentences — the paper moved under this test',
    ).toBeGreaterThanOrEqual(2);
    const reviewer = quoted[0];
    expect(reviewer).toContain('راجعه');

    const rows = registeredRows();
    const rendered = rows
      .filter((r) => r.checkerPermission === 'needs-assessment.approve')
      .map((r) => dutyRowName(r, rows, 'AR', t));
    expect(rendered).toContain(reviewer);

    // Her second cell writes the approver sentence with an ellipsis for the shared half
    // («… (اعتمده)»), so the comparison is built from HER two halves rather than from mine:
    // the reviewer sentence with its own word swapped for the approver's.
    const approverWord = quoted.find((q) => q.includes('اعتمده'));
    expect(
      approverWord,
      'decision 163 row ٤ no longer quotes the approver word',
    ).toBeTruthy();
    const approver = reviewer.replace(t('nadReviewedBy'), t('nadApprovedBy'));
    expect(approver).not.toBe(reviewer);
    expect(rendered).toContain(approver);
  });

  it('the format value carries a parenthesis and two placeholders, and no word', () => {
    const format = lookupOptional('AR', 'dutySegPermissionQualified');
    expect(format).toBe('{name} ({qualifier})');
    // ⛔ Not one Arabic letter in it. Any word here would be a word nobody ratified.
    expect(/[؀-ۿ]/.test(format as string)).toBe(false);
  });
});
