# Security

**Every claim in this file carries the command that demonstrates it.** That is not a style
preference — it is the only thing separating this document from the two it replaces.

> **2026-10-30 — `SECURITY_FIXES.md` IS MERGED INTO THIS FILE AND DELETED.** One subject in two
> places is the shape this repository refuses everywhere else, and the two had drifted into direct
> contradiction: this file told a reader that `common/sanitization.util.ts` was available for
> sanitising special cases, while the other recorded deleting it, and the file does not exist. A
> reader could not tell which half was current.
>
> **Then every claim in the merged file was re-measured, and 10 of 26 were false or stale.** The
> seven in the sections below are corrected in place with their measurement; the three worth naming
> here are: this file claimed a utility module that had been deleted; it recommended `npm audit fix`,
> which in this repository has made npm **drop a package from the tree** so the gate went green
> because the dependency had VANISHED; and the merged multer entry still argued its acknowledgement
> on *there is no multipart route*, which stopped being true when the customer-import upload landed.
>
> **That last one is not an irony, it is the recorded failure repeating.** `SECURITY_FIXES.md`
> opened with *"a security document that overstates its own coverage is worse than none — an
> auditor relies on it, and so does the next engineer deciding what still needs doing"*, and it was
> rewritten in 2026-09 precisely because an earlier revision had done that. The acknowledgement in
> `scripts/audit-check.mjs` records why its premise is now pinned by a TEST rather than by prose:
> four multer advisories were once accepted on a reachability argument that **had already been false
> for sixteen days**. A record whose premise nothing checks is a record that goes quietly false.

---

## How to re-verify this file rather than trusting it

Every subsection below names a file and, where a figure is quoted, the command that produced it.
If a claim here and the code disagree, **THE CODE IS RIGHT AND THIS FILE IS STALE.** Re-measure
before quoting any number in it to anybody outside this repository.

```bash
npm run test:security          # the dependency gate — see § Dependency posture
npm run typecheck && npm run lint
npx vitest run apps/api/src/common/multipart-upload-exposure.inventory.spec.ts
```

---

## 1 · Authentication & authorization

- **JWT access tokens, short-lived.** `TokenService.signAccessToken(payload, ttlMinutes)`.
  **The TTL is a PER-OFFICE SETTING with a default of 15 minutes** —
  `OfficeSecurityConfig.accessTokenTtlMinutes @default(15)` in `schema.prisma`, readable on
  `security-config.read` and writable on `security-config.manage`. This file previously stated 15
  minutes as a fixed fact; it is a default an office may change.
- **Refresh token rotation** on every refresh, and the refreshed token carries the **session's**
  organization rather than one the caller supplies — `auth.service.ts:507`, so a refresh cannot be
  a way to re-issue a token for a different office.
- **Cookie flags.** `httpOnly: true`, `sameSite: 'strict'`,
  `secure: process.env.NODE_ENV === 'production'` — `auth/cookies.util.ts:8-10`.
- **MFA (TOTP).** `MfaRequiredGuard` refuses every route until an authenticator is paired, with
  `/settings/security` the only way through. `@RequireStepUp()` re-challenges for a small set of
  high-consequence acts.
- **Permissions, not role names.** `PermissionsGuard` resolves codes from `roleId`; roles are
  per-office rows and a role NAME is not an identity, because two offices may each define a
  "Manager" with different grants.
- **`PermissionScope` is `OFFICE` or `PLATFORM`**, defaulting to the non-widening value. A
  PLATFORM code may only be held by the provider organization, and three layers enforce it: the
  matrix hides it, `RoleAdminService.setPermissions` refuses it, and the route checks the caller's
  organization type. **A hidden control the API still honours is not a boundary** — which is why it
  is all three.

## 2 · Tenant isolation

**Two layers, and the second is the one that holds when application code forgets.**

- **Layer 1 — `tenantScopeExtension`** rewrites the Prisma argument object for every model carrying
  `organizationId`, derived from the DMMF rather than a hand-kept list.
- **Layer 2 — row-level security.** Measured 2026-10-30:
  **139 distinct tables with `ENABLE ROW LEVEL SECURITY`, 13 of them `FORCE`d.**

