import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RETENTION_TEMPLATE,
  inertReason,
  periodIsActionable,
  templateFloor,
} from './retention-template.config';
import { STATUTORY_RETENTION_FLOORS } from './retention-floors.config';

/**
 * WHAT THE PRODUCT SHIPS WITH — decisions 32 and 33.
 *
 * The pin here constrains OUR template so a change to it is deliberate. It constrains no office:
 * decision 80 is that an office grants, edits and revokes freely, and nothing anywhere refuses a
 * category this file does not name.
 *
 * The cases that matter most are the two ABSENCES — neither floor list grew, and no floored row
 * ships a number — because both are the kind of thing that passes review by looking fine.
 */

describe('the shipped retention template', () => {
  it('ships EXACTLY these eight categories, so a ninth is a decision', () => {
    // EIGHT in the template; the SEED carries nine rows, because `AuditLogEntry` pre-dates the
    // template and keeps its own DRAFT history. The two are reconciled by name in the last block,
    // deliberately, rather than one number being quietly wrong.
    expect(RETENTION_TEMPLATE.map((c) => c.recordCategory)).toEqual([
      'KYCRecord',
      'CustomerFile',
      'Receipt',
      'Remittance',
      'CommissionLedgerEntry',
      'Settlement',
      'Invoice',
      'Quotation',
    ]);
  });

  it('A FLOORED CATEGORY SHIPS WITH NO PERIOD — every one of them', () => {
    /*
     * THE DECISION, asserted as a property rather than row by row: for every template category, a
     * period is shipped if and ONLY if no statutory floor governs it.
     *
     * Her reason is the whole of it — a period shipped beside an article number reads as a legal
     * opinion from us, and we do not have one. A category with no floor ships with a default,
     * because there a number claims nothing.
     *
     * Written as an iff so BOTH failure directions fail: a floored category that gained a number,
     * and an unfloored one that lost its default and would ship inert.
     */
    for (const c of RETENTION_TEMPLATE) {
      const floor = templateFloor(c);
      expect(
        c.defaultPeriodMonths === null,
        `${c.recordCategory} — floored: ${floor !== null}, period: ${String(c.defaultPeriodMonths)}`,
      ).toBe(floor !== null);
    }
    // A non-vacuity floor on BOTH halves: an assertion over an all-floored or all-unfloored set
    // would pass while proving nothing about the rule.
    const floored = RETENTION_TEMPLATE.filter((c) => templateFloor(c) !== null);
    expect(floored.length).toBeGreaterThan(0);
    expect(RETENTION_TEMPLATE.length - floored.length).toBeGreaterThan(0);
  });

  it('the quote category is ONE MONTH and counted from the END OF THE PURPOSE', () => {
    const quote = RETENTION_TEMPLATE.find(
      (c) => c.recordCategory === 'Quotation',
    );
    expect(quote).toBeDefined();
    expect(quote?.defaultPeriodMonths).toBe(1);
    // NOT FROM ARRIVAL, which is the instruction and the reason: a month from arrival deletes a
    // quote the customer is still considering. The word is asserted because a reword that dropped
    // it would leave a one-month period with no statement of what it runs from.
    expect(quote?.countedFrom).toMatch(/END OF THE PURPOSE/i);
    expect(quote?.countedFrom).toMatch(/refused/i);
    // AND THE LIMB THAT IS NOT RECORDED SAYS SO — the quote's own expiry. Declared rather than
    // approximated from arrival plus a guessed validity, which would be the arrival clock again.
    expect(quote?.countedFrom).toMatch(/not recorded anywhere/i);
    // It has no floor, which is what makes a default honest here.
    expect(templateFloor(quote!)).toBeNull();
  });

  it('NEITHER STATUTORY FLOOR LIST GREW — asserted by name, not by count', () => {
    /*
     * A batch that ships eight categories is exactly where a floor gets added by accident, and a
     * COUNT would survive a substitution. So both lists are pinned verbatim.
     *
     * The fourteen unsourced names from batch 5 group 5 are a question for the owner's lawyer: a
     * floor added on an engineer's reading is this product telling a broker the law says something
     * it does not.
     */
    expect(STATUTORY_RETENTION_FLOORS.map((f) => f.key)).toEqual([
      'AML_CDD_FIVE_YEARS',
      'COMMERCIAL_TEN_YEARS',
    ]);
    expect(STATUTORY_RETENTION_FLOORS[0].categories).toEqual([
      'KYCRecord',
      'KYC',
      'KYCRecords',
      'CDD',
      'CustomerDueDiligence',
      'CustomerDueDiligenceRecord',
      'CustomerDueDiligenceRecords',
      'CustomerFile',
      'CustomerFiles',
      'AccountFile',
      'AccountFiles',
    ]);
    expect(STATUTORY_RETENTION_FLOORS[1].categories).toEqual([
      'FinancialRecord',
      'FinancialRecords',
      'CommercialRecord',
      'CommercialRecords',
      'Invoice',
      'Receipt',
      'Payment',
      'Settlement',
      'Refund',
      'Remittance',
      'Collection',
      'CommissionLedgerEntry',
      'BankReconciliation',
    ]);
  });

  it('every row says what its period is counted FROM, and why it ships', () => {
    for (const c of RETENTION_TEMPLATE) {
      // A period without its trigger is a number somebody counts from the wrong day — the floors
      // config makes the same assertion about its own two entries for the same reason.
      expect(c.countedFrom.length, c.recordCategory).toBeGreaterThan(25);
      expect(c.note.length, c.recordCategory).toBeGreaterThan(25);
    }
  });
});

