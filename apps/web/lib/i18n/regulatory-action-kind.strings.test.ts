import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 147 §٥ — THE TWO MEMBER DESCRIPTIONS, RE-SLICED FROM HER PAPER.
 *
 * ## WHY THESE TWO STRINGS HELD A WHOLE DECISION OUT OF THE PRODUCT
 *
 * OWNER DECISION 128 adds `DEFICIENCY_NOTICE` and `RENEWAL_REFUSAL` to `RegulatoryActionKind`,
 * and `enum-descriptions.spec.ts` demands an Arabic description over 40 characters for EVERY
 * member. Decision 133 had ratified only their NAMES. So message 43 stopped at that guard rather
 * than composing Arabic — and the guard was the report.
 *
 * ⚠️ THE DESCRIPTIONS LIVE IN THE SEED, NOT THE DICTIONARY, which is why this file reads a
 * `packages/db` source from the web test suite. They are seeded onto
 * `RegulatoryActionKindDescription` and rendered from the database, so the dictionary has no
 * copy of them to compare — and a second copy is exactly what this repository refuses.
 *
 * The NAMES are separate and ratified by decision 133; `license-renewal.strings.test.ts` pins
 * those against her own table. ⛔ Do not conflate the two: a name is a label on a screen, a
 * description is the sentence that explains what the label cannot.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const D147 = join(
  REPO,
  'docs',
  'decision-147-two-regulatory-action-descriptions.md',
);
const SEED = join(
  REPO,
  'packages',
  'db',
  'prisma',
  'seed-data',
  'enum-descriptions.ts',
);

/**
 * Her §٣ table: the member's row, and the DESCRIPTION cell of it.
 *
 * ⚠️ MATCHED ON THE BACKTICKED MEMBER NAME, not on cell equality. Her second row's member cell
 * carries a parenthetical — «أو اسم العضو كما في الفرع الجانبي» — because she wrote the ruling
 * before the branch's member name was settled. An equality match would find nothing and the
 * comparison below would then compare undefined to undefined.
 */
function ratifiedDescription(member: string): string {
  const hits: string[] = [];
  for (const line of readFileSync(D147, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 3 || /^-+$/.test(cells[0])) continue;
    if (cells[0].includes(`\`${member}\``)) hits.push(cells[2]);
  }
  expect(
    hits,
    `decision 147 no longer carries exactly one row for ${member} — the slice source moved`,
  ).toHaveLength(1);
  return hits[0];
}

/** The description this product actually seeds for a member. */
function seeded(member: string): string {
  const source = readFileSync(SEED, 'utf8');
  const i = source.indexOf(`member: "${member}"`);
  expect(i, `${member} is not in the enum-description seed at all`).toBeGreaterThan(-1);
  const after = source.slice(i);
  const m = /descriptionAr:\s*\n?\s*"([^"]+)"/.exec(after);
  expect(m, `${member}'s seed row carries no descriptionAr`).not.toBeNull();
  return m![1];
}

describe('OWNER DECISION 147 — the two new regulatory-action descriptions are hers', () => {
  it.each([['DEFICIENCY_NOTICE'], ['RENEWAL_REFUSAL']])(
    '%s is byte-identical to what she ratified',
    (member) => {
      expect(
        seeded(member),
        `${member}'s Arabic description is not byte-identical to OWNER DECISION 147. It is HER ` +
          'sentence: re-slice it from docs/decision-147-...md rather than editing it here.',
      ).toBe(ratifiedDescription(member));
    },
  );

  it('⛔ and NEITHER description calls the act a suspension or a cancellation', () => {
    /*
     * THE WHOLE OF DECISION 128 IN ONE PROPERTY. The Central Bank asking for a missing
     * attachment is not the Central Bank stopping the office, and `foldActs` skips both kinds by
     * name for exactly that reason. A description that read as a suspension would teach the next
     * reader to expect `status` to move — which it never does — and would be the one place a
     * person looks before writing code that folds them.
     *
     * Her own words say so: «وليس وقفاً للرخصة ولا إلغاءً لها».
     */
    const deficiency = seeded('DEFICIENCY_NOTICE');
    expect(deficiency).toContain('وليس وقفاً للرخصة ولا إلغاءً لها');
    for (const member of ['DEFICIENCY_NOTICE', 'RENEWAL_REFUSAL']) {
      // Both name what they DO — stop the six issuance acts — rather than what they are not.
      expect(seeded(member)).toContain('أفعال الإصدار الستة');
    }
  });

  it('and each clears the guard’s own floor, which is what message 43 stopped on', () => {
    /*
     * `enum-descriptions.spec.ts` holds this floor and is the authority; asserted here too
     * because this file is where the text is compared, and a slice that silently truncated would
     * otherwise fail two directories away with no mention of the decision it came from.
     */
    for (const member of ['DEFICIENCY_NOTICE', 'RENEWAL_REFUSAL']) {
      expect(seeded(member).trim().length).toBeGreaterThan(40);
    }
  });

  it('⛔ and the NAMES are not these sentences — they are decision 133’s, and shorter', () => {
    /*
     * Not decoration. The name and the description sit one column apart in her table, and a
     * slice reaching for «her cell» could put a 160-character sentence on a screen label.
     */
    for (const [key, member] of [
      ['rcActKindDeficiencyNotice', 'DEFICIENCY_NOTICE'],
      ['rcActKindRenewalRefusal', 'RENEWAL_REFUSAL'],
    ] as const) {
      const name = lookupOptional('AR', key) ?? '';
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThan(seeded(member).length);
      expect(name).not.toBe(seeded(member));
    }
  });
});
