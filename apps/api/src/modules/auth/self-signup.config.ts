/**
 * 🔴 OWNER DECISION 140 — NOBODY CREATES AN ACCOUNT IN AN OFFICE WITHOUT AN INVITATION.
 *
 * «لا ينشئ أحدٌ حساباً في مكتب بلا دعوة.»
 *
 * ## THE FAULT THIS CLOSES, AND IT IS A SECURITY ONE
 *
 * `POST /auth/signup` is `@Public()`. Its only protection was an accident of arithmetic:
 * `soleOrganizationIdOrThrow` refuses while the platform holds more than one brokerage office,
 * and dev happens to hold four. **On a platform with exactly one real office — which is the
 * shape this product is sold in — anyone on the internet gets an account inside it.** The account
 * lands with no role, so it opens no guarded screen; it is still a user in somebody's office that
 * nobody invited, visible in their user list, counted in their seats.
 *
 * It had been recorded, and then it slipped: the signup PAGE was closed and the route was left
 * open because closing it broke 117 test files, «فصار بنداً عندها» — and then it fell off the
 * list of things waiting on her until this measurement.
 *
 * ## WHY THIS SHAPE AND NOT A NEW MECHANISM
 *
 * It is `ENABLE_DEV_RESET_TOKEN`'s idiom with the polarity inverted, and that idiom is already
 * used twice here (the dev reset token, and the rate limiter's `RATE_LIMIT_ENABLED`). Its
 * load-bearing property is stated in `auth.service.ts`'s own comment: **`NODE_ENV=production` is
 * a HARD OVERRIDE on top of the flag, not the primary gate, so a misconfigured flag cannot leak
 * in production even if somebody sets it there by mistake.**
 *
 * Here that direction is inverted along with the polarity, and it stays the safe one:
 *
 *   - In production the door is CLOSED, unconditionally. **No environment variable reopens it.**
 *     An operator who sets the flag wrongly cannot open a door the owner has closed.
 *   - Outside production it is OPEN by default, which is what keeps 117 e2e files running and is
 *     why not one of them is deleted.
 *   - `CLOSE_SELF_SIGNUP=true` closes it ANYWHERE. That exists so the REFUSAL ITSELF is testable
 *     without pretending to be production — setting `NODE_ENV=production` in a test would also
 *     switch on TLS assertions, secure cookies and the rate limiter, so the test would be
 *     measuring four things and reporting one.
 *
 * ⛔ Read at CALL TIME rather than captured at module load: a spec that sets the variable in a
 * `beforeEach` must be able to change the answer, and a captured constant would freeze whatever
 * the first import saw. The same reason `limiterEnabled()` is a function.
 */
export function selfSignupOpen(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.CLOSE_SELF_SIGNUP !== 'true';
}

/**
 * The refusal, and it NAMES THE WAY IN.
 *
 * This repository's own rule, from the licence gate: a refusal that does not say the way out gets
 * escalated as a system fault. The two invitation paths decision 140's criterion 4 protects are
 * exactly the way in, and both still work — the provider invites an office's first administrator,
 * and that administrator invites everybody else.
 */
export const SELF_SIGNUP_CLOSED_MESSAGE =
  'Self-service signup is closed. An account in a brokerage office is created by invitation ' +
  "only: the provider invites the office's first administrator, and that administrator invites " +
  'everyone else from Settings → Users.';
