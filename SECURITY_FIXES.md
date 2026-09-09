# SECURITY_FIXES.md — dependency advisories & app-level hardening

**Scope:** the SCA (known-CVE dependency) posture of this repo and the
app-level security controls that back it. Every claim below is either verified
against the working tree at the stated commit or explicitly marked as not done.

> **2026-09-09 — this file was rewritten.** Its previous revision marked a
> number of advisories "✅ FIXED" that were still live in the tree, and
> described mitigations that do not exist in this codebase (removal of a
> direct `lodash._template` call the app never made; YAML parse timeouts;
> request-size limits; query-string validation; "rate limiting on all
> routes"). None of those were in `apps/api/src`. A security document that
> overstates its own coverage is worse than none — an auditor relies on it,
> and so does the next engineer deciding what still needs doing. What follows
> is what is actually true, with the command that demonstrates each claim.

---

## 1. How the gate works

`npm run test:security` runs `scripts/audit-check.mjs`, which wraps
`npm audit --audit-level=high` and:

- fails the build on any high/critical advisory that is not explicitly
  acknowledged in that file;
- ignores npm's *cascade* rows (npm reports every dependent of a vulnerable
  package as vulnerable too, so one leaf advisory otherwise appears six times);
- fails the build again once an acknowledgement passes its `reviewBy` date, so
  an acknowledgement cannot quietly become permanent.

Adding an acknowledgement requires all four of: no upgrade path exists
(verified, not assumed), the vulnerable code is unreachable from this
application, a `reviewBy` date, and the reasoning written down in the entry.

---

## 2. Resolved — dependency alignment (2026-09-09)

**Finding.** `npm ls` reported the dependency tree as `invalid`:
`@nestjs/swagger@5.2.1` and `@nestjs/schedule@4.1.2` declare peer ranges of
`@nestjs/core` `^8 || ^9 || ^10`, against an installed `@nestjs/core@11.2.3`.
Both packages were several major versions behind the framework they plug into,
and were the source of three high-severity advisories.

**Fix.** Aligned both to the Nest 11 line — `@nestjs/swagger@^11.4.7`,
`@nestjs/schedule@^6.1.3`. Deliberately NOT a jump to the Nest 12 family: that
is a whole-framework major upgrade, and (see §3) it would clear nothing extra.

**Cleared by this change:**

| Package | Advisory | Reached us via |
|---|---|---|
| `lodash` | GHSA-r5fr-rjxr-66jc, GHSA-f23m-r3pf-42rh, GHSA-xxjr-mmjv-4gpg | `@nestjs/swagger@5` |
| `path-to-regexp` | GHSA-9wv6-86v2-598j (ReDoS) | `@nestjs/swagger@5` |
| `uuid` | GHSA-w5hq-g745-h8pq | `@nestjs/schedule@4` |

Note that the app never imported `lodash`, `path-to-regexp` or `uuid`
directly — they were transitive only. The previous revision of this file
claimed a direct `_.template` call had been removed; there was never one.

**Verified:** `npm audit` high/critical count went 9 → 6; `npm ls` reports a
valid tree; api unit suite 2474/2474 green after the upgrade;
`npm run build` green.

---

## 3. Acknowledged — `multer` (unreachable, no upgrade path)

**Advisories:** GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf,
GHSA-qvfw-j98x-7q72, GHSA-535w-7cp7-47q4 — all four are denial of service via
crafted **multipart** input. Fixed upstream in `multer@2.3.0`.

**Why it is not fixed here — verified, not assumed:**

- `@nestjs/platform-express@11.2.3` pins `multer` to exactly `2.2.0`.
- `@nestjs/platform-express@12.0.1` — the latest major — pins the **identical**
  `multer: 2.2.0`. Upgrading the whole framework to Nest 12 would clear none
  of these four.
- npm `overrides` cannot rewrite that edge on npm 10.8. Four syntaxes were
  tried (flat caret, flat exact, scoped under `@nestjs/platform-express`, and
  the `$name` reference form) against a freshly deleted lockfile. The exact
  form makes npm **drop `multer` from the tree entirely**, which is not a fix:
  `@nestjs/platform-express`'s own `index.js` eagerly requires it, so the API
  then fails at import.

