import { ApiError, isFieldValidationError } from '../auth/api-client';
import type { TranslationKey } from './translations';

/**
 * THE ONE PLACE A FAILED ACT IS WORDED — and the one place raw validator text is refused.
 *
 * ## Why this exists
 *
 * The owner's walk, on `/complaints`: «لما أبحث أول مرة عملية البحث ممتازة، بس لما أبحث كمان مرة
 * بتعلّق ما بتظهر اشي، وبتطلع هاي الرسالة "customerId must be a UUID"». Her instruction attached to
 * it is absolute: **no raw validator text may surface as UI copy anywhere.**
 *
 * `customerId must be a UUID` is Nest's `ValidationPipe` naming OUR OWN COLUMN, in English, on an
 * Arabic-first screen. It breaks owner decision 21 (a label never names a column) and it is never
 * actionable for a broker, because it only ever appears when the WEB sent something invalid — there
 * is nothing she could have typed differently. The honest line is the screen's own.
 *
 * ## The discriminator is structural, not a pattern match on the text
 *
 * `isFieldValidationError` reads whether the body's `message` arrived as an ARRAY. The validation
 * pipe is the only thing in this api that returns one; every domain refusal is a `throw new
 * UnprocessableEntityException('…')` and so a string. So no message text is sniffed, and a reworded
 * validator message cannot slip past.
 *
 * ## WHAT THIS DOES NOT FIX, AND THE SIZE OF IT
 *
 * A DOMAIN refusal still reaches the screen in the server's own words, and **this api has no message
 * i18n of any kind** — so those sentences are English for an Arabic reader. Measured:
 * **282 occurrences across 139 files** render an `ApiError`'s message. That is the class behind her
 * `/service-requests` report («في مشكلة بالماسيجيز الي بتطلع لما أضغط ع الأزرار الي فيها»), her
 * `/commission` and `/retention-disposal` sightings, and both provider registration screens.
 *
 * Passing those through is DELIBERATE here and is not a repair: a domain refusal is the only thing
 * that tells a reader why an act was refused, and replacing it with a generic line would trade an
 * English explanation for an Arabic non-explanation. Closing it properly needs either message i18n on
 * the server or error CODES on the wire that the web maps to Arabic — a decision, and a build, both
 * of which are reported rather than guessed at.
 *
 * ## No new words
 *
 * The fallback is the key the screen ALREADY has. Every screen that renders an action error already
 * declares one — `complaintsActionError`, `tmActionError`, `srActionError`, … — and they all read
 * «تعذّر تنفيذ الإجراء — حاول مرة أخرى.» / "That action failed — try again." So adopting this costs
 * nothing in copy and the Arabic is unchanged.
 */
export function actionErrorText(
  err: unknown,
  t: (key: TranslationKey) => string,
  fallbackKey: TranslationKey,
): string {
  // FIRST, and deliberately ahead of the ApiError branch: a field complaint is an ApiError too, and
  // checking the general case first would render exactly the text this function exists to withhold.
  if (isFieldValidationError(err)) return t(fallbackKey);
  if (err instanceof ApiError) return err.message;
  return t(fallbackKey);
}
