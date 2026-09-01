import type { TransformFnParams } from 'class-transformer';

/** class-validator's `@IsOptional()` only skips validation for `undefined`/
 * `null`, not `""` — an empty query-string value (`GET /leads?ownerUserId=`)
 * or an empty form field would otherwise still hit `@IsEmail()`/`@IsUUID()`/
 * `@IsIn()` and 400. Use as `@Transform(emptyStringToUndefined)` above
 * `@IsOptional()` on any optional field that can arrive as `""`. Originally
 * lived in the lead module (backlog Part C #1) — moved here once the
 * prospect module (Part C #2) needed the same generic helper. */
export function emptyStringToUndefined({ value }: TransformFnParams): unknown {
  return value === '' ? undefined : value;
}

/** Trims a string value, leaving non-strings untouched — pair with
 * `@IsString()`/`@MinLength()` so " x " can't slip past a length check.
 * Use as `@Transform(trimIfString)`. */
export function trimIfString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Fils-precision decimal string — at most 3 decimal places (Part 3.6 /
 * ibms-brain/meta/lex/money-decimal-jod.md), the shape money.util.ts's
 * `toMoney` / `quantizeMoney` expect. No sign, no currency symbol, no
 * thousands separator: `"125000"` or `"125000.500"`. Pair with `@Matches`
 * on any DTO field that lands in a `@db.Decimal(18, 3)` column. Predates its
 * consolidation here — `risk-profile.config.ts` and `create-prospect.dto.ts`
 * still carry their own copies. */
export const MONEY_STRING = /^\d{1,15}(\.\d{1,3})?$/;
