import type { TranslationKey } from './translations';

/**
 * THE ONE PLACE A PERMISSION REFUSAL IS WORDED.
 *
 * ## What was measured, and why this file exists
 *
 * 100 refusal strings across 89 files refused a reader for want of a permission, and every one of them
 * wrote its own sentence. Four counts that are easy to conflate, so they are stated once here and used
 * consistently below: **100 original keys** converted, **102 act keys** now declared (one of the 100 was a
 * parameterised generic used for three different sections and became three), **106 call sites**, **89 files**
 * (87 screens and 2 components). The survey found three things, and each one is a requirement below:
 *
 *   1. **The English never named the act.** Every English string named the CODE and stopped:
 *      *"You do not hold insurer.read, so there is nothing to show here."* A dotted machine identifier is
 *      not an answer to "what can I not do here" — it is the name of the thing the reader has to go and ask
 *      somebody else about. So all 102 English acts had to be written; there was nothing to recover.
 *
 *   2. **The Arabic named the act and, usually, the code too** — `اللازمة ل<act>`. So 52 acts were
 *      recoverable from the Arabic and 50 had to be written. The two languages were therefore generated
 *      INDEPENDENTLY rather than as translations of each other: each was read for the half it actually held.
 *
 *   3. **Not one of the 100 said who could grant it.** A refusal that names what is missing and not who
 *      supplies it leaves the reader with nowhere to go.
 *
 * ## The two constraints that shape the sentence
 *
 * **The act is described in the language of the work, not of the permission.** `payment-channel.read`
 * becomes "view the payment channels an office can send money through", because the reader is trying to do
 * a job, not to hold a code.
 *
 * **The administrator is named BY FUNCTION, never by role name.** An office defines its own role names —
 * that is what office-scoped RBAC is for — so "ask your Office Administrator" is a sentence that can be
 * false in any given office. "Whoever manages permissions in your office" is true everywhere.
 *
 * ## The code sits ALONGSIDE, never inside
 *
 * The code is still useful: it is what the administrator types into the Role screen. But it belongs in a
 * parenthetical after the sentence, not in the sentence — a reader who is being told what they cannot do
 * should not have to parse an identifier to find out.
 *
 * ## Three functions, not one, and no default mode
 *
 * Six of the 102 acts are gated on more than one code, and they do not all mean the same thing:
 *
 *   * `permissionsGuard` ORs its codes (`required.some`), so a route declaring two grants access to a
 *     holder of EITHER. That is `anyOf`.
 *   * A screen that loads two endpoints with `Promise.all` closes entirely if EITHER 403s, so its reader
 *     needs BOTH. That is `allOf`.
 *
 * Those two are opposite claims and a reader acting on the wrong one asks for the wrong grant. So the mode
 * is an explicit choice of function rather than an optional argument with a default: a default would be
 * silently wrong for half the multi-code cases, and the measured trap is exactly that — a rule true at the
 * route guard, generalised to a screen that does not live at that layer.
 */

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

/** A refusal gated on ONE permission code. 96 of the 102. */
export function permissionRefusal(
  t: Translate,
  act: TranslationKey,
  code: string,
): string {
  return t('permissionRefusal', { act: t(act), code });
}

/**
 * A refusal where holding ANY ONE of the codes would have been enough — the shape a route guard produces,
 * because `PermissionsGuard` is `required.some`.
 */
export function permissionRefusalAnyOf(
  t: Translate,
  act: TranslationKey,
  codes: readonly string[],
): string {
  return t('permissionRefusalAnyOf', { act: t(act), code: codes.join(', ') });
}

/**
 * A refusal that needs EVERY code listed — the shape a screen produces when it loads several endpoints
 * together and cannot render without all of them.
 */
export function permissionRefusalAllOf(
  t: Translate,
  act: TranslationKey,
  codes: readonly string[],
): string {
  return t('permissionRefusalAllOf', { act: t(act), code: codes.join(', ') });
}