```bash
grep -rhoE 'ALTER TABLE "[A-Za-z_]+" ENABLE ROW LEVEL SECURITY' \
  packages/db/prisma/migrations/*/migration.sql | grep -oE '"[A-Za-z_]+"' | sort -u | wc -l
```

**A policy on a model the extension does NOT scope is an outage rather than defence in depth** —
the extension sets `app.current_org_id` only for models carrying the column, so a policy anywhere
else matches nothing and the table reads empty for everyone.
`tenant-scope.extension.spec.ts` guards that pairing.

**The one place a `security_invoker = false` view crosses an office boundary** is registered in
`apps/api/test/security-definer-views.e2e-spec.ts` with its column allow-list and what it owes.
The declaration IS the review, and the guard fails the moment such a view exists unregistered.

## 3 · Raw SQL

**There are 37 raw queries in non-spec api code, and the honest claim is not that they are
avoided.** This file previously said *"No raw SQL: avoided whenever possible"*, which understates
both the count and what makes them safe.

- Every one is a **tagged template** (`$queryRaw\`…\``), so interpolations are parameterised by
  Prisma. The two occurrences of `$queryRawUnsafe` in non-spec code are not uses of it: they are
  `tenant-scope.extension.ts:315-317` **wrapping** those methods so a raw query is org-aware.
- `applyTenantScope` cannot filter a raw query — it rewrites an argument object and a raw query has
  none — so those call sites are **protected by RLS alone**, which is what makes the isolation
  promise true rather than aspirational.

```bash
grep -rn 'queryRaw`\|executeRaw`\|queryRaw<' apps/api/src --include=*.ts | grep -v spec | wc -l
```

## 4 · Transport security

- **HSTS** `max-age=31536000; includeSubDomains; preload`, production only —
  `common/security-headers.middleware.ts:58`.
- **Plain HTTP is rejected** in production, with `/health` and `/health/db` exempt so orchestrator
  probes still work.
- **`DATABASE_URL` must set `sslmode=require`** (or `verify-ca`/`verify-full`) in production, and
  the API **refuses to start** otherwise — `main.ts:56`.

## 5 · Response headers

