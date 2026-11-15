import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  APPROVED_MEANS,
  UNCONDITIONAL_APPROVED_CHANNELS,
  isApprovedMeans,
} from './approved-means.config';

/**
 * ART. 22/s's FOUR MEANS, AND THE MAP THAT DECIDES WHICH CHANNEL CARRIES EACH.
 *
 * The property that matters most is TOTALITY over the database enum. A fourteenth
 * `InteractionChannel` member added without a line in that map would otherwise fall through
 * `isApprovedMeans` as "not a means" — a silent refusal, which is the safe direction and still
 * a decision nobody took. Measured here against `schema.prisma` itself rather than against the
 * generated type, because the generated type IS the map's own key type: using it would compare
 * the map to itself.
 */

const SCHEMA = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'prisma',
  'schema.prisma',
);

/** The members of a Prisma enum, read out of the schema source. */
function schemaEnumMembers(name: string): string[] {
  const src = readFileSync(SCHEMA, 'utf8');
  const block = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(src);
  expect(block, `enum ${name} is not in schema.prisma`).not.toBeNull();
  return block![1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line))
    .sort();
}

describe('art. 22/s — the approved means of notification', () => {
  it('parses a real member set out of the schema — thirteen now', () => {
    /*
     * Non-vacuity, and a figure worth pinning. Twelve until OWNER DECISION 133 §3 ruling 2 added
     * `WRITTEN_NOTICE`. A parser that drifted would make the totality test below compare two
     * empty sets and pass.
     */
    expect(schemaEnumMembers('InteractionChannel')).toHaveLength(13);
  });

  it('is TOTAL over the database enum, in both directions', () => {
    expect(
      Object.keys(APPROVED_MEANS).sort(),
      'the approved-means map and InteractionChannel disagree. A new channel member needs a ' +
        "line here saying which of art. 22/s's four means it carries, or that it carries none " +
        'and why — a member with no line falls through as "not a means", which is the safe ' +
        'direction and still a decision nobody took.',
    ).toEqual(schemaEnumMembers('InteractionChannel'));
  });

  it('every entry says WHY, never a bare verdict', () => {
    for (const [channel, mapping] of Object.entries(APPROVED_MEANS)) {
      expect(
        mapping.because.length,
        `${channel} carries no reason. This map is read by somebody deciding whether a piece ` +
          'of regulatory evidence counts.',
      ).toBeGreaterThan(20);
    }
  });

  it('all four means have at least one member — which they did NOT until decision 133', () => {
    /*
     * 🔴 THE MEASUREMENT THAT EARNED THE MIGRATION. On 2026-11-12, means 1 — «التبليغ الخطي»,
     * the first and most traditional the article names — had NO member at all, so a paper
     * notice could only be recorded as `OTHER`, which means 4 makes CONDITIONAL on a written
     * agreement. The strongest means treated as the weakest.
     */
    const covered = new Set(
      Object.values(APPROVED_MEANS)
        .map((m) => m.means)
        .filter((m): m is 1 | 2 | 3 | 4 => m !== null),
    );
    expect([...covered].sort()).toEqual([1, 2, 3, 4]);
  });

  it('means 1 is WRITTEN_NOTICE and nothing else', () => {
    const ones = Object.entries(APPROVED_MEANS)
      .filter(([, m]) => m.means === 1)
      .map(([c]) => c);
    expect(ones).toEqual(['WRITTEN_NOTICE']);
  });

  it('PORTAL counts as means 2 — RATIFIED, no longer a reading', () => {
    // OWNER DECISION 133 §3 ruling 1. Her reason settles it on WHOSE CHANNEL it is rather than
    // whose software runs it: «قناة المكتب مع عميله وباسمه».
    expect(APPROVED_MEANS.PORTAL.means).toBe(2);
    expect(isApprovedMeans('PORTAL', false)).toBe(true);
  });

  it('⛔ WHATSAPP is refused BY NAME, not by falling through', () => {
    /*
     * The case no name-based rule could get right: WhatsApp IS an electronic channel. OWNER
     * DECISION 44, 9 October. Asserted on the MAPPING as well as on the function, so deleting
     * its line would fail here rather than quietly producing the same answer for a new reason —
     * and «refused by decision» and «not covered» are different facts about the same verdict.
     */
    expect(APPROVED_MEANS.WHATSAPP.means).toBeNull();
    expect(APPROVED_MEANS.WHATSAPP.because).toContain('44');
    expect(isApprovedMeans('WHATSAPP', false)).toBe(false);
    expect(
      isApprovedMeans('WHATSAPP', true),
      'a written agreement must not make WhatsApp a means — it is refused by name, not by ' +
        'condition, so means 4 is not a way in',
    ).toBe(false);
  });

  it('⛔ CALL is not a means either, though SMS is', () => {
    // The other direction a name-based rule gets wrong: a call is the nearest thing to an SMS
    // and art. 22/s names the TEXT message.
    expect(isApprovedMeans('CALL', false)).toBe(false);
    expect(isApprovedMeans('SMS', false)).toBe(true);
  });

  it('OTHER counts ONLY with a written agreement — means 4 in both directions', () => {
    expect(APPROVED_MEANS.OTHER.needsWrittenAgreement).toBe(true);
    expect(isApprovedMeans('OTHER', false)).toBe(false);
    expect(isApprovedMeans('OTHER', true)).toBe(true);
  });

  it('and it is the ONLY conditional one, so the screen can offer the rest outright', () => {
    const conditional = Object.entries(APPROVED_MEANS)
      .filter(([, m]) => m.needsWrittenAgreement)
      .map(([c]) => c);
    expect(conditional).toEqual(['OTHER']);
    expect([...UNCONDITIONAL_APPROVED_CHANNELS].sort()).toEqual(
      ['EMAIL', 'PORTAL', 'SMS', 'WRITTEN_NOTICE'].sort(),
    );
  });

  it('EIGHT members carry no means — seven that are not means, plus WHATSAPP, which is refused', () => {
    /*
     * ⚠️ THE COUNT NEEDS ITS UNIT, because two different facts produce the same verdict here.
     * `docs/module-1-strings-for-ratification.md` §6 reports **7 not means at all** and
     * `WHATSAPP` separately as *excluded by her own earlier decision* — so `means === null` is
     * EIGHT members and neither figure is wrong. The first version of this test was named for
     * seven and asserted eight.
     *
     * Stated rather than defaulted: a channel that is not a means because somebody decided so
     * reads differently from one nobody has looked at.
     */
    const notMeans = Object.entries(APPROVED_MEANS)
      .filter(([, m]) => m.means === null)
      .map(([c]) => c)
      .sort();
    expect(notMeans).toEqual(
      [
        'CALL',
        'CLAIM',
        'COMPLAINT',
        'MEETING',
        'PROPOSAL',
        'RENEWAL',
        'VISIT',
        'WHATSAPP',
      ].sort(),
    );
  });
});
