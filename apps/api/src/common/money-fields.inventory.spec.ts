import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MONEY_DECIMAL_FIELDS,
  NON_MONEY_DECIMAL_FIELDS,
} from './money-fields.inventory';
import { MONEY_PRECISION, MONEY_SCALE } from './money.util';

// Parses the real schema.prisma rather than hand-copying its field list a
// second time — the point of this test is to fail the moment a Decimal
// field is added to the schema without a classification decision being
// made here (money-decimal-jod.md: "no exceptions"), not to duplicate
// schema.prisma's content and drift from it.
const SCHEMA_PATH = join(
  __dirname,
  '../../../../packages/db/prisma/schema.prisma',
);

interface DecimalField {
  model: string;
  field: string;
  precision: number;
  scale: number;
}

function parseDecimalFields(schemaText: string): DecimalField[] {
  const fields: DecimalField[] = [];
  let currentModel: string | null = null;

  for (const line of schemaText.split('\n')) {
    const modelStart = line.match(/^model\s+(\w+)\s*\{/);
    if (modelStart) {
      currentModel = modelStart[1];
      continue;
    }
    if (currentModel && /^\}/.test(line)) {
      currentModel = null;
      continue;
    }
    if (!currentModel) continue;

    const fieldMatch = line.match(
      /^\s{2}(\w+)\s+Decimal\??\s+.*@db\.Decimal\((\d+),\s*(\d+)\)/,
    );
    if (fieldMatch) {
      fields.push({
        model: currentModel,
        field: fieldMatch[1],
        precision: Number(fieldMatch[2]),
        scale: Number(fieldMatch[3]),
      });
    }
  }
  return fields;
}

const schemaText = readFileSync(SCHEMA_PATH, 'utf-8');
const decimalFields = parseDecimalFields(schemaText);

describe('Decimal field inventory vs. packages/db/prisma/schema.prisma', () => {
  it('sanity: found a substantial number of Decimal fields (parser is actually matching)', () => {
    // Guards against a schema.prisma formatting change silently breaking
    // the regex above and making every other assertion in this file
    // vacuously pass against an empty list.
    expect(decimalFields.length).toBeGreaterThan(40);
  });

  it('every Decimal field in the schema is classified as money or non-money — no exceptions', () => {
    const classified = new Set([
      ...MONEY_DECIMAL_FIELDS,
      ...NON_MONEY_DECIMAL_FIELDS,
    ]);
    const unclassified = decimalFields
      .map((f) => `${f.model}.${f.field}`)
      .filter((key) => !classified.has(key));
    expect(
      unclassified,
      `Decimal field(s) in schema.prisma with no entry in money-fields.inventory.ts: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('MONEY_DECIMAL_FIELDS has no stale entries (field renamed/removed from schema)', () => {
    const present = new Set(decimalFields.map((f) => `${f.model}.${f.field}`));
    const stale = MONEY_DECIMAL_FIELDS.filter((key) => !present.has(key));
    expect(
      stale,
      `money-fields.inventory.ts lists field(s) no longer in schema.prisma: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('NON_MONEY_DECIMAL_FIELDS has no stale entries', () => {
    const present = new Set(decimalFields.map((f) => `${f.model}.${f.field}`));
    const stale = NON_MONEY_DECIMAL_FIELDS.filter((key) => !present.has(key));
    expect(
      stale,
      `money-fields.inventory.ts lists field(s) no longer in schema.prisma: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('no field is classified as both money and non-money', () => {
    const overlap = MONEY_DECIMAL_FIELDS.filter((key) =>
      NON_MONEY_DECIMAL_FIELDS.includes(key),
    );
    expect(overlap).toEqual([]);
  });

  it('every MONEY_DECIMAL_FIELDS entry is actually Decimal(18, 3) in the schema', () => {
    const byKey = new Map(
      decimalFields.map((f) => [`${f.model}.${f.field}`, f]),
    );
    for (const key of MONEY_DECIMAL_FIELDS) {
      const f = byKey.get(key);
      expect(f, `${key} not found in parsed schema fields`).toBeDefined();
      expect(
        f!.precision,
        `${key}: expected precision ${MONEY_PRECISION}, schema has ${f!.precision}`,
      ).toBe(MONEY_PRECISION);
      expect(
        f!.scale,
        `${key}: expected scale ${MONEY_SCALE} (fils), schema has ${f!.scale}`,
      ).toBe(MONEY_SCALE);
    }
  });

  it('no NON_MONEY_DECIMAL_FIELDS entry is secretly Decimal(18, 3) (i.e. actually money)', () => {
    const byKey = new Map(
      decimalFields.map((f) => [`${f.model}.${f.field}`, f]),
    );
    for (const key of NON_MONEY_DECIMAL_FIELDS) {
      const f = byKey.get(key);
      expect(f, `${key} not found in parsed schema fields`).toBeDefined();
      const isMoneyShaped =
        f!.precision === MONEY_PRECISION && f!.scale === MONEY_SCALE;
      expect(
        isMoneyShaped,
        `${key} is Decimal(${MONEY_PRECISION}, ${MONEY_SCALE}) — money-shaped — but is listed as non-money`,
      ).toBe(false);
    }
  });
});