**Why it does not reach this application:** there is no multipart route.
`grep -rn "FileInterceptor\|@UploadedFile\|multer" apps/api/src` returns
nothing. `Document` stores a `storageRef` pointer; no object-storage or upload
service exists yet (README § Known gaps). Nothing in this API parses a
multipart body, so no request can reach the vulnerable parser.

**Review trigger:** the moment a real document-upload endpoint is built — that
is precisely what would make it reachable. Recorded with a `reviewBy` date in
`scripts/audit-check.mjs`.

---

## 4. App-level controls — what exists, and what it covers

### 4.1 Rate limiting — auth endpoints only, production only

`apps/api/src/common/rate-limit.guard.ts` + `rate-limit.decorator.ts`.

**Applied to five endpoints**, not "all routes":

| Decorator | Endpoints | Budget |
|---|---|---|
| `@AuthRateLimit()` | `POST /auth/signup`, `POST /auth/login` | 5 / 15 min |
| `@MfaRateLimit()` | `POST /auth/mfa/totp/challenge/verify` | 10 / 15 min |
| `@PasswordRateLimit()` | `POST /auth/forgot-password`, `POST /auth/reset-password` | 3 / hour |

The three guards share one static store keyed by client IP, so cycling between
signup, login and password-reset does not buy a fresh budget.

**Two corrections made 2026-09-09:**

1. **`X-Forwarded-For` spoofing (real bypass).** The guard trusted that header
   unconditionally. It is client-supplied: an attacker rotating it got a fresh
   bucket on every request, defeating the limiter completely. It is now
   honoured only when `TRUST_PROXY_HEADERS=true` declares that a trusted proxy
   sets it; otherwise the socket address — the one value a client cannot
   choose — is used. Covered by a regression test.
2. **Enforced in production only.** Gated on `NODE_ENV=production`, or
   `RATE_LIMIT_ENABLED=true` to force it on anywhere (which is how the guard's
   own unit spec exercises it, and how staging can opt in). In dev and CI every
   request genuinely comes from 127.0.0.1, so a per-IP bucket lumps every user
   and every test into one — it does not approximate production, it just
   breaks: all 63 `*.e2e-spec.ts` files sign up and log in repeatedly, and an
   enforced 5-per-15-minutes limit made the integration suite unrunnable
   (verified: `429` on the sixth auth call). Same `NODE_ENV` gate
   `securityHeaders()`'s TLS enforcement and the secure-cookie flag use.

**Not covered:** this is a per-process, in-memory limiter. A multi-replica
deployment needs a shared store (Redis or the load balancer's own limiter) —
each replica currently keeps its own budget. There is no CAPTCHA and no
anomaly-based lock beyond the existing per-account lockout in `AuthService`.

### 4.2 Security response headers

`apps/api/src/common/security-headers.middleware.ts` sets
`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`,
`Referrer-Policy`, `Content-Security-Policy` and `Permissions-Policy` in
**every** environment, and `Strict-Transport-Security` plus the plain-HTTP
rejection in production only (`/health` and `/health/db` are exempt from the
rejection so orchestrator probes still work).

### 4.3 Removed — `common/sanitization.util.ts`

Deleted 2026-09-09. It exported an `escapeHtml` duplicating the one in
`modules/document-generation/document-html.util.ts` (which every document
template actually imports and which has its own tests), plus an unused
`validateJsonString`. Nothing imported it. Two `escapeHtml` implementations in
one codebase is a drift hazard, and an untested unused one is not a control.

### 4.4 Next.js

`apps/web` is on `next@16.3.4`, past the advisories that affected 16.0.0–16.3.2.
The previous revision of this file also claimed image optimization had been
"disabled or restricted" as a mitigation; no such configuration exists in
`apps/web`, and none is needed at this version.

---

## 5. Still open (tracked, not fixed here)

These are recorded in `IMPROVEMENTS.md` § 5 and are not dependency issues:

- **Screening is simulated** (§5.2) — no real sanctions/PEP data provider.
- **Encryption at rest** (§5.5) — a deployment-time setting; no target chosen.
- **Full bank/card data** (§5.6) — deliberately not stored; a real payment run
  would need field encryption plus an access path.
- **DAST is informational** — the CI ZAP baseline runs with
  `fail_action: false` and needs a seeded scan user before it can gate.
- **Distributed rate limiting** — see §4.1.
