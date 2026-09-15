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

/** A canonical UUID's leading four groups. Fixed length (24), so it is usable
 * as a lookbehind — see `NO_FULL_ACCOUNT_NUMBER`. */
const UUID_LEADING_GROUPS = String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-`;

/**
 * Guard for a free-text business note that sits next to a masked-data path
 * (`ibms-brain/meta/lex/sensitive-data-handling.md` — a note / detail /
 * reason field must not become the *de facto* capture point for a full bank
 * account / card number, which is Highly Confidential and belongs on an
 * approved `PaymentChannel`, Process 38, `accountLast4` only).
 *
 * **Rejects a run of 12+ consecutive digits**, unless that run is the tail of
 * a canonical UUID. Three deliberate properties, each of which replaces a
 * defect in the 9+ rule this supersedes:
 *
 *  1. **12, not 9.** An ISO/IEC 7812 PAN is 12-19 digits (Maestro starts at
 *     12, UnionPay runs to 19) and a Jordanian IBAN's numeric body is 22, so
 *     every real card/account shape still trips this. The old floor of 9 also
 *     caught things that are not account numbers at all — a 10-digit Jordanian
 *     mobile number, an 8-digit date, a reference code — and refused them with
 *     a message about payment channels.
 *  2. **UUIDs are exempt.** Every id in this schema is a UUID, and 3.11% of v4
 *     UUIDs contain a run of 9+ digits (measured over 200k); at a floor of 12
 *     the only way a UUID can still trip is an all-digit final group, ~0.35%.
 *     A staff member pasting a case / hold / transfer id into one of these
 *     fields must never be refused, so the lookbehind exempts exactly that
 *     one shape — a 12-digit run directly preceded by a UUID's other four
 *     groups. Nothing else is exempted: digits appended to a UUID tail, or a
 *     real card elsewhere in the same note, still reject.
 *  3. **The lookahead scans the whole value.** The old rule's body used
 *     `[\s\S]*` but its lookahead used `.*`, which does not cross newlines —
 *     so it only ever scanned the FIRST LINE, and a card number on line two
 *     was accepted. That was a false negative in a control whose entire job is
 *     to catch exactly that.
 *
 * Pair with `@Matches(NO_FULL_ACCOUNT_NUMBER, { message: \`<field>
 * ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}\` })`. Used by 21 fields across Processes
 * 41/42 (`ServiceRequest`, `Complaint`), the compliance-risk register, and
 * M04 (`DataSubjectRequest`). */
export const NO_FULL_ACCOUNT_NUMBER = new RegExp(
  String.raw`^(?![\s\S]*(?<!${UUID_LEADING_GROUPS})\d{12,})[\s\S]*$`,
);
export const NO_FULL_ACCOUNT_NUMBER_MESSAGE =
  'must not contain a run of 12+ digits — record a payment-method / account change through an approved payment channel (Process 38), not free text';

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
