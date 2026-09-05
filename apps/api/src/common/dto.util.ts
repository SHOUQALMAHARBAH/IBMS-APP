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

/** Coerces a query-string flag (`?isMarketing=true`) to a real boolean.
 * `"true"`/`"1"` -> true, `"false"`/`"0"` -> false, `""`/absent -> undefined,
 * anything else passes through untouched so `@IsBoolean()` can 400 it. Pair
 * with `@Transform(queryBoolean)` above `@IsOptional()` `@IsBoolean()` on an
 * optional boolean query filter. */
export function queryBoolean({ value }: TransformFnParams): unknown {
  if (value === '' || value === undefined || value === null) return undefined;
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
}

/** Fils-precision decimal string — at most 3 decimal places (Part 3.6 /
 * ibms-brain/meta/lex/money-decimal-jod.md), the shape money.util.ts's
 * `toMoney` / `quantizeMoney` expect. No sign, no currency symbol, no
 * thousands separator: `"125000"` or `"125000.500"`. Pair with `@Matches`
 * on any DTO field that lands in a `@db.Decimal(18, 3)` column. Predates its
 * consolidation here — `risk-profile.config.ts` and `create-prospect.dto.ts`
 * still carry their own copies. */
export const MONEY_STRING = /^\d{1,15}(\.\d{1,3})?$/;

/**
 * Guard for a free-text business note that sits next to a masked-data path
 * (`ibms-brain/meta/lex/sensitive-data-handling.md` — a note / detail /
 * reason field must not become the *de facto* capture point for a full bank
 * account / card number, which is Highly Confidential and belongs on an
 * approved `PaymentChannel`, Process 38, `accountLast4` only). Rejects a run
 * of 9+ consecutive digits. `[\s\S]*` (not `.*`) so a multi-line note still
 * matches. Pair with `@Matches(NO_FULL_ACCOUNT_NUMBER, { message: \`<field>
 * ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}\` })`. Used by Process 41 (`ServiceRequest`
 * `detail` / `outcomeNote`) and Process 42 (`Complaint` `issue` / `resolution`,
 * `ComplaintAction.actionText`, `EscalationRecord.reason`). */
export const NO_FULL_ACCOUNT_NUMBER = /^(?!.*\d{9,})[\s\S]*$/;
export const NO_FULL_ACCOUNT_NUMBER_MESSAGE =
  'must not contain a run of 9+ digits — record a payment-method / account change through an approved payment channel (Process 38), not free text';

/** Exactly one of two independently-nullable "who is the data subject" FKs
 * (`customerId` / `insuredPersonId`) must be set — true for both `M03`
 * (`ConsentRecord`) and `M04` (`DataSubjectRequest`). No DB CHECK pairs them
 * (unlike `PaymentChannel`'s `owner_exactly_one`, #38): that guard exists to
 * stop a *concurrent write* racing into an invalid combination, which does
 * not apply here — each of these rows is written by exactly one call site,
 * once, at creation, never edited afterward. App-level validation at that
 * single call site is proportionate; add a DB CHECK the day a second
 * creation path appears. Originally local to `consent.config.ts` — promoted
 * here once `dsr.config.ts` (Process 52/M04) needed the identical check. */
export function hasExactlyOneOwner(input: {
  customerId?: string | null;
  insuredPersonId?: string | null;
}): boolean {
  return Boolean(input.customerId) !== Boolean(input.insuredPersonId);
}