`common/security-headers.middleware.ts`, set in **every** environment:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload   (production only)
```

**The CSP here is defence-in-depth on an API that serves no HTML or JS**, which that middleware's
own comment says. This file previously listed it under XSS prevention as though it protected the
web app; it does not, and the web app's own policy is a separate question.

## 6 · Input validation

- `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`, so an unexpected field is a 400
  naming it rather than a silently ignored value. That absence is load-bearing in places:
  `UpdateCustomerContactDto` carries three fields and the identifiers are **absent by design**, so
  each is refused by name.
- **`common/sanitization.util.ts` DOES NOT EXIST** (measured 2026-10-30). This file claimed it
  was available; it was deleted 2026-09-09 because it duplicated the `escapeHtml` in
  `modules/document-generation/document-html.util.ts` — which every document template imports and
  which has its own tests — plus an unused `validateJsonString`, and nothing imported it. **Two
  `escapeHtml` implementations in one codebase is a drift hazard, and an untested unused one is not
  a control.**

## 7 · Output encoding

**`dangerouslySetInnerHTML` occurs exactly ONCE**, and this file's previous absolute claim that it
is "avoided in React components" is what made that one site look like a violation. It is
`app/layout.tsx:91`: a static, parameterless theme-flash script with **no user input of any kind**,
documented at length in place. Measure before assuming a second:

```bash
grep -rn "dangerouslySetInnerHTML" apps/web --include=*.tsx --include=*.ts | grep -v node_modules
```

## 8 · Rate limiting

`common/rate-limit.guard.ts` + `rate-limit.decorator.ts`. **Five endpoints, not "all routes":**

| Decorator | Endpoints | Budget | Bucket |
|---|---|---|---|
| `@AuthRateLimit()` | `POST /auth/signup`, `POST /auth/login` | 5 / 15 min | `auth` |
| `@MfaRateLimit()` | `POST /auth/mfa/totp/challenge/verify` | 10 / 15 min | `mfa` |
| `@PasswordRateLimit()` | `POST /auth/forgot-password`, `POST /auth/reset-password` | 3 / hour | `password-reset` |

**IT IS OFF UNLESS `NODE_ENV=production` OR `RATE_LIMIT_ENABLED=true`, AND `NODE_ENV` IS ASSIGNED
NOWHERE IN THIS DEPLOYMENT** — not in `.env`, `.env.test`, `turbo.json` or any workspace
`package.json`, and `RATE_LIMIT_ENABLED` is commented out in `.env.example`. So **in dev and CI the
limiter does not run**, which `.env.example` already says and this file did not. That is deliberate:
every request in dev and CI genuinely comes from 127.0.0.1, so a per-IP bucket lumps every user and
every test into one — and an enforced 5-per-15-minutes made the integration suite unrunnable,
verified at the time with a `429` on the sixth auth call.

**EACH DECORATOR HAS ITS OWN NAMED BUCKET, AND THE MERGED FILE DESCRIBED THE OPPOSITE AS A
FEATURE.** It said *"the three guards share one static store keyed by client IP, so cycling between
endpoints does not buy a fresh budget"*. Sharing one bucket was the **BUG**: `resetTime` was stamped
by whichever guard created the entry first, so a single request to `/auth/login` handed the
password-reset guard a 15-minute window in place of its declared hour — 12 attempts/hour, a 4×
bypass reachable with one extra request — and the shared counter meant an MFA retry consumed a
legitimate user's login budget. Per-bucket is the fix, and that decorator file's own header records
it.

**`X-Forwarded-For` is honoured only when `TRUST_PROXY_HEADERS=true`.** It is client-supplied: when
trusted unconditionally, an attacker rotating it got a fresh bucket per request and defeated the
limiter entirely. Covered by a regression test.

**Not covered:** per-process and in-memory, so a multi-replica deployment needs a shared store. No
CAPTCHA and no anomaly-based lock beyond the per-account lockout in `AuthService`.

## 9 · Sensitive data

- **Field-level encryption, AES-256-GCM** — `common/crypto.util.ts:11`, random IV per value.
- **Nine encrypted field names, not the three this file used to list.** It said "national IDs,
  emails, phones", which understates: `nationalIdEnc`, `contactEmailEnc`, `contactPhoneEnc`,
  `ibanEnc`, `secretEnc` (the TOTP secret), `webauthnPublicKeyEnc`, `oauthRefreshTokenEnc`,
  `contactDetailsEnc`, and `beforeValueEnc`/`afterValueEnc` on identifier corrections.
  `security/encrypted-fields.ts` is the map, pinned by exact equality so a new encrypted field is a
  reviewed change rather than something that silently starts or fails to start encrypting.
- **A random IV per value means an identifier CANNOT be searched** — the same number stored twice
  is two different ciphertexts. That is a deliberate consequence, recorded where it bites.
- **Log redaction**: authorization headers, `Set-Cookie`, passwords and hashes, access/refresh/MFA
  tokens, secrets, encrypted fields. **No request or response body is ever serialised** in
  operational logs.

## 10 · The audit trail

**`AuditLogEntry` is immutable by a database trigger, not by convention** —
`20260826083942_add_audit_log_entry_immutability_trigger`, which raises
`AuditLogEntry rows are immutable (Part 10.3) — % is not permitted` on UPDATE or DELETE.

Two consequences worth knowing before writing a test or a teardown: **no fixture can delete an
audit row**, so an organization that has ever had a user signed into it is permanently undeletable;
and **nothing sensitive may be put in a snapshot**, because an immutable row is a row an erasure
request can never reach. A data subject's own words and a date of birth are both recorded as
absent for exactly that reason.

The trail also stores **the roles the actor HELD at the time**, which is the one fact that cannot
be reconstructed later: a role held in the past and never written down is unrecoverable.

## 11 · Dependency posture

**`npm run test:security` runs `scripts/audit-check.mjs`.** This file previously gave the command
as `npm test:security` (which does not run) and described it as `npm audit --audit-level=high`
(which it has not been since 2026-10-11).

**Two sets, and only one fails the build** — owner decision, 2026-10-11:

- **BLOCKING** — advisories reachable in what SHIPS, decided by npm's own `--omit=dev` rather than
  re-derived from the lockfile. They fail the build unless acknowledged.
- **REPORTED** — advisories that exist only in the dev tree. Printed every run, and a dev-only
  CRITICAL prints its own line saying nothing will stop a merge on it. **The cost of that policy is
  written at the top of the script**: two `tinypool` criticals fixed under it were themselves
  devDependencies, so neither would have failed the build — they were fixed because somebody read
  the output.

It also collapses npm's cascade rows, refuses to pass if it parsed nothing, and fails once an
acknowledgement passes its `reviewBy` date, so an acknowledgement cannot quietly become permanent.

**DO NOT RUN `npm audit fix`, AND DO NOT REACH FOR AN OVERRIDE TO ESCAPE AN EXACT PIN.** This file
used to recommend it. Measured here: a root override of `multer@^2.5.0` made npm **drop multer from
the tree entirely**, and this gate then went **GREEN because the package had VANISHED** — which
would have shipped a latent crash on the one route that uses it. **A green security gate is not
evidence that a package was patched; check the version is INSTALLED, not merely absent from the
audit.**

### One acknowledged advisory, and its premise is pinned by a test

**`multer` — GHSA-q7qp-rjg7-q26m / CVE-2026-113872**, DoS via a pending ASYNCHRONOUS `fileFilter`.
The full entry is in `scripts/audit-check.mjs`; the parts that matter here:

- **It is recorded as *the vulnerable code path does not exist in this product*, NEVER as *a known
  vulnerability accepted*.** Owner decision 52, 2026-10-24. Those are different claims and the second is not
  ours to make, because this system goes in front of a regulator. **Do not reword that entry into
  the language of accepted risk.**
- **The claim is the advisory's own sentence** — uploads using a synchronous `fileFilter` are not
  affected. Measured: `fileFilter` appears **zero** times in `apps/api/src`; the single multipart
  route (`modules/customer/legacy-import.controller.ts`) passes only
  `limits: { fileSize, files: 1 }`; and `@nestjs/platform-express` injects none.
- **THE PREMISE IS PINNED BY `apps/api/src/common/multipart-upload-exposure.inventory.spec.ts`**
  (4 tests, passing), which asserts both facts by name over the whole api source — so the PREMISE
  fails rather than the feature, and it fails for a SECOND upload route somebody adds. **A missing
  `files` limit fails it too, because multer's own default is UNLIMITED**: reading *no `files` key*
  as safe would be exactly backwards.
- **No upgrade path, and it is a wait with a date rather than an exemption.** The fix exists in
  multer 2.5.0; `@nestjs/platform-express` pins an EXACT `2.4.0` and every published version
  **through 12.2.0** still does — checked one at a time rather than off the latest major.

**This merged entry was itself stale in five places and is corrected above**: it said multer 2.2.0
(it is 2.4.0), platform-express 11.2.3 (11.2.6), that 12.0.1 was the latest major (12.2.0), that
the fix was in 2.3.0 (2.5.0), that four advisories were acknowledged (one is) — and, most
seriously, **that "there is no multipart route" and the `FileInterceptor` grep returns nothing.**
That grep now returns a route.

### The lockfile's hoisting layout is load-bearing and undeclared

Do not regenerate `package-lock.json` casually. Two things that have broken from it:

- npm writes only the **current platform's** optional dependencies on a fresh resolve
  (npm/cli#4828), so the Linux `@rollup/*` binaries CI needs get dropped and CI fails with
  `Cannot find module @rollup/rollup-linux-x64-gnu`.
- A regenerated tree **de-hoisted** `vitest` and `next` into per-workspace copies, and
  `@testing-library/jest-dom` and `eslint-config-next` live at the root and resolve them by
  hoisting — so the web unit tests and the web lint both broke, on every platform.

Neither is visible without running `npm ci`. `vitest` must stay at ONE version across all three
workspaces for the same reason.

## 12 · Error handling and environment

- Generic client-facing messages; full detail logged server-side; stack traces only when
  `NODE_ENV !== 'production'`.
- **Startup refuses rather than warns**: `JWT_ACCESS_SECRET` unset in production throws
  (`main.ts:72`), as does a `DATABASE_URL` without `sslmode` (`main.ts:56`).
- `.env` is never committed; `.env.example` is the template and carries **names only**.
- **CORS** validates a single origin from `WEB_ORIGIN`, defaulting to `http://localhost:3000`
  (`main.ts:101`).

## 13 · Still open — tracked, not fixed

| Gap | Where it is tracked |
|---|---|
| **Screening has real sanctions data and NO PEP data.** OFAC SDN and UN Consolidated ingest for real (`watchlist-fetchers.ts`); the built-in provider has **no PEP coverage and says so in its own code** rather than reporting a clean result it cannot support. The merged file's *"screening is simulated — no real provider"* was stale. | `IMPROVEMENTS.md` § 5.2 |
| **No object storage anywhere.** A `Document` records a file — name, category, classification, uploader — and `storageRef` names a location nothing can fetch. So a mandatory-certificate column guarantees the certificate is FILED AND ATTRIBUTED, not that the bytes are retrievable. | `README.md` § Known gaps |
| **Encryption at rest** is a deployment-time setting; no target chosen. | `IMPROVEMENTS.md` § 5.5 |
| **Full bank/card data** deliberately not stored; a real payment run would need field encryption plus an access path. | `IMPROVEMENTS.md` § 5.6 |
| **DAST is informational.** The CI ZAP baseline runs `fail_action: false` and needs a seeded scan user before it can gate. | `IMPROVEMENTS.md` § 1.6 |
| **Distributed rate limiting** — per-process and in-memory. | § 8 above |
| **Pre-transaction screening is a regulatory obligation and is not implemented** (measured 2026-09-27). Nothing in the invoice, refund, commission or collection paths consults a customer's screening state. | `README.md` § Known gaps |

---

## For developers

### Do

**Parameterise through Prisma**, including raw queries — use the tagged template, never string
concatenation:

```typescript
const user = await prisma.user.findUnique({ where: { id: userId } });
const rows = await prisma.$queryRaw`SELECT * FROM "User" WHERE id = ${userId}`;
```

**Validate through a DTO**, and remember that an ABSENT field can be the control:

```typescript
export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}
```

**Encrypt through `EncryptionService`**, and add the field to `security/encrypted-fields.ts` in the
same change — the map is pinned by exact equality, so a field that is not in it does not encrypt.

**Rate-limit a new sensitive endpoint** with an existing decorator rather than a new guard, so it
joins a declared bucket:

```typescript
@Post('login')
@AuthRateLimit()
async login(@Body() dto: LoginDto) { /* … */ }
```

**Escape through `document-html.util.ts`'s `escapeHtml`** — the one implementation, with tests.

**Write security-relevant acts to the audit trail**, never to the application log. An application
log is not the audit trail: it is not queryable from the audit screen, not covered by the
immutability trigger, and not retained on the same terms.

### Don't

**Never log a secret**, even knowing redaction will catch it.

**Never concatenate SQL.**

**Never read a permission by role NAME.** An office defines its own role names, so a name-keyed
lookup returns every same-named role across every office and hands the caller their UNION.

**Never add a field to `UpdateCustomerContactDto`.** That class being three fields is one of three
layers keeping the screening identifiers uneditable, and
`customer-identifier-correction.inventory.spec.ts` refuses any of the six in either DTO.

**Never put a data subject's own words, or a date of birth, in an audit snapshot** — the row is
immutable, so that is personal data an erasure request can never reach.

**Never acknowledge an advisory without all four of**: a verified absence of an upgrade path
(checked version by version, not off the latest major), a reachability argument that is the
advisory's OWN sentence rather than your reading of it, a `reviewBy` date, and **a test pinning the
premise**. The fourth is not optional, and the reason is in § 11.

---

## If you find a vulnerability

1. **Do not open a public issue.**
2. Document it with a severity and the command that demonstrates it.
3. Work on a branch; request a security review before merging.
4. If the fix rests on a premise ("this path is unreachable"), **pin that premise with a test in
   the same change** — a record whose premise nothing checks goes quietly false, and this
   repository has one measured instance of exactly that lasting sixteen days.
5. Update this file, including the command.

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) ·
  [OWASP API Security](https://owasp.org/www-project-api-security/) ·
  [NestJS Security](https://docs.nestjs.com/security/overview)
- PDPL No. 24/2023 — `ibms-brain/meta/context/pcms-privacy-modules.md`
- `ibms-brain/meta/lex/sensitive-data-handling.md` ·
  `ibms-brain/meta/lex/maker-checker-segregation.md`