describe('an empty or unconfirmed period is INERT', () => {
  const CONFIRMED = new Date('2026-01-01T00:00:00.000Z');

  it('needs BOTH a period and a legal confirmation', () => {
    // Four combinations, so neither condition can be dropped without a test dying. The brief's own
    // rule: never proposed for disposal and never alerted on.
    expect(
      periodIsActionable({
        retentionPeriodMonths: 120,
        confirmedByLegalCounselAt: CONFIRMED,
      }),
    ).toBe(true);
    expect(
      periodIsActionable({
        retentionPeriodMonths: null,
        confirmedByLegalCounselAt: CONFIRMED,
      }),
    ).toBe(false);
    expect(
      periodIsActionable({
        retentionPeriodMonths: 120,
        confirmedByLegalCounselAt: null,
      }),
    ).toBe(false);
    expect(
      periodIsActionable({
        retentionPeriodMonths: null,
        confirmedByLegalCounselAt: null,
      }),
    ).toBe(false);
  });

  it('a floored category with no period names its ARTICLE and its FLOOR', () => {
    /*
     * This is what the office actually needs: not "no period set" but "no period set, here is the
     * minimum the law requires, set yours above it". A blank is not actionable; this is.
     */
    const reason = inertReason({
      recordCategory: 'KYCRecord',
      retentionPeriodMonths: null,
      confirmedByLegalCounselAt: CONFIRMED,
    });
    expect(reason).toMatch(/art\. 17\/a/i);
    expect(reason).toMatch(/Anti-Money Laundering/i);
    expect(reason).toContain('60 months');
    // AND IT SAYS NOTHING IS MEASURED, because an office that sees a category listed and is never
    // alerted about it will believe the system is watching — decision 28's family.
    expect(reason).toMatch(/nothing is measured/i);
  });

  it('an UNFLOORED category with no period says so without inventing an article', () => {
    const reason = inertReason({
      recordCategory: 'SomethingTheOfficeNamed',
      retentionPeriodMonths: null,
      confirmedByLegalCounselAt: CONFIRMED,
    });
    expect(reason).toMatch(/no retention period is set/i);
    // THE ABSENCE THAT MATTERS: no article, no instrument, no figure. Citing one here would be the
    // invented-floor defect in a sentence rather than in a config.
    expect(reason).not.toMatch(/art\./i);
    expect(reason).not.toMatch(/months/);
  });

  it('a period nobody confirmed is a DRAFT, and the reason says that word', () => {
    const reason = inertReason({
      recordCategory: 'Quotation',
      retentionPeriodMonths: 1,
      confirmedByLegalCounselAt: null,
    });
    expect(reason).toMatch(/not been confirmed by legal counsel/i);
    expect(reason).toMatch(/draft/i);
  });

  it('an actionable row has no reason at all', () => {
    expect(
      inertReason({
        recordCategory: 'Receipt',
        retentionPeriodMonths: 120,
        confirmedByLegalCounselAt: CONFIRMED,
      }),
    ).toBeNull();
  });
});

describe('the api template and the SEED template are one fact in two homes', () => {
  /*
   * `packages/db` cannot import from `apps/api` — the seed is typechecked by its own
   * `tsconfig.seed.json`, and the docker prune keeps only db's own workspace dependencies, so a
   * cross-import typechecks on a laptop and fails inside the image. This repository has paid for
   * that once already.
   *
   * So the list is declared twice and PINNED AGAINST ITSELF here. That is the `NOTIFICATION_KINDS`
   * precedent: a list declared twice in two packages with nothing checking they agree is how a
   * member added in one renders blank in the other.
   *
   * Read as SOURCE rather than imported, for the same reason — this spec runs in the api project.
   */
  const seedSource = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'prisma',
      'seed-data',
      'retention-template.ts',
    ),
    'utf8',
  );

  it('the seed ships every api template category, with the same period', () => {
    for (const c of RETENTION_TEMPLATE) {
      const entry = new RegExp(
        `recordCategory:\\s*"${c.recordCategory}",\\s*\\n\\s*retentionPeriodMonths:\\s*([^,]+),`,
      ).exec(seedSource);
      expect(
        entry,
        `${c.recordCategory} is missing from the seed`,
      ).not.toBeNull();
      const seeded = entry![1].trim();
      expect(seeded, c.recordCategory).toBe(
        c.defaultPeriodMonths === null ? 'null' : String(c.defaultPeriodMonths),
      );
    }
  });

  it('and the seed adds exactly ONE category the api template does not name', () => {
    /*
     * `AuditLogEntry` — the row that existed before the template did, kept with its own DRAFT
     * history. It is in the SEED because the row has to keep existing; it is not in the api
     * TEMPLATE because no decided floor governs it and it is not a category this product chose to
     * ship. Asserted rather than left as a discrepancy, so the next reader does not "fix" the
     * difference in either direction.
     */
    const seeded = [...seedSource.matchAll(/recordCategory:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    const extra = seeded.filter(
      (s) => !RETENTION_TEMPLATE.some((c) => c.recordCategory === s),
    );
    expect(extra).toEqual(['AuditLogEntry']);
    // A non-vacuity floor: a parser that stopped matching would report an empty `seeded` and an
    // empty `extra`, which is indistinguishable from a clean result.
    expect(seeded.length).toBe(RETENTION_TEMPLATE.length + 1);
  });
});
