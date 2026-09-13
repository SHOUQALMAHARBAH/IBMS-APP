# Authentication, MFA and sessions

Multi-tenancy Part II, §4.1–§4.10. This replaced the original Part A.1 flow
rather than sitting alongside it — every employee's sign-in goes through it.

## What changed, and why

| Before | Problem | Now |
|---|---|---|
| Department and Role conflated at account creation | They are different things: one department holds several roles | `Department` is a separate required field on provisioning, distinct from `roles` |
| First password change optional | The admin who provisioned the account knows the password | `mustChangePassword` forces exactly one change before anything else |
| MFA on every login | Impractical, and the reason people ask to weaken it | TOTP app (no send delay) + a 30-day `TrustedDevice`, for standard roles only |
| Idle timeout re-asked for an MFA code | Anyone at the unlocked machine could resume without the password | The session is revoked; the way back is the full email+password screen |
| "Invalid code" during enrolment | Zero clock tolerance, no verify-before-complete | ±1 step (±30s), and enrolment completes only after one live code |
| MFA setup hidden in Settings | Easy to skip | Forced inline as step 2 of onboarding |
| Always-step-up roles could trust a device | Would have quietly weakened the strongest guarantee | `SYSTEM_SECURITY_ADMINISTRATOR`, `COMPLIANCE_OFFICER`, `DATA_PROTECTION_OFFICER` are always prompted |
| No notion of which office a login belongs to | — | Every step runs inside an Organization resolved from the subdomain |

## The onboarding wizard

```
POST /auth/login            → { outcome: 'MUST_CHANGE_PASSWORD', onboardingToken }
POST /auth/password/force-change → a real session
POST /auth/mfa/totp/enroll  → QR + manual secret
POST /auth/mfa/totp/enroll/verify → mfaEnabled = true
```

**The password step issues no session token at all.** §4.3.1 is explicit about
that, and it is worth keeping: the onboarding token names no session, so the
JWT guard rejects it everywhere. It reaches `force-change` and nothing else.

After the change a real session exists, but `MfaRequiredGuard` still refuses
every business route until a second factor is enrolled — so the MFA screen is
reachable and nothing else is. A user owing the password change who somehow
holds a session (an admin setting the flag on an already-signed-in account)
gets `403 ONBOARDING_INCOMPLETE`.

The mandatory change is one-shot: once `mustChangePassword` is false the
endpoint refuses, so a leaked onboarding token cannot be replayed later to set
a password without knowing the current one. The new password is checked against
the current hash and the last five (`PasswordHistoryEntry`), which is what stops
someone "rotating" straight back to the admin-known temporary password.

## Trusted devices

A fingerprint is a **client-supplied hint, not a credential**. It is consulted
only after the password has verified, it can only shorten the second factor,
and it is stored as a SHA-256 hash — the raw value would make this table a
device-tracking log of every employee.

Trust is granted at `POST /auth/mfa/totp/challenge/verify` with
`trustDevice: true`, i.e. only immediately after a verified second factor.
Granting it on a password-only step would let a stolen password mint its own
MFA bypass.

The three always-MFA roles are refused server-side, not merely hidden in the
UI. They are deliberately **not** `PRIVILEGED_ROLES`, which is a wider set used
for step-up: reusing it would look stricter while quietly removing the
convenience from Executive Management and Branch/Department Managers, whom §4.4
leaves as standard roles for this purpose.

A password change revokes every trusted device for that user — the moment to
assume the old password may have been known by someone else is the moment to
stop trusting the machines it was used on.

## Sessions: two ceilings

`idleExpiresAt` moves forward on every authenticated request.
`absoluteExpiresAt` never moves (12h, `ABSOLUTE_SESSION_HOURS`). Either
elapsing **revokes** the session — a termination, not a screen lock.

Idle is evaluated against both the stored ceiling and one recomputed from the
office's *current* `idleTimeoutMinutes`, whichever bites first. The stored value
alone would let a session keep an old, longer window after an administrator
shortens the timeout — precisely when it matters most. Recomputing alone would
ignore a ceiling already written down.

## Tenant resolution

```
GET /orgs/resolve?subdomain=alsalam   → { id, legalName, legalNameAr, subdomain, status }
```

Public by necessity — it runs before there is anyone to authenticate — and it
returns only what a sign-in screen needs to render. **There is no route that
lists offices.** §4.10.4 says an office administrator must not learn that
another office exists, and a listing endpoint would hand that to anyone.

Every access token carries an `org` claim (§4.10.2). It is a claim, not the
source of truth: `validateAndTouch` still resolves the Organization from the
session row, and `JwtStrategy` rejects a token whose claim disagrees with its
own session.

`TenantMatchGuard` then enforces §4.10.3 — the office named by the request's
subdomain must match the session's. **It deliberately does nothing when the
host names no office** (`localhost`, an IP, the apex, `api.`): every local, CI
and e2e request looks like that, and failing them would make the system
unreachable outside production DNS while proving nothing. An unknown but
well-formed subdomain is also skipped rather than refused, because refusing
would turn the guard into a way to probe which labels are registered.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `TRUSTED_DEVICE_TTL_DAYS` | 30 | How long a "trust this device" grant lasts |
| `ABSOLUTE_SESSION_HOURS` | 12 | Hard cap on one sign-in, regardless of activity |

Idle timeout, lockout threshold and token TTLs remain per-office on
`SecurityConfig`. The absolute cap is deliberately **not** there: that model
holds the knobs an office's own administrator tunes, and a per-office setting
that could be raised to a year would quietly undo the control.

## Deviations from the spec text, and why

- **The TOTP secret stays on `MfaCredential`**, not on `User.mfaSecretEnc` as
  §4.1.3 sketches. `MfaCredential` predates this phase, is already field-level
  encrypted, and supports several credentials per user plus the WebAuthn
  fast-follow. Moving it up to `User` would be a strictly worse model adopted
  only to match a sketch.
- **`User.departmentId` was added**, alongside the `Employee.departmentId` of
  §4.1.2. §4.2.2 describes an admin filling Branch and Department on the same
  form, and `User.branchId` already existed; a freshly provisioned account often
  has no `Employee` row, so without this the required field would have nowhere
  to land and the requirement would be hollow.

## What is not built

- **No UI.** Every endpoint exists and is tested; the screens do not. They
  belong with the Phase 4 front-end work, where they also need Arabic.
- **SMS and EMAIL MFA methods** exist in the `MfaMethod` enum as §4.1.3 defines
  them, but only `TOTP_APP` is implemented. The spec calls the other two a
  lost-device fallback, and there is no recovery flow yet.
- **Lockout** (`failedLoginAttempts` / `lockedUntil`) predates this phase and is
  unchanged; §4.4.4's configurable threshold is `SecurityConfig
  .maxFailedLoginAttempts`.
