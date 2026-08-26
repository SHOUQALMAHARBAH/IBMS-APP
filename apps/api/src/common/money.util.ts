import { Prisma } from '@ibms/db';

/**
 * Fils-precision money arithmetic (Part 3.6 Controls;
 * ibms-brain/meta/lex/money-decimal-jod.md). JOD's minor unit is the fils —
 * 1/1000 JOD, three decimal places, not the two most currencies use — and
 * every monetary amount in the schema (`@db.Decimal(18, 3)`) is quantized
 * here. This is the ONLY place `MONEY_SCALE`/`MONEY_ROUNDING` are set,
 * matching the lex rule's "a rounding mode fixed once for the whole
 * codebase" — every add/subtract/percentage application anywhere in the
 * codebase must funnel through the functions below rather than reimplement
 * rounding at the call site.
 *
 * Built on `Prisma.Decimal` (decimal.js, already a transitive dependency of
 * `@prisma/client` and re-exported through `@ibms/db`) rather than a new
 * dependency, because every `Decimal(18,3)` column already round-trips as a
 * `Prisma.Decimal` on read/write — using the same type end-to-end means a
 * value read from the DB, passed through this file, and written back never
 * detours through a JS `number` at all.
 */

/** Total significant digits for a JOD money column — `@db.Decimal(18, 3)`. */
export const MONEY_PRECISION = 18;
/** Decimal places for a JOD money column — the fils, 1/1000 JOD (Part 3.6). */
export const MONEY_SCALE = 3;
/** The one rounding mode this codebase uses for money, fixed here per the lex rule. */
export const MONEY_ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

// decimal.js's own default happens to already be ROUND_HALF_UP, but the lex
// rule asks for the mode to be fixed explicitly, once, rather than relying
// on a library default that could change — this also covers any Decimal
// arithmetic elsewhere that implicitly rounds an intermediate result (e.g.
// a repeating decimal from `.dividedBy()`) without passing a mode.
Prisma.Decimal.set({ rounding: MONEY_ROUNDING });

/**
 * A monetary amount may arrive as a `Prisma.Decimal` (read straight off a
 * model), a decimal string (a request body, an insurer statement, a seed
 * fixture), or a JS `number` — but ONLY when that number is a mathematically
 * exact integer (`Number.isInteger`), the one case a binary float still
 * represents a JOD amount exactly. A fractional `number` (e.g. `19.99`) has
 * already lost precision by the time it reaches this module — the caller
 * must pass it as a string instead. `toMoney` enforces this at the boundary
 * rather than leaving it to convention.
 */
export type MoneyInput = Prisma.Decimal | string | number;

function assertNotFloatLike(value: MoneyInput, context: string): void {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(
      `${context}: received a non-integer JS number (${value}) where a monetary amount was expected. ` +
        'Binary floats cannot represent fils precision exactly — pass a decimal string (e.g. "19.990") ' +
        'or a Prisma.Decimal instead (ibms-brain/meta/lex/money-decimal-jod.md).',
    );
  }
}

/** Parses a `MoneyInput` into a `Prisma.Decimal`, rejecting a fractional JS `number`. */
export function toMoney(
  value: MoneyInput,
  context = 'toMoney',
): Prisma.Decimal {
  assertNotFloatLike(value, context);
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** Rounds to fils precision (3dp) using the codebase's one fixed rounding mode. */
export function quantizeMoney(value: MoneyInput): Prisma.Decimal {
  return toMoney(value, 'quantizeMoney').toDecimalPlaces(
    MONEY_SCALE,
    MONEY_ROUNDING,
  );
}

/** Sums any number of monetary amounts, quantized once at the end. */
export function addMoney(...values: MoneyInput[]): Prisma.Decimal {
  if (values.length === 0) {
    throw new Error('addMoney: at least one value is required');
  }
  const sum = values.reduce<Prisma.Decimal>(
    (acc, value) => acc.plus(toMoney(value, 'addMoney')),
    new Prisma.Decimal(0),
  );
  return quantizeMoney(sum);
}

/** Subtracts any number of monetary amounts from `minuend`, quantized once at the end. */
export function subtractMoney(
  minuend: MoneyInput,
  ...subtrahends: MoneyInput[]
): Prisma.Decimal {
  const result = subtrahends.reduce<Prisma.Decimal>(
    (acc, value) => acc.minus(toMoney(value, 'subtractMoney')),
    toMoney(minuend, 'subtractMoney'),
  );
  return quantizeMoney(result);
}

/**
 * Applies a percentage rate to a monetary amount — e.g. a commission rate
 * from `CommissionAgreement.ratePercent` applied to a premium, or VAT
 * applied to a fee (Part 3.6 Controls: "Commission rate application from
 * the governed rate table"). `percent` is the rate's own Decimal value
 * (e.g. `12.5` for 12.5%), not a fraction. Result quantized to fils.
 */
export function applyPercentage(
  amount: MoneyInput,
  percent: MoneyInput,
): Prisma.Decimal {
  const base = toMoney(amount, 'applyPercentage');
  const rate = toMoney(percent, 'applyPercentage');
  return quantizeMoney(base.times(rate).dividedBy(100));
}

/** True if the amount is exactly zero. */
export function isZeroMoney(value: MoneyInput): boolean {
  return toMoney(value, 'isZeroMoney').isZero();
}

/** -1 / 0 / 1, per `Prisma.Decimal.comparedTo` — never compare money with `<`/`>`/`===` on a float. */
export function compareMoney(a: MoneyInput, b: MoneyInput): number {
  return toMoney(a, 'compareMoney').comparedTo(toMoney(b, 'compareMoney'));
}

/** Formats a quantized amount as a fixed 3dp string (`"1234.500"`) — for persistence/logging, not display. */
export function formatMoney(value: MoneyInput): string {
  return quantizeMoney(value).toFixed(MONEY_SCALE);
}
