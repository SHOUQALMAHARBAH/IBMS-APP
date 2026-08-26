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
