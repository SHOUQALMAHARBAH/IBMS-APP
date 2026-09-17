import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Part G, checklist item 5 — "no float used in any monetary calculation,
 * enforced by a build-pipeline check".
 *
 * `money-fields.inventory.spec.ts` was the obvious candidate for that
 * enforcement and does NOT provide it: it inventories `Decimal` columns —
 * every one classified money or non-money, money ones `Decimal(18, 3)` — so a
 * `Float` column is invisible to it by construction. Planting
 * `plantedFloatAmount Float` on `Invoice` and watching all seven of its tests
 * pass is what established that.
 *
 * This is the missing half. Every `Float`/`Double` in the schema must be named
 * here with a reason, so adding one for an amount fails the build instead of
 * quietly introducing binary floating point into money — the failure mode
 * `money-decimal-jod.md` exists to prevent, and the one that does not announce
 * itself until a rounding difference turns up in a reconciliation.
 */

const SCHEMA = path.join(
  __dirname,
  '../../../../packages/db/prisma/schema.prisma',
);

/**
 * Float columns that are deliberately NOT money.
 *
 * Every entry is a ratio or a score — a number where binary floating point is
 * the right representation and where three-decimal fixed point would be wrong.
 * A money amount can never be added here; it belongs in
 * `MONEY_DECIMAL_FIELDS` as `Decimal(18, 3)`.
 */
const NON_MONETARY_FLOATS: Record<string, string> = {
  'ScreeningMatch.matchScore': 'similarity score, 0-1',
  'ScreeningMatch.reviewThreshold': 'score cut-off for manual review, 0-1',
  'SlaPolicy.warningThreshold':
    'fraction of the SLA elapsed before warning, 0-1',
};

/** Every `Float`/`Double` column in the schema, as `Model.field`. */
function floatColumns(): string[] {
  const text = fs.readFileSync(SCHEMA, 'utf8');
  const out: string[] = [];
  let model: string | null = null;
  for (const line of text.split('\n')) {
    const m = /^model (\w+) \{/.exec(line);
    if (m) model = m[1];
    if (line.trim().startsWith('//')) continue;
    const f = /^\s+(\w+)\s+(Float|Double)\b/.exec(line);
    if (f && model) out.push(`${model}.${f[1]}`);
  }
  return out;
}

describe('no floating point anywhere near money', () => {
  it('sanity: the parser finds the Float columns that do exist', () => {
    // If this ever reads zero the parser has broken and every assertion below
    // would pass vacuously — the failure mode that makes a guard worthless.
    expect(floatColumns().length).toBeGreaterThan(0);
  });

  it('every Float column is a declared non-monetary one', () => {
    const declared = new Set(Object.keys(NON_MONETARY_FLOATS));
    const undeclared = floatColumns().filter((f) => !declared.has(f));
    expect(undeclared).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    const actual = new Set(floatColumns());
    const stale = Object.keys(NON_MONETARY_FLOATS).filter(
      (f) => !actual.has(f),
    );
    expect(stale).toEqual([]);
  });

  it('no allow-listed float is named like an amount', () => {
    // A second, independent check on the list itself: the allow-list is the
    // weak point of this design, so a name that reads like money cannot be
    // waved through even deliberately.
    const moneyish =
      /(amount|premium|commission|balance|total|price|fee|paid|due|settlement|refund)/i;
    const suspicious = Object.keys(NON_MONETARY_FLOATS).filter((f) =>
      moneyish.test(f.split('.')[1]),
    );
    expect(suspicious).toEqual([]);
  });
});
