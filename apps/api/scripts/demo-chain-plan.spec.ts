import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEMO_OFFICE_NAMES,
  HALTED_CHAINS_PER_OFFICE,
  HALTED_STAGES,
  haltedChainCount,
  haltedChainSchedule,
} from './demo-chain-plan';

/**
 * THE DEMO'S DECLARED SHAPE, CHECKED WITHOUT A DATABASE.
 *
 * `seed-demo.script.ts` targets the DEV database and ends in a `test()` call, so it can neither
 * run in CI nor be imported. What CAN be checked here is the PLAN it executes — that every stage
 * message 46 §2.1 names is scheduled at least once per office, and that the two office names are
 * the owner's own rather than something written here.
 *
 * The run itself asserts what actually landed; this asserts what it was told to do. Both are
 * needed: a plan nobody executes and an execution nobody planned fail differently.
 */
describe('the demo seed’s halted-chain plan', () => {
  it('names every stage message 46 §2.1 asks for', () => {
    expect([...HALTED_STAGES]).toEqual([
      'needsAssessmentApproved',
      'programmeFinalized',
      'opportunityNeedsConfirmed',
      'rfqIssuedAwaitingEvidence',
    ]);
  });

  it('schedules AT LEAST ONE chain per office at every stage, by stage name', () => {
    for (const stage of HALTED_STAGES) {
      expect(
        HALTED_CHAINS_PER_OFFICE[stage],
        `stage ${stage} must halt at least one chain per office — a stage with zero is a stage ` +
          `the presenter cannot show`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('expands the schedule in pipeline order, one entry per chain', () => {
    const schedule = haltedChainSchedule();
    expect(schedule).toHaveLength(haltedChainCount());

    // Pipeline order: a stage's entries never appear before an earlier stage's. Asserted by
    // comparing first-appearance order against HALTED_STAGES rather than by trusting flatMap.
    const firstSeen = HALTED_STAGES.map((s) => schedule.indexOf(s));
    expect(firstSeen).toEqual([...firstSeen].sort((a, b) => a - b));
    expect(firstSeen.every((i) => i >= 0)).toBe(true);

    for (const stage of HALTED_STAGES) {
      expect(schedule.filter((s) => s === stage)).toHaveLength(
        HALTED_CHAINS_PER_OFFICE[stage],
      );
    }
  });

  /**
   * 🔴 THE FOUR OFFICE NAMES ARE RE-SLICED FROM HER PAPER AT TEST TIME.
   *
   * ⛔ This test does not hold its own copy of the Arabic — that would be a second home for it,
   * and a second home agrees with the first right up until somebody edits one. It reads the row
   * out of `docs/decision-150-ratified-strings.md` §٦ and compares byte for byte.
   */
  it('carries the owner’s own office names, sliced from decision 150 annex §٦', () => {
    const annex = readFileSync(
      join(__dirname, '../../../docs/decision-150-ratified-strings.md'),
      'utf8',
    );

    // The annex's §٦ table: `| <office> (`slug`) | <arabic> | <english> |`
    const rows = [
      ...annex.matchAll(
        /^\|[^|\n]*\(`(office-[ab])`\)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*$/gm,
      ),
    ];
    expect(
      rows,
      'decision 150 annex §٦ must still carry one row per demo office — if it does not, this ' +
        'slice is reading the wrong table and the comparison below would be vacuous',
    ).toHaveLength(2);

    for (const [, slug, ar, en] of rows) {
      const declared = DEMO_OFFICE_NAMES[slug as 'office-a' | 'office-b'];
      expect(declared, `no declared name for ${slug}`).toBeDefined();
      expect(declared.ar).toBe(ar);
      expect(declared.en).toBe(en);
    }
  });

  it('invents no Arabic: every declared name appears verbatim in her annex', () => {
    const annex = readFileSync(
      join(__dirname, '../../../docs/decision-150-ratified-strings.md'),
      'utf8',
    );
    for (const { ar, en } of Object.values(DEMO_OFFICE_NAMES)) {
      expect(annex.split(ar).length - 1, `«${ar}» is not in the annex`).toBe(1);
      expect(annex.split(en).length - 1, `"${en}" is not in the annex`).toBe(1);
    }
  });
});
