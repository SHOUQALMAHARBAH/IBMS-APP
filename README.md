# ibms-app

Engineering codebase for **IBMS** (Insurance Brokerage Management System). This is the
first engineering repo for the IBMS build program — a standards-taker from the
`ibms-brain` repo (rules in `meta/lex/`, domain knowledge in `meta/context/`,
architecture decisions in `meta/designs/`), pulled in here as a git submodule at
`ibms-brain/` so both a human and an agent working in this repo actually have it, not
just a note saying to go read it elsewhere. This repo does not restate those rules; it
implements against them. Compliance/PDPL/CBJ obligations still cite the source document
in `ibms-brain/`, not this README.

**Status:** infrastructure scaffold (Part A + Part B), plus the first Part C business
modules — **Domain A, Processes 1–10**: Lead Management (#1 — create/list/filter,
`LeadStatus` transition, an intake-form + pipeline-board screen), Prospect Management (#2
— convert a qualified Lead, capture its qualification profile, a profile screen), Customer
Acquisition/Onboarding (#3-4 — individual/corporate Customer creation, UBO capture, KYC
lifecycle with *simulated* sanctions/PEP/AML screening and maker/checker approval, a
step-by-step wizard + Compliance queue), Needs Assessment (#5 — a structured risk
questionnaire that derives a recommended coverage list, with a review + approval gate),
Risk Assessment (#6 — a per-site asset survey deriving Sum Insured + indemnity period,
consolidated across a multi-site client), Product Recommendation / Program Design (#7
— a multi-line `InsuranceProgram` assembled deterministically from an approved Needs
Assessment's coverage list + the Risk Profile's derived Sum Insured, DRAFT → FINALIZED),
Cross-Selling (#8 — a nightly job + on-demand scan flag each benchmark insurance line
a customer holds no in-force policy for as a `CrossSellOpportunity` to convert or dismiss;
`Policy` is empty until Domain B, so it is a correct no-op for now), and Up-Selling (#9 —
a nightly job + on-demand scan raise an `UpSellRecommendation` when a customer's surveyed
asset value has grown materially past the property Sum Insured designed into their live
`InsuranceProgram`), and Relationship Management / CRM (#10 — log every customer
touchpoint as an `Interaction` and serve the aggregated 360° customer view: interactions
plus policies, claims and complaints merged into one timeline; the latter three are empty
until Domains B/C/E land).
Everything else — Domains B–H
(policy, claims, finance, service, compliance/risk, management, supporting ops), and
Parts D–G (PDPL/DSR/retention, dashboards, bilingual/RTL UI, final verification) — is
**not started**. See § Scope status for the full picture and § Known gaps for the
deferred edges of each built item; `meta/context/data-model.md` in ibms-brain is the
logical data model this is built against. A minimal signed-in navigation shell (a sidebar
plus a `Welcome` landing at `/`) ties the built screens together; the original `/`
scaffold placeholder is gone, and login now lands on the home page.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript |
| Backend | NestJS + TypeScript |
| Frontend/backend unit tests | Vitest + Testing Library |
| E2E / accessibility | Playwright + axe-core |
| Database | PostgreSQL + Prisma (`6.19.3` — see note below) |
| Monorepo | npm workspaces + Turborepo |
| Containers | Docker (multi-stage, `turbo prune`-based) |
| CI | GitHub Actions |
| Preview deploys | Vercel (web app only) |
| Production deployment target | **TBD** — not decided yet, do not assume one |

**Why Prisma 6, not 7:** Prisma 7 requires Node ≥20.19/22.12/24 and mandates a driver
adapter (`@prisma/adapter-pg`) plus a `prisma.config.ts`. Node here is pinned at `20.19.0`
(see `.nvmrc`) — high enough to satisfy tooling engine requirements (e.g.
`typescript-eslint`), but Prisma itself stays pinned at `6.19.3` in `package.json`
deliberately: Node ≥20.19 makes Prisma 7 *installable*, not required. Don't bump the
`prisma`/`@prisma/client` versions past 6.x without doing the driver-adapter + config
migration first. Revisit deliberately when the team moves to Node 22 LTS.

## Layout

```
ibms-app/
  apps/
    web/                Next.js frontend (port 3000)
      app/              Routes (App Router)
      components/       Shared/presentational UI components
      features/         Feature-scoped UI + client logic
      lib/              Client-side utilities, API client, helpers
    api/                NestJS backend (port 4000)
      src/
        modules/         Feature modules (each wires its own controller/service)
        common/          Cross-cutting utilities (money, masking, logging, ...)
        controllers/      Route handlers not yet owned by a feature module
        services/         Business logic not yet owned by a feature module
        repositories/     Data-access layer (wraps @ibms/db)
        middleware/       Cross-cutting request handling (auth, logging, ...)
  packages/
    db/              Shared Prisma schema + generated client (@ibms/db)
  logs/              Runtime operational logs (pino) — gitignored; see logs/README.md
  ibms-brain/         Standards/rules/context — git submodule, not this repo's code
  docker-compose.yml Postgres + api + web for local/integration use
  turbo.json         Task graph (build/lint/typecheck/test/e2e)
  .github/workflows/ CI
```

`features/` (web) and `controllers/`, `services/` (api) are still empty scaffolding — no
feature has needed them over its own `modules/` subfolder yet. `modules/`/`repositories/`
(api) and `lib/`/`components/` (web) now also carry the first real business features (Lead
Management — `apps/api/src/modules/lead/`, `apps/web/app/(app)/leads/`; Prospect
Management — `apps/api/src/modules/prospect/`, `apps/web/app/(app)/prospects/`; Customer
Acquisition/Onboarding — `apps/api/src/modules/customer/`,
`apps/web/app/(app)/customers/`; Needs Assessment + minimal Risk Profile —
`apps/api/src/modules/needs-assessment/` + `apps/api/src/modules/risk-profile/`,
`apps/web/app/(app)/needs-assessments/`), alongside the infrastructure modules (auth,
RBAC, audit, SLA, workflow, security) built first. They establish where feature work
lands, per `meta/context/policy-lifecycle.md` and `meta/context/claims-lifecycle.md` in
`ibms-brain`.

## Prerequisites

- Node `20.19.0` (`nvm use`, or match `.nvmrc`)
- Docker (for Postgres locally, and for building the app images)

## Getting started

```bash
# Clone with the ibms-brain submodule included:
git clone --recurse-submodules https://github.com/SHOUQALMAHARBAH/IBMS-APP.git
# already cloned without it?
git submodule update --init --recursive

cp .env.example .env
npm install

# Postgres only, for local (non-Docker) app dev:
docker compose up -d db
npm run db:migrate:dev
npm run db:seed   # 11 roles + full permission grid — RBAC needs these to exist

# Everything else, run natively:
npm run dev
```

### Dev DB vs. test DB

Two separate local Postgres instances, never the same database:

- **`db`** (dev) — `docker compose up -d db`, driven by `.env`. Only changes when you
  explicitly run a migrate command against it. This is the database `npm run dev` talks to.
- **`db-test`** — `docker compose up -d db-test`, driven by `.env.test` (copy from
  `.env.test.example`). Everything exploratory happens here first: schema changes and
  `npm run test:e2e` run against this database, never against `db`.

```bash
cp .env.test.example .env.test
docker compose up -d db-test

# Iterate on a schema change and run the integration suite against db-test:
npm run db:test:migrate:dev
npm run db:test:seed
npm run test:e2e

# Once you're satisfied, promote the same migration files to the dev DB:
npm run db:migrate:deploy
```

`db:test:migrate:dev` and `db:migrate:deploy` apply the same migration files under
`packages/db/prisma/migrations/` to different databases — nothing is copied or
regenerated between them, only re-applied. CI (`.github/workflows/ci.yml`) does the
equivalent against its own ephemeral `ibms_test` container, which is destroyed with the
runner at the end of the job — it never touches either local database.

- `web` → http://localhost:3000
- `api` → http://localhost:4000 (`/health` liveness, `/health/db` readiness)

Next.js reads `NEXT_PUBLIC_*` vars from its own env file for local (non-Docker) dev —
also copy the relevant lines into `apps/web/.env.local` if you're not using
`docker compose` for the whole stack.

### Run the whole stack in Docker

```bash
docker compose up --build
```

## `ibms-brain` submodule

`ibms-brain/` is a git submodule, pinned to a specific commit of
[SHOUQALMAHARBAH/IBM-System](https://github.com/SHOUQALMAHARBAH/IBM-System) — it does
not auto-track that repo's `main`. Claude Code (or any agent) working in this repo reads
it automatically via the `@ibms-brain/CLAUDE.md` import at the top of this repo's own
`CLAUDE.md`. To pull in newer brain rules:

```bash
cd ibms-brain && git pull origin main && cd ..
git add ibms-brain && git commit -m "ibms-brain: sync to latest"
```

### `.claude/` — agents, commands, hooks

Claude Code only discovers `.claude/agents/`, `.claude/commands/`, and `.claude/settings.json`
at a session's own project root — not inside a nested git submodule — so this repo carries
its own `.claude/` rather than relying on `ibms-brain/.claude/`:

- `.claude/agents/{code-reviewer,software-developer}.md`, `.claude/commands/brain-gap.md` —
  mirrored from `ibms-brain/.claude/{agents,commands}/` by
  `.claude/hooks/mirror-brain-agents.sh` (a `PostToolUse` hook on Write/Edit). Don't hand-edit
  these files — the hook overwrites drift on the next Write/Edit.
- `.claude/settings.json` wires two of `ibms-brain`'s `PreToolUse` hooks directly against the
  submodule path (`enforce-credential-safety.sh`, `enforce-workspace-updates.sh`).
  `enforce-evidence.sh` (the `git push` evidence gate) is deliberately **not** wired yet —
  `scripts/verify.sh` doesn't write `artifacts/<sha>/gates.json`, so turning that hook on
  today would block every push with no way to satisfy it. The domain-code hooks
  (`enforce-money-decimal.sh`, `enforce-state-transitions.sh`, `enforce-sensitive-data.sh`)
  are also not wired — moot until real domain code lands (see `CLAUDE.md`).
- **Known gap:** both wired hooks parse the tool-call JSON via `python3`. On a machine where
  `python3` resolves to a stub (e.g. the Windows Store alias, with a real interpreter only at
  `python`), they silently no-op instead of blocking — verified during setup. This is a
  pre-existing issue in `ibms-brain`'s hook scripts, not something this repo can fix on its
  own.

## Scripts (run from repo root; Turborepo fans them out per workspace)

| Command | Does |
|---|---|
| `npm run dev` | `next dev` + `nest start --watch`, in parallel |
| `npm run build` | Production build of every workspace (`@ibms/db` generates the Prisma client first) |
| `npm run lint` | ESLint, per workspace |
| `npm run typecheck` | `tsc --noEmit`, per workspace |
| `npm run test` | Vitest unit tests (web + api) |
| `npm run test:e2e` | API integration tests (Vitest + Supertest) — needs a reachable `DATABASE_URL` |
| `npm run test:contract` | API contract tests — validates real responses against the OpenAPI schema generated from `@nestjs/swagger` decorators (`apps/api/test/contract.contract-spec.ts`) — needs a reachable `DATABASE_URL` |
| `npm run test:security` | Dependency audit (`npm audit --audit-level=high`), repo-wide |
| `npm run test:smoke` | `bash scripts/smoke.sh api` — dispatches to the api service's smoke test (see below) |
| `npm run e2e` | Playwright functional e2e (web) — excludes `@a11y`-tagged specs |
| `npm run test:a11y` | Playwright + axe-core accessibility checks (web) — only `@a11y`-tagged specs |
| `npm run db:validate` | `prisma validate` — schema is internally valid (not a drift check; that's `db:migrate:status`) |
| `npm run db:migrate:dev` | Create/apply a migration against the dev DB (`packages/db`) |
| `npm run db:migrate:deploy` | Apply existing migrations to the dev DB, no schema drift (also used for CI/prod) |
| `npm run db:migrate:status` | Check dev DB migration history against `schema.prisma` for drift |
| `npm run db:test:migrate:dev` | Create/apply a migration against `db-test` — where schema iteration happens |
| `npm run db:test:migrate:deploy` | Apply existing migrations to `db-test`, no schema drift |
| `npm run db:test:migrate:status` | Check `db-test` migration history against `schema.prisma` for drift |
| `npm run db:studio` | Prisma Studio (dev DB) |
| `npm run db:seed` | Seed the dev DB — the 11 roles + full permission grid (`packages/db/prisma/seed.ts`), idempotent |
| `npm run db:test:seed` | Same seed, against `db-test` |

## `scripts/`

- **`scripts/smoke.sh <service>`** — dispatches to a single backend service's smoke
  test. Today that's just `api` (`bash scripts/smoke.sh api`), which boots the real
  service via `npm run start` and calls `/health` and `/health/db` — proving it can
  reach Postgres, not just that the process started. Add a `case` for a second service
  the day one exists; see `apps/api/scripts/smoke.sh` for what a real per-service smoke
  test looks like.
- **`scripts/verify.sh`** — runs every gate in `ibms-brain/meta/context/verification-contract.md`
  § Backend/frontend gate commands against `db-test` and prints each gate's real evidence
  (exit code, and a test count where the tool reports one), ending in a summary block.
  Precondition: `.env.test` exists (`cp .env.test.example .env.test`) and `db-test` has
  been migrated at least once (`npm run db:test:migrate:dev`). Run it before opening a PR
  to get the evidence block for the PR description in one shot — claims aren't evidence,
  this is.
- **`scripts/backup-restore-drill.sh`** (A.10, Part 10.4/10.5) — dumps a database
  (`db-test` by default — never dev/prod automatically), encrypts the dump
  (AES-256-CBC), decrypts and restores it into a throwaway database, verifies the
  restored row count matches the original, and fails if the whole cycle exceeds the RTO
  target (`RTO_TARGET_SECONDS`, default 900s). Requires `BACKUP_ENCRYPTION_KEY` in the
  environment. `npm run db:backup:drill` runs it. See
  `ibms-brain/meta/lex/backup-rpo-rto.md` for the RPO/RTO targets this is testing.

## CI

`.github/workflows/ci.yml`, three jobs, plus two standalone workflows:

1. **frontend** — installs, then: typecheck → lint → unit/component tests (Vitest +
   Testing Library) → installs Playwright's Chromium → accessibility (`test:a11y`,
   axe-core, `@a11y`-tagged specs, evidence is 0 serious/critical violations) → e2e
   (`e2e`, functional Playwright flows) → build. Uploads the Playwright HTML report as an
   artifact on every run (including failures).
2. **backend** — installs, then: typecheck → lint → unit tests → security (`test:security`
   — dependency audit) → spins up an ephemeral `postgres:18-alpine` service container
   (database `ibms_test`, ports/network scoped to the job — distinct from both local
   `db` and `db-test`, and destroyed with the runner when the job ends) → database schema
   (`db:validate` — `prisma validate`, schema is internally valid) → migrate deploy →
   schema-drift check (`db:migrate:status`, fails on drift) → integration tests
   (`test:e2e`) → contract tests (`test:contract`, OpenAPI-validated responses) → smoke
   tests (`bash scripts/smoke.sh api` — boots the real service and hits `/health` +
   `/health/db`) → build → boots the built service again and runs an OWASP ZAP baseline
   scan against it (DAST, A.10/Part 10.4-10.5) — passive-only, informational
   (`fail_action: false`) for now, see § Known gaps, A.10.
3. **docker** — builds (does not push) the `api` and `web` images, to catch Dockerfile
   regressions. No registry/push step exists yet — the production deployment target is
   still TBD, so there's nowhere authorized to push to.

**`.github/workflows/codeql.yml`** (A.10, SAST) — GitHub CodeQL static analysis over
`apps/web`/`apps/api` TypeScript source, on every push/PR to `main` plus a weekly
schedule (catches a newly-published query matching old code no PR touched). Separate
from `test:security` in the backend job above, which is SCA (known-CVE dependency
scanning), not SAST (this repo's own code).

**`.github/workflows/backup-drill.yml`** (A.10, Part 10.4/10.5) — runs
`scripts/backup-restore-drill.sh` against `db-test` weekly and on manual dispatch.
Needs a `BACKUP_DRILL_ENCRYPTION_KEY` repository secret to run — see
`ibms-brain/meta/lex/backup-rpo-rto.md`.

### First end-to-end verification

Confirmed 2026-08-25 via `chore/initial-ci`, the repo's first real PR: every gate above
runs and passes on a clean diff, and a deliberately broken unit test correctly blocks
the PR (red ❌) until reverted. This is what makes `definition-of-done.md` mechanically
enforced rather than documentation.

## Vercel preview

Not yet connected to a live Vercel project. To wire it up: create a Vercel project from
this repo with **Root Directory = `apps/web`** — `apps/web/vercel.json` already tells
Vercel to install and build from the monorepo root via Turborepo. Set
`NEXT_PUBLIC_API_URL` in the Vercel project's environment variables to wherever the API
is reachable from that preview (there is no hosted API yet, so this is a placeholder
until one exists). The `ibms-brain` submodule isn't needed for the build (it's not an
npm workspace member) and both repos are public, so no submodule-auth setup is required.

## Security — encryption & key management (Part 10.2)

Field-level encryption, TLS enforcement, and key management live in
`apps/api/src/modules/security/` (`EncryptionService`, `KeyRegistryService`,
`encrypted-fields.ts`). Design rationale:
`ibms-brain/meta/designs/2026-08-a3-encryption-key-management.md`.

- **Field-level encryption.** Every `-- ENCRYPT` schema field
  (`Customer.nationalIdEnc/contactPhoneEnc/contactEmailEnc`,
  `UltimateBeneficialOwner.nationalIdEnc`, `InsuredPerson.nationalIdEnc`,
  `Employee.nationalIdEnc`, `ThirdPartyClaimant.contactDetailsEnc`) is covered by
  `encryptEntityFields`/`decryptEntityFields` in `encrypted-fields.ts`, AES-256-GCM via
  `EncryptionService`. `MfaCredential.secretEnc`/`webauthnPublicKeyEnc` keep their own,
  separate encryption path (`apps/api/src/common/crypto.util.ts`,
  `MFA_ENCRYPTION_KEY`) — a deliberate second key pool, not an oversight; see the design
  doc.
- **Key management.** `PII_ENCRYPTION_KEYS` (`keyId:base64key,...`) and
  `PII_ENCRYPTION_ACTIVE_KEY_ID` — see `.env.example` for the exact format and a
  rotation walkthrough. `GET /security/encryption-keys` (SYSTEM_SECURITY_ADMINISTRATOR
  only — the key-custodian role) returns key ids and active/retired status, never key
  material. Every encrypt/decrypt call writes an `AuditLogEntry`
  (`AuditAction.ENCRYPTION_KEY_USED`) recording which key/field/operation was used —
  never the plaintext or ciphertext.
- **TLS.** `securityHeaders()` middleware (`apps/api/src/common/`) sets HSTS and rejects
  any request that didn't arrive over HTTPS; `main.ts` refuses to boot if
  `DATABASE_URL` lacks `sslmode=require`/`verify-ca`/`verify-full`. Both gate on
  `NODE_ENV=production` only — local dev and CI have no TLS termination in front of
  them.
- **Encryption at rest (database + document store).** Not yet configurable — this repo
  has no chosen deployment platform (see § Deployment below) and no document-upload
  service behind `Document.storageRef` yet. Tracked as a deferred requirement in the
  design doc above: whichever managed Postgres/object-store this project deploys to
  must have encryption at rest enabled as part of that provisioning decision.

## Data masking, secure sharing & environment separation (Part 10.4-10.6)

- **Masking + justified drill-down.** `maskTrailing()` (`apps/api/src/common/masking.util.ts`)
  produces a last-4-visible masked string for list-view display.
  `SensitiveFieldRevealService` (`apps/api/src/modules/security/`) wraps that together
  with `EncryptionService.decrypt()` and a required, audited justification (`READ`
  `AuditLogEntry`, `isSensitiveDataAccess: true`, reason recorded — never the plaintext)
  — the only sanctioned way to get a real (unmasked) value back.
- **Secure data-sharing channel.** `DataSharingApproval.classification`/`channel`
  (new columns, migration `20260826140000_...`) plus `assertSecureChannel()`
  (`apps/api/src/modules/security/secure-channel.util.ts`) reject a CONFIDENTIAL/
  HIGHLY_CONFIDENTIAL share picked over `UNENCRYPTED_EMAIL`/`POSTAL_MAIL`/
  `OTHER_UNSECURED`.
- **Watermarking + export/print restriction.** `assertExportAllowed()`/
  `buildWatermarkText()` (`apps/api/src/modules/security/document-export.util.ts`)
  enforce that a HIGHLY_CONFIDENTIAL `Document` export/print carries a watermark, using
  the existing `AuditAction.EXPORT`/`PRINT` values.
- **Privacy-by-default forms.** `assertNoPresetSensitiveDefaults()`
  (`apps/web/lib/forms/privacy-by-default.ts`) throws if a form's initial values
  pre-populate a listed sensitive field.
- **Non-production data.** `synthesizeEntityFields()`/`synthesizeSensitiveValue()`
  (`apps/api/src/modules/security/synthetic-data.util.ts`) replace `-- ENCRYPT` field
  values with same-shape random data, for seeding Dev/Test/UAT without real PII.
  `.env.uat.example` + docker-compose's `db-uat` service give UAT its own local
  database, separate from `db`/`db-test`.

## Logging (Part 10.3/10.4)

`apps/api` uses **pino** (`nestjs-pino`) for structured operational logs — request
traces, debug output, error stacks. Config is one pure, unit-tested function,
`buildLoggerParams()` in `apps/api/src/common/logging/logger.options.ts`
(wired by `LoggingModule`, and `app.useLogger()` in `main.ts` so every
`@nestjs/common` `Logger` call routes through it too).

- **This is not the audit trail.** The immutable business `AuditLogEntry`
  (`apps/api/src/modules/audit`, Postgres, DB-level immutability trigger) is the
  legal/compliance record. These logs are for engineering incident triage.
- **Bodies are never logged.** The custom `req`/`res` serializers emit only
  `id` / `method` / `url` / `remoteAddress` / `user-agent` and `statusCode` — no
  headers, no request/response body, ever. On top of that, `redact` scrubs
  `Authorization`/`Cookie` and known secret/national-ID/contact-field keys to
  `[redacted]`. This is the mandatory `ibms-brain/meta/lex/sensitive-data-handling.md`
  rule ("a logging pipeline is exactly such an unencrypted, wide-retention,
  wide-access channel").
- **Correlation.** Every request gets an `x-request-id` (reused from the inbound
  header if present, else generated) echoed on the response and attached to every
  log line for that request, plus `userId` (id only, never email) once
  authenticated. `/health*` probes are not logged.
- **Where it goes.** Console only in local dev (pretty-printed). `NODE_ENV=production`
  — or `LOG_TO_FILE=true` anywhere — also writes daily-rolling JSON to
  `LOG_DIR` (default `<repo>/logs`): `api.<date>.<n>.log` (all levels, ~14 kept)
  and `api-error.<date>.<n>.log` (errors, ~30 kept). `LOG_LEVEL` (default
  `debug` dev / `info` prod) sets the floor. Under vitest the logger is forced
  silent with no transports or files. See `logs/README.md`.

## Scope status

The engineering backlog spans **Part A** (security & cross-cutting infra), **Part B**
(database), **Part C** (74 business processes across Domains A–H), and **Parts D–G**
(PDPL / M-series, dashboards, bilingual UI, a final verification checklist). Where the
build actually is today:

- **Part A & Part B — in place.** Deferred edges (hardware-token/WebAuthn MFA
  enforcement, an SSO identity provider, an email/notification provider,
  encryption-at-rest, a real KMS/HSM, load-test-driven performance indexes, independent
  penetration testing) are each documented under § Known gaps and mostly wait on a
  deployment-target decision.
- **Part C — Domain A, Processes 1–10 — built and verified** (unit + e2e +
  Playwright/axe green). Per-process detail below.
- **Part C — Domain B is complete: RFQ / Market Submission (#11) + Market Placement (#12) +
  Quotation Management (#13) + Quote Comparison (#14) + Negotiation (#15) + Broker
  Recommendation (#16) + Client Decision Handling (#17) + Policy Placement & Issuance
  (#18–19) + Policy Checking / Quality Control (#20) + Policy Delivery (#21) + Endorsement
  Management (#22) — built and verified. Domain C (Claims) is underway —
  Processes 23–30 (Notification → Registration → Documentation → Assessment →
  Follow-up → Settlement → Closure → Analytics) are built.** A minimal
  `Opportunity` parent (created from
  a FINALIZED `InsuranceProgram`) plus `RFQ` / `RFQInsurer` — one RFQ per insurance line, an
  insurer shortlist, per-insurer response tracking, a nightly business-day follow-up sweep
  (alerts *and* auto-advances a silent insurer to `NO_RESPONSE`), a broker↔insurer
  correspondence log on each RFQ (the widened `CommunicationLog`), each insurer's
  `Quotation` captured against an RFQ line and versioned on every negotiation round
  (`previousVersionId` / `isCurrentVersion`, the old version never overwritten — and, from
  #15, "never deleted or replaced" is enforced by a DB immutability trigger, with each round
  carrying the broker's rationale + a premium delta), a `ComparisonMatrix` (re)built from
  every current-version quotation — price alongside coverage / exclusions / deductibles /
  limits / optional quality & service scores, with the shortlisted insurers that didn't
  quote flagged — and a `Recommendation` with a six-factor documented rationale, gated on a
  senior-officer approval above the Opportunity's configurable `targetPremiumThreshold`
  (maker/checker) and on a mandatory conflict-of-interest disclosure whenever the pick
  earns materially more commission than a comparable competing quote, both before it can be
  sent to the client. Once sent, a single `ClientDecision` is recorded (one of six types)
  and routes the Opportunity down one of three paths — Accept → placement, Reject → close
  the request, any &ldquo;request&rdquo; → renewed negotiation. On an Accept, a `Policy`
  is created from the accepted recommendation's quotation (inception date set at
  placement) and, once the insurer issues, its number / issued premium / coverage
  `PolicySchedule` / electronic-file `Document`s are recorded and the `Policy` moves
  `PLACEMENT_CONFIRMED → ISSUED` through the workflow engine. An issued policy is then
  put through the mandatory maker/checker **Policy Checking** — a Policy Checking Officer
  (never the officer who placed *or* issued it) runs a line-by-line comparison of the
  requested coverage against the issued schedule; a discrepancy drives the `Policy` to
  `DISCREPANCY` (structurally blocking Delivery) and auto-logs a
  `ProfessionalIndemnityRiskEvent`, a clean check drives it to `VERIFIED`. A verified
  policy is then **delivered** (a `DeliveryRecord` with method / recipient / date moves it
  `VERIFIED → DELIVERED`) and, once the client acknowledges receipt, moves
  `DELIVERED → ACTIVE`. On an active policy, a mid-term **endorsement** (positive or
  negative) or a **cancellation** can be raised: the signed premium adjustment is
  calculated, a negative one auto-creates the commission reversal tied 1:1 to it plus a
  maker/checker-gated `Refund` above a configurable value threshold, and applying it opens
  a new `PolicySchedule` version (the prior one closed, never overwritten) — a cancellation
  also drives the `Policy` to `CANCELLED`. A reported loss is then recorded against a
  policy as a `Claim` at `NOTIFIED` (loss date / location / cause, the estimated loss,
  third-party involvement with the third party's contact details field-level encrypted) —
  validated against the coverage schedule **in force on the exact loss date** (resolved
  against every `PolicySchedule` version window, i.e. the endorsement history, not the
  current schedule), and every read of the Highly Confidential claim is audit-logged.
  Claims are built through Analytics (#30). **Domain D (Finance) has begun — Premium
  Billing (#31) + Collection (#32)**: `POST /invoices` raises the one new-business
  premium `Invoice` per policy (premium carried from `Policy.issuedPremium`, commission
  auto-derived from the placed quotation's rate, tax + fees supplied by Finance,
  `totalAmount` always `premium + tax + fees − commission` computed server-side; a
  partial `UNIQUE` keeps it to one per policy), then `POST /invoices/:id/receipt` →
  `/reconcile` → `/remittance` walk it `INVOICED → COLLECTED → RECONCILED → REMITTED`
  through the workflow engine — the client's exact-amount receipt, a live reconciliation
  to the invoiced total, and a server-computed `premium − commission` remittance to the
  insurer, booking an `in` / `out` `ClientFundsLedgerEntry` at each money movement (Part
  7.3). Detail below.
- **Everything else — not started.** Schema models (`packages/db/prisma/schema.prisma`,
  103 models) exist for all of it; there is no application code, no API, and no UI.

### Part C · Domain A #1–10 — built, with these deferrals

| # | Process | Built | Not done (detail in § Known gaps) |
|---|---|---|---|
| 1 | Lead Management | create · list/filter · `LeadStatus` transitions · intake + pipeline board | no reassignment; `Lead.marketingConsentGranted` is a bare boolean, not an SLA-timed `ConsentRecord`; no Lead-response SLA timer |
| 2 | Prospect Management | Lead→Prospect conversion · full qualification profile · profile screen | `Prospect.status` has no workflow-engine transitions; no reassignment |
| 3–4 | Customer Acquisition / Onboarding | individual + corporate forms · KYC lifecycle · UBO capture · sanctions/PEP/AML screening · EDD path · maker/checker approval gate · periodic re-KYC schedule · onboarding wizard + Compliance queue | **screening is simulated against a fictional fixture watchlist — no real sanctions/PEP/AML data provider**; the KYC/EDD review SLA durations and the re-KYC cadence are **unsourced draft figures** (`/brain-gap` filed); a batch/sweep HIT sets `escalatedToComplianceAt` but does **not** auto-suspend the Customer or force a status move; no dedicated "re-screening hits" list beyond the per-KYCRecord queue view; hardware-token MFA (A.1) is not enforced for the privileged approvers |
| 5 | Needs Assessment | fixed questionnaire · deterministic answers→coverage-list derivation · review + approval gate · minimal `RiskProfile` parent | derived coverage list is not manually curatable; the questionnaire is not runtime-configurable; no reassignment; the `APPROVED → Opportunity/RFQ` link is Process 11+ |
| 6 | Risk Assessment | per-site asset survey (building/equipment/stock/annual-profit/fleet) · deterministic Sum Insured + indemnity-period derivation · multi-site consolidation | no per-asset revision history (a `PATCH` replaces in place) — assembling the survey into an `InsuranceProgram` is Process 7, **now built (row 7)** |
| 7 | Product Recommendation / Program Design | deterministic assembly of a multi-line `InsuranceProgram` from an APPROVED Needs Assessment's coverage list + the Risk Profile's derived Sum Insured · `InsuranceProgramStatus` DRAFT → FINALIZED (reopen) through the workflow engine (16th entity) · re-assemble in place while DRAFT · per-customer list + detail screen | one `InsuranceProgram` per `RiskProfile` (schema has no program↔multi-`RiskProfile` join — a multi-site client's cross-site roll-up stays the `GET /risk-profiles/consolidated` view, for a human to reference); only Property All Risks + Business Interruption get an asset-derived `sumInsuredBasis`, every other line is `null` (set at RFQ/quotation, Process 11+); no manual line curation; `SUPERSEDED` is modeled but no endpoint triggers it; the `FINALIZED → Opportunity/RFQ` link is Process 11+; `program.assemble` is role-level (no per-officer queue), no maker/checker (the coverage set was maker/checker-approved at #5) |
| 8 | Cross-Selling | nightly `@Cron` sweep + on-demand `POST /cross-sell-opportunities/detect` compare a customer's in-force `Policy` lines against a benchmark line list and flag the gaps as `CrossSellOpportunity` · `CrossSellStatus` OPEN → CONVERTED\|DISMISSED through the workflow engine (17th entity) · per-customer list + detail screen with inline convert/dismiss | **the Policy module (Domain B) is not built, so `Policy` is empty everywhere and the job is a correct no-op until real policies exist**; `BENCHMARK_LINES` is one conservative global list, not a per-sector table (no sector taxonomy on `Customer`); only customers with ≥1 `ACTIVE` policy are scanned; a resolved (converted/dismissed) gap is never re-flagged (no re-open endpoint); the `CONVERTED → Opportunity/RFQ` link is Process 11+; no maker/checker (acting on a system nudge is single-actor); no per-officer queue; no reassignment |
| 9 | Up-Selling | nightly `@Cron` sweep + on-demand `POST /up-sell-recommendations/detect` compare a customer's designed property Sum Insured (Σ the "Property All Risks" line of their live `InsuranceProgram`, #7) against the current value of their surveyed assets (`deriveSumInsured`, #6) and raise an `UpSellRecommendation` when the shortfall clears a drafted 10% threshold · `UpSellStatus` OPEN → CONVERTED\|DISMISSED through the workflow engine (18th entity) · **partial** `UNIQUE` (one OPEN per customer, so a resolved one can re-flag once assets grow) · per-customer list + detail screen with the two figures + inline convert/dismiss | comparison is **property/asset value only** — a BI up-sell on profit growth is out of scope; `currentSumInsured` comes from the designed `InsuranceProgram` line, not an in-force `Policy` (Domain B not built) — the two converge once `reassemble` runs, so the job catches a survey that grew without a re-assembly/endorsement; the 10% threshold is a drafted default (no sourced underwriting figure); a resolved recommendation is not re-raised until assets grow past the last flagged value (a pre-check heuristic); the `CONVERTED → endorsement/re-quote` link is Process 22 / 11+; no maker/checker; no per-officer queue; no reassignment |
| 10 | Relationship Management / CRM | `POST/GET /customers/:id/interactions` log & list every touchpoint (`InteractionChannel` — meeting/call/email/WhatsApp/visit/proposal/renewal/claim/complaint/portal/SMS/other) · `GET /customers/:id/360-view` aggregates interactions + policies + claims + complaints into one pure, deterministic reverse-chronological timeline (`buildCustomerTimeline`) · customer-timeline screen + nav item + customer-profile section | **Policy/Claim/Complaint modules (Domains B/C/E) are not built, so those three collections are always empty and the timeline is interactions-only** — same "built ahead of its data source" shape as #8; `Interaction` carries no workflow status (not a `WorkflowTransitionService` entity) and no maker/checker (a factual log); logging is gated by `interaction.log` alone (not customer ownership — cross-functional staff log against customers they don't own), reads by the `customer.360-view.read` visibility rule; no edit/delete of a logged interaction; the claim projection is ids/status/dates only (HIGHLY_CONFIDENTIAL — no `causeOfLoss`/`lossLocation`/money), and the 360° read is audit-logged (`READ`, `isSensitiveDataAccess` when a claim is present); no `CommunicationLog`/`ConsentRecord` link (Process 44 / Part D); no pagination on the interaction list |

### Part C · Domain B #11–22 — built, with these deferrals

| # | Process | Built | Not done (detail in § Known gaps) |
|---|---|---|---|
| 11 | RFQ / Market Submission | minimal `Opportunity` parent — `POST /opportunities` (`{ insuranceProgramId }`) creates a `NEEDS_CONFIRMED` Opportunity from a **FINALIZED** `InsuranceProgram`, `customerId` resolved server-side · `GET /opportunities?customerId=` + `/:id` · `POST /rfqs` (one RFQ per `insuranceLine`, a SENT `RFQInsurer` per shortlisted insurer, `followUpThresholdDays` override) — the first RFQ drives `Opportunity` `NEEDS_CONFIRMED → RFQ_ISSUED` through the workflow engine · `GET /rfqs/selectable-insurers` (read-only `Insurer` master data) · `GET /rfqs?opportunityId=\|customerId=` + `/:id` · `POST /rfqs/:id/insurers` (broaden the shortlist) · `POST /rfq-insurers/:id/transition` (VIEWED/QUOTED/DECLINED/NO_RESPONSE via the workflow engine; QUOTED/DECLINED stamp `respondedAt`) · nightly `@Cron('0 6 * * *')` follow-up sweep (see #12 for its behaviour) · `@@unique([opportunityId, insuranceLine])` + partial `UNIQUE` `Opportunity(insuranceProgramId) WHERE status <> 'CLOSED_LOST'` (`race-safe-invariants.md`) · web: opportunities + RFQ list/detail/new, per-insurer status control, "Take to market" on a FINALIZED programme, one nav item | **full Opportunity lifecycle is #16–17** — no Recommendation, no Client Decision (6 outcomes), no renegotiation, no close-lost endpoint, no `targetPremiumThreshold`; new-business Opportunities with no `InsuranceProgram` are not supported (a FINALIZED programme is the only entry point); the business-day threshold is a **lower bound** (no Jordanian public-holiday calendar exists — `ibms-brain/meta/context/business-day-calendar.md`); one RFQ per `(opportunity, line)` — re-marketing a line needs a deliberate relaxation (#17); `Insurer` master data is read-only (a real Insurer-management module is narrative Process 31); no maker/checker (issuing an RFQ is single-actor Placement work); `rfq.create` / `opportunity.create` are role-level (no per-officer queue); `Recommendation` (#16) is not built |
| 12 | Market Placement | `CommunicationLog` **widened** (not a new model) to carry broker↔insurer RFQ correspondence alongside its Process-44 role — nullable `customerId`/`languageUsed`, new `direction CommunicationDirection @default(OUTBOUND)` (enum `INBOUND\|OUTBOUND`), `rfqId?`/`rfqInsurerId?` FKs, `subject?`/`body?`/`loggedByUserId?`/`createdAt` (migration `20260829120000`) · `POST /rfqs/:id/communications` (`{ direction, channel, body, subject?, rfqInsurerId?, occurredAt? }`, new perm `rfq.communication.log`/Placement — `rfqInsurerId` must be on the RFQ; `occurredAt` offset-required + not-future) + `GET /rfqs/:id/communications` (`rfq.read`) — factual log, no status/maker-checker, CREATE audit is **metadata only, never `body`** (Confidential) · the nightly follow-up sweep now also **auto-advances** `SENT`/`VIEWED → NO_RESPONSE` through the workflow engine once past the business-day threshold (race-safe: a concurrent manual QUOTED/DECLINED → no-op, counted `transitionSkipped`) · shared `parseHistoricalInstant` (`common/historical-instant.util.ts`) reused by CRM + RFQ · web: a "Correspondence" section on the RFQ detail screen (list + Placement-only log form) | no attachment upload for "additional information" (free-text note only — a Document-module concern); no per-insurer thread view / pagination on the correspondence list; a placement row leaves `respectedConsent`/`languageUsed`/`templateId` unused; auto-`NO_RESPONSE` inherits the same business-day **lower bound**; Process 44 (outbound customer communication) itself is unbuilt and will share the widened table |
| 13 | Quotation Management | `POST /quotations` (`{ rfqId, insurerId, premium, currency?, deductible?, limits?, biPeriodMonths?, liabilityLimit?, exclusions?, conditions?, commissionRatePercent? }`, `quotation.capture`/Placement) captures an insurer's quote as a version-1 `Quotation` — the insurer must be on the RFQ's shortlist and not `DECLINED`, and must not already have a current quotation (409 → revise) · `POST /quotations/:id/revise` (`quotation.negotiate`/Placement) records a renegotiation round as a NEW version linked by `previousVersionId`, flipping `isCurrentVersion` — the old row is kept verbatim · `GET /quotations?rfqId=\|opportunityId=\|customerId=` + `/:id` (`quotation.read` — new seeded perm, Sales/Placement/Manager/Exec) return per-insurer version chains · every monetary field is fils-quantized through `money.util.ts` (`normalizeQuotationTerms`, pure) · partial `UNIQUE` `Quotation(rfqId, insurerId) WHERE isCurrentVersion` + the existing `previousVersionId @unique` are the race backstops (`race-safe-invariants.md`) · a successful capture / revise **best-effort** advances the matching `RFQInsurer → QUOTED` (stamping `respondedAt`) and the `Opportunity RFQ_ISSUED → QUOTES_RECEIVED` through the workflow engine (logged, never thrown) · web: a "Quotations" section on the RFQ detail screen (per-insurer chain cards + version history + a Placement-only capture / revise form) | `Quotation` is **not** a `WorkflowTransitionService` entity (`isCurrentVersion` is a boolean, not a status) and has no maker/checker (capturing what an insurer sent is a factual single-actor record); `limits` is stored as opaque JSON — its internal shape is not validated; `commissionRatePercent` is captured verbatim, not applied (Finance, #31+); the best-effort workflow advances are **not authoritative** — derive "this insurer has quoted" from the `Quotation` table, not `RFQInsurer.status`; no `Recommendation` (#16) consuming these quotes yet; the `apps/api` e2e gap carried from #11–12 is **closed for this module at #15** (`test/quotation.e2e-spec.ts` drives the real capture / revise path + the immutability trigger); the `revise` two writes run in one Prisma `$transaction` (`reviseChain`) — a deliberate local exception to this codebase's no-`$transaction` convention, since a crash between the predecessor-clear and the successor-insert would otherwise leave the chain headless; the nightly RFQ follow-up sweep (#12) now **drops any open submission whose `(rfqId, insurerId)` already has a current `Quotation`** (`RfqRepository.findCurrentQuotationKeys` → `FollowUpScanResult.skippedQuoted`) — an insurer that quoted is not "silent" even if its best-effort `→ QUOTED` move failed (`/brain-gap` filed + solved, `ibms-brain/meta/context/policy-lifecycle.md`) |
| 14 | Quote Comparison | `POST /comparison-matrices` (`{ rfqId, scores?: [{ insurerId, insurerQualityScore?, serviceScore? }] }`, `comparison.build`/Placement) **(re)builds** the one `ComparisonMatrix` per RFQ from every **current-version** `Quotation` on it — one `ComparisonMatrixRow` each (the objective dimensions — premium / deductible / `limits` / BI period / liability limit / exclusions / conditions / commission rate — live on the linked `Quotation`, so the matrix is **never price alone**, `policy-lifecycle.md` § controls) · shortlisted insurers with no quote in the matrix are flagged — the `missing` / `declined` buckets are **recomputed live on every read** from the current shortlist (so they stay disjoint after a post-build status change); `ComparisonMatrix.missingInsurers` stores the build-time snapshot for the audit counts only · optional per-insurer `insurerQualityScore` / `serviceScore` (0–100, 2dp) — Placement's judgement, there is no Insurer-scoring module (Process 61) · `GET /comparison-matrices?rfqId=` + `/:id` (`comparison.read` — **new seeded perm**, Sales/Placement/Manager/Exec) · a build **best-effort** advances `Opportunity QUOTES_RECEIVED → COMPARISON_BUILT` through the workflow engine (logged, never thrown) · upsert-matrix + replace-rows run in one Prisma `$transaction` (`ComparisonRepository.buildOrRebuild`, which also reports created-vs-rebuilt for the audit action); `@@unique([comparisonMatrixId, quotationId])` backstops a doubled row (`race-safe-invariants.md`) · migration `20260901160000` adds `ComparisonMatrix.builtByUserId` + the FK/filter indexes + that `@@unique` · web: a "Comparison" section on the RFQ detail screen (a wide scrollable table + missing / declined callouts + a "· superseded" marker on a row whose quote was revised since the build + a Placement-only build / rebuild control with an optional score grid) | `ComparisonMatrix` is **not** a `WorkflowTransitionService` entity (no status) and has no maker/checker (a derived artefact — the gate sits downstream at the Recommendation, #16); the two subjective scores are manual free inputs (no Insurer-scoring module — Process 61) and `Insurer.financialStrengthRating` is not mapped in; a row's **quote terms** can go stale (a `Quotation` revised since the build — `builtAt` and the row's `quotation.isCurrentVersion` / "superseded" marker signal it; rebuild to refresh); rows carry no computed ranking / "best value" (that reasoning is the Recommendation, #16 — and row order is deliberately by insurer, not by premium); no `apps/api` e2e (carried from #11–13); `comparison.build` is role-level (no per-officer queue) |
| 15 | Negotiation | the negotiation mechanism is `POST /quotations/:id/revise` from #13 — a round is a NEW `Quotation` version (`versionNumber+1`, linked by `previousVersionId`, `isCurrentVersion` flipped, the predecessor kept verbatim) · #15 makes **"never deleted or replaced" a real DB-layer guarantee**: migration `20260901180000` adds `negotiationNotes TEXT` + a trigger (`prevent_quotation_version_mutation`, same pattern as the `AuditLogEntry` immutability trigger) that rejects any `DELETE` of a `Quotation` row, any `UPDATE` of an already-superseded version, and any `UPDATE` of a live version that changes anything other than `isCurrentVersion` true→false (the supersede flip — asserted column-by-column via `to_jsonb(NEW) - 'isCurrentVersion' IS DISTINCT FROM to_jsonb(OLD) - 'isCurrentVersion'`) · a revise round now carries the broker's optional `negotiationNotes` (the rationale — what was asked / conceded; Confidential, audited as a `hasNegotiationNotes` boolean only) · every quotation read returns a pure `history: NegotiationRound[]` projection (`buildNegotiationHistory`) — round 0 is the opening quote, each later round is diffed against the version its `previousVersionId` names and carries `premiumDeltaFromPrevious` (fils-quantized via `money.util.ts`, sign preserved, `null` when the round changed `currency`) + `changedTermFields` + that round's notes · web: the "Quotations" version-history table gains Round / Δ premium / Terms-changed columns + the round rationale, and the revise form gains a "Negotiation notes" field | `Quotation` is still **not** a `WorkflowTransitionService` entity and has no maker/checker (recording a negotiated term set is a factual single-actor Placement record; the approval gate is the Broker Recommendation, #16); no structured "negotiation ask vs. counter" model — `negotiationNotes` is one free-text field per round; the DB trigger's documented residual risk is identical to the `AuditLogEntry` trigger's (a session on the shared `ibms` Postgres role can still `SET session_replication_role = replica` — a least-privilege app role is a separate infra change); a data fix or PDPL Correction DSR touching a historical version now requires that privileged bypass (same posture as `AuditLogEntry`); `changedTermFields` treats a `limits` JSON key reorder as a change (stringify compare, a display aid not a semantic diff) |
| 16 | Broker Recommendation | **new module** `apps/api/src/modules/recommendation/` · `POST /recommendations` (`{ opportunityId, recommendedQuotationId, rationale, rationaleFactors }`, `recommendation.draft`/Placement) — one `Recommendation` per Opportunity (`opportunityId @unique`), pointing at one **current-version** `Quotation` on one of its RFQs; the Opportunity must be at `COMPARISON_BUILT`; `rationaleFactors` requires a non-empty note for **all six** dimensions (coverage / price / financial strength / claims service / deductible / policy conditions — "never price alone") · two gate flags snapshot at draft: `approvalRequired` (recommended premium > the Opportunity's `targetPremiumThreshold`) and `conflictOfInterestFlagged` (`detectConflictOfInterest`, pure — a competing current-version quote priced within a **drafted, unsourced** 10% band carries a commission rate at least a **drafted, unsourced** 2 percentage points lower) · `PATCH /opportunities/:id/target-premium-threshold` (`opportunity.set-target-threshold`/**Manager, Exec** — new perm) sets/clears the configurable threshold · `POST /recommendations/:id/approve` (`recommendation.approve`/**Manager**) — only when `approvalRequired`, **maker/checker**: `assertDifferentActors(draftedByUserId, actor)` + the existing `Recommendation_maker_checker_distinct` CHECK; a status-conditional `updateMany` stamps `approvedByUserId`/`approvedAt` (0 rows → 409) · `POST /recommendations/:id/conflict-of-interest-disclosure` (`conflict-of-interest.disclose`/Placement, Compliance) — only when flagged, acknowledger ≠ drafter, one per recommendation · `POST /recommendations/:id/send` (`recommendation.send`/**Placement** — new perm) — 422 while a required approval or COI disclosure is outstanding, else stamps `sentToClientAt` and best-effort advances `Opportunity RECOMMENDATION_DRAFTED → SENT_TO_CLIENT` · `GET /recommendations?opportunityId=\|customerId=` + `/:id` (`recommendation.read` — new perm, Sales/Placement/Manager/Exec) return the recommendation + its quotation + the COI disclosure + a computed `blockedFromSend` list · a successful draft best-effort advances `Opportunity COMPARISON_BUILT → RECOMMENDATION_DRAFTED` · migration `20260901200000` adds `Recommendation.rationaleFactors`/`approvalRequired`/`conflictOfInterestFlagged`/`coiCompetingQuotationId`/`coiCommissionDiffPercent`/`sentByUserId` + FK/filter indexes · web: a "Broker recommendation" section on the Opportunity detail screen (Manager-only threshold control, Placement-only draft form, Manager-only Approve, Placement/Compliance COI disclosure form, Send with the block reasons listed) | `Recommendation` is **not** a `WorkflowTransitionService` entity (no `status` column — its lifecycle is nullable timestamps; the parent `Opportunity` carries the same progression through the engine); one recommendation per Opportunity pointing at **one** quote — a multi-line programme's per-line recommendation is a deferred edge (schema constraint, like #7's one-programme-per-`RiskProfile`); the **10% comparable-premium band** and **2 pp material-commission** figures are `ibms-app` product decisions, drafted, **unsourced** — `/brain-gap` candidates; the COI check can only assess quotes that captured a `commissionRatePercent` at #13 (no rate → not flagged); `CommissionAgreement.ratePercent` (the governed rate table, Finance) is not consulted — the check uses the per-quote rate; draft requires the Opportunity to be **at** `COMPARISON_BUILT`, which is an adequate proxy for "a comparison was built" but not a hard FK to a `ComparisonMatrix` row; `recommendation.draft` / `.send` are role-level (no per-officer queue); the disclosure records that a disclosure was **made to the client** — the system does not itself send anything to the client |
| 17 | Client Decision Handling | **new module** `apps/api/src/modules/client-decision/` · `POST /client-decisions` (`{ opportunityId, decision, evidenceType, evidenceRef, notes? }`, `client-decision.capture`/Sales, Placement) records the client's **single** decision on a **sent** `Recommendation` — one `ClientDecision` per Opportunity (`opportunityId @unique` → 409); the precondition is `Recommendation.sentToClientAt != null` (authoritative — the Opportunity status can lag a #16 best-effort advance) · the six `ClientDecisionType` values collapse to three routes (`routeFor`, pure): **ACCEPT → PLACEMENT**, **REJECT → CLOSED_LOST**, and the four **REQUEST_\* → RENEGOTIATE** · the route is the parent Opportunity's engine walk `<current> → SENT_TO_CLIENT → CLIENT_DECISION → <route>`, applied **best-effort** (logged, never thrown — the `ClientDecision` row + `routeFor(decision)` is the authoritative record; the response carries `route` / `routeLabel` / `routingComplete`) · `evidenceType` ∈ `signature \| e-signature \| email_confirmation` + a non-empty `evidenceRef` are required (Part 4.1 — a decision of record needs a reference) · `GET /client-decisions?opportunityId=\|customerId=` + `/:id` (`client-decision.read` — **new perm**, Sales/Placement/Manager/Exec) · migration `20260902120000` adds `ClientDecision.notes` + `capturedByUserId` · web: a "Client decision" section on the Opportunity detail screen (Sales/Placement form once a recommendation is sent, read-only after) | `ClientDecision` is **not** a `WorkflowTransitionService` entity (`decision` is a one-shot enum, not a state machine) and has no maker/checker (recording the client's stated decision is a factual, single-actor Sales/Placement act); **one decision per Opportunity** — a RENEGOTIATE loop that produces a *second* client decision is blocked by the `@unique` (schema constraint, same class as #16's one-recommendation-per-Opportunity); the RENEGOTIATE route lands the Opportunity at `RENEGOTIATE` and stops — it does **not** auto-advance to `RFQ_ISSUED` or relax the one-RFQ-per-`(opportunity, line)` constraint (re-marketing a line is still a deferred edge from #11; new quote versions / negotiation rounds via #13/#15 work on the existing RFQ regardless); the routing transitions are best-effort (a partial failure leaves the Opportunity mid-route with `routingComplete: false` and no re-trigger endpoint); `client-decision.capture` is role-level (no per-officer queue); the six decision types are not otherwise differentiated (all four REQUEST_* behave identically beyond the recorded `decision` value + `notes`) |
| 18–19 | Policy Placement & Issuance | **new module** `apps/api/src/modules/policy/` · **`Policy` IS a `WorkflowTransitionService` entity** — `status` moves ONLY through the engine (the first Domain B one); **no maker/checker** here (placing + recording issuance is single-actor Placement work — the mandatory independent check is Process 20 `PolicyChecking`) · `POST /policies` (`{ opportunityId, inceptionDate, expiryDate? }`, `policy.create`/Placement — already seeded) creates the `Policy` at the schema `@default(PLACEMENT_CONFIRMED)` (NOT via the engine — initial creation, like `Opportunity` at `NEEDS_CONFIRMED`); the **authoritative precondition is a `ClientDecision` of `ACCEPT`** (the Opp status can lag #17's best-effort route — 422 otherwise); insurer / insurance line / requested premium / currency come from the accepted `Recommendation.recommendedQuotation`, **not the body**; `opportunityId @unique` → pre-check 409 + `P2002` → 409 · `POST /policies/:id/issuance` (`{ policyNumber, issuedPremium, inceptionDate?, expiryDate?, schedule: { effectiveFrom?, limits, sumsInsured, namedPerils?, extensions? }, documents: [{ category, classification, fileName, storageRef }] }`, `policy.issue`/Placement — already seeded) drives `Policy PLACEMENT_CONFIRMED → ISSUED` through `WorkflowTransitionService.transition` with the issued scalars (`policyNumber` / `issuedPremium` / `issuedByUserId` + optional period corrections) passed as the transition `data` — so the status flip and the scalar write are **one atomic, engine-audited write** (its status-conditional `updateMany` is the race gate — 0 rows → 409); then `PolicyRepository.createIssuanceArtifacts` writes the opening `PolicySchedule` + the insurer-issued `Document` rows in **one Prisma `$transaction`** (local exception, like `QuotationRepository.reviseChain`) · a **crash-recovery re-entry branch** completes a partially-done issuance (status already `ISSUED`, no open schedule, payload byte-matches `policyNumber` + `compareMoney(issuedPremium)`) without re-transitioning and with no `UPDATE Policy` audit row; any other state / mismatched payload → 422 "issuance is recorded once" · `POST /policies/:id/documents` (`document.manage` — existing perm) appends `Document` rows to the electronic Insurance File (Part 4.2) at any lifecycle stage · `GET /policies?opportunityId=\|customerId=` + `/:id` (`policy.read` — **new seeded perm**, Sales/Placement/Manager/Exec) — the view carries `premiumVariance` (signed `subtractMoney(issued, requested)`, `null` until issued) + `issuanceComplete` · migration `20260902140000` adds `Policy.placedByUserId` / `Policy.issuedByUserId` (TEXT provenance scalars) + a **partial `UNIQUE`** `PolicySchedule_one_open_per_policy` (`effectiveTo IS NULL`) — raw SQL, Prisma can't express it (`race-safe-invariants.md`) · audit snapshots are **metadata not body**: schedule snapshot = coverage-key *names* + counts (never the figures), document snapshot **excludes `fileName` + `storageRef`** (a health-cert filename can name insured persons — HIGHLY_CONFIDENTIAL; `storageRef` is an internal object key) · web: a "Policy" section on the Opportunity detail screen (Placement place form once the Opp is at `PLACEMENT`, an issuance form — policy number / issued premium / limits+sums JSON / perils+extensions / repeatable document rows — then the issued policy + schedule + documents, with a post-issuance "attach a document" control) | `Policy` creation takes the schema `@default` status without the engine (initial creation, matches `Opportunity`/`RFQ`); the **transition-then-artefacts ordering** has one seam — if the schedule/documents `$transaction` fails after the status flip committed, the `Policy` is `ISSUED` with no schedule (recoverable via the re-entry branch; a hard crash *between* the engine's `updateMany` and its own audit write would additionally leave the TRANSITION row unwritten — bounded, rare, separately alarmed); `limits` / `sumsInsured` are stored opaquely (a non-empty flat object of string/number values — no per-figure `Decimal(18,3)` precision until a consumer does arithmetic on them, e.g. a Claim resolving "coverage in force at the loss date"); a `CoverNote` / binder interim state (Process 18) is modeled in the schema but has no endpoint; one `Policy` per Opportunity; `policy.create` / `policy.issue` are role-level (no per-officer queue); no `Endorsement`-driven schedule versioning (#22) — the partial `UNIQUE` is in place for it |
| 20 | Policy Checking / Quality Control | **no migration** — `PolicyChecking`, the `PolicyChecking_maker_checker_distinct` CHECK (migration `20260826091424`, `checkedByUserId <> placedByUserId`), `ProfessionalIndemnityRiskEvent`, the `policy.check` perm, and the `ISSUED → CHECKING_IN_PROGRESS → DISCREPANCY \| VERIFIED` / `DISCREPANCY → CHECKING_IN_PROGRESS` map all already existed · `POST /policies/:id/checking` (`{ requestedCoverage: { limits, sumsInsured, namedPerils?, extensions? } }`, `policy.check`/**Policy Checking Officer**) — `diffCoverage` (pure) does a **line-by-line comparison** of the checker's transcribed Requested Coverage vs the current open `PolicySchedule` over exactly the four backlog dimensions: `limits` / `sumsInsured` per-key (money-equal via `compareMoney` so `"5000000"` == `"5000000.000"`, else a **case / whitespace-normalised** compare so a `"Fire"`/`"fire"` transcription is not a discrepancy), `namedPerils` / `extensions` as `missing` / `extra` set diffs · `discrepancyFound` is **derived**, never caller-asserted · **maker/checker**: `assertDifferentActors(placedByUserId, actor)` (app) + the DB CHECK (structural), **and** `assertDifferentActors(issuedByUserId, actor)` app-side — stricter than the lex row, which maps only the placer (`/brain-gap` filed) · 422 if `placedByUserId` is null · on a discrepancy: `PolicyChecking.discrepancyFound = true` + a linked `ProfessionalIndemnityRiskEvent` created **in the same `$transaction`** as the checking `upsert` (a discrepancy is recorded ⟺ a PI event exists); a re-check with the **same** detail does not double-log, one with a **materially changed** detail refreshes the existing PI event's `description` · the `Policy` is then walked `(ISSUED \| DISCREPANCY) → CHECKING_IN_PROGRESS → (VERIFIED \| DISCREPANCY)` through the engine — best-effort for a clean `VERIFIED` outcome, but an **unappliable `DISCREPANCY` outcome is a hard 409** (a concurrent divergent check verified the policy first — otherwise Delivery would be silently unblocked) · **Delivery is blocked structurally** — the `WORKFLOW_TRANSITIONS.Policy` map has no `DISCREPANCY → DELIVERED` edge, so #20 only needs to reach `DISCREPANCY` · `checking` (+ `checkingComplete`) folded into `PolicyView` · `POLICY_CHECKING_OFFICER` added to `policy.read` (seed, additive) + to the shared `POLICY_CROSS_OWNER_ROLES` (visibility) · web: the "Policy" section gains a checker-only QC form + the discrepancy / PI-event-logged display | `PolicyChecking` is **not** a `WorkflowTransitionService` entity (no `status` — its lifecycle is the parent `Policy`'s status); "Requested Coverage" is **transcribed by the checker** into the request body (there is no separately-stored requested schedule) — a corrected re-check by the same checker, or the insurer re-issuing a corrected `PolicySchedule` (which needs #22 `Endorsement`, not built), are the only exits from `DISCREPANCY`; the `complianceOverrideByUserId` column is surfaced in the view but no endpoint sets it (a discrepancy override is deferred — clearing a `DISCREPANCY` is currently single-actor); two officers checking one policy near-simultaneously with divergent transcriptions can still race on `PolicyChecking.discrepancyFound` itself (`policyId @unique` serialises the row, `P2002` → 409, but not the *value*) — per-policy serialisation of the check would close it (`/brain-gap` filed); the audit snapshot withholds the `checklistResult` / `discrepancyDetail` (coverage figures) but the PI event `description` carries them by design (Process 54); `policy.check` is role-level (no per-officer queue) |
| 21 | Policy Delivery | **no migration** — the `DeliveryRecord` model (`policyId @unique`, `deliveredAt`, `method`, `recipient`, `receiptAcknowledgedAt`), the `policy.deliver` perm (`[SALES, PLACEMENT]`), and the `VERIFIED → DELIVERED → ACTIVE` map all already existed · new `PolicyDeliveryService` + `PolicyDeliveryRepository` in the `policy` module · `POST /policies/:id/delivery` (`{ method ∈ email \| portal \| courier \| in_person, recipient, deliveredAt? }`, `policy.deliver`) drives `Policy VERIFIED → DELIVERED` through `WorkflowTransitionService.transition` (its status-conditional `updateMany` is the race gate — a concurrent delivery → `409`; an "already in status DELIVERED" engine rejection is **normalised to the same 409** so the loser's status code is deterministic), then creates the one `DeliveryRecord` (`policyId @unique` → `P2002` → `409`) · a **crash-recovery re-entry branch** (status already `DELIVERED`, no `DeliveryRecord`) creates the missing record without re-transitioning · `POST /policies/:id/delivery/acknowledge-receipt` (`{ acknowledgedAt? }`, `policy.deliver`) stamps `DeliveryRecord.receiptAcknowledgedAt` via a status-conditional `updateMany` (double-ack → `409`) and **best-effort** advances `Policy DELIVERED → ACTIVE` (logged, never thrown — the stamp is the authoritative "client confirmed" record, and `ACTIVE` is *not* a safety gate the way `DISCREPANCY` is, so failing to reach it leaves the policy in the *more* restrictive `DELIVERED` state; a resume branch does just the `ACTIVE` advance when the stamp already committed) · `deliveredAt` / `acknowledgedAt` are parsed with `parseHistoricalInstant` (past-only, an explicit offset required on datetimes); `422` if `acknowledgedAt < deliveredAt` · `DeliveryRecord` is **not** a `WorkflowTransitionService` entity (no `status`) · audit `CREATE` / `UPDATE DeliveryRecord` carries `method` / `recipient` / `deliveredAt` (delivery is an accountability record) · `delivery` (+ `deliveryComplete` = `receiptAcknowledgedAt` set) folded into `PolicyView` · **refactor**: `PolicyService.loadVisible` promoted to **public** so `PolicyCheckingService` + `PolicyDeliveryService` share one visibility path — `PolicyCheckingService` drops its own copy + its `CustomerRepository` dependency · web: the "Policy" section gains a Sales/Placement delivery form + an "Acknowledge receipt" button + a read-only display | `DeliveryRecord` has no `status`; the `DELIVERED → ACTIVE` advance is best-effort (fail-safe — a stuck policy sits in the more restrictive `DELIVERED`, self-heals on the next ack call, and `deliveryComplete` is still true); `ACTIVE` here just means "delivered + client-confirmed" — **premium-collection / inception-date gating of `ACTIVE`** is a Finance concern (#31+) not modelled; delivery is single-actor factual recording (no maker/checker — `maker-checker-segregation.md` § "what does NOT trigger this rule"); `deliveredAt` may be backdated before the policy's own issuance date (bounded only by "not in the future", same latitude as #19/#20's historical instants); `policy.deliver` is role-level (no per-officer queue); no reminder / SLA timer for an unacknowledged delivery (Policy Delivery has no row in `pdpl-sla-timers.md`) |
| 22 | Endorsement Management | **new module** `apps/api/src/modules/endorsement/` (+ `repositories/endorsement.repository.ts`) — `Endorsement` / `Cancellation` / `Refund` / `CommissionReversal` / `PolicySchedule` models + the `Refund_maker_checker_distinct` CHECK (`20260826091424`, `approvedByUserId <> raisedByUserId`) all already existed · **`Endorsement` IS a `WorkflowTransitionService` entity** — `status` moves ONLY through the engine `REQUESTED → SUBMITTED_TO_INSURER → INSURER_CONFIRMED → FINANCIAL_ADJUSTMENT_CALCULATED → (REFUND_APPROVAL_PENDING →) APPLIED → CLIENT_NOTIFIED`; the child `Cancellation` / `Refund` / `CommissionReversal` have **no `status`** (lifecycle = the parent endorsement's), same shape as `PolicyChecking` / `DeliveryRecord` · `POST /policies/:id/endorsements` (`{ type ∈ POSITIVE \| NEGATIVE, changeType, premiumAmount (unsigned), effectiveFrom, targetCoverage? }`, `endorsement.create`/Placement) — Policy must be `ACTIVE` (422); `signedPremiumAdjustment` (pure) signs the fils-quantized amount by `type` (a NEGATIVE endorsement returns premium → negative `premiumAdjustment`) · `POST /policies/:id/cancellation` (`{ reason, basis ∈ short_period \| pro_rata, effectiveFrom }`, `cancellation.create`/Placement) — a NEGATIVE endorsement `changeType: cancellation`; `cancellationReturnPremium` (pure) — `pro_rata` = `issuedPremium × unexpiredDays / totalDays` (via `money.util.ts` `applyPercentage`), `short_period` = **drafted, unsourced** `SHORT_PERIOD_CLIENT_RETURN_PERCENT = '90'`% of the pro-rata figure; the `Endorsement` + its `Cancellation` child created in **one `$transaction`** (local exception) · `POST /endorsements/:id/advance` (`endorsement.create`) walks the two pre-financial hops · `POST /endorsements/:id/calculate-adjustment` (`{ premiumAmount? }` insurer-confirmed override for a non-cancellation, `endorsement.apply`) — for a NEGATIVE endorsement creates the auto-tied `Refund` (maker side) **+** `CommissionReversal` (`|premiumAdjustment| × recommendedQuotation.commissionRatePercent`, `commissionReversalAmount` pure — **never a separate hand calc**, `policy-lifecycle.md`) in **one `$transaction`** (`P2002` → 409), transitions to FINANCIAL_ADJUSTMENT_CALCULATED, then to REFUND_APPROVAL_PENDING iff the refund is `≥` the **drafted, unsourced** `REFUND_APPROVAL_THRESHOLD_JOD = '5000.000'` · `POST /endorsements/:id/apply` (`endorsement.apply`) — FINANCIAL_ADJUSTMENT_CALCULATED → APPLIED; **`applyCore` refuses outright if an at/above-threshold `Refund` is still unapproved — regardless of status** (the maker/checker gate is structural, not just the `REFUND_APPROVAL_PENDING` status, `@code-reviewer` BLOCKER); `PolicyRepository.versionScheduleForEndorsement` closes the open `PolicySchedule` at `effectiveFrom` and opens a **NEW** version (`sourceEndorsementId @unique`, coverage from `targetCoverage` or carried forward) in **one `$transaction`** — the prior version is never overwritten; a **cancellation apply drives `Policy ACTIVE → CANCELLED` and throws a hard 409 if that cannot be applied** (already-`CANCELLED` = success; the endorsement is already APPLIED so a retry of `apply` is re-entrant); 422 while REFUND_APPROVAL_PENDING · `POST /refunds/:id/approve` (`refund.approve`/**Manager or Finance**, already seeded) — **maker/checker** `assertDifferentActors(raisedByUserId, actor)` (403) + the CHECK; status-conditional `recordRefundApproval` (0 rows → 409); on success runs the apply path (→ APPLIED + schedule version) · `POST /endorsements/:id/notify-client` (`endorsement.apply`) — APPLIED → CLIENT_NOTIFIED (+ stamps `Cancellation.clientNotifiedAt`) · `GET /policies/:id/endorsements` + `GET /endorsements/:id` (**new perm `endorsement.read`**/Sales,Placement,Finance,Manager,Exec) · migration `20260902160000` adds `Endorsement.targetCoverage JSONB`, `effectiveFrom` / `submittedToInsurerAt` / `financialAdjustmentCalculatedAt` timestamps, `Endorsement_policyId_idx`; **migration `20260902170000` adds the partial `UNIQUE` `Endorsement_one_live_cancellation_per_policy` (`WHERE changeType='cancellation' AND status<>'CLIENT_NOTIFIED'`, `@code-reviewer` MAJOR — at most one in-flight cancellation per policy)** — no new `Decimal` columns · audit snapshots **metadata not body** (money as fixed strings, `hasReason` boolean, never the `reason` text; a CREATE row per `Endorsement` / `Cancellation` / `Refund` / `CommissionReversal` / `PolicySchedule`) · web: a new "Endorsements" section (`components/policy/EndorsementSection.tsx`) — Placement request/cancellation forms while the Policy is ACTIVE, per-endorsement one-action buttons, Manager "Approve refund" | `SHORT_PERIOD_CLIENT_RETURN_PERCENT` (90%) and `REFUND_APPROVAL_THRESHOLD_JOD` (5,000) are **drafted, unsourced** module constants — no market short-period scale table, no CBJ / Finance approval-matrix source (a real Finance config surface, narrative Process 37/40, does not exist); **filed via `/brain-gap`** (ibms-brain `7b60bbd`), same pattern as #16's drafted 10% / 2 pp bands · `commissionRatePercent` comes from the accepted `Recommendation.recommendedQuotation` — 422 if the quote captured none · the premium-adjustment override at `calculate-adjustment` only applies before FINANCIAL_ADJUSTMENT_CALCULATED and never to a cancellation (a materially different late override is a 422, not a silent no-op) · a below-threshold `Refund` is auto-cleared (`approvalThresholdMatrixLevel = below_threshold_auto`, `approvedByUserId` stays null — no separate approval row) · the parent-`Opportunity` progression is best-effort (the `Endorsement` + its money are authoritative) · `Refund.paidAt` is surfaced but no endpoint stamps it (payment execution is Finance, #37) · a stuck in-flight cancellation permanently blocks re-raising until it is pushed through (no void/withdraw endpoint) · `endorsement.create` / `.apply` / `refund.approve` are role-level (no per-officer queue); no SLA timer on an unapplied endorsement |

### Part C · Domain C #23–30 — built, with these deferrals

| # | Process | Built | Not done (detail in § Known gaps) |
|---|---|---|---|
| 23 | Claim Notification | **new module** `apps/api/src/modules/claim/` (+ `repositories/claim.repository.ts`) — **no migration**: the `Claim` / `ClaimStatusHistory` / `ThirdPartyClaimant` models, the `ClaimStatus` enum, the `WORKFLOW_TRANSITIONS.Claim` map (`NOTIFIED → REGISTERED → …`), every `Decimal` money field (already in `MONEY_DECIMAL_FIELDS`), and `ENCRYPTED_FIELDS.ThirdPartyClaimant = ['contactDetailsEnc']` all already existed · **`Claim` IS a `WorkflowTransitionService` entity**, but #23 only does the INITIAL creation at the schema `@default(NOTIFIED)` — NOT via the engine (same precedent as `Policy` at `PLACEMENT_CONFIRMED`, `Opportunity` at `NEEDS_CONFIRMED`); the `NOTIFIED → REGISTERED` move is #24 · **no maker/checker at notification** (recording a reported loss is single-actor Sales/Claims work — the mandatory second approver is at settlement, Process 28) · `POST /claims` (`{ policyId, lossDate, causeOfLoss, lossLocation?, estimatedLoss, isThirdPartyInvolved?, thirdParty?: { fullName?, contactDetails?, subrogationRecoveryFlag? } }`, `claim.notify`/**Sales or Claims** — already seeded) creates the `Claim`, its opening `ClaimStatusHistory` row (`null → NOTIFIED`, `changedByUserId` = the notifier — there is no `Claim.notifiedByUserId` scalar) and, for a third-party loss, the one `ThirdPartyClaimant` (contact details field-level encrypted via `encryptEntityFields`) — all in **one `$transaction`** (local exception) · **coverage in force AT THE LOSS DATE** (`resolveCoverageAtLossDate`, pure & total) resolves against **every `PolicySchedule` version window `[effectiveFrom, effectiveTo)`** — the materialised endorsement history, NOT the current open schedule — so a loss under a policy endorsed *after* the loss resolves to the (now closed) version that actually applied; `Policy.expiryDate` is an independent upper bound (nothing closes the open row at expiry); an unresolvable loss is a hard **422** on notify, but a non-throwing `coverage: null` + `coverageResolvedAtLossDate: false` on a later read (a #22 forward cancellation can strand a validly-notified mid-term loss) · `estimatedLoss` quantized + must be `> 0`; `isLargeClaim` derived from the **drafted, unsourced** `CLAIM_LARGE_THRESHOLD_JOD = '25000.000'` as an advisory NOTIFICATION-TIME SNAPSHOT (`/brain-gap` filed — ibms-brain `67582ee`; Process 28 must re-derive the second-approver gate from live data) · `GET /claims?policyId=\|customerId=` + `/:id` (**new perm `claim.read`**/Sales,Claims,Manager,Exec) — **every read is audit-logged** (`action: READ`, `isSensitiveDataAccess` when a claim is returned — ids/counts only, never `causeOfLoss` / `lossLocation` / the claimant name; mirrors `CrmService.get360View`), list capped at 200 rows · audit snapshots **metadata not body**: `hasLossLocation` bool + the resolved schedule id/window, never the free text; the third-party snapshot is `hasFullName` / `hasContactDetails` bools + `subrogationRecoveryFlag` only · `CLAIMS_OFFICER` added to `policy.read` (seed, additive — a claims officer needs the underlying policy context) + a new shared `CLAIM_CROSS_OWNER_ROLES` (visibility: Claims/Manager/Exec cross-book, Sales own-customer only) · web: a "Claims" block in the "Policy" section on the Opportunity detail screen (Sales/Claims notify form once the policy is issued, read-only claim list with the resolved coverage window) | `Claim` creation takes the schema `@default(NOTIFIED)` without the engine (initial creation) · `CLAIM_LARGE_THRESHOLD_JOD` is a **drafted, unsourced** constant (no CBJ / Part-3.7 / broker authority-matrix figure) and `isLargeClaim` is a snapshot only — the Process 28 second-approver gate must re-derive from the approved amount · `ThirdPartyClaimant.recoveryAmount` is a settlement-phase figure and is **not** accepted at notification; a bare `isThirdPartyInvolved: true` still creates the (all-null) claimant row as the anchor for the subrogation process · no `ClaimFollowUpAlert` sweep (#27); Loss Ratio / Claims Analytics (#29+) not fed yet · the resolver assumes contiguous schedule versions — a `coverage_gap` reason exists for a hole between versions but that shouldn't occur (each #22 APPLY closes-and-opens contiguously) · `claim.notify` / `claim.read` are role-level (no per-officer queue); no PDPL-registry SLA attaches at `NOTIFIED` (the insurer-non-response follow-up clock is a #27 concern) |
| 24 | Claim Registration with Insurer | extends the `claim` module — migration `20260902180000` adds **only** `@@unique([claimId, toStatus])` on `ClaimStatusHistory` (a `@code-reviewer` MINOR — one history row per status is structural, not emergent; valid because `WORKFLOW_TRANSITIONS.Claim` is an acyclic DAG). The `Adjuster` model, `Claim.insurerClaimReference` / `Claim.claimNumber @unique`, `ClaimStatus.REGISTERED`, the transition map and the `claim.register` perm (`[CLAIMS_OFFICER]`) all already existed · `POST /claims/:id/registration` (`{ insurerClaimReference (required), claimNumber?, adjuster: { name, firm? } }`, `claim.register`/**Claims Officer**) drives `Claim NOTIFIED → REGISTERED` through `WorkflowTransitionService.transition` with `insurerClaimReference` / optional `claimNumber` passed as the transition `data` (status flip + scalar write are **one atomic, engine-audited write**; a `claimNumber` collision → `P2002` → 409); then `ClaimRepository.recordRegistration` writes the `REGISTERED` `ClaimStatusHistory` row (idempotent — skipped if present) + the one loss `Adjuster` (`claimId @unique`) in **one `$transaction`** · **the first real engine transition on a `Claim`** (#23 only created it at `@default`); nothing writes `Claim.status` directly — the e2e asserts exactly **one** `TRANSITION` audit row across the register + all re-calls · **no maker/checker** (registering + assigning the adjuster is single-actor Claims work per `maker-checker-segregation.md` § "what does NOT trigger this rule"; the second approver is at settlement, Process 28) · **idempotent / race-safe**: a byte-identical re-call (insurer ref + adjuster name/firm + claim number all equal) is a no-op `200`; **any** change to a registration field is a `409` ("recorded once — a correction is not yet supported"); a concurrent register that lost the `NOTIFIED → REGISTERED` race (engine 0-rows `ConflictException` or "already in status REGISTERED") is reloaded and handled as an already-registered claim; a crash-recovery re-entry (status `REGISTERED`, no `Adjuster`) does only the artefact write · audit: `CREATE Adjuster` (the adjuster `name` + `firm` — a professional loss-assessment provider, not the claimant; same tier as the #21 delivery `recipient`) + `UPDATE Claim` (the registration scalars, only on the transitioning call) · `insurerClaimReference` + `Adjuster` folded into `ClaimView` · web: the "Claims" block gains a per-`NOTIFIED`-claim "Register with the insurer" form (Claims Officer) | `insurerClaimReference` + the `Adjuster` name/firm are **write-once** at registration — there is no amend endpoint (a correction needs a future path); no `Adjuster` re-assignment (the insurer swapping adjusters); `Adjuster.surveyCompletedAt` / `investigationCompletedAt` are surfaced in the view but no endpoint stamps them (Process 26); the transition-then-artefacts ordering has a narrow seam — a crash between the engine transition committing and `recordRegistration` committing leaves `Claim.status === REGISTERED` with no `Adjuster` and no `REGISTERED` history row (the engine's `TRANSITION` audit row is written, so the PDPL trail is intact, but the domain `ClaimStatusHistory` row that feeds Loss Ratio / Claims Analytics lags until the next `register` call completes it — accepted #19/#21 pattern, nothing reconciles it automatically); no dedicated "registered at" timestamp — Process 27's insurer-non-response follow-up clock should key off the `REGISTERED` `ClaimStatusHistory.changedAt`; `claim.register` is role-level (no per-officer queue) |
| 25 | Claim Documentation | extends the `claim` module — **no seed change**; migration `20260902180000` adds only `@@unique([claimId, toStatus])` on `ClaimStatusHistory` (a `@code-reviewer` MINOR — see #24's row; it also backstops the #25 best-effort `DOCUMENTATION_IN_PROGRESS` history-row write). The `ClaimDocument` / `Document` models, the `DocumentCategory` / `DataClassification` enums and the `claim.document` perm (`[CLAIMS_OFFICER]`) all already existed · `POST /claims/:id/documents` (`{ documents: [{ docType ∈ claim_form\|police_report\|medical_report\|photo\|invoice\|repair_estimate\|expert_report\|correspondence, classification, fileName, storageRef }] }`, `claim.document`/**Claims Officer**) — valid from `REGISTERED` onward (a `NOTIFIED` claim has no insurer reference to file against → 422); each file is a `Document` (`category: CLAIM`, a `storageRef` pointer, never the bytes) + a `ClaimDocument` join carrying the claim-specific `docType`, written in **one `$transaction`** · a `medical_report` **must** be `HIGHLY_CONFIDENTIAL` (`claims-lifecycle.md` — health data is classification-driven from first contact; 422 otherwise) · **the first attach best-effort advances `Claim REGISTERED → DOCUMENTATION_IN_PROGRESS`** through the engine (+ a `ClaimRepository.recordStatusHistory` idempotent domain-trail row) — best-effort because `DOCUMENTATION_IN_PROGRESS` is a forward-progress marker, not a #20-style safety gate, so a failed advance is logged and retried on the next attach, never thrown; the e2e asserts every `Claim` status move is an engine `TRANSITION` row (2 by this point: `REGISTERED`, `DOCUMENTATION_IN_PROGRESS`) · **the mandatory-document checklist per claim type** (`mandatoryDocTypesFor` + `classifyInsuranceLine`, pure) — `Policy.insuranceLine` is free text, so it is classified into a broad line *family* (`property` / `motor` / `medical` / `liability` / `marine` / `other`) by keyword and each family maps to a **drafted, unsourced** required doc set (e.g. `property` → `claim_form` + `photo` + `repair_estimate`; `medical` → `claim_form` + `medical_report` + `invoice`; any third-party loss also → `police_report`); `buildDocumentChecklist` derives `documentationComplete` (every `required` type present) + `missingMandatoryDocuments` · `ClaimView` gains `documents` (no `storageRef`), `documentChecklist`, `documentationComplete`, `missingMandatoryDocuments` · audit: `CREATE ClaimDocument` — ids / `docType` / `category` / `classification` only, **never `fileName` / `storageRef`** (a claim doc filename can name an injured person; same rule as #18-19's `policyDocumentAuditSnapshot`) · **`/brain-gap` filed** (ibms-brain `0dfa33f`): `claims-lifecycle.md` gains a Claim Documentation row + a medical-data sub-point · web: the "Claims" block gains a per-claim checklist display + a single-file attach form (Claims Officer) | The mandatory-document matrix + the `insuranceLine → family` classifier are **drafted, unsourced** (no Part 3.7 per-line matrix, no line taxonomy) — a Business Interruption claim (family `property`) inherits `photo` / `repair_estimate` rather than an accounts requirement (the `docType` enum has no "financial statements" value); the checklist is surfaced but nothing yet *gates* on `documentationComplete` — the `DOCUMENTATION_IN_PROGRESS → UNDER_ASSESSMENT` move + that gate is Process 26; `Document.versionNumber` is always 1 (no claim-doc version chain / re-upload flow); no delete (the schema's `deletionLocked` privileged-override path is unused); a claim `Document` carries no `policyId` (the `ClaimDocument` join is the canonical link — a "full insurance file" union view is deferred); `claim.document` is role-level (no per-officer queue); the transition-then-history-row seam is the same accepted #19/#21/#24 pattern (best-effort here, so even lower stakes) |
| 26 | Claim Assessment | extends the `claim` module — **no migration, no seed change** (`claim.assess` perm `[CLAIMS_OFFICER]`, `Adjuster.surveyCompletedAt` / `investigationCompletedAt`, `ClaimStatus.UNDER_ASSESSMENT` / `APPROVED` / `PARTIALLY_APPROVED` / `DECLINED` and the `WORKFLOW_TRANSITIONS.Claim` map all pre-existed) · **three endpoints, all `claim.assess`/Claims Officer** — `POST /claims/:id/assessment/adjuster-progress` (`{ surveyCompletedAt?, investigationCompletedAt? }`) stamps the loss adjuster's completion timestamps (past-only via `parseHistoricalInstant`, no earlier than the loss date, **write-once** per field — an identical re-send is a no-op, a different value is a 409); `POST /claims/:id/assessment/submit` drives `Claim DOCUMENTATION_IN_PROGRESS → UNDER_ASSESSMENT`; `POST /claims/:id/assessment/decision` (`{ outcome ∈ APPROVED\|PARTIALLY_APPROVED\|DECLINED }`) drives `UNDER_ASSESSMENT → <outcome>` · **every `Claim` status move goes through `WorkflowTransitionService.transition`** and also writes a domain `ClaimStatusHistory` row (best-effort after the loud transition — the #24/#25 seam, backfilled on the next call) · **`submit` is a hard safety gate on the mandatory-document checklist** (`claims-lifecycle.md` — "the checklist is what gates the move to insurer assessment") **recomputed from the live `ClaimDocument` rows** (never a stored `documentationComplete` snapshot — the #16 "re-derive the gate from live data" generalisation): a 422 lists the missing docTypes · **`decision` is gated on the adjuster having completed BOTH survey and investigation** — a **drafted, unsourced** `ibms-app` rule (Part 3.7 tracks the completion data but does not say it blocks the verdict), same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23) / the #25 checklist matrix / #16's 10 % / 2 pp · the verdict is **write-once** (a different outcome once one is recorded is a 409 — a disputed verdict routes to Complaint Management, Process 42, not a status walk-back) · **no maker/checker** — recording the insurer's verdict is single-actor Claims work, not the broker approving a payment (`maker-checker-segregation.md` § "what does NOT trigger this rule"; the second approver is at settlement, Process 28) · `ClaimView` gains `assessment` (`surveyCompletedAt` / `investigationCompletedAt` / `adjusterWorkComplete` / `readyForAssessment` / `outcome`) · audit: `UPDATE Adjuster` (ids + the two ISO timestamps, no claim narrative) + the engine `TRANSITION` rows; every assessment endpoint also emits the `READ` sensitive-data-access row that `get` / `list` emit (its response echoes `causeOfLoss` / `documents[].fileName` / the third-party name) — **also retrofitted onto `register` (#24)** for consistency · **`/brain-gap` filed** (ibms-brain `d1dba95`): `claims-lifecycle.md` gains a Process 26 bullet · web: the "Claims" block gains a per-claim "Assessment" sub-block — adjuster survey/investigation stamps, "Submit for assessment" (disabled until the checklist is complete) and a verdict selector | The adjuster-work gate on the verdict and the write-once semantics are **drafted / unsourced** (filed, above) — a desktop assessment with no site survey has no way past the gate today; `Adjuster` survey/investigation stamps have no amend path (write-once); the `submit` / `decision` transition-then-history-row ordering has the same accepted #24/#25 seam (the status can lead its `ClaimStatusHistory` row by one failed call, reconciled on the next); no `Settlement` yet (the four figures + the second approver are Process 28); `DECLINED → CLOSED` and `APPROVED`/`PARTIALLY_APPROVED → SETTLED` are Processes 28–29; `claim.assess` is role-level (no per-officer queue); no SLA timer on a claim sitting in `UNDER_ASSESSMENT` (the insurer-non-response follow-up clock is #27) |
| 27 | Claim Follow-up | extends the `claim` module — **migration `20260902190000`** adds a partial `UNIQUE ("claimId") WHERE "resolvedAt" IS NULL` + a plain `@@index([claimId])` on `ClaimFollowUpAlert` (the model, the `Claim.followUpAlertThresholdDays` column and the `claim.followup.manage` perm `[CLAIMS_OFFICER]` all pre-existed) · **no seed change** · **`ClaimFollowUpScheduler`** (`@Cron` 07:00 UTC, after the 06:00 RFQ sweep) + an on-demand **`POST /claims/follow-up-sweep`** (`claim.followup.manage`, counts only) both call `ClaimService.runFollowUpScan` — two passes, per-row isolated (the `CrossSellDetectionScheduler` shape): **raise** a `ClaimFollowUpAlert` on every pre-verdict claim (`REGISTERED` / `DOCUMENTATION_IN_PROGRESS` / `UNDER_ASSESSMENT`) whose business-day `followUpAlertThresholdDays` has elapsed since it was `REGISTERED` and which has no open alert; **auto-resolve** open alerts whose claim has since moved past the pre-verdict stage · the raise is `ClaimRepository.raiseFollowUpAlert` = `create` + `P2002` → "already alerted" (the partial `UNIQUE` is the race gate — a concurrent sweep is counted `skippedAlreadyAlerted`, not `failed`); the resolve is a conditional `updateMany` (0 rows = a concurrent resolve — race-safe) · **the clock is a single one from the `REGISTERED` `ClaimStatusHistory.changedAt`** — registration = submission to the insurer; NOT reset at `UNDER_ASSESSMENT` · **the threshold is per broad line family** (`motor` 7, `property` 10, `medical` 7, `liability` / `marine` 15, else 9 — the Part 3.7 worked-example figure) via `followUpThresholdDaysFor` (keyword family from `classifyInsuranceLine`), **drafted / unsourced** (same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23) / the #25 checklist matrix / #16's 10 % / 2 pp), and **snapshotted onto `Claim.followUpAlertThresholdDays` at notification** (Process 23's `notify` now sets it) so a later taxonomy change does not retroactively shift live claims · `isFollowUpDue` moved from `rfq.config.ts` to a shared **`common/follow-up.util.ts`** (Jordan business days, `now` injected; `rfq.config.ts` re-exports it) · **`POST /claims/:id/follow-up-alerts/:alertId/resolve`** (`claim.followup.manage`) — a Claims Officer manually resolves an open alert (they chased the insurer); the claim's status is **not** touched; idempotent; a wrong alert id on this claim is a 404 · **an alert is NOT a `Claim` status change** — it is an accountability record (`triggeredAt` / `resolvedAt`) alongside the lifecycle · **no maker/checker** (single-actor operational work) · audit: `CREATE` / `UPDATE ClaimFollowUpAlert` — ids + threshold + clock timestamps + `resolvedBy` (`sweep` / `manual`), never claim narrative · `ClaimView` gains `followUp` (`followUpAlerts` / `followUpAlertOpen` / `followUpAlertThresholdDays` / `awaitingInsurerResponse` / `awaitingInsurerSince`) · **`/brain-gap` filed** (ibms-brain `8618f29`) · web: the "Claims" section gains a "Run follow-up sweep" button + a per-claim open-alert display with a "Resolve" button (Claims Officer) | The per-line threshold map + the `insuranceLine → family` classifier are **drafted / unsourced** (filed, above) · the clock is one clock from `REGISTERED` — a claim that sits in `UNDER_ASSESSMENT` a long time is measured from registration, not from when it was submitted for assessment (a per-status clock is a possible refinement) · auto-resolve happens on the **next sweep** after the claim progresses, not the moment a verdict lands (`ClaimView.followUp.followUpAlertOpen` can be stale for up to a day; `awaitingInsurerResponse` already reads false) · the sweep is a global scan (`FOLLOWUP_SWEEP_LIMIT = 1000`, no pagination) · no escalation ladder (one open alert per claim; a still-stuck claim needs a human via `claim.followup.manage`) · `ClaimFollowUpAlert` has no `resolvedByUserId` scalar (the actor is on the audit row) · `claim.followup.manage` is role-level |
| 28 | Claim Settlement | extends the `claim` module — **migration `20260902200000`** adds only `Settlement.brokerProcessedPayment BOOLEAN NOT NULL DEFAULT false` (the "any claim payment the broker processes" trigger, re-derived from live data). The `Settlement` model, all four `Settlement` `Decimal` money fields (`estimatedLoss` / `approvedAmount` / `deductible` / `netSettlement`, already in `MONEY_DECIMAL_FIELDS`), the `Settlement_maker_checker_distinct` CHECK (`20260826091424`, `secondApproverUserId <> approvedByUserId`), the `WORKFLOW_TRANSITIONS.Claim` `APPROVED`/`PARTIALLY_APPROVED → SETTLED` edges and the `claim.settle.approve` (`[CLAIMS_OFFICER, MANAGER]`) / `claim.settle.second-approve` (`[MANAGER, FINANCE]`) perms all already existed · `POST /claims/:id/settlement` (`{ approvedAmount, deductible, brokerProcessedPayment? }`, `claim.settle.approve`) — valid only from `APPROVED` / `PARTIALLY_APPROVED` (422 otherwise) · **the four figures are always distinct and never collapsed**: `estimatedLoss` is carried from `Claim.estimatedLoss`, `approvedAmount` + `deductible` are the only inputs, and **`netSettlement` is ALWAYS `approvedAmount − deductible` computed server-side (`subtractMoney`)** — never accepted from the caller · hard bounds — `approvedAmount > 0`, `approvedAmount ≤ estimatedLoss` (422 — an insurer cannot approve more than the claimed amount), `deductible ≥ 0`, `deductible ≤ approvedAmount` (422 — net cannot be negative) · **the recorder of the four figures IS the first approver** (`Settlement.approvedByUserId = actor`); recording is **write-once** — a byte-identical re-`POST` is a 200 no-op / resume, any changed figure is a 409 (`P2002` on the `claimId @unique` → 409 for a concurrent create) · **a mandatory distinct second approver is required iff `approvedAmount ≥ CLAIM_LARGE_THRESHOLD_JOD`** (the **same drafted, unsourced** `= '25000.000'` #23 uses for `isLargeClaim`, **re-derived here from the live approved amount** — never `Claim.isLargeClaim`, the notification-time snapshot) **OR `brokerProcessedPayment = true`** · when neither holds `POST /settlement` drives `Claim → SETTLED` straight through; when either holds the claim holds at its verdict status until `POST /claims/:id/settlement/second-approve` (`claim.settle.second-approve`/**Manager or Finance**) — **maker/checker** `assertDifferentActors(approvedByUserId, actor)` (403) + the DB CHECK; a status-conditional `recordSettlementSecondApproval` `updateMany` (0 rows → 409); a different second approver on an already-approved settlement → 409, the same one → idempotent resume · **`settleCore` structurally re-checks the second approval at the `→ SETTLED` write** — it refuses to walk a claim whose live `Settlement` still needs a second approver while `secondApproverUserId IS NULL`, regardless of path (record + second-approve are separate writes and the engine map allows `→ SETTLED` unconditionally — the #22 "APPLY must re-check approval structurally" generalisation) · every `Claim` status move goes through `WorkflowTransitionService.transition` (+ a best-effort domain `ClaimStatusHistory` row, the #24–27 seam); the e2e asserts exactly **5** `TRANSITION` audit rows across the #23→#28 chain · **`Settlement` is not a `WorkflowTransitionService` entity** (no `status` — its lifecycle is the parent `Claim`'s), same shape as `Adjuster` / `ClaimDocument` / `ThirdPartyClaimant` / `ClaimFollowUpAlert` · audit: `CREATE` / `APPROVE Settlement` — the four figures as fixed strings + `brokerProcessedPayment` + the maker/checker ids + `secondApproverRequired`, **never the claim narrative**; every settlement endpoint also emits the `READ` sensitive-data-access row `get` / `list` emit · `ClaimView` gains `settlement` (`estimatedLoss` / `approvedAmount` / `deductible` / `netSettlement` / `brokerProcessedPayment` / `approvedByUserId` / `secondApproverUserId` / `secondApproverRequired` / `settled`) · **`/brain-gap` filed** (ibms-brain `1999311`): `claims-lifecycle.md` — the four-figures row + the second-approver row extended · web: the "Claims" block gains a per-claim "Settlement" sub-block — a Claims/Manager four-figure record form (with a broker-processed checkbox), a read-only four-figure display, and a Manager/Finance "Second-approve settlement" button | `CLAIM_LARGE_THRESHOLD_JOD` (25,000) is **drafted, unsourced** (no CBJ / Part-3.7 / broker authority-matrix figure — filed, above), same status as #16's 10 % / 2 pp and #22's refund / short-period constants · the four figures are **write-once** — no amend path (a corrected settlement needs a future endpoint; a disputed one routes to Complaint Management, Process 42) · `brokerProcessedPayment` is set once at record time and not re-evaluated · **no payment execution** — `Settlement` records the decision + the four figures; the actual disbursement, `ThirdPartyClaimant.recoveryAmount` / subrogation, and `Claim → CLOSED` are Processes 29–30 · Loss Ratio / Claims Analytics (#29) is still not fed · the record-then-second-approve seam is two writes — `settleCore`'s structural re-check is the backstop, but a crash between the `Settlement` create and the straight-through `→ SETTLED` leaves the settlement recorded with the claim at its verdict status until the next `POST /settlement` (byte-identical) resumes it · `claim.settle.approve` / `claim.settle.second-approve` are role-level (no per-officer queue); no SLA timer on a recorded-but-unsettled claim |
| 29 | Claim Closure | extends the `claim` module + a small new `loss-ratio` module — **no migration, no seed change** (the `claim.close` perm `[CLAIMS_OFFICER]`, `ClaimStatus.CLOSED`, the `WORKFLOW_TRANSITIONS.Claim` `SETTLED → CLOSED` / `DECLINED → CLOSED` edges, `Settlement.clientPaymentConfirmedAt`, and the `RenewalCase` / `LossRatio` models all already existed) · `POST /claims/:id/closure` (`{ clientPaymentConfirmedAt? }`, `claim.close`/**Claims Officer**) — **no maker/checker** (closure is single-actor Claims work; the mandatory second approver is at settlement, #28) · a `SETTLED` claim closes only once the client's receipt of the settlement payment is confirmed: `clientPaymentConfirmedAt` is supplied in the body, **write-once** on the `Settlement` (a status-conditional `updateMany`), past-only (`parseHistoricalInstant`) and **no earlier than the loss date** (a tighter "after the `Settlement` was recorded" bound is deliberately not enforced — data-entry lag is normal, the #21 `deliveredAt` latitude); closing without it is a **422**, a *different* instant once one is recorded is a **409**, a byte-identical re-close resumes a stuck close · a `DECLINED` claim closes **directly** — no payout, so a `clientPaymentConfirmedAt` on a declined claim is a **422** · any other status → 422; an already-`CLOSED` claim is a **200 no-op** that does **not** re-fire the recompute · `closeCore` drives `Claim (SETTLED \| DECLINED) → CLOSED` through `WorkflowTransitionService.transition` (+ a best-effort domain `ClaimStatusHistory` row, the #24–28 seam; a concurrent close normalises to an idempotent no-op) and **only the call that actually transitions the claim** best-effort triggers the Loss Ratio recompute (logged, never thrown — closure has committed; the recompute is a downstream input, not a gate) · the e2e asserts exactly **6** `TRANSITION` audit rows across the #23→#29 chain · **new `LossRatioModule`** (`LossRatioService` + `LossRatioRepository`) — `recomputeForPolicy(policyId)` upserts the `LossRatio` for the policy's open `RenewalCase` (`LossRatio.renewalCaseId @unique`); **since the renewal module (Part 3.9) is not built, no policy has a `RenewalCase`, so it is a logged no-op** — a standalone per-claim loss ratio is deliberately NOT created, and the closed claim's `CLOSED` `ClaimStatusHistory` row is the durable trigger record · `computeLossRatio` (pure) — `periodClaims` = Σ `Settlement.netSettlement` over the policy's `SETTLED` / `CLOSED` claims (a `DECLINED` claim contributes 0), `periodPremium` = `Policy.issuedPremium ?? requestedPremium`, `ratio` = `periodClaims ÷ periodPremium` at 4 dp (`ROUND_HALF_UP`; a zero premium → a zero ratio, never a divide-by-zero); **the "period" is drafted / unsourced** — computed all-time for the policy, the renewal module will narrow it to the policy year (same status as `CLAIM_LARGE_THRESHOLD_JOD` etc.) · audit: the engine `TRANSITION` row + an `UPDATE Settlement` row when `clientPaymentConfirmedAt` is stamped (ids + the ISO timestamp, no narrative) + an `UPDATE LossRatio` row per real recompute (ids + the three figures as fixed strings + the trigger); every closure also emits the `READ` sensitive-data-access row `get` / `list` emit · `ClaimView` gains `closedAt` (the `CLOSED` `ClaimStatusHistory.changedAt`, or null) and `settlement.clientPaymentConfirmedAt` · **`/brain-gap` filed** (ibms-brain `194888c`): `claims-lifecycle.md` — a new Claim Closure bullet + the Loss Ratio bullet extended · web: the "Claims" block gains a per-claim "Closure" sub-block — a "Client received the settlement payment on" date input + "Confirm payment & close claim" (SETTLED), a "Close claim" button (DECLINED), and a read-only "Closed …" line (CLOSED); `page.tsx` wires `canClose={isClaims}` | `computeLossRatio`'s "period" (all-time per policy) is **drafted / unsourced** (filed, above) — the renewal module owns the policy-year window · in normal running the recompute takes the logged no-op branch (no policy has a `RenewalCase` until the renewal module lands); the `#29`/`#30` e2e creates a `RenewalCase` so the write path (`loadPolicyForRecompute` + `computeLossRatio` + `upsertLossRatio` + audit) is exercised against a real DB · `Settlement.clientPaymentConfirmedAt` is write-once with no correction path · **no payment execution / disbursement** (`Settlement` records the decision; the money movement, `ThirdPartyClaimant.recoveryAmount` / subrogation are Finance / a later process) · a `CLOSED` claim is terminal — there is no reopen edge in `WORKFLOW_TRANSITIONS.Claim` · `claim.close` is role-level (no per-officer queue); no SLA timer on a SETTLED-but-unclosed claim |
| 30 | Claims Analytics | extends the `loss-ratio` module — **no migration, no seed change** (the `claims-analytics.view` perm `[CLAIMS_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]` was already seeded; `computeLossRatio` from #29 is reused) · **`GET /claims-analytics/loss-ratio?groupBy=customer\|policy\|line`** (`claims-analytics.view`) — the aggregate `Claims ÷ Premium` breakdown that feeds the reporting dashboard and, once built, the renewal workflow · **book-wide** (the perm is a cross-book reporting role, so there is no per-owner visibility filter); optional `customerId` / `policyId` / `insuranceLine` query params just narrow the policy set first · **computed on the fly — there is no stored aggregate table** (the per-`RenewalCase` `LossRatio` row is still #29's) · `LossRatioRepository.loadPoliciesForAnalytics` loads every **written** policy (status past `PLACEMENT_CONFIRMED` — `ISSUED` … `EXPIRED`) with its customer name and its `SETTLED` / `CLOSED` claim net settlements; the pure **`buildLossRatioBreakdown`** groups them and runs `computeLossRatio` per group **over the group's pooled net settlements + pooled written premium** (a **paid, all-time** loss ratio — not a sum or average of per-policy ratios), plus a `totals` row that pools every in-scope policy regardless of `groupBy` · each row carries `key` / `label` / `periodClaims` / `periodPremium` / `ratio` / `ratioCapped` / `claimCount` / `policyCount`; rows are ordered **worst-first** (highest ratio) · a `DECLINED` claim contributes 0; an open (pre-settlement) claim is not counted (a *paid* ratio — an *incurred* one adding open-claim `estimatedLoss` reserves is deferred); a `CANCELLED` / `EXPIRED` policy still contributes its **full written premium** (earned-premium proration is a renewal-module refinement) · `ClaimsAnalyticsService` emits a `READ` audit row (`entityType: 'ClaimsAnalytics'`, `entityId` = the scoping id or `book-wide`, counts / filters only — **never a figure or a customer name** — `isSensitiveDataAccess` when a claim contributed; best-effort, mirrors `CrmService.get360View`) · `ClaimsAnalyticsController` is a new `@Controller('claims-analytics')` in `LossRatioModule` (no `AuthModule` import — the global `PermissionsGuard` / `@CurrentUser` cover it, same as `CrmModule`) · **`/brain-gap` filed** (ibms-brain `d1a0a1a`): `claims-lifecycle.md` — the Loss Ratio bullet gains a Process 30 sub-point · web: a new **"Claims analytics"** screen (`app/(app)/claims-analytics/page.tsx` + `lib/claims-analytics/analytics-api.ts` + an `AppNav` entry) — a group-by selector and a worst-first table of loss-ratio rows + a totals row, with a friendly `claims-analytics.view`-missing message | the "period" is **all-time**, and "written premium" counts a cancelled / expired policy's full premium — both **drafted** (filed, above); the renewal module owns the policy-year window + earned-premium proration · **no incurred loss ratio** (open-claim reserves) — paid only · no date-range / as-of filter (all-time only); no CSV / export; no per-line-family rollup (the raw `Policy.insuranceLine` string is the `line` key — a `Business Interruption` policy and a `Property All Risks` policy are separate lines even though #25's classifier would fold both into `property`) · in-memory aggregation (`findMany` + JS grouping — first `groupBy`-style query in the repo), fine at a broker's book size, unbounded · `claims-analytics.view` is role-level |

### Part C · Domain D #31–40 — complete, with these deferrals

*(#37 Refund Management needs no separate build — the endorsement-driven `Refund` + maker/checker under #22 covers it; see § Known gaps, Part C #37.)*

| # | Process | Built | Not done (detail in § Known gaps) |
|---|---|---|---|
| 31 | Premium Billing | **new module** `apps/api/src/modules/finance/` (+ `repositories/invoice.repository.ts`) — **migration `20260902210000`** adds `Invoice.invoiceType TEXT NOT NULL DEFAULT 'new_business_premium'` + a partial `UNIQUE ("policyId") WHERE "invoiceType" = 'new_business_premium'` + `@@index([policyId])`. The `Invoice` model, its five `Decimal` money columns (already in `MONEY_DECIMAL_FIELDS`), the `InvoiceStatus` enum, the `WORKFLOW_TRANSITIONS.Invoice` map and the `invoice.create` (`[FINANCE_COLLECTIONS_OFFICER]`) / `client-accounting.read` (`[FINANCE, MANAGER, EXEC, AUDITOR]`) perms all already existed · **no seed change** · `POST /invoices` (`{ policyId, taxAmount, feesAmount?, dueDate }`, `invoice.create`/**Finance**) raises the one **new-business premium `Invoice`** per policy · **`premiumAmount` is carried from `Policy.issuedPremium`** (a policy with no issued premium → **422**) · **`commissionDeducted` is auto-derived** — `premiumAmount × Recommendation.recommendedQuotation.commissionRatePercent` for the policy's Opportunity (the rate the policy was *placed* at — the same lookup #22's `commissionRateFor` uses); a quotation that captured **no** rate → **422** (Process 35's `CommissionAgreement` will replace this lookup) · `taxAmount` + `feesAmount` are the **only** money inputs (each `0 ≤ x ≤ premiumAmount`; `feesAmount` defaults to `0`) — there is no governed premium-tax-rate table yet, Finance supplies the applicable tax · **`totalAmount` is ALWAYS `premiumAmount + taxAmount + feesAmount − commissionDeducted`, computed server-side** (`addMoney` then `subtractMoney`); the DTO rejects a `totalAmount` field (the #28 `netSettlement` lesson) · `dueDate` is a required `YYYY-MM-DD`, today .. +365d (`INVOICE_MAX_DUE_DAYS_AHEAD`, drafted) · **one new-business premium invoice per policy** — the partial `UNIQUE` is the race backstop; write-once #24/#28-style: a byte-identical re-`POST` (all five figures + `dueDate` compared) returns the existing invoice, any different figure is a **409**, a concurrent create hits `P2002` → 409 · **`Invoice` IS a `WorkflowTransitionService` entity** but #31 only creates it at the schema `@default(INVOICED)` — no engine transition (same precedent as #23 creating a `Claim` at `@default(NOTIFIED)`); the `INVOICED → COLLECTED` cycle is Process 32 · **no maker/checker** (raising a bill is single-actor Finance work — `maker-checker-segregation.md` § "what does NOT trigger this rule"; the second actor is at refund approval / commission override) · reads are **book-wide** (`client-accounting.read` is a cross-book reporting perm — no per-owner filter, same as `claims-analytics.view`); `GET /invoices` with no `policyId`/`customerId` scope is a **400** (a book-wide dump is Process 33's ageing report), `GET /invoices/:id` returns one · audit: one `CREATE Invoice` row (ids + all five figures as fixed 3dp strings + the commission rate applied + the due date, no free text); reads are **not** audited (an invoice total is Confidential, not Highly Confidential — same tier as `Policy` premium) · **`/brain-gap` filed** (ibms-brain `f8843ed`): **new `meta/context/finance-lifecycle.md`** (Domain D seed) documents Process 31 · web: a "Billing" block in the "Policy" section on the Opportunity detail screen — a read-only premium/tax/fees/less-commission/total/due-date/status card once an invoice exists, a tax + fees + due-date form for Finance otherwise (`canInvoice={isFinance}`) | `commissionDeducted` derives from the *placed quotation's* `commissionRatePercent`, not a governed rate table — Process 35 (`CommissionAgreement`, by insurer + line) will replace the lookup, and a policy whose quotation captured no rate cannot be billed today (422) · **there is no premium-tax-rate table** — `taxAmount` is a raw Finance input (no computed default, no exemption model); a real Jordan insurance-premium-levy figure belongs to a Finance-config surface that does not exist · `INVOICE_MAX_DUE_DAYS_AHEAD` (365) is a **drafted** sanity bound, not a CBJ / Part-3.6 credit-term rule · the five figures are **write-once** — no amend / credit-note path (a correction needs a future endpoint) · `PremiumTransaction` (the schema's generic premium-ledger model) is **not** written — #31 fills `Invoice.premiumAmount` directly; wiring the ledger is deferred to #32/#35/#36 · only the `new_business_premium` invoice is modelled — `endorsement_adjustment` / `renewal_premium` invoices (the other `invoiceType` values, raised from #22 / the renewal module) are not · `invoice.create` / `client-accounting.read` are role-level (no per-officer queue); no PDPL-registry SLA attaches at `INVOICED` (a payment-due follow-up is a #32/#33 concern) |
| 32 | Collection | **extends the `finance` module** — **migration `20260902220000`** adds ONLY `Receipt.invoiceId @unique` (`Receipt_invoiceId_key`) — the "one collection receipt per invoice" race backstop, matching `Remittance.receiptId @unique` on the next hop and #31's `Invoice` partial `UNIQUE`. The `Receipt` / `Remittance` / `ReconciliationException` / `ClientFundsLedgerEntry` models, the `InvoiceStatus` cycle values, the `WORKFLOW_TRANSITIONS.Invoice` map (`INVOICED → COLLECTED → RECONCILED → REMITTED`) and the `receipt.record` / `remittance.record` perms (`[FINANCE_COLLECTIONS_OFFICER]`) all already existed · **no seed change** · **`Invoice` IS a `WorkflowTransitionService` entity and #32 is where the engine transitions happen** — three endpoints, one hop each: `POST /invoices/:id/receipt` (`receipt.record`) drives `INVOICED → COLLECTED`, `POST /invoices/:id/reconcile` (`receipt.record`) drives `COLLECTED → RECONCILED`, `POST /invoices/:id/remittance` (`remittance.record`) drives `RECONCILED → REMITTED` — every move through `WorkflowTransitionService.transition` (its status-conditional `updateMany` + the two `@unique`s are the race gates), the `Receipt` / `Remittance` / ledger artefacts written **after** the transition commits (the #24 `register` pattern: lost race → resume/409; crash between transition and artefact → re-entry writes only the artefact); the e2e asserts exactly **3** `TRANSITION` audit rows across the cycle · **#32 supports one full-payment receipt per invoice** — `Receipt.amount` **must equal `Invoice.totalAmount` exactly** (`compareMoney === 0`); a partial / over payment is a **422** (the `money-decimal-jod.md` "a mismatch is raised as an exception, never silently written off" rule at the door — the variance / investigation path is Process 39, not a silent short-collect) · a `P2002` on the `Receipt` `UNIQUE` (a concurrent caller that lost the transition race but reached the artefact write first) → reload → byte-identical resume, or a **409** if the landed receipt differs · **reconcile re-derives `sumMoney(receipts) === totalAmount` from the live rows** (never a stored snapshot — the #16 "re-check the gate at the decision point" rule); a mismatch is a 422, an already-`RECONCILED` / `REMITTED` invoice is an idempotent 200 · **the remittance is `premiumAmount − commissionDeducted`, computed server-side** (`subtractMoney`, `≥ 0` since #31 bounds commission ≤ premium; tax + fees stay with the broker); `insurerId` from `Policy.insurerId`; a non-policy invoice → 422; the figures are deterministic so a re-`POST` is an idempotent no-op (a stored figure that disagrees → 409; `Remittance.receiptId @unique` + `P2002` backstop) · **Part 7.3 client-money segregation** — every collection books an `in` `ClientFundsLedgerEntry`, every remittance an `out` one, **each in the same `$transaction` as its `Receipt` / `Remittance`** (a deliberate local `$transaction` exception, same rationale as `PolicyRepository.createIssuanceArtifacts`), so a crash can never leave a money movement with no matching ledger row; `reference` is an `invoice:<id>` pointer · **no maker/checker** (`roles-and-segregation-of-duties.md` — "record receipts" is a Finance/Collections single-actor duty; moving client money to the insurer is mechanical, not an approval) · book-wide · `InvoiceView` gains `netRemittance` (`premium − commission`, computed server-side so the UI never does money math), `receipt` (`amount` / `method` / `receivedAt`) and `remittance` (`amount` / `insurerId` / `remittedAt`) · audit: a best-effort `CREATE` row for each `Receipt` / `Remittance` / `ClientFundsLedgerEntry` (amount as a fixed 3dp string + method / insurer / direction, no free text) + the engine `TRANSITION` rows · **`/brain-gap` filed** (ibms-brain `2cfbe4f`): `finance-lifecycle.md` gains a "Collection (Process 32)" section · web: the "Billing" block gains the three cycle actions (record receipt / reconcile / remit, `canCollect={isFinance}`) + a read-only "Collected …" / "Remitted to insurer …" display | #32 records **one exact-amount receipt per invoice** — partial payments (multiple receipts summing to the total) are a deferred refinement that would replace the `Receipt.invoiceId @unique` · the **`EXCEPTION_RAISED` / `EXCEPTION_RESOLVED` `Invoice` states + the `ReconciliationException` model + the investigate/resolve path are Process 39** — #32's reconcile / receipt gates 422 a variance rather than raising a formal exception · **no payment execution** — a `Receipt` records that the client paid and a `Remittance` records the broker's transfer to the insurer as facts (`receivedAt` / `remittedAt`); there is no bank integration, no `Receipt` reversal / `Remittance` clawback · `ClientFundsLedgerEntry` is an append-only movement log — there is no running-balance query or a client-funds reconciliation report yet (a #33 / dedicated-Finance-surface concern) · `PremiumTransaction` (the generic premium-ledger model) is still not written · `receipt.record` / `remittance.record` are role-level (no per-officer queue / worklist of un-reconciled invoices) |
| 33 | Client Accounting | **extends the `finance` module** — **no migration, no seed change** (`client-accounting.read` — `[FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`, its seeded description is literally "View the client accounts-receivable/ageing report" — pre-existed) · new `ClientAccountingService` + `ClientAccountingController` in the `finance` module, `InvoiceRepository.loadOutstandingReceivables`, and the pure `buildReceivablesAgeing` / `daysOverdue` / `ageingBucketFor` in `finance.config.ts` · **`GET /client-accounting/ageing?customerId=&asOf=`** (`client-accounting.read`) returns the accounts-receivable / ageing report — **one row per customer with an outstanding balance**, each split into `current` / `d1_30` / `d31_60` / `d61_90` / `d90_plus` buckets, plus a `totals` row pooling every outstanding invoice in scope · **computed on the fly — no stored aggregate table** (the #30 Claims Analytics shape; the unscoped `GET /invoices` 400 message points here) · **"outstanding" is structural — an `Invoice` with no collection `Receipt`** (#32 records exactly one per invoice for the full total, so a receipt means paid in full; partial payments are a deferred #32 refinement) · **`asOf` is the ageing reference date** — a bare `YYYY-MM-DD`, today or earlier (a future `asOf` → **422**), default today; it is **point-in-time correct for the outstanding set with no history table** — the query filters `Invoice.createdAt < asOf+1d` and requires `Receipt.receivedAt < asOf+1d` to be `none`, and `Invoice.dueDate` is write-once at #31 · **buckets are the textbook 30 / 60 / 90-day bands, drafted / unsourced** (`≤ 0` days overdue is `current`, then 1–30 / 31–60 / 61–90 / 90+) — same drafted status as `INVOICE_MAX_DUE_DAYS_AHEAD` (#31), `CLAIM_LARGE_THRESHOLD_JOD` (#23), the #27 follow-up thresholds, the #29 loss-ratio "period" · **book-wide** (the optional `customerId` just narrows to one client); rows ordered **worst-first** (largest days-overdue, then largest balance, then customer name in a fixed `en` locale); capped at `AR_AGEING_INVOICE_LIMIT = 5000` (the #30 `ANALYTICS_POLICY_LIMIT` precedent — `logger.warn` on truncation) · every figure pooled through `sumMoney` (`money.util.ts`) · **no maker/checker** (a read) · **not audit-logged** — an invoice total is Confidential, not Highly Confidential (the #31 decision: `GET /invoices` is likewise not audited); contrast the #30 breakdown, which aggregates HIGHLY_CONFIDENTIAL `Claim` rows and does write a `READ` row · **`/brain-gap` filed** (ibms-brain — `finance-lifecycle.md` gains a "Client Accounting (Process 33)" section) · web: a new **"Client accounting"** screen (`app/(app)/client-accounting/page.tsx` + `lib/client-accounting/ageing-api.ts` + an `AppNav` entry) — an `asOf` date input and a worst-first table of per-customer ageing buckets + a totals row, with a friendly `client-accounting.read`-missing message | the 30 / 60 / 90-day bucket boundaries are **drafted / unsourced** (filed) — no CBJ / Part-3.6 ageing-band rule · **`asOf` shifts the outstanding set + the bucket boundaries but not a changed `dueDate`** — `dueDate` is write-once at #31 so this cannot happen today, but a future amend / credit-note path would need to version it · **no partial-payment ageing** — an invoice is all-outstanding or all-paid (#32 records one full-amount `Receipt`); a `ClientFundsLedgerEntry` running balance / client-funds reconciliation report is still not built · no per-invoice drill-down in the report (the row is the aggregate; `GET /invoices?customerId=` is the line-item list) · no CSV / export; no currency split (every figure assumed JOD — `money-decimal-jod.md`) · `client-accounting.read` is role-level (no per-officer collections worklist) |
| 34 | Insurer Accounting | **extends the `finance` module** — **no migration, no seed change** (`insurer-accounting.read` — `[FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]` — pre-existed) · new `InsurerAccountingService` + `InsurerAccountingController` in the `finance` module, `InvoiceRepository.loadInsurerObligations` / `loadInsurerRemittances`, and the pure `buildInsurerPayables` + `INSURER_PAYABLES_ROW_LIMIT` in `finance.config.ts` · **`GET /insurer-accounting/payables?insurerId=&asOf=`** (`insurer-accounting.read`) returns the accounts-payable / remittance-obligations report — **one row per insurer** with `outstandingAmount` (net premium collected but not yet remitted), `remittedAmount` (paid to date), the counts, and `oldestDaysOutstanding`, plus a `totals` row · the **insurer-side mirror of #33**; **computed on the fly — no stored aggregate table** · **the obligation arises at collection, is discharged by the `Remittance`** — an **outstanding** obligation is a *collected-but-not-yet-remitted* invoice (a `Receipt` exists, no `Remittance` yet); it is **not** read from a `Remittance` row (#32 only creates a `Remittance` *after* the transfer and always stamps `remittedAt`, so a `Remittance` row means settled) · **the amount owed per invoice is `premiumAmount − commissionDeducted`** (`computeRemittanceAmount` — exactly #32's `Remittance.amount`; tax + fees stay with the broker), derived in the pure builder, never re-typed; the remitted side is straight from `Remittance.amount` · **`asOf`** (bare `YYYY-MM-DD`, today or earlier — a future `asOf` → **422**; default today) makes both sides point-in-time correct — a `Receipt` counts as collected when `receivedAt < asOf+1d`, a `Remittance` as remitted when `remittedAt < asOf+1d`, outstanding-as-at-`asOf` = collected by then and any `Remittance` came after (one `where` on the `receipts` relation: `{ some: { receivedAt: { lt: X } }, none: { remittance: { remittedAt: { lt: X } } } }`; the cycle is 1:1:1) · non-policy invoices (`policyId IS NULL`) are skipped — no insurer to owe · **no ageing buckets** (#34's line is "a query", not "an ageing query" like #33) — one `outstandingAmount` + `oldestDaysOutstanding` (whole UTC days since the earliest unremitted `Receipt.receivedAt`, `daysOverdue` reused; `-1` when nothing is outstanding); `Insurer.creditTermsDays` is **not** factored in (a deferred refinement) · **book-wide** (the optional `insurerId` just narrows); rows **worst-first** (largest days-outstanding, then largest amount owed, then insurer name in a fixed `en` locale); capped at `INSURER_PAYABLES_ROW_LIMIT = 5000` per side (`logger.warn` on truncation) · every figure pooled through `sumMoney` · **no maker/checker** (a read) · **not audit-logged** — same Confidential tier / #31 decision as #33 · **`/brain-gap` filed + pushed** (ibms-brain `ced8ed0`: `finance-lifecycle.md` gains an "Insurer Accounting (Process 34)" section) · web: a new **"Insurer accounting"** screen (`app/(app)/insurer-accounting/page.tsx` + `lib/insurer-accounting/payables-api.ts` + an `AppNav` entry) — an `asOf` date input and a worst-first table of per-insurer outstanding / remitted figures + a totals row, with a friendly `insurer-accounting.read`-missing message | **no ageing buckets** — a single "days outstanding" figure, not the 30/60/90 bands #33 uses; `Insurer.creditTermsDays` (a grace period before the remittance is "due") is not applied · the obligation is **derived from the invoice cycle state**, not a first-class `PayableObligation` row — there is no "insurer statement reconciliation" (that is #39) · **no partial-payment** — an invoice is fully unremitted or fully remitted (#32 records one `Remittance` per receipt) · no per-invoice drill-down in the report · no CSV / export; no currency split (every figure assumed JOD — `money-decimal-jod.md`; `Remittance` has no currency column) · `insurer-accounting.read` is role-level (no per-officer remittance worklist) · `CommissionAgreement` / the governed commission ledger (#35–36) is not built — the net owed still derives from `Invoice.commissionDeducted` (the placed quote rate, #22/#31) |
| 35 | Commission Calculation | **new module** `apps/api/src/modules/commission/` (+ `repositories/commission.repository.ts`) — **migration `20260903120000`** adds a partial `UNIQUE ("insurerId", "insuranceLine") WHERE "effectiveTo" IS NULL` on `CommissionAgreement` (one open rate window per pair, raw SQL), `CommissionLedgerEntry.policyId @unique` (one commission entry per policy), and `CommissionLedgerEntry.overrideAmount DECIMAL(18,3)` (the pending proposed override, held separately from `amount`). The `CommissionAgreement` / `CommissionLedgerEntry` models, the `CommissionLedgerEntry_maker_checker_distinct` CHECK (`20260826091424`), and the four Finance commission perms (`commission.calculate` `[FINANCE]`, `commission-rate.manage` `[COMPLIANCE, MANAGER]`, `commission-override.raise` `[FINANCE]`, `commission-override.approve` `[MANAGER]`) all already existed · **no seed change** · **the governed rate table** — `POST /commission/agreements` (`commission-rate.manage` / **Compliance + Manager**, not Finance — `roles-and-segregation-of-duties.md`: Finance "cannot alter commission rate tables without approval") opens a rate window for an `(insurerId, insuranceLine)`; a still-open window for the same pair is **superseded** (its `effectiveTo` stamped at the new window's `effectiveFrom`), both in one `$transaction` (`supersedeAndCreateAgreement` — the `reviseChain` exception); the partial `UNIQUE` + `P2002` → 409 is the race backstop; `effectiveFrom` may be future-dated but not earlier than the window it supersedes (422); a same-rate same-date re-`POST` returns the open window · **`resolveGovernedRate` (pure)** picks the window whose `[effectiveFrom, effectiveTo)` contains a date (`from` inclusive, `to` exclusive) · **`POST /commission/entries`** (`commission.calculate` / **Finance**) records the **one** `CommissionLedgerEntry` per policy (`policyId @unique`, write-once — the #31 Invoice pattern) at the governed rate in force for the policy's `(insurerId, insuranceLine)` **at `inceptionDate ?? createdAt`** (the rate the business was written at, not today's); `amount = premium × ratePercent%` (`applyPercentage`); **422** if the policy has no `issuedPremium` or no agreement covers the pair at that date; the rate is bounded `0..COMMISSION_MAX_RATE_PERCENT` (100) so `amount ≤ premium`; a re-`POST` whose recomputed governed figure differs from the stored one → **409** ("recorded once — a correction is a manual override"), an already-overridden entry always resumes · **no maker/checker on `calculate`** (applying the governed figure is mechanical single-actor Finance work, like #31 raising an invoice) · **#31's `Invoice.commissionDeducted` is NOT rewired to this table** — it stays on the placed-quotation rate (the client-facing figure); the `CommissionLedgerEntry` is the broker's governed commission-earned record (reconciling the two is a later concern) · **the manual override IS a maker/checker pair** — `POST /commission/entries/:id/override` (`commission-override.raise` / **Finance**) proposes `{ overrideAmount, reason }` (`reason` mandatory, `@MinLength(10)`; `0 ≤ overrideAmount ≤ premium`), writes `overrideAmount` + `isManualOverride` + `overrideReason` + `overrideRequestedByUserId` and **leaves `amount` (the governed figure) untouched** — the override is *pending*; Finance may revise a still-pending override freely; once approved it is write-once · `POST .../override/approve` (`commission-override.approve` / **Manager**) — `assertDifferentActors(overrideRequestedByUserId, actor)` (403) + the `CommissionLedgerEntry_maker_checker_distinct` CHECK, a status-conditional `updateMany` (0 rows → 409), **copies `overrideAmount` into `amount`**; a null requester → 409 (the #28 `'' === actor` fix), a different approver on an already-approved override → 409, the same one → idempotent · `CommissionLedgerEntryView` carries `amount` (governed) / `overrideAmount` / `effectiveAmount` (`overrideApproved ? overrideAmount : amount`) / `overridePending` · audit: `CREATE` / `UPDATE CommissionAgreement`, `CREATE CommissionLedgerEntry` (ids + the rate applied + amount, no free text), `UPDATE` (override raise) / `APPROVE` (override approve) — both carry `overrideReason` **verbatim** (the reason IS the "separately logged" requirement, a business justification not personal data — same as #22's `refundAuditSnapshot`) · book-wide reads (`GET /commission/agreements` `commission-rate.manage`; `GET /commission/entries` + `/:id` `financial-report.view`; a `GET /commission/insurers` `{ id, name }` helper) · `vatAmount` stays `0` (VAT on commission is #36's "tax implications" line) · **`/brain-gap` filed + pushed** (ibms-brain `950d5eb`: `finance-lifecycle.md` gains a "Commission Calculation (Process 35)" section; `race-safe-invariants.md` gains the "re-assert every validated field" clause) · web: a new **"Commission rates"** screen (`app/(app)/commission/page.tsx` + `lib/commission/commission-api.ts` + an `AppNav` entry — the rate-table history + a Compliance/Manager add form) and a per-policy **"Commission"** block on the opportunity detail screen (`components/policy/CommissionSection.tsx` — calculate / raise override / approve, `canCalculate={isFinance}` / `canApproveOverride={isManager}`) | **the rate table is time-windowed but has no scheduled-change automation** — a future `effectiveFrom` opens/closes windows by date arithmetic in `resolveGovernedRate`, nothing sweeps them · **`calculate` uses `inceptionDate ?? createdAt`** as the rate-resolution date — a policy with neither would fall back to `createdAt`; a governed "as of the binding instant" would need a `Policy.boundAt` that does not exist · **#31 / #22 are not migrated onto the governed rate** (documented above) — a reconciliation of `Invoice.commissionDeducted` vs `CommissionLedgerEntry.effectiveAmount` is a later process · **one `CommissionLedgerEntry` per policy** — renewal / a second commission entry type would relax the `policyId @unique` to a discriminated constraint (renewal is not built) · **no `paid` / `reversed` transitions** — #35 only ever creates at `outstanding`; the lifecycle (and VAT on commission) is #36 · **no override reject / withdraw** — a bad *pending* override is revised in place; an *approved* one needs a future correction path · `commission.calculate` / the override perms are role-level (no per-officer queue) |
| 36 | Commission Reconciliation | **extends the `commission` module** — **migration `20260903130000`** adds `CommissionAgreement.vatRatePercent DECIMAL(5,2) NOT NULL DEFAULT 0` and, on `CommissionLedgerEntry`, `vatRatePercent DECIMAL(5,2) NOT NULL DEFAULT 0` + `paidAmount` / `paidAt` / `paymentReference` / `reversedAmount` / `reversedAt` / `reversalReason` (all nullable) · **seed: +`commission.reconcile` `[FINANCE_COLLECTIONS_OFFICER]`** ("Reconcile a commission ledger entry against the insurer statement and mark it paid") · **VAT on commission is GOVERNED on `CommissionAgreement`** — `commission-rate.manage` (Compliance / Manager) sets `vatRatePercent` beside `ratePercent`, Finance only applies it; `POST /commission/agreements` takes an optional `vatRatePercent` (`0..COMMISSION_MAX_VAT_RATE_PERCENT` = 100, **422** outside; omitted → `0`); a same-rate re-`POST` is idempotent only if **both** `ratePercent` **and** `vatRatePercent` match · **the rate is snapshotted onto the entry at `calculate`** — `CommissionLedgerEntry.vatRatePercent` freezes the governing agreement's rate when `POST /commission/entries` runs, and `vatAmount = amount × vatRatePercent%` (`computeCommissionVat` → `applyPercentage`) is stamped then (no longer `0`); the invariant `vatAmount == amount × vatRatePercent%` holds after **every** write — an approved manual override recomputes `vatAmount` from `overrideAmount × the frozen rate` (in `recordOverrideApproval`'s `data`, derived purely from fields the `where` already pins — no new race surface), and a later `CommissionAgreement` edit does not disturb a recorded entry · `CommissionLedgerEntryView` gains `vatRatePercent`, a non-zero `vatAmount`, and `grossAmount = amount + vatAmount` · **`status` gets its `outstanding → paid | reversed` lifecycle** — `CommissionLedgerEntry` is **NOT** a `WorkflowTransitionService` entity (its `status` is a plain string, like `ReconciliationException.status`), but the legal moves live in `commission.config.ts`'s `COMMISSION_ENTRY_TRANSITIONS` (`outstanding: [paid, reversed]`, `paid: [reversed]`, `reversed: []`) / `isCommissionEntryTransition`, and every move validates against it, writes an audit row, and persists via a **status-conditional `updateMany`** — never a bare `.status =` (`workflow-state-transitions.md` spirit + `race-safe-invariants.md`) · **`outstanding → paid` = `POST /commission/entries/:id/settle`** (`commission.reconcile` / **Finance**, **no maker/checker** — Finance applies/settles the governed figure, it is not an approval, same call as #32's remittance): `{ statementAmount, paymentReference }`, `statementAmount` **must equal the recorded `amount` exactly** (`compareMoney === 0`) — a variance is a **422** pointing at Process 39's `ReconciliationException`, never a silent short settle (`money-decimal-jod.md` at the door, the #32 rule); a **pending** manual override blocks settlement (**422** — the amount is not final); a `reversed` entry cannot be settled (**422**); stamps `status = 'paid'`, `paidAmount = amount`, `paidAt`, `paymentReference` (a pointer, not free text); write-once — a re-`POST` with the same figure **and** reference resumes (200), a different one is a **409**; the status-conditional `updateMany` `where` re-asserts `amount` (a concurrent override-approve → clean 0-row 409) and "no pending override" (`OR: isManualOverride false | overrideApprovedByUserId not null`) · **`{outstanding|paid} → reversed` is DRIVEN BY Process 22, not an endpoint** — when a cancellation / negative `Endorsement` mints a `CommissionReversal` for the policy (`calculateAdjustment`), the endorsement service **best-effort** calls `CommissionLedgerService.reconcileReversalForPolicy(policyId, actorId)` (the #29 `lossRatio.recomputeForPolicy` precedent — only the actual transitioner, never fails the endorsement flow, the entry may not exist yet); it recomputes `reversedAmount` from **live** rows — `computeReversalState` pools every `CommissionReversal.amount` on the policy's endorsements, **caps at `amount`** (you cannot reverse more commission than was earned), and `fullyReversed` once the pool meets `amount`; it stamps `reversedAmount` / `reversedAt` / `reversalReason` (a system-generated pointer to the endorsement) and flips `status → reversed` **only when fully clawed back** — a partial cancellation leaves `status = 'outstanding'` with a partial `reversedAmount`; a missed best-effort call self-heals on the next endorsement, and `settle` re-checks the same live gate — a pre-check **422** *and* a relation filter in the settlement `updateMany` `where` (`policy: { endorsements: { none: { commissionReversal: { isNot: null } } } }`), so a `CommissionReversal` minted concurrently with a `settle` lands a clean 0-row → **409** rather than paying commission on cancelled cover; `EndorsementModule` imports `CommissionModule` (one-way — no cycle) · audit: `CREATE` / `UPDATE CommissionAgreement` now carry `vatRatePercent`; `CREATE CommissionLedgerEntry` carries `vatRatePercentApplied` + `vatAmount`; `settle` writes an `UPDATE CommissionLedgerEntry` (`settlementAuditSnapshot` — `paidAmount` + the statement `paymentReference`); the reversal reflection writes an `UPDATE` (`reversalAuditSnapshot` — `reversedAmount` + the reason verbatim, a business justification like `overrideReason`) · **`/brain-gap` filed + pushed** (ibms-brain — `finance-lifecycle.md` gains a "Commission Reconciliation (Process 36)" section) · web: the "Commission rates" screen gains a **VAT %** column + input; the per-policy **"Commission"** block gains VAT / gross / paid / reversed detail and a Finance **"Reconcile & mark paid"** form (statement amount + reference) | **no commission-reconciliation summary report** — an AP-style outstanding-vs-paid-vs-reversed roll-up by insurer is **Financial Reporting (#40)**; the per-entry lifecycle fields + `GET /commission/entries` are the #36 deliverable · **the Jordan GST rate on commission is unsourced** — `CommissionAgreement.vatRatePercent` is the *governed home* for the figure, but its value is a manual Compliance / Manager input (no computed default, no exemption model, no governed tax-rate table) · **`settle` needs an EXACT statement match** — a partial / over / short commission payment 422s (pointing at #39); there is no partial-settlement accumulation, no `Receipt`-style variance object here · **the reversal reflection is best-effort + has no sweep** — if `reconcileReversalForPolicy` fails after the `CommissionReversal` is minted, the ledger entry stays un-flipped until the next endorsement on the policy or a `settle` attempt re-checks the live gate (there is no cron that reconciles drifted entries) · **partial reversal then settle is blocked** — an entry with a non-zero `reversedAmount` but `status = 'outstanding'` 422s on `settle` (the statement won't match `amount`); a settle-the-remainder path is a deferred refinement · **no `paid → reversed` via `settle`** — a clawback after payment still flows only through a Process 22 endorsement · **no un-reverse / un-settle** — both are effectively write-once · `commission.reconcile` is role-level (no per-officer reconciliation queue) |
| 38 | Payment Processing | **extends the `finance` module** — **migration `20260903140000` (39th)** adds the `PaymentChannel` table (`ownerType` `customer`\|`insurer`, `customerId?`/`insurerId?`, `channelType`, `label`, `bankName?`, `accountLast4?`, `currency`, `status` `active`\|`disabled`, `disabledAt?`), a `PaymentChannel_owner_exactly_one` CHECK (exactly one of `customerId`/`insurerId` is set and matches `ownerType`), and nullable `Receipt.paymentChannelId` / `Remittance.paymentChannelId` FKs · **seed: +`payment-channel.manage` `[FINANCE_COLLECTIONS_OFFICER]`** · **`PaymentChannel` is a governed reference list, NOT a workflow entity** — `POST /payment-channels` (`payment-channel.manage` / Finance) records an approved channel for a customer (money **in**, on a `Receipt`) or an insurer (money **out**, on a `Remittance`); created `active`; `POST /payment-channels/:id/disable` is a status-conditional `updateMany` (`where: { id, status: 'active' }`, 0 rows → already disabled → idempotent); `GET /payment-channels?ownerType=&customerId=&insurerId=&status=` is the book-wide list · **no maker/checker** (maintaining a reference list is single-actor Finance work — `roles-and-segregation-of-duties.md`) · **MASKED-ONLY — no full bank account / card number anywhere** (`sensitive-data-handling.md`: bank/card data is Highly Confidential, a list view showing a full account number is a violation); #38 stores `label` + `bankName` + `accountLast4` (`^\d{2,4}$`) and nothing else — the DTO has no full-number field, the model stays `CONFIDENTIAL`, and the audit snapshot carries `ownerType` / `channelType` / `label` / `bankName` / `status` but **never `accountLast4`** · **#32's `Receipt` / `Remittance` reference a channel — optional but validated**: on `POST /invoices/:id/receipt` an optional `paymentChannelId` must be an **`active`** channel with `ownerType = customer` and `customerId = invoice.customerId` (else **422**; **404** on an unknown id), and it **DERIVES `Receipt.method`** from `channel.channelType` (a caller `method` that disagrees is a **422** — the "computed, not an input, when derivable" rule, #28 `netSettlement` / #31 `totalAmount`); `POST /invoices/:id/remittance` is the insurer-side mirror (`ownerType = insurer`, `insurerId = policy.insurerId`) · keeping it optional leaves #32's existing contract + e2e unchanged (a hard "must use an approved channel" gate is a later tightening); #32's write-once / idempotency comparisons (`existingReceipt`, the `finishReceipt` / `finishRemittance` concurrent + `P2002` resume checks) now **also compare `paymentChannelId`** — a re-`POST` with a different channel is a **409**, so the remittance `P2002` branch is no longer an unconditional "deterministic resume" · `Remittance.remittedAt` is unchanged (#32 already stamps it); `Receipt.method` keeps its `bank_transfer \| cheque \| card \| cash` domain, now shared with `PaymentChannel.channelType` · `InvoiceView`'s `receipt` / `remittance` blocks gain `paymentChannelId`; the #32 `CREATE Receipt` / `CREATE Remittance` audit snapshots gain `paymentChannelId` (a pointer) · **`/brain-gap` filed + pushed** (ibms-brain — `finance-lifecycle.md` gains a "Payment Processing (Process 38)" section) · web: a new **"Payment channels"** screen (`app/(app)/payment-channels/page.tsx` + `lib/finance/payment-channel-api.ts` + an `AppNav` entry) — an owner / type / label / bank / last-4 add form and a list with a per-row Disable, account fragments shown `••••1234` | **masked-only** — no full IBAN / account number / SWIFT is stored anywhere; full-number storage + encryption (via the existing `EncryptionService`) is a deferred refinement · **the channel on a `Receipt` / `Remittance` is OPTIONAL, not mandatory** — a "must use an approved channel" hard gate is a later tightening · **no per-owner "default channel"** — the caller picks the channel explicitly on each receipt / remittance, no auto-pick · **no channel on refunds (#37) or commission settlement (#36)** — #38 only wires the #32 cycle · **no bank / payment-gateway integration** — a `Receipt` / `Remittance` still records that money moved as a *fact* (`receivedAt` / `remittedAt`), not an executed transfer; there is no reversal / clawback · **no approval workflow on the channel itself** — `active` / `disabled` only (Finance adds = approved) · `payment-channel.manage` is role-level (no per-officer channel queue) |
| 39 | Bank Reconciliation | **extends the `finance` module** — **migration `20260903150000` (40th)** adds `ReconciliationException.raisedByUserId` / `resolvedByUserId` / `resolutionNote` (all nullable), two plain indexes (`invoiceId`, `status`), and a partial `UNIQUE ("invoiceId") WHERE "status" <> 'resolved' AND "invoiceId" IS NOT NULL` (raw SQL — one non-resolved exception per invoice). The `ReconciliationException` model, the `InvoiceStatus.EXCEPTION_RAISED` / `EXCEPTION_RESOLVED` values, the `WORKFLOW_TRANSITIONS.Invoice` exception hops, and the `reconciliation-exception.investigate` (`[FINANCE_COLLECTIONS_OFFICER]`) / `reconciliation-exception.resolve` (`[FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) perms all already existed (seeded in `a440c1b`) · **no seed change** · **`ReconciliationException` is a plain-string-`status` entity, NOT a `WorkflowTransitionService` entity** (the `CommissionLedgerEntry.status` pattern) — the legal moves live in `finance.config.ts`'s `RECON_EXCEPTION_TRANSITIONS` (`open: [investigating, resolved]`, `investigating: [resolved]`, `resolved: []`) / `isReconExceptionTransition`, every move validates against it, writes an audit row, and persists via a **status-conditional `updateMany`** · **`POST /reconciliation-exceptions/detect`** (`reconciliation-exception.investigate` / **Finance**) runs the variance check over a batch of insurer-statement lines carried **in the request body** (`{ lines: [{ invoiceId, insurerStatementAmount }] }` — there is no `InsurerStatement` model; the statement figures are the job input); per line `brokerRecordAmount = premiumAmount − commissionDeducted` (`computeRemittanceAmount` — the net the insurer expects, exactly #32's `Remittance.amount`), `varianceAmount = computeVariance(statement, broker) = subtractMoney(statement, broker)` — **exact, can be ±, never rounded away** · **a non-zero variance ALWAYS raises a `ReconciliationException`** (`status = 'open'`, the exact `varianceAmount` stored) — **never a silent write-off** (`money-decimal-jod.md` — "a mismatch is raised as an exception with the exact variance amount, never silently written off or rounded away"); a **zero** variance reconciles silently (`outcome: 'reconciled'`, no row) · cap `RECON_DETECT_MAX_LINES = 500` (drafted); a duplicate `invoiceId` in the batch → **422**; an unknown / non-policy invoice is **flagged per-line** (`invoice_not_found` / `not_a_policy_invoice`), not thrown, so the rest of the batch still processes; the response is `{ lineCount, reconciled, exceptionsRaised, results: [{ invoiceId, outcome, varianceAmount?, exceptionId? }] }` · **one non-resolved exception per invoice** — the partial `UNIQUE` is the race backstop; a re-`detect` with the **same** figures → `outcome: 'exception_exists'` (idempotent), **different** figures → `outcome: 'conflicting_exception'` (resolve the old one first), a concurrent create → `P2002` → the same resume/conflict split · **the exception is the source of truth for the variance; the `Invoice` transition is state-gated + best-effort** — `Invoice` IS a `WorkflowTransitionService` entity, so `detect` drives `COLLECTED | RECONCILED → EXCEPTION_RAISED` through the engine (the only two `→ EXCEPTION_RAISED` sources in `WORKFLOW_TRANSITIONS.Invoice`); for any **other** invoice state the exception is **still recorded** (that IS the "never written off" guarantee), just with no engine transition, and a failed transition is a `logger.error`, not a throw · **`POST /reconciliation-exceptions/:id/investigate`** (`reconciliation-exception.investigate`) — `open → investigating`, stamps `investigatedByUserId`; already-`investigating` is an idempotent 200 regardless of who, already-`resolved` → **422** · **`POST /reconciliation-exceptions/:id/resolve`** (`reconciliation-exception.resolve` / **Finance, Manager**) — `{ resolutionNote, resumeInvoiceAs? }`; `resolutionNote` is **mandatory** (`@MinLength(10)`, `@MaxLength(2000)`) and logged **verbatim** (the reason IS the "closure path", a business justification like #35's `overrideReason`); `{open|investigating} → resolved` (+ `resolvedAt` / `resolvedByUserId`); **NO figure is adjusted** — the `varianceAmount` stays recorded on the exception (the whole point of "never a silent write-off") · then, when the parent `Invoice` is mid-exception (`EXCEPTION_RAISED` / `EXCEPTION_RESOLVED`), the engine drives it `EXCEPTION_RAISED → EXCEPTION_RESOLVED → RECONCILED` (or just the last hop on a crash re-entry that finds it already at `EXCEPTION_RESOLVED`, re-reading between the two hops so a concurrent `resolve` is a clean no-op not a same-state engine error); `resumeInvoiceAs` can only be **`RECONCILED`** — the engine map also allows `EXCEPTION_RESOLVED → REMITTED`, but resuming straight there would land a terminal-state invoice with **no `Remittance` row and no `out` `ClientFundsLedgerEntry`** (both minted only inside `POST /invoices/:id/remittance`'s `$transaction` — Part 7.3 client-money trace), so `resolve` returns the invoice to `RECONCILED` and Finance completes the cycle with a normal remittance call; `resumeInvoiceAs` is **required** when the invoice is mid-exception (**422** if omitted), ignored otherwise · **ordering** — the invoice hops run **before** `recordResolution` so a crash before the exception write is a clean retry (the #31 / #28 lesson); an idempotent re-`resolve` with the same note → 200, a different note → **409** · **no maker/checker** (`roles-and-segregation-of-duties.md` — the Finance maker/checker pair is refunds / overrides; reconciling the cycle is single-actor, with `investigate` [Finance] vs `resolve` [Finance, Manager] as the natural segregation) · book-wide reads (`GET /reconciliation-exceptions?invoiceId=&status=` + `GET /reconciliation-exceptions/:id`, `reconciliation-exception.investigate`; capped `RECON_EXCEPTION_READ_LIMIT = 5000`, `logger.warn` on truncation) · audit: `CREATE ReconciliationException` (the three figures as fixed 3dp strings + ids + status, no free text), `UPDATE` on investigate (the investigator) and on resolve (`resolutionNote` verbatim + `resolvedByUserId` + `resumeInvoiceAs`) + the engine `TRANSITION` rows on the `Invoice` · **`/brain-gap` filed + pushed** (ibms-brain — `finance-lifecycle.md` gains a "Bank Reconciliation (Process 39)" section) · web: a new **"Bank reconciliation"** screen (`app/(app)/bank-reconciliation/page.tsx` + `lib/finance/reconciliation-api.ts` + an `AppNav` entry) — an `invoiceId, amount` textarea that posts a detect batch and a table of open exceptions with per-row Investigate / Resolve | **no `InsurerStatement` model / statement audit trail** — the statement figures are a transient request input, not stored; there is no import format, no per-statement grouping · **the broker record is always the deterministic `premium − commission`**, not the actual `Remittance.amount` (they are equal by #32's construction — a real reconciliation against the posted `Remittance` is a later refinement) · **`resolve` cannot itself correct a figure** — a genuine broker-record correction is a manual / #40 concern; the exception closes with a note, the variance stays on the record · **no ageing / dashboard of open exceptions** (a worklist of un-investigated exceptions by age is a #40 reporting concern) · **no automatic detection sweep** — there is no statement data source to sweep; `detect` is caller-driven · `RECON_DETECT_MAX_LINES` (500) is a **drafted** batch bound · `reconciliation-exception.investigate` / `.resolve` are role-level (no per-officer exception queue) |
| 40 | Financial Reporting | **extends the `finance` module** — **no migration, no seed change** (`financial-report.view` = `[FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`, the **same perm** `GET /commission/entries` already uses, was seeded in `a440c1b`). The backlog line has **no checkboxes** ("Financial Reporting — dashboard D in Part E"); "dashboard D" is Part E's **Financial Dashboard** (receivables & ageing, payables to insurers, commission income & outstanding, profitability by client segment / line) — #40 is the **backend** it consumes · **`GET /financial-report/summary?asOf=`** (`financial-report.view`) returns `{ asOf, currency: 'JOD', receivables, payables, commission, profitability }`, **computed on the fly**, **book-wide** (a cross-book reporting perm), **no maker/checker** (a read) · **`receivables`** = #33's `buildReceivablesAgeing(...).totals` **verbatim** (the `outstandingTotal` + the five ageing buckets + `invoiceCount` / `customerCount`) — the service calls `ClientAccountingService.receivablesAgeing` directly (the truncation `logger.warn` still fires) and passes `asOf` through; **`payables`** = #34's `buildInsurerPayables(...).totals` **verbatim** (`outstandingAmount` / `remittedAmount` + counts + `insurerCount`) via `InsurerAccountingService.payables` · `asOf` (bare `YYYY-MM-DD`, today or earlier — a future `asOf` → **422**, default today) makes **the receivables + payables sections point-in-time**; the summary parses `asOf` once for the response + the future guard and passes the **canonical `YYYY-MM-DD`** down to both sub-services (so all three parse the identical string — no drift if the request straddles UTC midnight with `asOf` omitted) · **`commission`** is the new pure **`buildCommissionRollup`** (the "AP-style outstanding-vs-paid-vs-reversed roll-up by insurer" #36 deferred here) — per `CommissionLedgerEntry`: `earned = amount` (the *effective* commission — `amount` holds the governed figure on a fresh / pending-override entry and the approved override once copied in, the `deriveLedgerEntryView` `effectiveAmount` rule), `paid = paidAmount ?? 0`, `reversed = reversedAmount ?? 0`, **`outstanding = max(0, amount − paid − reversed)`** — floored at 0 per entry so a reconciled-then-clawed-back entry (`paidAmount == amount` **and** `reversedAmount > 0` — a legal #36 / #22 state, `settle` then a Process 22 cancellation) never reports a negative "still collectible" (which would drag the pooled total down and invert the worst-first sort — a `@code-reviewer` BLOCKER, fixed). The strict identity `earned == paid + outstanding + reversed` therefore holds **only for entries with no paid+reversed overlap** (the normal case); **`netEarned = earned − reversed`** is the recognised commission income after clawbacks. Also `vat` (Σ `vatAmount`) and `gross = earned + vat` are on the **gross** `earned` (a reversal's VAT treatment is a #36 / tax concern, not netted — deferred), `entryCount`, and `byInsurer[]` (the same `CommissionRollupFigures` per `policy.insurerId`, worst-first — largest `outstanding`, then `earned`, then insurer name in a fixed `en` locale; the book totals pool the exact per-entry values the rows do) · **`profitability`** is the new pure **`buildProfitability`** — every **written** policy (status past `PLACEMENT_CONFIRMED` — the #30 `ANALYTICS_WRITTEN_POLICY_STATUSES` list; a cancelled / expired policy still contributes its full written premium) grouped by `insuranceLine` (`byLine`) and by `Customer.customerType` (`bySegment` — `CORPORATE` / `INDIVIDUAL`), each with `premiumWritten` (Σ `issuedPremium ?? requestedPremium`), `claimsPaid` (Σ net settlement of the group's SETTLED / CLOSED claims), `commissionEarned` (Σ `entry.amount − entry.reversedAmount`, net of clawback) and **`netPosition = premiumWritten − claimsPaid − commissionEarned`** — the backlog line's literal "premium − claims − commission" (a **drafted** interpretation: for a *broker* the P&L driver is `commissionEarned`, but the backlog wording is the book's underwriting result, so that is what the field returns; it can be negative); rows worst-first (smallest / most-negative `netPosition`) · **`commission` + `profitability` are current-state** — `asOf` does **not** constrain them (the commission ledger / `Policy.issuedPremium` are not time-versioned) · **the profitability section aggregates SETTLED / CLOSED `Claim` net settlements (HIGHLY_CONFIDENTIAL)** — so, exactly like #30 Claims Analytics, the service writes a **best-effort `READ` audit row** (`entityType: 'FinancialReport'`, `entityId: 'summary'`, `afterValue` = `asOf` + counts only, **never a figure or a name**; `isSensitiveDataAccess` when a settled claim contributed); contrast #33 / #34, which are Confidential-tier and **not** audited · all four reads run under one `Promise.all`; each section is capped at `FINANCIAL_REPORT_ROW_LIMIT = 5000` (`logger.warn` on truncation) · `finance.config.ts` gains `buildCommissionRollup` / `buildProfitability` (+ their row / section types), `FINANCIAL_REPORT_ROW_LIMIT`, `PROFITABILITY_GROUP_BY`; new `repositories/financial-report.repository.ts` (`loadCommissionRollupEntries` / `loadProfitabilityPolicies` — book-wide, capped) · **`/brain-gap` filed + pushed** (ibms-brain — `finance-lifecycle.md` gains a "Financial Reporting (Process 40)" section; intro → "**Domain D is complete**") · web: a new **"Financial report"** screen (`app/(app)/financial-report/page.tsx` + `lib/finance/financial-report-api.ts` + an `AppNav` entry) — an `asOf` date `<input>` and the four sections rendered as figure lists + a `byInsurer` / `byLine` / `bySegment` table each | the `asOf` / line / insurer / **branch / language filters** and the dashboard UI proper are **Part E** — #40 is the backend only · `commission` + `profitability` are **current-state only** (no point-in-time reconstruction — the commission ledger and `issuedPremium` aren't time-versioned) · **`netPosition`** (`premium − claims − commission`) is a **drafted** metric — no CBJ / Part-3.6 profitability definition · no CSV / export; JOD-only (the `money.util.ts` / #30 / #33 / #34 single-currency assumption) · the aggregation is **in-memory** (`findMany` + JS grouping), fine at a broker's book size, capped at 5000 rows per section · `financial-report.view` is role-level (no per-officer scoping) |

### Part C · Domain E #41–46 — Customer Requests, Complaints, SLA Management, Customer Communication, Customer Feedback & Customer Retention (Domain E complete), with these deferrals

| # | Process | Built | Not done (detail in § Known gaps) |
|---|---|---|---|
| 41 | Customer Requests | **new module** `apps/api/src/modules/customer-service/` (+ `repositories/service-request.repository.ts`) — **opens Domain E** · **migration `20260903160000` (41st)** only **widens** the pre-existing `ServiceRequest` model: `policyId` (nullable FK, `ON DELETE SET NULL`), `detail`, `raisedByUserId` / `assignedToUserId` / `fulfilledByUserId`, `outcomeNote`, `@@index([customerId])` / `@@index([status, createdAt])` (open-queue read) / `@@index([assignedToUserId])` (my-queue read). The `ServiceRequest` model, its `slaTimerId @unique` link to the generic `SlaTimer`, and the `service-request.manage` (`[SALES_RELATIONSHIP_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) perm all already existed · **no seed change** · **`ServiceRequest.status` is a PLAIN STRING, NOT a `WorkflowTransitionService` entity** (the `CommissionLedgerEntry` / `ReconciliationException` pattern) — `SERVICE_REQUEST_TRANSITIONS` (`open: [in_progress, fulfilled, cancelled]`, `in_progress: [fulfilled, cancelled]`, both terminal `[]`) / `isServiceRequestTransition` + a service `assertTransition`, every move a **status-conditional `updateMany`** (0 rows → reload → idempotent-or-**409**) · **endpoints** (all `service-request.manage` / Sales, Manager): `POST /service-requests` (`{ customerId, requestType, detail?, policyId?, assignedToUserId? }` — creates at `open`, starts the SLA timer), `POST /service-requests/:id/assign` (`{ assignedToUserId }` — while `open` / `in_progress`), `POST /service-requests/:id/start` (`open → in_progress`, idempotent), `POST /service-requests/:id/fulfil` + `.../cancel` (`{ outcomeNote }` **mandatory** `@MinLength(3)` / `@MaxLength(2000)`, logged **verbatim** — `{open|in_progress} → terminal`, stamps `closedAt` + (fulfil) `fulfilledByUserId`, resolves the SLA timer; a same-note re-close → 200, a different note → **409**, the other terminal state → **422**), `GET /service-requests?customerId=&status=&assignedToUserId=` + `GET /service-requests/:id` (book-wide, capped `SERVICE_REQUEST_READ_LIMIT = 5000`) · **`policyId` (optional) must belong to `customerId`** — a **422** on a cross-customer policy, **404** on an unknown one; `assignedToUserId` validated to exist (**404**) · **the SLA timer is the generic `SlaTimerService` engine** — a new `SLA_REGISTRY` entry `service_request_fulfilment` (`entityType: 'ServiceRequest'`, **5 business days**, one escalation stage → `BRANCH_DEPARTMENT_MANAGER`). **The 5-day figure is DRAFTED / UNSOURCED** — a customer-service turnaround is a published service-standard / courtesy target, **not a PDPL statutory SLA** (`pdpl-sla-timers.md` § "What does NOT trigger this rule" — internal targets are ordinary KPIs); the backlog line names `SlaTimer` so #41 tracks it as a real timer + the existing nightly escalation sweep, and the registry `citation` marks it DRAFT/UNSOURCED like the two KYC rows · **the timer is started BEST-EFFORT at create** (the A.8 / `AccessRecertificationService.startCycle` precedent — the request is already committed; a timer-bookkeeping failure must not roll it back or hide that it was logged), then a best-effort `attachSlaTimer` (`updateMany({ where: { id, slaTimerId: null }, data: { slaTimerId } })`) populates the direct 1:1 `ServiceRequest.slaTimerId @unique` (the schema intends the link — `SlaTimer.serviceRequest` back-relation — unlike `AccessRecertificationCycle`, which has no `slaTimerId`) · `SlaTimerService.resolve` (best-effort) flips the timer's `resolvedAt` on fulfil / cancel · `deriveServiceRequestView`'s `sla` block carries a computed **`breached`** (`resolvedAt === null && dueAt <= now`) so the UI shows "overdue" before the nightly sweep has stamped `escalatedAt` · **no maker/checker** (a service-desk request is single-actor Sales / Manager work — `maker-checker-segregation.md`; the mandatory supervisor sign-off is #42 Complaints' `complaint.close`, not #41) · audit: a best-effort `CREATE ServiceRequest` (ids + type + `detail` + status + `assignedToUserId`), an `UPDATE` on every move (new status + who + `outcomeNote` verbatim + `closedAt`) + the `SlaTimer` engine's own `CREATE` / `SLA_ESCALATED` rows · **`detail` / `outcomeNote` carry a `NO_FULL_ACCOUNT_NUMBER` `@Matches` guard** (rejects a run of 9+ digits, message points at `PaymentChannel` #38) — a Confidential free-text field next to a masked-data path must not be its capture point (`sensitive-data-handling.md`, new clause) · **`@code-reviewer` → APPROVE WITH MINORS** (2 MINORs + 5 NITs addressed — `start`-on-terminal now 422, the free-text guard + lex clause, the composite indexes, the drafted-citation spec, 0-row race tests) · **`/brain-gap` filed + pushed** (ibms-brain — **new `meta/context/customer-service-lifecycle.md`** (Domain E seed) with a "Customer Requests (Process 41)" section; `sensitive-data-handling.md` gains the free-text-guard clause) · web: a new **"Customer requests"** screen (`app/(app)/service-requests/page.tsx` + `lib/customer-service/service-request-api.ts` + an `AppNav` entry) — a log form (customer id / type / detail) and a table of requests with their SLA state (`due …` / `BREACHED …` / `resolved`) and per-row Start / Fulfil / Cancel | the 5-business-day SLA is **drafted / unsourced** (no broker service charter / SOP figure) — same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23), the #27 follow-up thresholds, the #40 `netPosition` metric · **no `ServiceRequest` → `Document` link** — a fulfilled certificate request does not attach the generated PDF (a #25-style `Document` pointer, deferred) · one 5-day SLA for **all four** `requestType`s (no per-type target) · **no re-open path** — a `fulfilled` / `cancelled` request is terminal · a `change` request records intent but **executes nothing** — no path from a service request to a `PaymentChannel` (#38) or an `Endorsement` (#22) · no customer-facing portal / self-service; no bulk actions · `detail` / `outcomeNote` are Confidential business notes (the `NO_FULL_ACCOUNT_NUMBER` guard is the only masking) · `service-request.manage` is role-level (no per-officer queue beyond the `assignedToUserId` filter) |
| 42 | Complaints Management | **extends the `customer-service` module** · **migration `20260903170000` (42nd)** only **widens** the pre-existing `Complaint` / `ComplaintAction` / `EscalationRecord`: `Complaint.resolvedByUserId` / `resolvedAt`, `EscalationRecord.escalatedByUserId`, a `Complaint_closure_maker_checker_distinct` CHECK, and 4 indexes (`@@index([status, createdAt])` replacing the bare `@@index([status])`, `@@index([claimId])`, `@@index([responsibleEmployeeUserId])`, `@@index([complaintId])` on both child tables). The models, the `ComplaintStatus` enum, `Complaint.slaTimerId @unique`, the `WORKFLOW_TRANSITIONS.Complaint` map, and the `complaint.log` `[SALES, CLAIMS, FINANCE, COMPLIANCE, MANAGER]` / `complaint.close` `[MANAGER]` / `complaint.escalate` `[MANAGER, COMPLIANCE]` perms all already existed · **no seed change** · **`Complaint.status` IS a `WorkflowTransitionService` entity** (unlike #41) — `LOGGED → [ASSIGNED]`, `ASSIGNED → [IN_PROGRESS]`, `IN_PROGRESS → [RESOLVED, ESCALATED]`, `ESCALATED → [IN_PROGRESS, RESOLVED]`, `RESOLVED → [CLOSED]`; every move through `WorkflowTransitionService.transition`, the one non-transition write is `recordAssignee` (sets `responsibleEmployeeUserId`, no status change, status-conditional); **only `CLOSED` is terminal** · **endpoints**: `POST /complaints` (`complaint.log` — `{ customerId, issue, category?, claimId?, policyId?, responsibleEmployeeUserId? }`, creates at `LOGGED`, best-effort SLA start), `.../:id/assign` (`{ responsibleEmployeeUserId }` — from `LOGGED` also drives `→ ASSIGNED`; else a plain re-assign; **404** unknown user; **422** CLOSED/RESOLVED; 0-row → **409**), `.../:id/start` (`{ASSIGNED|ESCALATED} → IN_PROGRESS`, idempotent, **422** CLOSED/RESOLVED), `.../:id/actions` (`{ actionText }` `@MinLength(3)` — appends a `ComplaintAction` while not CLOSED), `.../:id/resolve` (`{ resolution }` `@MinLength(10)` mandatory **verbatim** — `{IN_PROGRESS|ESCALATED} → RESOLVED`, stamps `resolvedByUserId` + `resolvedAt`; same-note re-resolve → 200, different → **409**; **422** CLOSED), `.../:id/escalate` (`complaint.escalate` — `IN_PROGRESS → ESCALATED` + an `EscalationRecord` in the engine `sideEffect`; `{ escalatedTo?, reason? }`, `escalatedTo` default `dispute_resolution_committee`; resolves the SLA; a re-escalate while ESCALATED is a plain idempotent **no-op** — no count-then-create self-heal (`race-safe-invariants.md`), a missed best-effort `EscalationRecord` leaves the engine `TRANSITION` row as the authoritative fact; **422** CLOSED/RESOLVED), `.../:id/close` (`complaint.close` / **MANAGER** — `RESOLVED → CLOSED`, stamps `closureApprovedByUserId` + `closedAt`; idempotent if CLOSED; **422** if not RESOLVED), `GET /complaints?customerId=&status=&claimId=&responsibleEmployeeUserId=` + `/:id` (book-wide, capped `COMPLAINT_READ_LIMIT = 5000`) · **`claimId` (optional) must belong to `customerId`** — **422** cross-customer, **404** unknown (this is "link it to a claim on dispute"; same for `policyId`); `responsibleEmployeeUserId` validated to exist (**404**) · **mandatory supervisor sign-off before closure** (`maker-checker-segregation.md` / Part 5.2): the **maker** is `resolvedByUserId` (write-once once RESOLVED), the **checker** is `closureApprovedByUserId`; `assertDifferentActors` → **403** on a self-close, backed by the `Complaint_closure_maker_checker_distinct` CHECK; `Complaint` added to `maker-checker.util.ts`'s covered-pairs table · **the SLA timer is the generic `SlaTimerService` engine** — a new `SLA_REGISTRY` entry `complaint_resolution` (`entityType: 'Complaint'`, **10 business days — DRAFTED / UNSOURCED**, one escalation stage → `BRANCH_DEPARTMENT_MANAGER`). A complaint-resolution turnaround is a CBJ insurance conduct-of-business matter (the CBJ Insurance Dispute Resolution Committee `EscalationRecord` routes to is real), **not a PDPL statutory SLA**; `citation` marks it DRAFT/UNSOURCED like #41 / the two KYC rows; `EXPECTED_NON_PDPL_WORKFLOW_NAMES` gains it · started **BEST-EFFORT at create** + a follow-up `attachSlaTimer` for the 1:1 `slaTimerId`; `SlaTimerService.resolve` (best-effort) flips `resolvedAt` when the complaint reaches **`RESOLVED` OR `ESCALATED`** — escalation stops the internal clock · `deriveComplaintView`'s `sla` block carries a computed `breached` (same as #41) · **`issue` / `resolution` / `ComplaintAction.actionText` / `EscalationRecord.reason` carry the shared `NO_FULL_ACCOUNT_NUMBER` `@Matches` guard** — moved from `service-request.config.ts` to `common/dto.util.ts` this pass · audit: best-effort `CREATE Complaint` (ids + issue + category + status), `UPDATE` on resolve / close (`resolution` verbatim + `closureApprovedByUserId` + `closedAt`), best-effort `CREATE ComplaintAction` / `CREATE EscalationRecord` (text verbatim), plus the engine `TRANSITION` rows + the `SlaTimer` engine's own · **`@code-reviewer` (mandatory — migration + workflow state-machine + maker/checker closure + Confidential free-text) → CHANGES REQUESTED → resolved** (1 MAJOR + 1 MINOR + 4 NITs addressed — see the Known-gaps entry below) · **`/brain-gap` filed + pushed** (ibms-brain — `customer-service-lifecycle.md` gains a "Complaints Management (Process 42)" section) · web: a new **"Complaints"** screen (`app/(app)/complaints/page.tsx` + `lib/customer-service/complaint-api.ts` + an `AppNav` entry) — a log form + a table with per-row Assign / Start / Add action / Resolve / Escalate / Close gated by status + role | one 10-day SLA for **all categories** (no per-category target) — the figure is **drafted / unsourced** · **no re-open** of a `CLOSED` complaint · escalation does **not restart** the SLA on a return-to-handling · **no automatic escalation sweep to the committee** — the nightly `SlaTimerScheduler` sweep escalates the SLA timer to the internal `BRANCH_DEPARTMENT_MANAGER` only; the committee route is a **manual `complaint.escalate`** · no link from a complaint to a generated acknowledgement / final-response `Document` · no customer-facing portal |
| 43 | SLA Management | **new module** `apps/api/src/modules/sla-dashboard/` (+ `repositories/sla-dashboard.repository.ts`) — a read-only cross-module monitoring dashboard over the generic `SlaTimer` engine (backlog A.8) · **no migration, no seed change** — `sla-dashboard.view` (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`) was seeded in `a440c1b` · the backlog line has **no checkboxes** ("a monitoring dashboard over `SlaTimer` across every module") — like #40, it is the **backend** for a Part E-style dashboard · kept a **separate module from `SlaModule`** (which owns the engine + the 15-min escalation sweep) — this one only reads · **no maker/checker** (read-only) · today only 3 workflows create timers (`quarterly_access_review`, `service_request_fulfilment`, `complaint_resolution`); the dashboard shows **all** `SLA_REGISTRY` workflows as they come online · **endpoints** (both `sla-dashboard.view`, book-wide, computed at `now`, capped `SLA_DASHBOARD_TIMER_LIMIT = 5000` + `logger.warn` on truncation): **`GET /sla-dashboard/summary`** → `{ generatedAt, dueSoonWindow, totals, byWorkflow[], byEntityType[], byEscalationTarget[] }` — every `SlaTimer` classified into one of **6 mutually-exclusive leaf states** (`on_track` / `due_soon` / `breached` / `escalated` / `resolved_on_time` / `resolved_late`; `escalated` ⇒ past due) then tallied per group + `openBreached` (= breached + escalated) + `entityCount` (distinct `entityId` — a multi-stage workflow contributes >1 timer row per entity) + `oldestOverdueDays`; `totals.breachRate` = `(resolvedLate + breached + escalated) / (that + resolvedOnTime)` 4dp (`"0.0000"` when nothing has reached a deadline) · **`GET /sla-dashboard/timers?state=&entityType=&workflowName=`** → the filterable per-timer drill-down, worst-first (state severity, then oldest deadline); `state` accepts a **leaf** state or a **group** (`open` = unresolved · `open_breached` = breached+escalated · `at_risk` = due_soon+breached+escalated · `resolved`), default when omitted = `open`; `workflowName` is a **prefix** match so a base name catches its `::stage` rows; `baseWorkflowName()` strips the `SlaTimerService` stage suffix so the summary rolls all DSR stages into one `dsr_access_deletion` row · registry labels / `configuredDuration` / a `drafted` flag come from a **new non-throwing `findSlaRegistryEntry()`** (a `SlaTimer.workflowName` could name a since-renamed workflow — a monitoring view degrades to the raw name, never crashes) · **`SLA_DASHBOARD_DUE_SOON_WINDOW = { value: 3, unit: 'calendarDays' }`** is a **dashboard lookahead heuristic, NOT an SLA registry value** — it changes only which bucket a still-open timer shows in, never a deadline, so it is outside `pdpl-sla-timers.md`'s "any registry value must be sourced" rule; drafted, tune freely · all aggregation is pure / unit-tested in `sla-dashboard.config.ts` (mirrors `finance.config.ts`); the service only loads rows + writes the audit · **best-effort `READ` audit row** per read (`entityType: 'SlaDashboard'`, `entityId: 'summary'|'timers'`, counts + `generatedAt` + filters only — **never an `entityId` or a name**), `isSensitiveDataAccess` when the loaded set contains a timer of a personal-data-bearing entity type (`SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES` = DSR / incident / complaint / KYC / claim / legal-hold) — the #30 / #40 precedent (contrast #33 / #34, not audited) · **`@code-reviewer` (Confidential-tier operational data + a new `READ` audit row) → APPROVE WITH MINORS** — no blocker / MAJOR / lex violation, all six mandatory checks pass · **2 MINORs + 4 NITs addressed**: locale-unpinned sort tiebreak → a byte-stable `compareRaw`; `SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES` widened with `ConsentRecord` (M03) / `DataSharingApproval` (M08) + a `/brain-gap` (`sensitive-data-handling.md` § "What triggers" gains a clause — an aggregate `READ` flips `isSensitiveDataAccess` on **existence-context** from an **explicit** list, canonical list belongs in `PRIV-SRS-02`); dead `isSlaTimerStateFilter` export removed, `byEscalationTarget` `Map` keyed on `escalatedTo` directly (a `null` key, no sentinel), the redundant `sensitive` key dropped from the audit `afterValue`, friendly group-filter `<select>` labels · web: a new **"SLA dashboard"** screen (`app/(app)/sla-dashboard/page.tsx` + `lib/sla/sla-dashboard-api.ts` + an `AppNav` entry after "Complaints") — summary stat cards + breach-rate %, a by-workflow table (label · entity · configured SLA · per-state counts · oldest-overdue · a "drafted" marker), a by-entity-type table, and a `state`-`<select>` + timers table from `/timers` | the **`SLA_DASHBOARD_DUE_SOON_WINDOW`** (3 calendar days) is a drafted lookahead heuristic — same status as #41's 5-day SLA / the #40 `netPosition` metric · **no historical SLA-performance trend** — the dashboard is a live "right now" view, no `asOf`, no over-time series · **counts are per timer-*row*** — a multi-stage workflow (only the two DSR types) contributes one row per escalation stage; `entityCount` surfaces the distinct-entity number · **in-memory aggregation** capped at 5000 rows (the #30 / #33 / #40 pattern — push into the query if the timer table outgrows it) · JOD-irrelevant (no money) · no per-workflow drill-through page, no CSV / export, no notifications — the dashboard reads the same `SlaTimer` rows the nightly `SlaTimerScheduler` sweep already escalates |
| 44 | Customer Communication | **extends the `customer-service` module** · **migration `20260904120000` (43rd)** only **widens** — no new table, **no seed change** (`communication.send` `[SALES_RELATIONSHIP_OFFICER, PLACEMENT_TECHNICAL_OFFICER, CLAIMS_OFFICER, FINANCE_COLLECTIONS_OFFICER]` was seeded in `a440c1b`; 149 perms). Adds **`Customer.preferredContactChannel InteractionChannel?`** (nullable — the recorded outbound-channel preference, the parallel to the pre-existing `Customer.languagePreference` where "recorded language" already lives; also threaded through `CreateCustomerDto` / `CustomerService.toMasked` + `list` / `CustomerRepository`), **`CommunicationLog.isMarketing Boolean @default(false)`** + **`CommunicationLog.consentRecordId String?`** (nullable FK → `ConsentRecord`, `ON DELETE SET NULL`) + a `ConsentRecord.communicationLogs` back-relation, `@@index([customerId])` → `@@index([customerId, sentAt])`, new `@@index([consentRecordId])` · **`CommunicationLog` is shared with Process 12** (RFQ correspondence) — **DISCRIMINATOR: `rfqId IS NULL` == a Process-44 customer-communication row**; every Process-44 read filters `rfqId: null` (a #12 id 404s on `GET /communications/:id`) · **not a `WorkflowTransitionService` entity, no maker/checker, no `SlaTimer`** — a factual send log (the `Interaction` #10 / #12 shape; Process 44 has no SLA — the `consent_withdrawal` M03 timer is a separate concern #44 only *reads*) · new `apps/api/src/modules/customer-service/communication.{config,service,controller}.ts` + `dto/create-communication.dto.ts` + `dto/list-communications-query.dto.ts` + `repositories/communication.repository.ts`, wired as the **3rd `CustomerServiceModule` controller**; `common/dto.util.ts` gains `queryBoolean` (a `?isMarketing=true` query-flag coercer) · **endpoints** (all `communication.send`): `POST /communications` (`{ customerId, body (mandatory), channel?, languageUsed?, isMarketing?, templateId?, subject?, sentAt? }` — creates at `direction: OUTBOUND`, `respectedConsent: true`; **404** unknown customer), `GET /communications?customerId=&channel=&isMarketing=&direction=` (book-wide Process-44 list, newest-first by `sentAt` then `createdAt`, capped `COMMUNICATION_READ_LIMIT = 5000` + `logger.warn`), `GET /communications/consent-status?customerId=` (`{ customerId, marketing: { allowed, reason, consentRecordId } }` — a pre-compose check, declared **before** `:id`; **400** if `customerId` omitted), `GET /communications/:id` (a #12 / unknown id → **404**) · **"Respect the customer's recorded channel and language"** — both **derived, not an input** (`resolveChannel` / `resolveLanguage`, pure — the #28 / #31 / #38 "computed when derivable" rule): omit → taken from the `Customer` record; an explicit value that **disagrees** → **422**; `languageUsed` always resolves (`Customer.languagePreference` has a value), `channel` becomes a **required input** (**422** if also omitted) only when the customer has no `preferredContactChannel` on record; no per-message language override · **the marketing-consent gate** (`evaluateMarketingConsent`, pure) runs **only for `isMarketing: true`** — the repo loads the customer's `ConsentRecord` rows where `purpose = 'MARKETING' OR isMarketing = true` (`PRIV-SOP-04` keeps the two as separate controls; either identifies a marketing-consent row), the pure fn picks the **most recent** by `grantedAt ?? createdAt` then `createdAt` (consent is point-in-time — a fresh grant after a withdrawal is a valid re-opt-in), and `granted && withdrawnAt == null` ⇒ **allowed** (the row's id is stamped onto `CommunicationLog.consentRecordId`); otherwise the send is **BLOCKED with a 422** (`reason` ∈ `no_record` / `not_granted` / `withdrawn`), **no `CommunicationLog` row is written** (PDPL: no marketing without consent — a blocked send did not happen), and a **best-effort `REJECT` audit row** records the attempt (`entityType: 'CommunicationLog'`, `entityId: 'blocked'`, `afterValue` = `customerId` + `channel` + `blocked: 'marketing_consent_<reason>'` + `consentRecordId` — **no subject / body**); a non-marketing (service / transactional) send never touches the consent table — `respectedConsent` stays `true` (contractual necessity), `consentRecordId` null · **`subject` / `body` carry the shared `NO_FULL_ACCOUNT_NUMBER` `@Matches` guard** (`common/dto.util.ts`, same as #41 / #42) and are **Confidential-tier free text** — returned unmasked but **never in an audit row** (the best-effort `CREATE` `afterValue` is channel / language / consent metadata only — the #12 `RfqCommunication` / CRM `Interaction` precedent); **reads are NOT audited** (Confidential tier — the #33 / #34 / #41 precedent; contrast the #30 / #40 / #43 aggregate reads) · `sentAt` is backdatable via `parseHistoricalInstant` (an offset-less datetime or a future instant → **422**) · **no maker/checker** (logging a send is single-actor cross-functional work — `communication.send` is granted to four roles for exactly that reason, the #10 `interaction.log` shape) · **`@code-reviewer` (mandatory — migration + Confidential free-text + a consent gate + a new `REJECT` audit row) → APPROVE WITH MINORS** — no blocker / MAJOR / lex violation, all six mandatory checks pass or N/A with a stated reason. **3 MINORs + 1 NIT addressed**: `resolveChannel` now treats a recorded `preferredContactChannel` outside `COMMUNICATION_CHANNELS` (a `MEETING` / `VISIT` value) as **no usable preference** (was: logged verbatim as a nonsensical send channel, or a permanent 422); `evaluateMarketingConsent` rewritten to the **fail-safe rule** ("allowed only if there is an active grant AND no withdrawal event is `>=` the newest active grant's effective time") so a withdrawal on a *different / older* record still blocks — the multi-record precedence marked drafted pending a pinned `PRIV-SOP-04` section; `GET /communications/consent-status` gained a `ConsentStatusQueryDto` (`@IsUUID` → a malformed id is a 400, not a 404). **For the record (no change):** the consent gate is a read-then-write with no DB constraint (a comment + a brain Deferred note flag that a real email/SMS dispatch must re-check at send time); whether a consent-status lookup is itself a loggable read is an open `PRIV-SOP-04` check (reads stay unaudited, matching #33 / #34 / #41) · **`/brain-gap` filed + pushed** (ibms-brain — `customer-service-lifecycle.md` gains a "Customer Communication (Process 44)" section; intro → "#41–44 are built") · web: a new **"Communications"** screen (`app/(app)/communications/page.tsx` + `lib/customer-service/communication-api.ts` + an `AppNav` entry after "Complaints") — a send form (customer id · channel `<select>` defaulting to "(recorded preference)" · a "Marketing" checkbox · subject · message), a "Check marketing consent" button hitting `/consent-status`, and a table (customer · channel · lang · marketing · subject · sent) | **no real delivery integration** — this is a *log*, not a sender (no email / SMS gateway, no bounce / read tracking) · **`isMarketing` is a caller-asserted boolean** — not derived from `templateId` · one consent check covers all marketing (no per-campaign / per-purpose granularity beyond `MARKETING`) · the `POST` endpoint only writes `OUTBOUND` (`INBOUND` Process-44 rows can be created directly in the DB but not via the API) · **no `CommunicationLog` → CRM 360° timeline wiring** — `buildCustomerTimeline` (#10) still merges only interactions / policies / claims / complaints · no template library / render step (`templateId` is a free string) · no bulk / campaign send · **no `Customer` update endpoint**, so `preferredContactChannel` is set only at customer creation · the "recorded channel" is a plain enum preference — the system does not verify the customer actually has that channel's contact detail on file |
| 45 | Customer Feedback | **extends the `customer-service` module** · **no migration, no seed change** — `CustomerFeedback` (Part 4 core schema) already had every field a satisfaction-survey log needs (`customerId`, `context`, `score`, `comments`, `submittedAt`); `feedback.log` (`[SALES_RELATIONSHIP_OFFICER]`) was seeded in `a440c1b` (149 perms), and there is **no separate read permission** — `feedback.log` covers create *and* read (the #41 / #44 shape) · **not a `WorkflowTransitionService` entity, no maker/checker, no `SlaTimer`** — a factual log, create + read only, the `Interaction` #10 shape (the simplest Domain E item so far: no status, no derived fields, no cross-entity validation beyond the customer existing) · new `apps/api/src/modules/customer-service/feedback.{config,service,controller}.ts` + `dto/create-feedback.dto.ts` + `dto/list-feedback-query.dto.ts` + `repositories/feedback.repository.ts`, wired as the **4th `CustomerServiceModule` controller** · `context` restricted to the model's own three documented values (`post_issuance` / `post_claim` / `post_renewal`, `FEEDBACK_CONTEXTS` / `isFeedbackContext`); `score` optional, bounded `1`–`5` (`FEEDBACK_SCORE_MIN` / `FEEDBACK_SCORE_MAX`) — **DRAFTED / UNSOURCED** (Part 3.8 names no scale), same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23) · **endpoints** (all `feedback.log`): `POST /feedback` (`{ customerId, context, score?, comments?, submittedAt? }`; **404** unknown customer), `GET /feedback?customerId=&context=` (book-wide, newest-first by `submittedAt`, capped `FEEDBACK_READ_LIMIT = 5000` + `logger.warn`), `GET /feedback/:id`; `submittedAt` backdatable via `parseHistoricalInstant` (an offset-less datetime or a future instant → **422**; default now()) · **`comments` carries the shared `NO_FULL_ACCOUNT_NUMBER` guard, same as #41 / #42 / #44's free-text fields** · **`comments` is deliberately excluded from the `CREATE` audit `afterValue`** (ids + `context` + `score` + `submittedAt` only) — the CRM `Interaction.summary` precedent (`crm.service.ts` `logInteraction` logs channel/`occurredAt`, never `summary`), not #41 (`detail`) / #42 (`issue`/`resolution`)'s verbatim-note precedent: feedback `comments` is the customer's own subjective reflection, closer in kind to a private relationship-log note than to an operational business-action record — the audit trail leans conservative, the input guard does not follow that distinction · no ownership-based read gating — `feedback.log` is single-role and the sole gate on both write and read, book-wide · audit: best-effort `CREATE CustomerFeedback` only; reads not audited (Confidential tier — the #33 / #34 / #41 / #44 precedent) · **`@code-reviewer` (mandatory — code touching Confidential-tier customer commentary + a new `CREATE` audit-row shape) → CHANGES REQUESTED → resolved** — **1 MAJOR fixed**: a first pass reasoned `comments` was the CRM `Interaction.summary` shape and omitted the account-number guard entirely; the reviewer corrected this — feedback `comments` is customer-typed text solicited *immediately after* a claim settlement / issuance / renewal (precisely when a dissatisfied customer is most likely to paste a full account/card number) and is book-wide readable, so the guard now applies, leaving only the audit-row exclusion as the genuine divergence; **2 MINORs addressed**: the e2e now also proves a non-Sales `GET` is 403'd (was POST-only), plus `score` `1`/`5` boundary + full-account-number-in-`comments` assertions; **2 NITs deferred** (no index on `CustomerFeedback`; the truncation-`logger.warn` path untested — both noted, neither new to this module) · **`/brain-gap` filed + pushed** (ibms-brain `0c5bc63` + `7974db7` — `customer-service-lifecycle.md` gains a "Customer Feedback (Process 45)" section; intro → "#41–45 are built") · web: a new **"Feedback"** screen (`app/(app)/feedback/page.tsx` + `lib/customer-service/feedback-api.ts` + an `AppNav` entry after "Communications") — a log form (customer id · context `<select>` · a 1–5 score `<input>` · comments) and a table (customer · context · score · comments · submitted) | the 1–5 score scale is **drafted / unsourced** — same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23) and the #41 5-day SLA · **no link from a feedback row to the triggering `Policy`/`Claim`/`RenewalCase`** — `context` is a label, not a foreign key · no automatic survey trigger — logging is always a manual `POST`, no #23-style "on claim closure, prompt for feedback" flow · no duplicate-response detection — a customer can submit feedback for the same context repeatedly · no aggregation / CSAT-dashboard reporting (the #40 / #43 "backend for a Part E dashboard" shape is not repeated here — reads are a plain filtered list) · **no index on `CustomerFeedback`** — not even `@@index([customerId])`, unlike every sibling Domain E model (a follow-up migration once volume exists) |
| 46 | Customer Retention | **extends the `customer-service` module — Domain E (#41–46) is now complete** · **genuinely no migration, no seed change** — `RetentionCase` (Part 4 core schema) already had every field needed; `RenewalCase` (Part 3.9 core schema) already carried `retentionEscalatedAt DateTime?`, a nullable timestamp clearly provisioned for exactly this mechanism, unused until now; `retention-case.manage` `[SALES_RELATIONSHIP_OFFICER, BRANCH_DEPARTMENT_MANAGER]` was seeded in `a440c1b` (149 perms) · **built ahead of its data source** (the #8 / #10 / #29 shape) — the renewal module (Part 3.9) that would create a `RenewalCase` per policy nearing expiry is **not built**, so in normal running the sweep is a logged no-op, exactly #29 Loss Ratio's precedent · **not a `WorkflowTransitionService` entity, no maker/checker, no `SlaTimer`** — a factual log; `status` is a plain string `open → closed` (the model's own vocabulary — no outcome/resolution field, the bare schema has none) · new `apps/api/src/modules/customer-service/retention-case.{config,service,controller}.ts` + `retention-sweep.scheduler.ts` + 2 DTOs + `repositories/retention-case.repository.ts`, wired as the **5th `CustomerServiceModule` controller** (`AuthModule` newly imported there, for the scheduler's system-account lookup) · **the classifier** (`classifyRenewalCaseForRetention`, pure): `lapse_risk` ⇐ `status === 'LAPSED'` — checked first, always wins over inactivity; `renewal_inactivity` ⇐ the cycle has **not concluded** (`RENEWED` / `CANCELLED` excluded; `LAPSED` is deliberately NOT "concluded" — it's the other trigger) **and** `RENEWAL_INACTIVITY_THRESHOLD_BUSINESS_DAYS = 30` business days have elapsed since `triggeredAt`, reusing **`isFollowUpDue`** (`common/follow-up.util.ts` — the same test the RFQ #12 / Claim #27 follow-up sweeps use) — **DRAFTED / UNSOURCED** (Part 3.9 names a 90-*calendar*-day `leadTimeDays` default but no inactivity-escalation figure), same status as the #41 / #42 SLA figures; the two reasons are mutually exclusive by construction · **the race-safe invariant is `RenewalCase.retentionEscalatedAt`, not a new `RetentionCase` constraint** — `escalateAndCreateRetentionCase` stamps + creates the `RetentionCase` in **ONE `$transaction`** (a deliberate local exception to the no-`$transaction` convention, the `claim.repository.ts createNotification` shape), a **status-conditional `updateMany`** (`WHERE retentionEscalatedAt IS NULL AND status NOT IN (RENEWED, CANCELLED)`, the `RfqInsurer.followUpAlertSentAt` / `stampFollowUpAlert` shape (#12) plus a `status` re-assertion that precedent didn't need); `runSweep` calls it once — a `null` return counts as `skippedConcurrent` (distinct from `failed`); **`RenewalCase.status` is NEVER written by this sweep** — only checked; per-row isolation (the #9 / #12 / #27 shape) · **`@code-reviewer` (mandatory — this change IS the `race-safe-invariants.md` implementation + a new scheduler) → CHANGES REQUESTED → resolved**: **1 BLOCKER** (stamp + create were two separate writes — a `create` failure after a successful stamp permanently stranded the `RenewalCase` as "escalated" with no `RetentionCase`, and no future sweep would ever reconsider it since `findRenewalCasesForSweep` filters on `retentionEscalatedAt: null`; fixed by the `$transaction` above) **+ 1 MAJOR** (the stamp's `where` originally re-asserted only `retentionEscalatedAt: null`, not `status` — a `RenewalCase` concluding between the sweep's load and the stamp could open a spurious case for a customer who just renewed; fixed by the `status NOT IN (...)` re-assertion) — both dormant today, both would be live races the day the renewal module lands; **2 MINORs addressed** (a distinct `skippedConcurrent` counter; a new unit test for a create failure after a successful stamp) · **no "one open `RetentionCase` per customer" invariant** — deliberately not built (would need a migration; the schema has no FK to dedupe against) — two at-risk policies for one customer legitimately open two cases · **endpoints** (all `retention-case.manage`): `POST /retention-cases` (manual open, `{ customerId, reason }`; **404** unknown customer), `POST /retention-cases/sweep` (on-demand, declared before the `:id` routes, counts only — the #27 `follow-up-sweep` shape), `GET /retention-cases?customerId=&status=&reason=` (book-wide, capped `RETENTION_CASE_READ_LIMIT = 5000`) + `/:id`, `POST /retention-cases/:id/close` (`open → closed`, no body — the model has no note field; idempotent, **404** unknown) · **`RetentionSweepScheduler`** nightly at **08:00 UTC** (after the 07:00 claim follow-up sweep), the `system@ibms.internal` account precedent, delegating to the same `runSweep` the on-demand endpoint calls · audit: best-effort `CREATE RetentionCase` per opened case (sweep or manual), `UPDATE` on close; reads not audited (Confidential tier — the #33 / #34 / #41 / #44 / #45 precedent) · **`/brain-gap` filed + pushed** (ibms-brain `4c1f2c9` — `customer-service-lifecycle.md` gains a "Customer Retention (Process 46)" section; intro → "Domain E is complete — #41–46 are all built") · web: a new **"Retention"** screen (`app/(app)/retention-cases/page.tsx` + `lib/customer-service/retention-case-api.ts` + an `AppNav` entry after "Feedback") — an open form + a "Run detection sweep now" button + a table with a per-row Close | the renewal module (Part 3.9) itself is not built, so the sweep has no real `RenewalCase` traffic in normal running — only e2e tests create one directly · the 30-business-day inactivity threshold is **drafted / unsourced** · **no per-customer dedup of open cases** — the schema has no `renewalCaseId` / `policyId` FK on `RetentionCase` to dedupe against · **no outcome / resolution field on close** — "was the customer retained or lost" is not recorded, the bare schema has none · no link from a `RetentionCase` back to the `RenewalCase` / `Policy` that triggered it (only `RenewalCase.retentionEscalatedAt` records that *an* escalation happened) · no auto-close when the underlying `RenewalCase` eventually reaches `RENEWED` · `retention-case.manage` is role-level (no per-officer queue) |

### Part C · Domain F #47–51 — Compliance & Risk (begun), with these deferrals

| # | Process | Built | Not done (detail in § Known gaps) |
|---|---|---|---|
| 47 | KYC | **fully covered by Part C #3-4** (`KycService` / `ScreeningService`) — the backlog's own line reads "#47 KYC — fully covered under #3–4", no checkboxes of its own. Verified 2026-09-04: every #3-4 checkbox (two-form Customer creation, KYC + document capture, UBO + PEP capture, sanctions/PEP/AML screening at intake/on material change/recurring batch, the automatic EDD path with a separate longer SLA, the maker/checker approval gate, the risk-based periodic re-KYC schedule, the step-by-step onboarding wizard) maps to real, built, permission-gated code — see the #3-4 row above | nothing #47-specific — see the #3-4 row's own deferred edges (simulated screening provider, drafted SLA/re-KYC figures) |
| 48 | AML/CFT | **new module** `apps/api/src/modules/compliance-risk/` (+ `repositories/transaction-monitoring-alert.repository.ts`) — opens Domain F beyond KYC · **migration `20260904130000` (44th)** only **widens** the pre-existing `TransactionMonitoringAlert` model (Part 7.2 core schema, no application code had ever written to it): adds `sourceEntityType` / `sourceEntityId` (nullable — the triggering `Receipt` for an event-scoped alert; both null for the two aggregate patterns), `@@index([customerId])` / `@@index([status])` / `@@index([patternType])`, and two race-safe uniqueness guards — **no seed change** (`aml.monitor` / `aml.escalate`, both `[COMPLIANCE_OFFICER]`, were seeded ahead of time in `a440c1b`, module `compliance-risk`, 149 perms) · **not a `WorkflowTransitionService` entity, no maker/checker** (`aml.monitor` / `aml.escalate` are both single-role COMPLIANCE grants, kept as two permissions since the pre-existing seed clearly means to separate "monitor" from "escalate" — the #42 `complaint.escalate` shape, not the #23-28 claim-settlement dual-approver shape) · **detection** (`TransactionMonitoringSweepScheduler`, nightly at 09:00 UTC after the 08:00 retention sweep, + on-demand `POST /transaction-monitoring-alerts/detect`) checks four patterns over existing Finance/Endorsement data, pure classifiers in `transaction-monitoring.config.ts`: **`large_premium_payment`** / **`third_party_payment_source`** — both scanned off every `Receipt` (an actual client payment collected, #32 — a raised-but-unpaid `Invoice` is not yet a "payment"), the first comparing the underlying `Invoice.premiumAmount` against a drafted `AML_LARGE_PREMIUM_THRESHOLD_JOD = '15000.000'`, the second checking whether the `Receipt`'s `PaymentChannel` (#38) is owned by a customer other than the one invoiced — **DORMANT in production, a `@code-reviewer` BLOCKER**: `CollectionService.assertReceiptChannelUsable` (#38) already rejects any real `Receipt` whose channel mismatches the invoiced customer before one can exist, so this classifier can never fire outside a test that bypasses `CollectionService` directly; kept coded/tested/wired as a forward-compatible detector, documented rather than architecturally changed; **`frequent_cancellations`** / **`frequent_refunds`** — a rolling 90-calendar-day count of `Cancellation` / `Refund` rows per customer (via `Endorsement.policy.customerId`, neither child table carries its own `customerId`) against a drafted threshold of 3 · **race-safety** (`race-safe-invariants.md`): a plain `@@unique([patternType, sourceEntityId])` stops the sweep from re-alerting the same `Receipt` forever (Postgres treats every NULL `sourceEntityId` as distinct, so the two aggregate patterns are untouched by it); a hand-authored partial `UNIQUE ("customerId", "patternType") WHERE status = 'open' AND "patternType" IN ('frequent_cancellations', 'frequent_refunds')` (the `UpSellRecommendation` / `ClaimFollowUpAlert` shape — Prisma can't express the predicate) caps the aggregate patterns at one open alert per customer/pattern at a time — **scoped directly to `patternType`, NOT to `sourceEntityId IS NULL`, a `@code-reviewer` BLOCKER on the first pass** (that predicate would also collide two unrelated manual `other`-pattern alerts for the same customer, throwing an uncaught 500 with no pre-check/catch; `create()` now catches `P2002` → a 409); the service also pre-checks both before writing, then catches the `P2002` from a concurrent run as `skippedExisting`, never `failed` · per-candidate isolation — one bad row does not abandon the rest of the sweep (the #9/#12/#27/#46 shape) · **manual log**: `POST /transaction-monitoring-alerts` (`aml.monitor`) — any of the five `patternType`s (`large_premium_payment` / `frequent_cancellations` / `frequent_refunds` / `third_party_payment_source` / `other`), for a pattern Compliance notices that machine detection doesn't cover; `detailText` carries the shared `NO_FULL_ACCOUNT_NUMBER` guard (`common/dto.util.ts`, the #41/#42/#44/#45 precedent) — the model's own default `classification` is `HIGHLY_CONFIDENTIAL` ("names payment sources/counterparties, AML-sensitive") · **the suspicious-activity escalation path is two separate steps**, the M03 consent-withdrawal request/confirm shape: `POST /:id/escalate` (`aml.escalate`) — the internal decision, `open` only, idempotent; `POST /:id/report-to-authority` (`aml.escalate`) — the external filing, **requires `escalate` to have run first** (422 otherwise), idempotent; **`POST /:id/close`** (`aml.monitor`) — `open → closed`, no body (the model has no note/`closedAt` field — the `UPDATE` `AuditLogEntry.occurredAt` is the closure timestamp of record) · **record-keeping**: no delete endpoint exists anywhere on this model — the row + its `CREATE`/`UPDATE` audit trail is the regulator-mandated record; the actual retention *period* is undocumented/unsourced (no CBJ AML source figure identified yet — flagged in `ibms-brain/meta/context/transaction-monitoring.md`, not built as a tracked deadline the way `kyc-aml-sla-timers.md`'s two figures are) · `GET /transaction-monitoring-alerts?customerId=&patternType=&status=&escalatedToSuspiciousActivity=` + `/:id` (book-wide, capped `TRANSACTION_MONITORING_READ_LIMIT = 5000`) · audit: best-effort `CREATE` per alert (sweep or manual — ids + `patternType` + `status` + source provenance, **never `detailText`** — the #44 `subject`/`body` / #45 `comments` precedent), `UPDATE` on escalate / report / close, all `isSensitiveDataAccess: true` (Highly Confidential AML data); **`get()`/`list()` also write a best-effort `READ` row** — a `@code-reviewer` MAJOR fix (the first pass had followed the Confidential-tier #33/#34/#41/#44/#45 no-audit precedent; `TransactionMonitoringAlert` is `HIGHLY_CONFIDENTIAL`, the `Claim` same-tier precedent says every read is logged) · `apps/web/`: a new **"AML monitoring"** screen (`app/(app)/transaction-monitoring/page.tsx` + `lib/compliance-risk/transaction-monitoring-api.ts` + an `AppNav` entry after "Consent") — a log form (customer id · pattern `<select>` · detail) + a "Run detection sweep now" button + a table (customer · pattern · status · escalated · reported · detected · per-row Escalate/Report/Close) · **`@code-reviewer` → CHANGES REQUESTED → resolved: 2 BLOCKERs** (the partial-index scoping — fixed; `third_party_payment_source`'s dormancy — documented, not architecturally changed) **+ 1 MAJOR** (the missing `READ` audit — fixed) **+ 2 MINORs** (`escalate()`'s idempotency ordering — a closed-but-escalated alert now stays idempotent on retry; the sweep's `scanned` count now sums rows examined, not distinct customers) · **Verification**: +57 api unit (`transaction-monitoring.config.spec.ts` 23 — every classifier + boundary + the audit-snapshot's `detailText` exclusion; `transaction-monitoring.service.spec.ts` 31 — manual log incl. no-customerId + the P2002→409 fix, all four sweep patterns incl. both-on-one-receipt + pre-check skip + `P2002` → `skippedExisting` + a genuine failure doesn't abort the rest, escalate/report/close incl. every guard + idempotency + the closed-but-escalated fix, `get()`/`list()` `READ`-audit tests; `transaction-monitoring-sweep.scheduler.spec.ts` 3). api unit **1575** (106 files, from 1518). New `test/transaction-monitoring.e2e-spec.ts` **1/1 isolated** (extended post-review) — seeds a large-premium Receipt, a third-party-channel Receipt, an ordinary Receipt, 3 Cancellations (one Endorsement per Policy — `Endorsement_one_live_cancellation_per_policy`, migration 20260902170000, allows only one live cancellation Endorsement per policy) and 3 Refunds under one customer; a non-Compliance actor → 403 on detect/list/escalate; the on-demand sweep flags all four patterns + is idempotent on re-run; manual log incl. the account-number-guard 400 + unknown-`patternType` 400 + unknown-customer 404; a second independent manual `other` alert succeeds while a manual log of an already-open aggregate pattern 409s; report-before-escalate → 422; escalate → report → close, each idempotent; re-escalating the closed-but-escalated alert stays idempotent; a `CREATE` audit row per alert (6 total — 4 swept + 2 manual, none carrying `detailText`) + `UPDATE` rows for escalate/report/close + `READ` rows for `get()`/`list()`. New Playwright `transaction-monitoring.spec.ts` (3 — form + table render, 403 friendly copy, `@a11y` no serious/critical). turbo `typecheck`/`lint`/`build` OK; `ibms-brain` `brain-doctor.sh` 0 errors; `prisma migrate status` clean (44) | the four thresholds (15000 JOD large-premium, 90-day/3-count frequent cancellation & refund) are **drafted / unsourced** — same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23) and the #41/#42/#46 SLA figures · **`third_party_payment_source` is dormant in production** (see above — documented, not fixed by relaxing #38's enforcement) and separately cannot classify a `Receipt` with no recorded `PaymentChannel` either way (`Receipt.paymentChannelId` is optional) · no dedup across the four patterns firing on the same underlying activity (a customer could get both a `large_premium_payment` alert and a `frequent_cancellations` alert for related behaviour, with nothing linking them) · the escalation path has **no `SlaTimer`** — the backlog names no filing deadline the way M03's "2 business days" was explicit, so unlike `consent_withdrawal` this is not (yet) a tracked deadline · no case-management workflow beyond `open`/`closed` — no assignment, no investigator notes beyond the original `detailText`, no link to a filed SAR document · no bulk/CSV export; in-memory aggregation for the two frequent-* patterns, capped implicitly by whatever `findCancellationsSince`/`findRefundsSince` return (unpaginated, the #12/#27 follow-up-sweep precedent) · `aml.monitor`/`aml.escalate` are role-level (no per-officer queue) |
| 49 | Sanctions & PEP Screening | **the one checkbox**: "Screen at onboarding + on any material change + a recurring batch against **updated lists**" — the first two legs were already built under #3-4 (`KycService`/`ScreeningService`); this finishes the third leg with real list data and a sourced cadence · **migration `20260904140000` (45th)** adds `WatchlistSource` / `WatchlistEntry` / `WatchlistSyncRun` — `WatchlistEntry` is the local sync cache (`sourceRecordId` = OFAC `ent_num` / UN `DATAID`, the upsert/prune key, `classification DataClassification @default(HIGHLY_CONFIDENTIAL)` — a `@code-reviewer` BLOCKER, see below); `WatchlistSyncRun` is the sync job's own operational log, not an `AuditLogEntry`, and carries a hand-authored partial `UNIQUE (source) WHERE status='running'` (a second BLOCKER, see below) · **no seed change** — `sanctions-pep.screen` (`[COMPLIANCE_OFFICER]`, module `compliance-risk`) was pre-seeded, gating THREE endpoints: `POST /watchlist-sync/run`, `GET /watchlist-sync/status`, `POST /screening/recurring-batch` · **new module** `apps/api/src/modules/compliance-risk/watchlist-sync.{config,service,controller,scheduler}.ts` + `watchlist-fetchers.ts` (the network boundary — two tiny injectable classes, `OfacSdnFetcher`/`UnConsolidatedFetcher`, so `WatchlistSyncService` never calls `fetch()` directly) + `repositories/watchlist-entry.repository.ts` · **two real, free, no-API-key sanctions lists** — `https://www.treasury.gov/ofac/downloads/sdn.csv` (OFAC SDN, ~19,000 records, redirects to `sanctionslistservice.ofac.treas.gov`) and `https://scsanctions.un.org/resources/xml/en/consolidated.xml` (UN Consolidated, ~1,000 records) — both verified reachable live 2026-09-05; hand-rolled parsers (a general quoted-CSV parser for OFAC's mixed quoted/unquoted 12 columns, a scoped regex block/tag extractor for the UN XML, safe because every tag read is a flat single-occurrence leaf verified against the real document), no new npm dependency, both unit-tested against real captured sample data · **`WatchlistSyncScheduler`** every 12 hours (the lists' own real-world refresh cadence) or on demand, delegating to `WatchlistSyncService.runSync()`: fetch → parse → `upsertMany` (stamps every record with the current `WatchlistSyncRun.id`, chunked at 100 with bounded `Promise.all` concurrency — not a raw-SQL bulk upsert, OFAC alone is ~19,000 rows) → `pruneStale` (deletes every row of that source NOT stamped with this run's id — i.e. dropped from the source list) — two passes, not a `$transaction` (a non-transactional external cache refresh, not a financial/workflow write); per-source isolation (one source's fetch/parse failure does not block the other) · **`ScreeningService.run()` now checks TWO sources**: `sample-watchlist.ts` (unchanged, dev/test-only fixture) and the real synced `WatchlistEntry` cache (every environment, including production) — an exact match on `normalizeWatchlistName`'s canonical form (uppercase, strip everything but letters/digits/whitespace, sort the tokens) applied identically at ingestion and match time; **order-independent** (handles OFAC's "LASTNAME, First" vs. a customer record's "First Last") but **NOT fuzzy/phonetic** — a documented limitation, the same honesty `sample-watchlist.ts`'s own header already had · **`ScreeningBatchScheduler`'s cadence changed from a drafted monthly guess to every 4 hours** — the lists resync every 12h, so checking twice within that window bounds the "list changed but not yet re-checked" gap to at most one sync interval plus one screening interval; its customer-selection + per-customer loop **MOVED into `ScreeningService.runRecurringBatch()`** so the scheduler (4h) and the new on-demand `POST /screening/recurring-batch` (`sanctions-pep.screen`) share identical logic — the #46/#48 "service owns the sweep, scheduler + endpoint both delegate" shape; batch-level failures (e.g. `findActive()` throwing) propagate to the caller rather than being swallowed, matching `RetentionCaseService.runSweep`/`TransactionMonitoringService.runSweep` · **`WatchlistEntryRepository` is provided in BOTH `ComplianceRiskModule` (owns the sync) and `CustomerModule` (`ScreeningService` reads it) deliberately** — a stateless `PrismaService` wrapper, safe to instantiate twice, avoiding a cross-module dependency for one narrow read · **neither the unit nor the e2e suite calls the real endpoints** — `test/watchlist-sync.e2e-spec.ts` stubs `globalThis.fetch` with fixture CSV/XML content and drives the real `POST /watchlist-sync/run` endpoint through the full Nest app, proving the whole fetch→parse→upsert→prune pipeline without depending on an external government server's uptime in CI · `apps/web/`: a new **"Watchlist sync"** screen (`app/(app)/watchlist-sync/page.tsx` + `lib/compliance-risk/watchlist-sync-api.ts` + an `AppNav` entry after "AML monitoring") — a sync-runs table (source · status · records · started · completed) + "Sync watchlists now" / "Run recurring screening batch now" buttons · **`@code-reviewer` → CHANGES REQUESTED → resolved: 4 BLOCKERs** (a concurrency race between an overlapping manual sync and the scheduler — fixed with the partial `UNIQUE (source) WHERE status='running'` above, `createSyncRun`'s P2002 mapped to `'skipped'`; a 200-with-wrong-content parse committing near-zero records and pruning the entire prior cache — fixed with a plausibility floor, `WATCHLIST_MIN_ACCEPTABLE_RATIO = 0.5` / `WATCHLIST_MIN_ABSOLUTE_RECORDS = 10`, both drafted; an ASCII-only `[A-Z0-9]` normalizer reducing any all-Arabic-script name to `""` — a universal false-positive wildcard for this Jordan-based broker — fixed with Unicode-aware `\p{L}`/`\p{N}` plus a defense-in-depth empty-string refusal at ingestion, match time, AND the repository; the `classification` field missing entirely, reasoned in a code comment rather than a `PRIV-STD-02` citation — fixed per `2026-08-pcms-source-of-truth.md`, see above) **+ 3 MINORs** (`parseCsvLine` silently merged fields across an unterminated quote instead of rejecting the line — now returns `null`; `runRecurringBatch`'s error log gained a comment justifying why logging the message is safe; the ADF-style single-token collision risk is now an explicit documented gap, not an implicit one) · **Verification**: +59 api unit total — `watchlist-sync.config.spec.ts` 23 (from 17, +6 review-fix: Arabic-name + pure-punctuation normalization, the two plausibility constants, an unterminated quote in `parseCsvLine`/`parseOfacSdnLine`), `watchlist-sync.service.spec.ts` 10 (from 4, +6: P2002→skipped, non-P2002 still throws, the plausibility floor with/without a prior sync + its exact boundary, an empty-normalized record filtered before upsert), `watchlist-sync.scheduler.spec.ts` 3, `screening.service.spec.ts` +19 original +1 review-fix (an empty-normalized subject name never reaches the query), `screening-batch.scheduler.spec.ts` unchanged → api unit **1617** (109 files, from 1604, from 1575 pre-#49). Isolated `test/watchlist-sync.e2e-spec.ts` **1/1** (all original assertions — a run-unique synthetic OFAC entity + UN individual; a non-Compliance actor → 403 on sync/status/batch; `POST /watchlist-sync/run` succeeds for both sources with `recordCount >= 1`; a real `WatchlistEntry` row matches the parsed shape; a second sync is idempotent; a customer whose legal name is a token-reordering of the synced sanctioned name gets flagged `HIT`/`isEdd: true`, `listSource` = `"OFAC_SDN (SDGT)"`; the on-demand recurring batch runs without error — **plus** a new assertion that the synced row's `classification` is `HIGHLY_CONFIDENTIAL`). Full api e2e suite green, no regression. Playwright `watchlist-sync.spec.ts` 3/3 unaffected (no web changes in the review-fix pass). `npm run typecheck`/`lint` (api) OK; `ibms-brain` `brain-doctor.sh` 0 errors; `prisma migrate status` clean (**45**, same pre-commit migration widened, not a second one) | matching is exact-on-canonical-form, **not fuzzy/phonetic** — spelling variants, transliteration differences, honorifics ("Dr.", "Sheikh"), and a missing/extra middle name all defeat it; aliases are not matched (primary name only, the `sample-watchlist.ts` scope limit carried forward) · the 12h/4h cadence is a **real, sourced ratio** (an observed list-refresh rate) but still **DRAFTED** — no OFAC/UN SLA document commits to exactly 12h · only `Customer`/`UltimateBeneficialOwner` names are screened — `InsuredPerson`/`Employee`/`ThirdPartyClaimant` aren't (no module writes those tables yet either) · no paid/premium sanctions data provider — scope is specifically the free lists · `WatchlistEntry.remarks` (OFAC "Remarks" / UN "COMMENTS1") is stored verbatim, classified `HIGHLY_CONFIDENTIAL` by default (a `@code-reviewer` BLOCKER fix, pending a real PCMS/`PRIV-STD-02` determination) — it names real sanctioned individuals' alleged conduct and DOB, not masked · the single-short-token ("ADF") collision risk is accepted, not fixed · `sanctions-pep.screen` is role-level (no per-officer queue) |
| 50 | Conflict of Interest | **fully covered by Part C #16** (`ConflictOfInterestDisclosure` / `RecommendationService`) — the backlog's own line reads "#50 Conflict of Interest — `ConflictOfInterestDisclosure` (covered under #16)", no checkboxes of its own. Verified 2026-09-05 against the real, current code: `RecommendationService.detectConflictOfInterest` (automatic detection, live-recomputed at `send` — not just a draft-time snapshot, `effectiveGates`), the mandatory disclosure gate blocking `send` while `conflictOfInterestFlagged && !disclosure`, and `assertDifferentActors` so the conflicted drafter cannot self-clear their own disclosure are all still intact and wired — see the #16 row above | nothing #50-specific — see the #16 row's own deferred edges (the 10%/2pp thresholds are drafted, one recommendation per Opportunity) |
| 51 | Regulatory Compliance (CBJ) | **new files** in `apps/api/src/modules/compliance-risk/` (`broker-license.{config,service,controller}.ts`, `compliance-calendar.{config,service,controller}.ts`) + `repositories/broker-license.repository.ts` + `compliance-calendar.repository.ts` · **genuinely no migration, no seed change** — `BrokerLicense`/`ComplianceCalendarItem` (both Part 7.1 core schema) pre-existed with every field a bare license record / obligation log needs; `license.manage`/`compliance-calendar.manage` (both `[COMPLIANCE_OFFICER]`) were pre-seeded ahead of time · **`BrokerLicense` is a true SINGLETON** — one row at a fixed id (`BROKER_LICENSE_SINGLETON_ID = 'the-broker-license'`), not a `findFirst()` guess over an unconstrained table: "the broker's own CBJ license status" (the model's own doc comment) is singular by nature, so rather than a migration adding a DB-level singleton constraint for a resource Compliance creates once and only ever updates afterward (an infrequent, deliberate, human action — the M03 "exactly-one-owner is app-level, not a DB CHECK" reasoning), the row is simply always created under that fixed id · **endpoints**: `POST /broker-license` (409 if one exists), `POST /broker-license/renew` (404 if none does — updates every field and resets `status` to `'active'`, a fresh period supersedes any prior manual lapse), `POST /broker-license/mark-lapsed` (a manual override ahead of the calendar expiry, e.g. a CBJ suspension — idempotent), `GET /broker-license` · **the lapse check is a pure LIVE recompute (`isBrokerLicenseCurrentlyLapsed` — `status === 'lapsed' || expiresAt <= now`), not a scheduler-maintained flag** — deliberately: the #16 `@code-reviewer` MAJOR lesson ("a control that fires only when a human/sweep configured data in the right order first is procedural, not structural") means `PolicyService.place()`'s block must be correct the INSTANT `expiresAt` passes, so there is **no `BrokerLicenseSweepScheduler` at all** — nothing for one to keep in sync; the same function backs both the gate's decision and the read view's derived `isCurrentlyLapsed` flag · **`PolicyService.assertLicenseNotLapsed` is the literal first statement in `place()`**, before every other placement precondition (the client-decision ACCEPT check, the duplicate-policy check) — the cheapest, most fail-fast gate, and logically prior to everything else · **an unconfigured license (no row at all) is deliberately treated as NOT blocked** — load-bearing, not an oversight: dozens of existing policy/endorsement/claim/finance e2e and unit tests place a `Policy` without ever configuring a license, and this system is built for an already-operating, already-licensed brokerage; treating "unconfigured" the same as "lapsed" would fail every one of those tests for a condition none of them are testing · **the gate is scoped to `place()` ONLY** — `recordIssuance` (completing an ALREADY-placed policy's paperwork) is deliberately not gated, since blocking that would strand legitimately in-flight business, out of scope for "block new business issuance" · `BrokerLicenseRepository` is provided directly by BOTH `ComplianceRiskModule` (owns create/renew/mark-lapsed) and `PolicyModule` (`place()`'s one narrow read) — the #49 `WatchlistEntryRepository` duplication-over-cross-import shape · the compliance calendar: `POST /compliance-calendar` (`{ obligationName, ownerUserId, dueDate }`, 404 unknown owner), `GET /compliance-calendar?ownerUserId=&overdueOnly=` + `/:id` (book-wide, capped `COMPLIANCE_CALENDAR_READ_LIMIT = 5000`), `POST /compliance-calendar/:id/record-submission` (`{ evidenceOfSubmissionRef, submittedAt? }` — **write-once**, a race-safe status-conditional `updateMany({ where: { id, submittedAt: null } })`, 409 on a second attempt — unlike `RetentionCase.close`'s idempotent-on-repeat shape, silently accepting a second submission would let a later call overwrite the first evidence reference with no trace of the original) · `isOverdue` (`submittedAt === null && dueDate < now`) is a pure derived dashboard convenience, not a tracked `SlaTimer` — the backlog names no single statutory turnaround for the calendar entries themselves · a recurring obligation is a NEW row per cycle, not a recurrence field — the bare schema has nothing to express a recurrence rule with, the #41/#46 per-instance shape · **`parseCalendarDate` promoted from `policy.config.ts` to a new `common/calendar-date.util.ts`** — already a de facto shared utility via `endorsement.service.ts`'s cross-module import, #51 is its third consumer; `policy.config.ts` re-exports it so existing imports keep working unchanged · no `classification` field on either model (verified defensible, not the `WatchlistEntry` BLOCKER pattern — neither model contains any content about an identifiable natural person beyond an internal staff `ownerUserId` FK, the same kind of actor reference several other unclassified models already carry) · `apps/web/` gains a **"Regulatory compliance"** screen (`app/(app)/regulatory-compliance/page.tsx` — one page, two sections: license status + renew/mark-lapsed form, and the calendar table + log form + per-row record-submission) · **`@code-reviewer` (mandatory — a business-critical issuance-blocking gate + a novel global-singleton e2e-testing pattern) → CHANGES REQUESTED → resolved: 3 MAJORs.** **MAJOR 1**: `BrokerLicenseService.create()`'s `findCurrent() === null` pre-check alone leaves a real gap — two concurrent `POST /broker-license` calls both pass it before either writes, and while the fixed-id `@id` PK correctly stops a second row from ever existing (the data integrity itself always held), the loser's P2002 was unhandled, surfacing as a raw 500 instead of the clean 409 every other create-once resource in this codebase produces (`policy.service.ts`, `watchlist-sync.service.ts`, etc.'s `isUniqueViolation` shape); fixed by wrapping `repo.create()` in the identical catch-and-rethrow pattern. **MAJOR 2**: both new e2e specs mutate the real, shared `BrokerLicense` singleton (unlike every other fixture in this suite, scoped by unique generated ids) and rely on a restore-before-finishing step so a leftover lapsed state doesn't 422 every later e2e file that places a Policy — the restore's own success check originally only verified `isCurrentlyLapsed` when the renew call itself returned 201, missing the more likely failure (renew returning a non-201), which would have silently left the singleton lapsed with no signal; fixed by asserting the renew call's status unconditionally (and, separately, restructured away from a `throw`-in-`finally` — ESLint's `no-unsafe-finally` — since that shape would silently swallow a genuine test-body failure; now a `testError` capture + unconditional restore + rethrow-whichever-failed). **MAJOR 3**: the What's New / brain-gap bookkeeping this very row is satisfying hadn't been done at review time — closed by this documentation pass. **1 MINOR**: the web form's `renew` only collected `licenseNumber`/`expiresAt`, and since `renew()` fully replaces every field, using it would silently wipe any previously recorded `scopeOfAuthorization`/`issuedAt` an officer didn't intend to touch; fixed by adding both fields to the form, pre-filled from the current record — adjusted during render (React's own recommended pattern for this), not a `useEffect`, so it never fights with an officer's in-progress edit on an unrelated reload · **Verification**: +33 api unit (`broker-license.config.spec.ts` 7, `broker-license.service.spec.ts` 11 incl. the P2002-race fix, `compliance-calendar.config.spec.ts` 4, `compliance-calendar.service.spec.ts` 8, `calendar-date.util.spec.ts` 5 moved from `policy.config.spec.ts`, `policy.service.spec.ts` +4 for the license gate) → api unit **1651** (114 files, from 1617 pre-#51). New `test/regulatory-compliance.e2e-spec.ts` **2/2** (broker-license CRUD + permissions incl. the concurrent-create 409; compliance-calendar log/filter/write-once-submission), `test/policy.e2e-spec.ts` **+1** (the real cross-module block — an active license places normally, a manually-lapsed one 422s a NEW placement with no Policy row created, both singleton-mutating specs restore-and-verify before finishing). Full api e2e suite green aside from the two pre-existing chronic flakes (rbac/up-sell) plus one transient full-suite-contention failure (`audit.e2e-spec.ts`, confirmed passing in isolation) — no regression. New Playwright `regulatory-compliance.spec.ts` 3/3; full Playwright suite **165/165**. `npm run typecheck`/`lint`/`build` (api + web) OK | no `BrokerLicense` renewal-history tracking — a renewal overwrites the singleton in place, the `AuditLogEntry` UPDATE trail is the only history · no CBJ-integration license-status feed — the record is entered manually, not pulled from a regulator API · no recurrence/reminder mechanism for the compliance calendar beyond the plain `dueDate` + derived `isOverdue` · `license.manage`/`compliance-calendar.manage` are role-level (no per-officer queue) |

### Not started

- **Domains C–H** — Claims **#23–30 are built** (Notification, Registration, Documentation,
  Assessment, Follow-up, Settlement, Closure, Analytics — see the Domain C table above;
  the per-`RenewalCase` `LossRatio` recompute is wired but a logged no-op until the
  renewal module exists, and the #30 aggregate breakdown is all-time / paid-only). **#30
  is the last built Claims process** — Domain C's remaining edges (a real earned-premium
  loss ratio, incurred reserves, the full Claims dashboard #58–65) wait on the renewal /
  reporting modules. **Finance (Domain D #31–40) is complete** — see the Domain D table
  above: the full `Invoice → Receipt → Reconciliation → Remittance` cycle through the
  workflow engine with a client-funds ledger entry at each money movement, the on-the-fly
  accounts-receivable / ageing report per customer and accounts-payable /
  remittance-obligations report per insurer, the governed `CommissionAgreement` rate +
  VAT table, the `CommissionLedgerEntry` ledger with the manual-override maker/checker,
  VAT snapshotting, `outstanding → paid` reconciliation against the insurer statement,
  `→ reversed` driven by a Process 22 cancellation, the governed masked-only
  `PaymentChannel` list wired (optionally) onto every `Receipt` / `Remittance`, the
  `ReconciliationException` variance job that ALWAYS raises an exception with the exact
  variance (never a silent write-off) plus its investigate / resolve path driving the
  `Invoice` `EXCEPTION_RAISED → EXCEPTION_RESOLVED → RECONCILED` hops, and the
  consolidated `GET /financial-report/summary` (#40) that composes the AR / payables
  totals with a new commission roll-up by insurer and a profitability section by line /
  client segment (#37 Refund Management needs no separate build — endorsement-driven
  `Refund` + maker/checker under #22 covers it; the Part E Financial Dashboard UI + its
  branch / line / time filters are still Part E). **Domain E — Customer Service
  (#41–46) is complete** — see the Domain E table above: `ServiceRequest` /
  `Complaint` post-sale logging through the generic `SlaTimer`, the read-only
  cross-module SLA dashboard, consent-gated `CommunicationLog` sends,
  `CustomerFeedback` satisfaction logging, and `RetentionCase` opened
  automatically on renewal inactivity / lapse risk (#46 — built ahead of its
  data source, the Part 3.9 renewal module itself is not built, so the sweep
  is a logged no-op until it lands, same shape as #29's Loss Ratio). **Domain F —
  Compliance & Risk (#47–57) has begun.** #47 KYC needed no separate build — it is
  fully covered by Part C #3-4's `KycService`/`ScreeningService` (sanctions/PEP/AML
  screening, EDD, maker/checker approval, periodic re-KYC — see the #3-4 row above).
  #48 AML/CFT Transaction Monitoring is built: a nightly + on-demand sweep over
  `Receipt`/`Cancellation`/`Refund` flags four patterns — an unusually large premium
  payment, a third-party payment source, and frequent cancellations/refunds — as a
  `TransactionMonitoringAlert`, plus a manual log for anything Compliance notices by
  hand, and a two-step `escalate` → `report-to-authority` suspicious-activity path (the
  M03 consent-withdrawal request/confirm shape). #49 Sanctions & PEP Screening is
  built: two free public sanctions lists (OFAC SDN, UN Consolidated) sync locally every
  12 hours into `WatchlistEntry`, `ScreeningService` matches every customer/UBO name
  against them (exact match on a canonical, order-independent form — not fuzzy) in
  every environment including production, and the recurring re-screen batch moved from
  a drafted monthly cadence to every 4 hours to match. #50 Conflict of Interest needed
  no separate build — it is fully covered by Part C #16's
  `ConflictOfInterestDisclosure`/`RecommendationService`. #51 Regulatory Compliance is
  built: a singleton `BrokerLicense` record whose live-recomputed lapse status
  automatically blocks new business placement (`PolicyService.place()`'s first
  precondition, no scheduler needed), plus a `ComplianceCalendarItem` log tracking
  regulatory obligations by owner/due-date with a write-once evidence-of-submission
  stamp — see their own entries below for full detail. **Not
  built**: the broker's own risk register (#53), incident/breach management (#55),
  internal audit (#56), the remaining #52/#54/#57 items. Management reporting (#58–65),
  Supporting Operations (HR, procurement, IT, document management, vendor management,
  BCP/DR, knowledge base,
  #66–74).
- **Part D — PDPL / M-series — begun.** **M03 Consent Management is built**: capture a
  consent decision (grant or explicit decline) for a `Customer` or `InsuredPerson`, and
  withdraw it through a two-step request/confirm flow that finally gives the
  previously-unused `consent_withdrawal` `SlaTimer` (2 business days) a real window —
  see § Known gaps, Part D §5.1, for the full detail. Not built as part of M03: the
  capture form is a generic screen, not wired into the 7 named touchpoints (lead
  capture, onboarding/KYC, needs & risk assessment, RFQ/market placement, claims, Group
  Medical/Life & Motor Fleet, renewal & cross/up-sell) individually. **Still not
  built**: `DataSubjectRequest` handling (M04), retention & disposal *execution*
  (M06 — the `RetentionScheduleItem` / `LegalHold` / `DisposalBatch` /
  `CertificateOfDestruction` models exist since the initial migration, nothing drives
  them), vendor risk tiering (M07), cross-border transfer gating and one-off
  `DataSharingApproval` (M08), DPIA screening (M10), version-controlled bilingual
  privacy notices, the RoPA register, and the DPO workspace dashboard. The A.8 SLA
  registry carries all the PDPL timer definitions; `consent_withdrawal` is the first one
  a real caller uses.
- **Part E — dashboards** — none of the six management dashboards (Sales, Policy, Claims,
  Financial, Compliance, Insurer & Employee Performance) exist.
- **Part F — bilingual UI** — every screen built so far is **English-only, LTR**. There
  is no i18n framework, no RTL layout, no bidirectional-text handling, no locale-aware
  number/date/currency formatting (Gregorian/Hijri, JOD base + multi-currency), no
  Arabic-first input or Arabic collation, and no system-generated bilingual documents.
  Screens implement the loading / empty / error / populated states, but the Part F rule
  of capturing a screenshot of each state as evidence is not met.
- **Part G — final verification checklist** — not run as a formal, evidence-attached
  gate (individual gates — `prisma validate`, maker/checker tests, `transition()`-only
  status writes, `-- ENCRYPT` coverage, no-float money, SLA escalation jobs — do pass
  where the relevant code exists).

Nothing here has been deployed anywhere and the production target is undecided (§
Deployment). Part C #1–10 currently live on the `feat/backlog-c1-lead-management` branch;
none of it is merged to `main` yet.

## Known gaps (per completed backlog item)

This repo's backlog (A.x/B.x/C.x task IDs) lives outside this repo, so this list only
tracks what's genuinely incomplete **within an item that has actually been built** — the
project-wide picture is § Scope status above. Updated in the same change that closes or
narrows a gap.

**A.1 — Authentication & Session Management (Part 10.1)**

- **Hardware-token MFA (WebAuthn) is not implemented — and Part 10.1's requirement that
  privileged roles (SYSTEM_SECURITY_ADMINISTRATOR, EXECUTIVE_MANAGEMENT,
  BRANCH_DEPARTMENT_MANAGER, COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER) use a hardware
  token is currently unenforced as a result.** `MfaCredentialType.WEBAUTHN` is
  schema-reserved only; `AuthService.mfaPolicySatisfied()` computes
  `requiresHardwareToken(roles)` but only uses it to surface a frontend banner, never to
  block login — a privileged user with TOTP-only MFA logs in normally today. This is the
  most compliance-significant gap in what's built so far.
- No email/notification provider exists, so `POST /auth/forgot-password` cannot deliver
  a real reset link in any deployed environment. `ENABLE_DEV_RESET_TOKEN` returns the raw
  token in the response body instead, hard-blocked by `NODE_ENV=production` regardless of
  the flag — a dev/e2e-only workaround, not a substitute for a real provider.
- SSO has no identity provider wired — `POST /auth/sso/:provider/callback` returns 501 by
  design (`SsoController`); `SsoProviderStrategy` is a strategy interface with nothing
  implementing it yet, since no broker-specific IdP (SAML/OIDC/Azure AD/Okta) has been
  chosen. This one is a correctly-built stub, not an oversight — Part 10.1 marks SSO
  "optional per broker."
- `RequireStepUp` (recent-reauthentication gate for refund approval/data export/disposal,
  Part 10.1) exists as a decorator + guard but is not applied to any route — there is no
  business endpoint yet for it to protect. Same "built ahead of the consumer" pattern as
  the RBAC permission grid and the field-encryption service.
- Minor: `auth.types.ts`'s `requiresHardwareToken` doc comment points to "the auth module
  README" — no such file exists in this repo (`apps/api/src/modules/auth/` has no
  `README.md`). Dangling reference, not a functional gap.

**A.2 — Roles & Permissions / access recertification**

- Instance-level maker≠checker self-check (e.g. one user placing *and* checking the
  *same* policy) is backlog item A.5 (`assertDifferentActors`) — its own call site here
  (`AccessRecertificationService.decide()`) now uses it. A.2 only enforces the
  role-permission-grid level.
- `AccessRecertificationItem` has no per-`UserRoleAssignment` foreign key — one item is
  generated per *user* holding any active role, not per role grant, so a "revoked"
  decision revokes all of that user's active roles, not one.
- Reviewer-pool assignment always picks the first eligible (≠ subject) member of the
  COMPLIANCE_OFFICER/BRANCH_DEPARTMENT_MANAGER/EXECUTIVE_MANAGEMENT pool, not
  round-robin — acceptable for now since there's no manager-hierarchy field on
  `User`/`Employee` yet.
- `startCycle` skips (logs a warning on) a subject with no eligible reviewer rather than
  blocking the whole cycle.

**A.3 — Encryption & Key Management (Part 10.2)**

- Encryption at rest for the database and document store is not configured — no
  deployment platform is chosen yet and no document-upload service exists behind
  `Document.storageRef`. See § Security above.
- No automated re-encryption sweep on key rotation — an operator must re-encrypt
  existing rows by hand before retiring an old key id. Deferred until real production
  data and a real rotation event exist to size the sweep against.
- Key material is env-var-backed, not a real KMS/HSM (AWS KMS, Azure Key Vault, Vault) —
  `KeyRegistryService`'s interface is deliberately shaped so swapping in a real KMS
  client later is a contained change, not a redesign.
- `encryptEntityFields`/`decryptEntityFields` are wired into `CustomerService` (backlog
  Part C #3-4 — see that entry below) for `Customer`/`UltimateBeneficialOwner`, their
  first real consumers. `InsuredPerson`/`Employee`/`ThirdPartyClaimant` still have no CRUD
  module (those Part C business modules aren't built yet) — the encryption is ready for
  them too; nothing calls it yet.
- TLS enforcement covers client-server traffic and the database connection only —
  there's no third-party/server-to-server HTTP client (Insurer/vendor integration) in
  the codebase yet to enforce TLS on.
- `MfaCredential` encryption (`crypto.util.ts`) remains a separate, unrotated key pool
  from the new PII registry — a deliberate isolation choice, not an oversight; see the
  design doc's Alternatives table.

**A.4 — Immutable Audit Trail (Part 10.3)**

- Write-on-every-action (`AuditService.record()`), the DB-level immutability trigger
  (`packages/db/prisma/migrations/20260826083942_add_audit_log_entry_immutability_trigger/`),
  and anomaly detection (bulk export / off-hours / repeated access,
  `AuditAnomalyDetectionService`) are all real and e2e-verified — Postgres itself rejects
  `UPDATE`/`DELETE` on `AuditLogEntry`, not just an app-layer convention.
- **Not yet done: READ access to Highly Confidential data is not actually logged.** The
  mechanism exists (`AuditAction.READ`, `AuditLogEntry.isSensitiveDataAccess`, and
  `AuditAnomalyDetectionService` keys its "repeated unjustified access" pattern off it),
  but no code path in the app calls `audit.record({ action: 'READ', ... })` for a real
  business-entity read today — only test fixtures use it. The only live producer of
  `isSensitiveDataAccess: true` is `EncryptionService.decrypt()`, logged as
  `ENCRYPTION_KEY_USED`, not `READ`. Same root cause as A.5's gap (no Part C business
  modules — the entities that would actually be read — exist yet); call `audit.record()`
  with `action: 'READ'` from each entity's read path as its service layer is built.
- `AuditService`'s retention-cutoff lookup (`getRetentionCutoffDate`) depends on a
  `RetentionScheduleItem` seed row for `"AuditLogEntry"` — a fresh dev DB without
  `npm run db:seed` logs a warning and falls back rather than failing, but the log
  retention SLA isn't actually enforced until that seed exists.

**A.5 — Maker/Checker Rule enforced, not just documented (Part 5.2)**

- `assertDifferentActors(makerId, checkerId, context)` (`apps/api/src/common/`) is the
  shared application-layer guard; a `CHECK` constraint per table
  (`packages/db/prisma/migrations/20260826091424_add_maker_checker_check_constraints/`)
  is the DB-layer backstop, covering all 9 entities in the Part 5.2 table
  (`KYCRecord`, `PolicyChecking`, `Refund`, `DisposalBatch`, `DataSharingApproval`,
  `DataProcessingAgreement`, `Settlement`, `CommissionLedgerEntry`, `Recommendation`)
  plus `AccessRecertificationItem`.
- Only one of those 10 has a real call site today —
  `AccessRecertificationService.decide()` calls `assertDifferentActors()` before
  recording a reviewer decision. The other 9 have no repository/service layer yet (Part
  C business modules aren't built — see `CLAUDE.md`), so the helper isn't wired into an
  approval write-path for them; the DB `CHECK` constraint is what actually enforces the
  invariant for those tables today. Wire `assertDifferentActors()` into each one's
  approve/check/DPO-approve write path as its service layer is built.
- `DataProcessingAgreement.assessedByUserId` and
  `CommissionLedgerEntry.overrideRequestedByUserId` are new maker-side columns added to
  give those two entities' pre-existing checker fields something to be checked against
  — neither previously had a maker field in the schema. Both are nullable, so — same as
  `Settlement`/`CommissionLedgerEntry`'s existing approver pairs — a row can reach a
  checked state with no maker recorded at all; the `CHECK` constraint only rejects an
  actual maker==checker match, it doesn't require both to be populated.
- Real call sites now exist as Part C business modules land: `KycService.decide()`
  (backlog #3-4) and `NeedsAssessmentService.review()`/`.approve()`/`.reject()` (backlog
  #5) both call `assertDifferentActors()` before recording a checker decision.
  `NeedsAssessment` also gained a maker-side `createdByUserId` column (same "add the
  missing maker field" move as `DataProcessingAgreement` above) and two `CHECK`
  constraints — `reviewedByUserId`/`approvedByUserId` each `<> createdByUserId`
  (migration `20260827120000_add_needs_assessment_status_enum`).

**A.6 — Workflow Transition Engine (Part 2 "Workflow & Notifications")**

- `WorkflowTransitionService.transition()` (`apps/api/src/modules/workflow/`) and the
  `WORKFLOW_TRANSITIONS` map (originally 11 workflow status enums, now 15 — `Lead`,
  `KYCRecord`, `Customer`, and `NeedsAssessment` were added as their Part C modules
  landed; the lex rule was never scoped to the original 11) are built and unit-tested.
  Real callers now exist: `LeadService`, `ProspectService`, `KycService`, and
  `NeedsAssessmentService`. The remaining status enums (`PolicyStatus`, `ClaimStatus`,
  etc.) still have no service to call `transition()` from — wire each one's
  status-changing write path through it as its module is built.
- `NeedsAssessmentStatus` (backlog #5) was converted from a free-text `String` column to
  a real Prisma enum in the same move (migration
  `20260827120000_add_needs_assessment_status_enum`), the same enum conversion #3-4 did
  for `KycStatus` — a string-literal `status` can't plug into the typed
  `WORKFLOW_TRANSITIONS` `Record`.
- Two entities' transition maps (`RFQInsurer`, `Invoice`) are inferred from schema field
  semantics rather than transcribed from an explicit lifecycle document — flagged inline
  in `workflow-transitions.config.ts`, candidates for a `/brain-gap` confirmation.
- The `sideEffect` extension point (for a linked SLA timer/notification/recompute) has no
  registered consumer yet — no timer/notification service exists in this repo.

**A.7 — Fils-Precision Money Arithmetic (Part 3.6 Controls)**

- `money.util.ts` (`apps/api/src/common/`) fixes `Decimal(18,3)` + `ROUND_HALF_UP` as the
  only sanctioned way to add/subtract/apply a percentage to a JOD amount, and
  `money-fields.inventory.ts` classifies all 54 `Decimal` fields in `schema.prisma` as
  money vs. rate/ratio, self-checked against the live schema. Both are unit-tested, but —
  same root cause as A.6 — nothing in the codebase actually calls these helpers yet, since
  no service layer does premium/commission/claim arithmetic. Any future service touching a
  `MONEY_DECIMAL_FIELDS` entry must go through this helper, never a raw `Prisma.Decimal`
  method call or a JS `number`.
  `CommissionLedgerEntry.overrideRequestedByUserId` are new maker-side columns added to
  give those two entities' pre-existing checker fields something to be checked against
  — neither previously had a maker field in the schema. Both are nullable, so — same as
  `Settlement`/`CommissionLedgerEntry`'s existing approver pairs — a row can reach a
  checked state with no maker recorded at all; the `CHECK` constraint only rejects an
  actual maker==checker match, it doesn't require both to be populated.

**A.8 — SLA Timers & Automated Escalation (Part 6.2, 7, 3.x)**

- `SlaTimerService` + `SlaTimerScheduler` (`apps/api/src/modules/sla/`) are the generic,
  polymorphic engine `ibms-brain/meta/lex/pdpl-sla-timers.md` asks for, backing the
  `SlaTimer` model that's been in the schema since the initial domain-model migration.
  `SLA_REGISTRY` (`sla-registry.config.ts`) is the machine-readable registry that lex file
  itself calls for ("this table should be generated from it, not maintained by hand in two
  places") — one entry per each of its 14 SLA types, self-checked for completeness in
  `sla-registry.config.spec.ts`. A `*/15 * * * *` cron sweep escalates any overdue,
  unresolved timer and writes a new `SLA_ESCALATED` audit action.
- **One `SlaTimer` row per escalation stage, not per workflow** — a row is one deadline
  plus the one target it escalates to; a multi-stage workflow (only the two DSR types:
  an early T-3-business-day DPO warning, then a General-Manager escalation at the SLA
  due date itself) gets one row per stage, distinguished by a `::`-suffixed
  `workflowName`, to avoid another schema migration for a stage column.
- `business-days.util.ts` (`apps/api/src/common/`) is a new shared Friday/Saturday
  (Jordan's real weekend, not Saturday/Sunday) business-day calculator — no gazetted
  public-holiday calendar exists yet (same gap as A.6's retention-period table), so a
  computed business-day deadline is a lower bound, not an exact one.
- **One real call site**: `AccessRecertificationService.startCycle()` now starts a
  `quarterly_access_review` timer (best-effort — a timer-bookkeeping failure never rolls
  back or blocks the cycle itself). Fixed in the same change:
  `AccessRecertificationScheduler`/`AccessRecertificationController` both previously
  computed their default due date as 15 *calendar* days despite citing "15 business days"
  in their own comments/DTO doc — both now use `addBusinessDays()`.
- **The other 13 registry entries have no real call site** — same root cause as A.6/A.7:
  no Part C business module (`DataSubjectRequestService`, `IncidentService`,
  `DisposalBatchService`, etc.) exists yet to call `startTimer()`/`resolve()` from. Several
  of those entities already carry their *own* inline due-date field
  (`DataSubjectRequest.slaDueAt`, `DisposalBatch.slaDueAt`, `LegalHold.nextReviewDueAt`,
  `Vendor.annualReviewDueAt`, `DataSharingApproval.slaDueAt`,
  `DpiaScreening.dpoReviewDueAt`) with no generic `SlaTimer` row alongside it yet — wire
  `startTimer()`/`resolve()` into each one's create/close write path as its service layer
  is built, using that field as `dueAt` rather than `computeDueAt()`'s registry default.
- `escalatedTo` is populated at `startTimer()` time (the stage's *planned* target), not at
  escalation time — the sweep only ever flips `escalatedAt`. See `SlaTimerService`'s header
  comment for why; a reader expecting `escalatedTo` to mean "already escalated to" should
  check `escalatedAt` instead.
- Every non-DPO escalation target (`GENERAL_MANAGER`, `IT_MANAGEMENT`,
  `CUSTOMER_RETENTION`, `DPO_AND_LEGAL_COUNSEL`) is free text, not a real RBAC role —
  `ibms-brain/meta/context/roles-and-segregation-of-duties.md` doesn't name any of them.
  Resolving a free-text target to an actual notified person is a notification-system
  concern this repo doesn't have yet (same gap as A.1's "no email provider").

**A.9 — Data Masking & Leakage Prevention (Part 10.6)**

- `maskTrailing()`/`SensitiveFieldRevealService` and `assertNoPresetSensitiveDefaults()`
  now have real callers — `CustomerService` (backlog Part C #3-4, see that entry below)
  and the customer onboarding wizard's initial-values check, respectively.
  `assertSecureChannel()` and `assertExportAllowed()`/`buildWatermarkText()` still have
  none — same root cause as A.5/A.6/A.7/A.8 for the modules that would call them (a
  `DataSharingApproval` create/decide endpoint, any export/print/download endpoint) —
  neither exists yet. Wire `assertSecureChannel()` into `DataSharingApproval`'s
  create/decide write path, and `assertExportAllowed()` into whatever export/print/
  download endpoint is built, as each is built.
- `assertExportAllowed()`/`buildWatermarkText()` enforce the business rule and produce
  the watermark text, but don't themselves stamp a PDF/image — no document-rendering or
  object-storage pipeline exists yet behind `Document.storageRef` (same gap as A.3; Part
  C #3-4's customer document capture is metadata/reference only for the same reason —
  see that entry below).
- `assertNoPresetSensitiveDefaults()` is called once, real, from the customer onboarding
  wizard (`CustomerOnboardingWizard.tsx`) — against its own literal empty-string initial
  values, not live form state (calling it against live state would incorrectly throw the
  moment a real user typed a real national ID; see that component's own comment). Every
  other `apps/web` business form so far (Lead intake, Prospect qualification) has no
  Confidential/Highly Confidential field for it to guard.
- `DataSharingApproval.classification`/`channel` are new required (non-nullable)
  columns added in this change — safe because the table is empty in every environment
  today (no Part C module writes to it yet); a schema with real rows would have needed
  a backfill migration instead.

**A.10 — Infrastructure & Deployment (Part 10.4/10.5)**

- **Independent penetration testing before go-live and periodically after is not
  implemented, and can't be — by definition it requires an external, unaffiliated
  party, not code written by the same agent building the system under test.** Nothing
  in this change simulates, schedules, or claims to satisfy this item; it needs to be
  engaged and tracked as an organizational/procurement task (candidate home: M11
  Compliance & Audit Toolkit's corrective-action register once that module exists —
  `ibms-brain/meta/context/pcms-privacy-modules.md`), not a repo change.
- SAST (`.github/workflows/codeql.yml`) and DAST (the backend CI job's ZAP baseline
  step) are both real and run in CI, but DAST is informational only
  (`cmd_options: -I`, `fail_action: false`) — this app has almost no exposed business
  surface yet (Part C isn't built), so failing the pipeline on ZAP's generic ruleset
  today would train everyone to ignore it. Turn it into a hard gate, with a documented
  allowlist for accepted alerts, once there's real endpoint surface to scan
  meaningfully.
- The backup/restore drill (`scripts/backup-restore-drill.sh`,
  `.github/workflows/backup-drill.yml`) is real, runs against `db-test`, and has been
  executed locally (dump → encrypt → decrypt → restore → row-count verify, ~14s against
  a 900s RTO target — see `ibms-brain/meta/lex/backup-rpo-rto.md`). It has never run
  against a production database, because none exists. The scheduled workflow needs a
  `BACKUP_DRILL_ENCRYPTION_KEY` repository secret set before its first scheduled run
  will succeed rather than fail on the missing-secret check.
- RPO (24h)/RTO (15min) in `backup-rpo-rto.md` are drafts this repo picked to have a
  real number to test against — not yet reviewed or signed off by whoever owns
  business continuity (Part 10.4/10.5 names that role, this repo doesn't have a named
  person yet). Confirm and update both the lex file and `RTO_TARGET_SECONDS`'s default
  the day someone with that authority sets a real target.
- **Dev/Test/UAT/Prod separation is scaffolded, not achieved.** `db`/`db-test`/`db-uat`
  are three separate local docker-compose Postgres instances with their own env files
  (`.env`/`.env.test`/`.env.uat.example`) — but there is no UAT or Prod *deployment*
  target (see § Deployment below), so "UAT" today means "a fourth local database," not
  a real separate environment reachable by anyone but the developer running it.
  `synthesizeEntityFields()` exists so that whenever a real non-prod environment is
  seeded from a production export, PII doesn't have to travel there unmasked — but
  nothing calls it yet, since there's no production data to synthesize from.
  `prisma/seed.ts` (Part B) now seeds roles/permissions/document templates plus
  fictional sample insurers/users, not real exported data, so `synthesizeEntityFields()`
  has nothing to apply to yet either way.

**Part B — Database**

- **B.1 (first migration from `schema.prisma` + a real `prisma validate` run) is done —
  and the sandbox limitation the backlog item names no longer holds in this
  environment.** `prisma validate` needs `DATABASE_URL` resolvable, not registry access;
  it ran clean here (`npm run db:validate`). The schema grew as 13 incremental
  migrations (one per backlog item, starting from `20260825083352_init`) rather than one
  single "first migration" — same net schema, smaller reviewable steps.
  `npm run db:migrate:status` confirms zero drift between `schema.prisma` and both the
  `db` and `db-test` databases.
- **B.2 (the `CHECK` constraints from A.5) was already done** — see A.5 above; nothing
  further needed here.
- **B.3 (additional performance indexes "based on real usage patterns after the first
  load test") is blocked, not implemented — same shape of gap as A.10's pentest item.**
  No load test has run and no Part C business module exists yet to generate real query
  patterns to index against. `schema.prisma` already carries 39 `@@index` entries from
  the initial design (FK lookups, `status`, SLA/expiry date fields, the
  `entityType`+`entityId` polymorphic lookups on `AuditLogEntry`/`SlaTimer`) — adding
  more without real usage data would be guessing, which this item explicitly says not to
  do. Revisit once Part C modules exist and a load test has actually run.
- **B.4 (seed data) is done.** The 11 roles + full permission grid were already seeded
  (A.2); this change adds the three pieces that weren't:
  - `DOCUMENT_TEMPLATES` (`packages/db/prisma/seed-data/document-templates.ts`) — 4 rows,
    `templateType` `proposal_form_motor/general/health/life`. Seeded unconditionally
    (real reference data, like roles/permissions), but `bodyEn`/`bodyAr` are a structural
    skeleton (applicant details / risk details / sum insured / claims history /
    declarations) — neither source document supplies real proposal-form wording, so this
    is placeholder copy pending Underwriting/Compliance sign-off, not a document to use
    as-is.
  - `SAMPLE_INSURERS` (`.../seed-data/insurers.ts`) — 3 fictional insurers (names
    suffixed so nobody mistakes them for real Jordanian insurer master data) spanning
    the four lines, each with nested `InsurerProduct`/`InsurerSlaAgreement` rows.
  - `SAMPLE_USERS` (`.../seed-data/sample-users.ts`) — one login-capable account per
    `RoleName` (11), sharing a single `SAMPLE_USER_PASSWORD` that satisfies the real
    password policy but isn't a real credential — purely so the list doesn't enumerate
    11 secrets.
  - The last two are gated on `process.env.NODE_ENV !== 'production'` in `seed.ts` —
    same convention as `ENABLE_DEV_RESET_TOKEN` (A.1) — since they're synthetic demo
    data, not configuration every environment needs. Verified: the gate actually skips
    them under `NODE_ENV=production`, and re-running the seed with sample data enabled
    is a no-op (idempotent) rather than duplicating rows.

**Part C #1 — Lead Management (Domain A, Process 1)**

- **The first real business module.** `POST /leads` (create, owner = creator),
  `GET /leads` (filter by `source`/`ownerUserId`/`status`, Sales Officers forced to their
  own pipeline server-side, Manager/Executive see any owner), and
  `POST /leads/:id/transition` (only the owning officer, only a legal `LeadStatus` move).
  `apps/web/app/(app)/leads/page.tsx` is the intake-form + pipeline-board screen the
  backlog item asks for.
- **`LeadStatus` reuses `WorkflowTransitionService`** (backlog A.6) rather than growing a
  second transition function — `Lead` is now a twelfth entry in `WORKFLOW_TRANSITIONS`
  alongside the eleven named in `ibms-brain/meta/lex/workflow-state-transitions.md`/A.6,
  which that lex file's own wording already permits ("every entity that carries a
  workflow state", not a closed list).
- **`DISQUALIFIED` reachable from every non-terminal status (`NEW`/`CONTACTED`/
  `QUALIFIED`), not only after `QUALIFIED`, is an inference**, not a cited rule — the
  backlog item's own text reads `NEW→CONTACTED→QUALIFIED→CONVERTED_TO_PROSPECT/
  DISQUALIFIED` literally, which would put `DISQUALIFIED` reachable only at the end.
  Modeled the same way this file's other "the client went quiet/declined" exits are
  (`Opportunity.CLOSED_LOST`, `RenewalCase.LAPSED`) — see the citation comment in
  `workflow-transitions.config.ts`. Candidate for a `/brain-gap` confirmation against a
  real CRM-process source.
- **Process 2 (Prospect Management/qualification) is now built** — see Part C #2 below.
  `POST /leads/:id/transition` itself now rejects `toStatus: CONVERTED_TO_PROSPECT`
  directly (`UnprocessableEntityException`), closing off the "converted Lead just...
  stops" gap this note used to describe — that move only happens through `POST
  /prospects`.
- **No lead reassignment** — `ownerUserId` is fixed to the creating user at `POST /leads`
  time; there's no endpoint for a Manager to hand a lead to a different Sales Officer.
  Not asked for by this backlog item; add it the day a real reassignment need shows up.
- **No field-level encryption or masking on `contactPhone`/`contactEmail`** — these
  aren't classified Confidential/Highly Confidential in this schema (see A.3/A.9 above),
  so `EncryptionService`/`SensitiveFieldRevealService` correctly have no call site here.
- **`Lead.marketingConsentGranted` is a bare boolean, not a `ConsentRecord`** — the model
  that's actually wired into the mandatory PDPL consent-withdrawal SLA
  (`ibms-brain/meta/lex/pdpl-sla-timers.md`, `sla-registry.config.ts`). A lead can grant
  marketing consent at intake but has no way to withdraw it with a tracked, SLA-timed
  record — only Customer-level consent (a later Domain A process) was in scope for this
  item. Revisit if/when marketing-consent withdrawal for a pre-Customer Lead becomes a
  real requirement, not before.
- **No SLA timer on a Lead sitting untouched** — `pdpl-sla-timers.md`'s registry doesn't
  name a Lead-response SLA, so `SlaTimerService` isn't wired in; nothing here claims
  otherwise.
- Domain A Processes 3-10 (Prospect qualification through the 360° customer view) remain
  entirely unbuilt.

**Part C #2 — Prospect Management (Domain A, Process 2)**

- **`POST /prospects`** converts a Lead into a Prospect and captures the qualification
  profile the backlog names verbatim (sector/activity/employee count/business size/
  location/contact person/products of interest/expected premium), **`GET /prospects`**
  (Sales Officers forced to their own prospects server-side, same pattern as
  `GET /leads`; Manager/Executive see any owner), **`GET /prospects/:id`** (the profile
  screen's data source). `apps/web/app/(app)/prospects/` is the qualification form
  (`/prospects/new`, reached from a "Convert to prospect" action on a `QUALIFIED` lead in
  the pipeline board) + list + profile screens the backlog item asks for.
- **Reuses `WorkflowTransitionService` for the Lead side of the conversion** rather than
  inventing a second write path — `ProspectService.convert()` calls
  `workflow.transition({ entityType: 'Lead', toStatus: 'CONVERTED_TO_PROSPECT' })`
  directly, which rejects converting the same Lead twice (`CONVERTED_TO_PROSPECT` is
  terminal) — no separate "already converted" check needed here. `LeadService.transition()`
  (the generic `POST /leads/:id/transition` endpoint) now explicitly refuses
  `toStatus: CONVERTED_TO_PROSPECT` so this is the only legal path to that move; see the
  Part C #1 note above and `workflow-transitions.config.ts`'s Lead entry, which now notes
  the application-layer restriction the map itself doesn't (and can't) express.
- **`/code-review --level high` caught a real non-atomic-write bug before this landed**:
  the first version transitioned the Lead to its terminal `CONVERTED_TO_PROSPECT` status
  *before* creating the Prospect row — with no `$transaction` spanning both tables (this
  codebase has none; see `workflow-transition.service.ts`'s own note on the same
  tradeoff), any failure of the second write (concretely reproducible: `employeeCount` had
  no upper bound, so a value like `3000000000` passed DTO validation but overflowed
  Postgres's `INTEGER` column) permanently orphaned the Lead — converted, but with no
  Prospect and no way to retry, reintroducing via a different mechanism the exact
  "converted Lead just... stops" gap this module exists to close. Fixed by reordering
  (`ProspectService.convert()` now creates the Prospect first, transitions the Lead
  second) plus an explicit `lead.status === 'QUALIFIED'` precondition check before ever
  writing a Prospect row (redundant with what `workflow.transition()` itself validates —
  deliberately so, to catch the common "not qualified yet" case before any write, not just
  before the Lead transition) plus a `@Max(2147483647)` bound added to `employeeCount` in
  `create-prospect.dto.ts`. The audit-log write for the new Prospect is now also wrapped
  in try/catch (logged, not thrown) so an audit hiccup after both real writes succeed
  can't turn a successful conversion into a reported failure — same philosophy as
  `WorkflowTransitionService`'s own `sideEffect` catch. A narrower residual race (Prospect
  created, then the Lead transition itself fails for an unrelated reason) is accepted, not
  fixed — no worse than the double-DB-read tradeoff already accepted in Part C #1.
- **Two lower-severity findings from the same review, fixed**: `VIEW_ALL_OWNERS_ROLES` was
  byte-for-byte duplicated between `lead.service.ts` and `prospect.service.ts` — moved to
  `apps/api/src/common/rbac-visibility.util.ts`, shared by both. The "Convert to prospect"
  button in `LeadPipelineBoard.tsx` was missing `disabled={isTransitioning}` (present on
  its sibling transition buttons), letting an officer navigate to the conversion screen
  while another transition on the same lead card was still in flight.
- **One finding accepted as a documented tradeoff, not fixed**: `LeadModule` now exports
  `LeadRepository` (so `ProspectService` can read a Lead's owner/status) rather than a
  narrower Lead-read-only interface — a real but latent encapsulation weakening (a future
  module could bypass `LeadService`'s ownership-scoping/audit guarantees by importing the
  repository directly), not a bug in this change. Revisit if/when a second consumer
  actually does that.
- **`Prospect.status` (default `"qualifying"`) is a bare string, not a workflow-engine-
  governed enum** — unlike `Lead`, the schema defines no `ProspectStatus` enum, and unlike
  backlog Part C #1's explicit "`LeadStatus` transition" bullet, this backlog item's own
  task list (convert / capture fields / profile screen) never asks for a Prospect-side
  status transition. Left as a plain field nothing writes to after creation; revisit if a
  later item (e.g. Process #3-4, Customer Acquisition/Onboarding) needs a governed
  Prospect status progression before consuming it.
- **`expectedPremium` is the first field any Part C module actually writes through
  `money.util.ts`** (`quantizeMoney`, backlog A.7) — accepted client-side as a decimal
  string (`create-prospect.dto.ts`'s `MONEY_STRING` regex, fils precision, at most 3dp)
  and quantized again server-side before persisting, per
  `ibms-brain/meta/lex/money-decimal-jod.md`.
- **No reassignment of a Prospect's owner** — `salesOwnerUserId` is copied from the
  converting Lead's `ownerUserId` at creation time; same deferred gap as Lead
  reassignment above, for the same reason (not asked for yet).
- **No field-level encryption or masking** on `companyName`/`contactPerson`/`location` —
  none of these are classified Confidential/Highly Confidential in this schema, matching
  the same reasoning as Lead's `contactPhone`/`contactEmail` above.
- **Process 5 (Needs Assessment) is now built** — see Part C #5 below. Domain A Processes
  6-10 (Risk Assessment through the 360° customer view) remain entirely unbuilt.

**Part C #3-4 — Customer Acquisition/Onboarding (Domain A, Processes 3-4)**

- **`apps/api/src/modules/customer/`**: `POST /customers` (individual/corporate,
  `CreateCustomerDto` branches required fields on `customerType` via `@ValidateIf`),
  `GET /customers` / `GET /customers/:id` (owner-scoped like Lead/Prospect, plus
  `customer.360-view.read`'s Compliance/Manager/Exec/Auditor cross-owner grant),
  `POST /customers/:id/ubos` + `GET .../ubos` (`CORPORATE` only), `POST
  /customers/:id/documents` + `GET .../documents` (category fixed to
  `APPLICATION_PROPOSAL` server-side, never caller-chosen), `POST
  /customers/:id/reveal-field` (justified drill-down). `kyc.controller.ts`: `POST
  /customers/:id/kyc` (start, `DRAFT`), `.../submit`, `.../run-screening`,
  `.../rerun-screening`, `.../trigger-edd`, `.../approve`, `.../reject`, `.../schedule-
  review`, plus `GET /kyc-records` (the Compliance queue) / `GET /kyc-records/:id`. See
  `kyc.service.ts`'s header comment for the full `KycStatus` chain and which permission
  gates each step.
- **First real consumer of A.3 field encryption and A.9 masking/drill-down** for
  `Customer.nationalIdEnc`/`contactPhoneEnc`/`contactEmailEnc` and
  `UltimateBeneficialOwner.nationalIdEnc` — `encryptEntityFields`/`decryptEntityFields`
  (`security/encrypted-fields.ts`) and `SensitiveFieldRevealService` had no caller before
  this landed (see the A.3 entry above). List endpoints never decrypt at all; only the
  single-record profile view decrypts-then-masks, and only `reveal-field` returns the true
  plaintext, gated on a written justification.
- **A real bug the e2e suite caught before this landed**: `POST /customers` originally
  returned the bare Prisma `Customer` row straight from `create()` — including the raw
  `nationalIdEnc`/`contactPhoneEnc`/`contactEmailEnc` ciphertext, verbatim, in the HTTP
  response. `GET /customers/:id` was correctly masked from the start; the creation
  response was not, because masking lived only in `get()`. Caught by
  `customer.e2e-spec.ts`'s "never returns the raw encrypted field" assertion against the
  real API. Fixed by extracting both code paths onto one shared `toMasked()` helper in
  `customer.service.ts` — there is now exactly one place a `Customer` becomes an API
  response, not two that can drift.
- **`@code-reviewer` (mandatory here — this module touches maker/checker workflow logic
  and Confidential/Highly Confidential data) caught four more real bugs of the same
  shape, all fixed before this landed**:
  - `GET /customers` (`list()`) had the identical raw-ciphertext leak `POST /customers`
    had — every row's `nationalIdEnc`/`contactPhoneEnc`/`contactEmailEnc` went out
    verbatim. `list()` never decrypts (masking a field means decrypting it, and doing
    that for every row of every Customer is the bulk-decrypt pattern Part 10.3's anomaly
    detection watches for — see that method's own comment), but the raw ciphertext
    columns are now explicitly stripped from every row regardless.
  - `POST /customers/:id/ubos` (`addUbo()`) returned the created UBO straight from the
    repository, including raw `nationalIdEnc` — unlike `listUbos()` a few lines below,
    which already masked it. Both now share one `toMaskedUbo()` helper.
  - `addUbo()`/`addDocument()` checked only that the target Customer existed
    (`customers.findById`), never that the caller owned or could view it — unlike every
    other method in `CustomerService`. A Sales Officer could add a UBO or document to
    *any* Customer, not just their own book. Both now go through the same
    `findOwnedOrVisible()` gate `get()`/`listUbos()`/`listDocuments()` already used.
  - `KycService.decide()` unconditionally transitioned `Customer` `PENDING_KYC ->
    ACTIVE` on every approval — which throws (`WorkflowTransitionService`: "already in
    status ACTIVE") on the *second* KYC approval for the same Customer, i.e. every
    periodic re-KYC cycle this same backlog item asks for. The throw happened after the
    KYCRecord was already committed `APPROVED`, its SLA timer resolved, and
    `nextReviewDueAt` persisted — turning an already-successful approval into a reported
    422. Fixed by gating the Customer transition on `customer.status === 'PENDING_KYC'`
    (the only legal predecessor of `ACTIVE`) — a re-approval on an already-`ACTIVE`
    Customer now simply skips that transition instead of throwing.
  - Also fixed in the same pass: `ScheduleReviewDto.nextReviewDueAt` accepted any
    well-formed ISO-8601 date with no future-date check (a past date would be picked up
    by `KycPeriodicReviewScheduler`'s very next daily sweep); the sanctions/PEP/AML loop
    in `ScreeningService.run()` recomputed the identical watchlist match three times for
    an input that never changes between iterations; `customer.constants.ts` shipped with
    zero consumers (dead code, removed); and the wizard's unreachable "Customer active."
    success message (the page navigates away immediately after a successful submit, so
    it could never render) was removed.
- **A second `@code-reviewer` pass (2026-08-27, run while reviewing Part C #5) found and
  fixed six more issues in this module** — none in #5's own code:
  - `KycService.decide()` did the `SCREENING/EDD -> COMPLIANCE_REVIEW -> APPROVED/REJECTED`
    move as two separate transitions with nothing spanning them; a failure in between
    stranded the file in the transient `COMPLIANCE_REVIEW` state with no endpoint to
    resume it. `decide()` now *accepts* `COMPLIANCE_REVIEW` as an entry status and skips
    the first transition when already there — the "resumable guard" pattern, matching the
    Prospect non-atomic-write fix (`b57a380`).
  - `ScreeningService.run()` on a re-screen (`rerunScreening` / the monthly batch)
    unconditionally overwrote `RiskRating.level` and `KYCRecord.isEdd`, silently
    *downgrading* a customer who had been escalated to `HIGH`/EDD if a later fixture scan
    came back CLEAR — with no audit row. It now only ever *escalates* (a CLEAR re-scan
    keeps a prior `HIGH`; `isEdd` never goes true→false), and audits any actual
    `RiskRating` change.
  - `decide()` could approve a file stranded in `SCREENING` by an interrupted
    `runScreening()` — no `ScreeningResult` rows, no `RiskRating`, activating a Customer
    with no sanctions/PEP/AML check ever run. `decide()` now refuses a file with zero
    `ScreeningResult` rows, and `runScreening()` runs the watchlist check *before* the
    `SCREENING` transition so a failure leaves the file retriable in `SUBMITTED`.
  - The `decide()` `PENDING_KYC -> ACTIVE` Customer activation now catches the
    concurrent-approval race (two KYC files for one Customer approved at once): the loser
    of the `updateMany` race was getting a thrown `ConflictException` *after* its own
    KYCRecord committed `APPROVED`. It re-checks the Customer and only re-raises if it is
    genuinely still `PENDING_KYC`.
  - Both schedulers (`KycPeriodicReviewScheduler`, `ScreeningBatchScheduler`) wrapped
    their entire per-record loop in one outer try/catch — the first record that threw
    abandoned every remaining due record until the next scheduled run. The try/catch is
    now per-record: one failure is logged and the sweep continues. New
    `*.scheduler.spec.ts` files lock this in.
  - `CreateCustomerDto` only made `nationalId` *optional* for a CORPORATE body via
    `@ValidateIf` — it never *rejected* one, so `{ customerType: 'CORPORATE', nationalId:
    '...' }` passed validation and `CustomerService.create()` still encrypted it into
    `nationalIdEnc`. A `CustomerTypeFieldCoherence` class-validator now rejects a body
    that mixes the two forms, and `CustomerService.create()` additionally never maps a
    field from the wrong form onto the row.
- **A third `@code-reviewer` pass (2026-08-27, run against a healthy tree while reviewing
  Part C #6) fixed five more** — again none in #6's own code:
  - `KycService.decide()` still had a non-resumable span *after* the `KYCRecord ->
    APPROVED` transition: if the `nextReviewDueAt` write or the `Customer PENDING_KYC ->
    ACTIVE` activation threw, the file was permanently `APPROVED` while the Customer was
    stranded `PENDING_KYC` with no endpoint to finish it (and periodic re-KYC never picked
    it up either, `nextReviewDueAt` being null). The tail is now `finalizeApproval()`, and
    `decide('APPROVED')` on an already-`APPROVED` file whose tail is demonstrably
    unfinished resumes it; a genuinely finished approval still gets the `422`.
  - The monthly `ScreeningBatchScheduler` (and `KycService.rerunScreening()`) skipped
    every ACTIVE customer whose latest KYC file was `PERIODIC_REVIEW_DUE` — the
    overdue-re-KYC slice, i.e. exactly the customers whose sanctions/PEP/AML screening
    most needs to keep running. Both now accept `PERIODIC_REVIEW_DUE` as well as
    `APPROVED`.
  - `logger.options.ts` `genReqId` echoed an inbound `x-request-id` straight into
    `res.setHeader` with no validation — a value containing CR/LF (or any byte outside a
    safe token set) made `setHeader` throw `ERR_INVALID_CHAR` and `500` the request, a
    trivially reachable denial vector. It now only reuses a client id matching
    `/^[A-Za-z0-9._-]{1,128}$/`, else generates a fresh UUID.
  - `ScreeningService.run()` called `upsertRiskRating` on *every* re-screen, and
    `upsertRiskRating`'s update branch bumps `ratedAt` and rewrites `reason`
    unconditionally — so a re-screen that kept the level (a retained `HIGH`) silently
    mutated the rating row with nothing in the audit trail. It now writes the `RiskRating`
    only on a real change (first assessment or an escalation), and audits every such
    write; the per-run "we re-screened and it was CLEAR" evidence is the `ScreeningResult`
    rows.
  - `CustomerOnboardingWizard`'s Review step rendered `contactPhone`/`contactEmail` from
    the `create()` response, which come back *masked* — the officer's final confirmation
    showed values they couldn't check against what they typed. It now renders the local
    form state (the typed values), which never leaves the browser.
- **`KYCRecord.status`, `ScreeningResult.screeningType`/`.result`, and `RiskRating.level`
  converted from free-text `String` columns to real enums** (migration
  `20260826170000_add_customer_kyc_screening_enums`) so `KYCRecord` could plug into
  `WorkflowTransitionService` (A.6) as its 13th entity, `Customer` as the 14th —
  `KycService.decide()` is the only caller of the `Customer` `PENDING_KYC -> ACTIVE`
  move, gated on `assertDifferentActors(kyc.createdByUserId, actorUserId, ...)` (A.5) so
  the Sales Officer who captured a KYC file can never also be its approver.
- **Sanctions/PEP/AML screening now checks a real, free, publicly published data source
  in every environment including production (Part C #49) — this row is no longer
  accurate as originally written.** `ScreeningService` checks the Customer's `legalName`
  and any UBO `fullName`s against TWO sources: `sample-watchlist.ts` (a fictional
  fixture, still hard-gated on `NODE_ENV !== 'production'`, kept for deterministic
  offline testing) **and** the synced `WatchlistEntry` cache — OFAC SDN + the UN
  Security Council Consolidated List, both free, government-published, no API key,
  refreshed every 12 hours by `WatchlistSyncService`/`WatchlistSyncScheduler`. Production
  is no longer CLEAR-only: a real HIT against either list now escalates a `KYCRecord` to
  `isEdd: true` / `RiskLevel.HIGH`. What's still a real, remaining gap: matching is exact
  on a canonicalised name (`normalizeWatchlistName` — uppercase, Unicode-letter/digit-
  only, token-sorted), **not fuzzy or phonetic**, so spelling variants, transliteration
  differences, and honorifics still defeat it; aliases aren't matched (primary name
  only); and there is still no PAID/premium sanctions provider — only the two free
  lists. All three `ScreeningType`s check the same combined result; a real integration
  would call three distinct providers/lists. See Part C #49's own entry above for the
  full detail.
- **The KYC/EDD review SLA durations and the re-KYC review cadence are drafted, unsourced
  defaults, not PRIV-SOP/PRIV-STD-cited figures** — unlike every other row in
  `ibms-brain/meta/lex/pdpl-sla-timers.md`'s registry (all 14 are PDPL-sourced), there is
  no brain document covering CBJ AML customer-due-diligence turnaround time at all. The
  two new `SLA_REGISTRY` entries (`kyc_standard_review`: 5 business days,
  `kyc_edd_review`: 15 business days) and the re-KYC cadence
  (`RiskLevel.STANDARD`: +12 months, `HIGH`: +6 months, both in `kyc.service.ts`) are
  reasonable placeholders, explicitly marked `DRAFT, UNSOURCED` in code — a `/brain-gap`
  was filed for real sourcing before these are cited as compliant in a regulator-facing
  context.
- **A recurring screening batch and a periodic re-KYC sweep exist, running as the system
  service account** (`ScreeningBatchScheduler`, monthly; `KycPeriodicReviewScheduler`,
  daily) — but a HIT surfaced by either one does not force any status transition or
  auto-suspend the Customer. It only sets `ScreeningResult.escalatedToComplianceAt` on the
  new row; making that visible/actionable to Compliance beyond the queue's existing
  per-KYCRecord view (e.g. a dedicated "re-screening hits" list) is deferred, not built.
- **No object-storage/upload pipeline exists behind `Document.storageRef`** — same
  pre-existing gap as A.3 (see that entry above); this module doesn't add one either.
  `POST /customers/:id/documents` accepts a caller-supplied filename/reference string, not
  an uploaded file — the wizard's "documents" step is metadata capture, not a real file
  picker.
- **The KYC compliance queue has no per-officer assignment** — any user holding
  `kyc.approve` (role-level, not instance-level, matching the seeded permission grid's own
  design) can act on any KYCRecord in the queue; there is no "assigned reviewer" concept
  the way `AccessRecertificationItem` has one.
- **`CustomerStatus.SUSPENDED`/`.CLOSED` are modeled in `WORKFLOW_TRANSITIONS.Customer`
  but nothing in this backlog item actually triggers them** — no suspend/close endpoint
  exists yet; only `PENDING_KYC -> ACTIVE` (via KYC approval) is reachable today. Same
  "modeled ahead of a real trigger" shape as other not-yet-consumed corners of this
  codebase.
- **Fixed a latent e2e test-isolation race, unrelated to this module's own logic but
  exposed by it**: every `*.e2e-spec.ts` file shares one real Postgres test DB with no
  isolation between files, and Vitest's default is to run spec files in parallel worker
  processes. `customer.e2e-spec.ts` (~14 signups across 8 tests) was large enough to
  reliably trigger two real races when run alongside the rest of the suite: extra
  `COMPLIANCE_OFFICER` users shifted `AccessRecertificationService`'s "first eligible
  reviewer" pick (a known, already-documented ordering-not-round-robin gap — see the A.2
  entry above) out from under a concurrently running assertion in `rbac.e2e-spec.ts`, and
  the added parallel CPU load pushed a real-time-based TOTP code in `auth.e2e-spec.ts`
  past its 30-second window. Fixed by setting `fileParallelism: false` in
  `apps/api/test/vitest-e2e.config.ts` — confirmed this makes all 8 files/53 tests pass
  reliably; the previous (parallel) default was flaky at this file count. Slower
  (~15s -> ~90-100s total), but a flaky e2e gate is not real evidence
  (`ibms-brain/meta/lex/definition-of-done.md`).
  **Update (Part C #14 follow-up):** even serialized, `rbac.e2e-spec.ts`'s
  access-recertification tests (`:203` / `:264`) later became slow-then-timeout once the
  shared test DB had ~14 files' worth of accumulated users — `startCycle` did 2 sequential
  writes per active subject and `listItemsForReviewer` one role-lookup per item. Both are
  now batched into a single query each (`AccessRecertificationRepository.createManyItems`,
  `AuditService.recordMany`, `UserRepository.getRoleNamesByIds`), so those endpoints are
  O(1) round-trips regardless of user count. `rbac.e2e-spec.ts` back to 5/5 in ~18s; full
  api e2e **98/98**.

**Part C #5 — Needs Assessment (Domain A, Process 5)**

- **`apps/api/src/modules/needs-assessment/`**: `POST /needs-assessments` (captures the
  questionnaire against a Risk Profile, derives `recommendedCoverageLines`, starts in
  `DRAFT`), `GET /needs-assessments` (owner-scoped: a Sales Officer sees only what they
  captured; Placement/Manager/Executive see the whole book), `GET /needs-assessments/:id`,
  `GET /needs-assessments/questionnaire` (the fixed question set the form renders),
  `PATCH /needs-assessments/:id` (re-answer while `DRAFT`, owner only), and the lifecycle
  actions `POST /needs-assessments/:id/{submit,review,approve,return,reject}`. The
  questionnaire is a fixed config (`needs-assessment.config.ts`) with a deterministic,
  rule-based answers→coverage mapping — not an admin-editable form builder.
- **Status is a real `NeedsAssessmentStatus` enum through `WorkflowTransitionService`**
  (A.6, 15th entity): `DRAFT → PENDING_REVIEW → {REVIEWED → APPROVED | back to DRAFT |
  REJECTED}`. `APPROVED` is terminal — linking an approved assessment to an
  Opportunity/RFQ is Process 11+ (not built), the same "modeled up to the edge of the
  next unbuilt process" shape `Lead.CONVERTED_TO_PROSPECT` had before Part C #2. Migration
  `20260827120000_add_needs_assessment_status_enum` converts the column from free-text
  `String` and adds `createdByUserId`.
- **Maker/checker (A.5)**: the `needs-assessment.approve` role (Branch/Department Manager)
  that reviews, approves, or rejects must differ from `createdByUserId` (the Sales Officer
  who captured it) — `assertDifferentActors()` plus two DB `CHECK` constraints
  (`reviewedByUserId`/`approvedByUserId` each `<> createdByUserId`). The manager who
  records the review and the one who approves *may* be the same person (no source
  requires them to differ); only the capturer is excluded from both. e2e proves the guard
  with a dual-hatted (Sales + Manager) user trying to review their own assessment.
- **Minimal `RiskProfile` parent record** (`apps/api/src/modules/risk-profile/`): `POST
  /risk-profiles` + `GET /risk-profiles?customerId=` + `GET /risk-profiles/:id`, capturing
  only `customerId` + optional `siteLabel` + optional `priorClaimsHistorySummary`. The
  schema makes `NeedsAssessment.riskProfileId` a required FK to `RiskProfile`, and
  `RiskProfile` (backlog #6) had no module — so #5 builds the parent shell it needs. The
  detailed building/equipment/stock/annual-profit/fleet survey, per-asset declared values,
  and the Sum Insured / indemnity-period derivation were Process 6 — **now built, see Part
  C #6 below.** `risk-profile.create` is granted to Sales *and* Placement; a Sales Officer
  can only target a Customer they own, Placement/Manager/Executive any Customer.
- **New seeded permissions**: `needs-assessment.read` and `risk-profile.read`
  (`.create`/`.approve` were already in the A.2 grid). Re-run `npm run db:seed` /
  `db:test:seed`.
- **Deferred**: no manual curation of the derived coverage list (it's purely rule-derived
  from the answers — a manager who disagrees returns it for changes, and the officer
  edits answers); the questionnaire is not runtime-configurable; `NeedsAssessment` has no
  reassignment path (mirrors Lead/Prospect); the `APPROVED → Opportunity/RFQ` link is
  Process 11+; the manager review queue has no per-officer assignment (role-level, like
  the KYC queue).
- **Verification**: 18 new api unit tests (`needs-assessment.config.spec.ts`,
  `needs-assessment.service.spec.ts`, `risk-profile.service.spec.ts`) + 6 new
  `workflow-transitions.config.spec.ts` cases; `needs-assessment.e2e-spec.ts` (9 tests,
  full flow + maker/checker + RBAC + visibility); `needs-assessments.spec.ts` Playwright
  (7 tests incl. `@a11y` + keyboard). All green: 414 api unit, 62 api e2e, 4 contract,
  50 Playwright.

**Part C #6 — Risk Assessment (Domain A, Process 6)**

- **`apps/api/src/modules/risk-profile/`** (extends the #5 parent module): `POST
  /risk-profiles/:id/assets`, `PATCH /risk-profiles/:id/assets/:assetId` (replaces the
  asset's survey fields wholesale), `DELETE /risk-profiles/:id/assets/:assetId` (204) —
  all under the existing `risk-profile.create`. `GET /risk-profiles/:id` now returns
  `{ ...profile, assets, sumInsured }`, and `GET /risk-profiles/consolidated?customerId=`
  rolls every site's survey into one consolidated Sum Insured view (`risk-profile.read`).
- **Deterministic Sum Insured derivation** (`risk-profile.config.ts`, pure + unit-tested,
  same philosophy as `needs-assessment.config.ts`): property Sum Insured = Σ `declaredValue`
  over building/equipment/stock/other; Business Interruption Sum Insured = Σ
  `annualGrossProfit`; indemnity period = the longest BI window; fleet = Σ
  `fleetVehicleCount` over vehicle assets; total = property + BI. **Every roll-up goes
  through `money.util.ts`** (fils precision, `ibms-brain/meta/lex/money-decimal-jod.md`) —
  no raw `Decimal` op, no JS `number`. `deriveSumInsured()` / `consolidateSites()` are the
  only place the arithmetic lives; the web never re-derives it.
- **`Asset` carries no workflow state and no maker/checker** — it is survey data captured
  under `risk-profile.create` and read under `risk-profile.read`, not an approvable
  record. `Asset` has no `-- ENCRYPT` fields, so no field encryption. An `AssetFieldCoherence`
  validator keeps the two shapes apart: a `vehicle` asset takes only `fleetVehicleCount`;
  every other type needs a `declaredValue` and/or `annualGrossProfit`, must not carry a
  fleet count, and may set `indemnityPeriodMonths` only alongside `annualGrossProfit`.
- **No new permissions** — the seeded `risk-profile.create` description already reads
  "Capture a detailed risk survey (Risk Profile/**Asset**)". Migration
  `20260827160000_add_asset_risk_profile_index` adds `@@index([riskProfileId])` on `Asset`
  (the one child table that lacked its parent-FK index — `ScreeningResult`, `Interaction`,
  `KYCRecord` etc. all have theirs). No schema type change, so no `db:generate` needed.
- **`apps/web/app/(app)/risk-profiles/`**: a per-site asset-survey screen (asset table +
  add/remove + a "Derived Sum Insured" panel) and a `?customerId=` list showing every site
  plus the consolidated roll-up. Reached from a "Risk survey" section on the customer
  profile and a new "Risk surveys" nav item. Four states (loading/empty/error/populated),
  `@a11y` + keyboard covered.
- **Deferred**: assembling the survey into an `InsuranceProgram` / `InsuranceProgramLine`
  with per-line Sum Insured was Process 7 (Product Recommendation / Program Design) —
  **now built, see Part C #7 below.** No per-asset revision history (a PATCH replaces in
  place); no reassignment path (mirrors `RiskProfile`/Lead/Prospect).
- **Verification**: 21 new api unit tests (`risk-profile.config.spec.ts` ×10,
  `risk-profile.service.spec.ts` +11); `risk-profile.e2e-spec.ts` (6 tests — derivation,
  coherence 400s, PATCH/DELETE, multi-site consolidation, RBAC + visibility);
  `risk-profiles.spec.ts` Playwright (7 tests incl. `@a11y` + keyboard). All green: 454
  api unit, 69 api e2e, 4 contract, 57 Playwright.

**Part C #7 — Product Recommendation / Program Design (Domain A, Process 7)**

- **`apps/api/src/modules/insurance-program/`**: `POST /insurance-programs`
  (`{ needsAssessmentId }` — assemble, `program.assemble`/Placement only, starts `DRAFT`),
  `GET /insurance-programs?customerId=` + `GET /insurance-programs/:id` (new seeded
  `program.read`, granted Sales/Placement/Manager/Executive), `POST
  /insurance-programs/:id/{reassemble,finalize,reopen}`. `:id` responses carry a
  `context` block — the source Needs Assessment id/status, its `recommendedCoverageLines`,
  and the Risk Profile's currently-derived `SumInsuredSummary` (what a re-assembly would
  seed from).
- **Deterministic assembly** (`insurance-program.config.ts`, pure + unit-tested, same
  philosophy as `needs-assessment.config.ts`/`risk-profile.config.ts`): one
  `InsuranceProgramLine` per line in the APPROVED Needs Assessment's
  `recommendedCoverageLines`, order-stable in `COVERAGE_LINES` order.
  `assembleProgramLines()` maps each coverage line to a canonical `insuranceLine` string
  and picks its `sumInsuredBasis` from `deriveSumInsured()` (Process 6) — **only Property
  All Risks (← `propertySumInsured`) and Business Interruption (← `businessInterruptionSumInsured`)
  get an asset-derived basis**; every other line (liability limit, payroll, per-capita,
  per-vehicle) is created with `sumInsuredBasis: null`, set later at the RFQ/quotation
  stage (Process 11+). An empty asset survey (`assetCount === 0`) leaves Property/BI
  `null` too — not a misleading `0.000`. No arithmetic in this module — the figures were
  already derived at fils precision by `risk-profile.config.ts` (`money.util.ts`); the
  service re-`quantizeMoney()`s at the persistence boundary.
- **`InsuranceProgramStatus` through `WorkflowTransitionService`** (A.6, 16th entity):
  `DRAFT -[finalize]-> FINALIZED -[reopen]-> DRAFT`, with
  `{DRAFT|FINALIZED} -> SUPERSEDED` modeled and reachable but **triggered by no endpoint
  in this item** (same "modeled ahead of a real trigger" shape as
  `CustomerStatus.SUSPENDED/CLOSED`). Migration
  `20260827180000_add_insurance_program_status_enum` converts `InsuranceProgram.status`
  from free-text `String` (the third such enum conversion, after `KycStatus` #3-4 and
  `NeedsAssessmentStatus` #5), adds `needsAssessmentId`/`assembledByUserId` provenance
  columns (bare scalars, no relation — the `AuditLogEntry` is the authoritative trail),
  the parent-FK indexes `InsuranceProgram`/`InsuranceProgramLine` both lacked, and a
  **partial `UNIQUE` index** (`riskProfileId WHERE status <> 'SUPERSEDED'` — raw SQL,
  Prisma can't express the predicate) that makes "one live program per Risk Profile" a
  real DB invariant, not a check-then-act. **Re-run `npm run db:migrate:dev` /
  `db:test:migrate:dev`, then `npm run db:seed` / `db:test:seed`** for the new
  `program.read` permission.
- **One `InsuranceProgram` per `RiskProfile`.** The schema has no program↔multi-`RiskProfile`
  join, and `NeedsAssessment` is per-`RiskProfile` too (`meta/context/data-model.md`:
  `RiskProfile / Asset -> 1..n InsuranceProgramLine`). A multi-site client's cross-site
  roll-up stays the `GET /risk-profiles/consolidated` view — for a human to reference
  when assembling the primary site's program. `POST /insurance-programs` refuses a second
  non-`SUPERSEDED` program for the same `RiskProfile` — a descriptive 409 on the
  non-racing path (the pre-check names the existing program), and the partial `UNIQUE`
  index above (`P2002` → the same 409) for two concurrent assemblies. Point the caller at
  `reassemble` (in place, DRAFT only) or `reopen`.
- **No maker/checker** on a program — assembly is a single-actor Placement/Technical
  Officer task (`program.assemble`, Placement only), and the coverage set it is built
  from was already maker/checker-approved at the Needs Assessment stage (A.5). Visibility
  is inherited from the Risk Profile's Customer, same pattern as
  `RiskProfileService`/`NeedsAssessmentService` (Sales sees its own book,
  Placement/Manager/Executive the whole book).
- **`apps/web/app/(app)/insurance-programs/`**: a `?customerId=` list, a detail screen
  (lines table + derived-Sum-Insured panel + Finalize/Reopen/Re-assemble for Placement),
  and an assemble screen reached from an APPROVED needs assessment. New "Insurance
  programs" nav item and an "Insurance program" section on the customer profile. Four
  states (loading/empty/error/populated), `@a11y` + keyboard covered.
- **Deferred**: no manual line curation (purely rule-derived, like #5's coverage list);
  `SUPERSEDED` has no trigger; the `FINALIZED -> Opportunity/RFQ` link is Process 11+;
  `program.assemble` is role-level (no per-officer queue, like the KYC/needs-assessment
  queues); no reassignment path.
- **`@code-reviewer` pass** (mandatory — workflow + money logic) returned one blocker and
  four minors, all fixed before this landed: the "one live program per Risk Profile"
  guard was a check-then-act with no DB backstop (→ the partial `UNIQUE` index above,
  `P2002` mapped to 409, + a concurrent-assembly e2e test); `assemble()` leaked an
  existence oracle via differing 404 messages for "no such Needs Assessment" vs. "one you
  can't see" (→ normalised); the `CREATE` audit row is now written *before* the lines
  insert so a crash in between still leaves a trail (the zero-line program is recoverable
  via `reassemble`); `reassemble()` re-reads `status` immediately before the wholesale
  line rewrite so a `finalize()` in the window can't be silently clobbered; and
  `finalize()` now refuses a zero-line program.
- **Verification**: 24 new api unit tests (`insurance-program.config.spec.ts` ×7,
  `insurance-program.service.spec.ts` ×17) + 2 new `workflow-transitions.config.spec.ts`
  cases; `insurance-program.e2e-spec.ts` (7 tests — RBAC 403, assembly + Property basis,
  not-APPROVED 422, duplicate 409, **concurrent-assembly race → exactly one program**,
  finalize/reopen/re-assemble lifecycle, visibility 404); `insurance-programs.spec.ts`
  Playwright (8 tests incl. `@a11y` + keyboard). Full suites green: 488 api unit, 76 api
  e2e, 4 contract, 54 web e2e, 11 a11y.

**Part C #8 — Cross-Selling (Domain A, Process 8)**

- **`apps/api/src/modules/cross-sell/`**: a nightly `@Cron('0 4 * * *')` sweep
  (`cross-sell-detection.scheduler.ts`) and an on-demand `POST
  /cross-sell-opportunities/detect` (`{ customerId }`, new seeded `cross-sell.detect` →
  Sales/Manager) compare a customer's in-force `Policy` lines against a benchmark line
  list and flag each missing line as a `CrossSellOpportunity`. `GET
  /cross-sell-opportunities?customerId=&status=` + `GET /:id` (new seeded
  `cross-sell.read` → Sales/Manager/Executive); `POST /:id/convert` and `POST /:id/dismiss`
  (`{ reason }`) under the existing `cross-sell.convert` (Sales only).
- **Deterministic comparison** (`cross-sell.config.ts`, pure + unit-tested, same
  philosophy as `insurance-program.config.ts`): `findCoverageGaps(heldLines, benchmark)`
  returns the benchmark lines a customer holds no in-force policy for, in `BENCHMARK_LINES`
  declaration order, case- and whitespace-insensitive. `BENCHMARK_LINES` is **one
  deliberately conservative global list** (Property All Risks, Business Interruption,
  Public Liability, Workers Compensation) — the vocabulary matches
  `InsuranceProgramLine.insuranceLine`. A per-sector benchmark table is deferred (the
  schema has no structured sector taxonomy — `Customer.natureOfBusiness` is free text).
- **Only customers with ≥1 in-force policy are scanned** (`Policy.status = ACTIVE`) — a
  customer with no cover is a new-business prospect, not a cross-sell target. **The Policy
  module (Domain B) is not built, so `Policy` is empty in every environment and both the
  nightly sweep and an on-demand scan legitimately produce nothing today** — built ahead
  of its data source, same pattern as the A.8 SLA registry's 13 unwired timer types.
- **`CrossSellStatus` through `WorkflowTransitionService`** (A.6, 17th entity): `OPEN
  -[convert]-> CONVERTED` and `OPEN -[dismiss]-> DISMISSED`, both terminal. "Converting"
  only records the decision — starting the actual Opportunity/RFQ for the gap line is
  Process 11+ (same edge `NeedsAssessment.APPROVED` sits at). Migration
  `20260827200000_add_cross_sell_status_enum` converts `CrossSellOpportunity.status` from
  free-text `String` (the fourth such enum conversion, after `KycStatus` #3-4,
  `NeedsAssessmentStatus` #5, `InsuranceProgramStatus` #7), adds
  `detectedByUserId`/`resolvedByUserId`/`resolvedAt`/`dismissReason`, `@@index([status])`,
  and **`@@unique([customerId, gapLine])`** — the `race-safe-invariants.md` backstop (at
  most one opportunity per customer+line, ever; the sweep inserts via
  `createMany({ skipDuplicates })`, so a re-run or two concurrent scans add nothing).
  Prisma expresses this one directly — no raw SQL, unlike #7's partial index. **Re-run
  `npm run db:migrate:dev` / `db:test:migrate:dev`, then `npm run db:seed` /
  `db:test:seed`** for the two new permissions.
- **No maker/checker** — acting on a system-surfaced nudge is a single-actor Sales task,
  not an approval. Visibility is inherited from the Customer's owner, same as
  `lead.service.ts` / `prospect.service.ts` (Sales sees its own book,
  Manager/Executive the whole book).
- **`apps/web/app/(app)/cross-sell/`**: a `?customerId=` list with a "Scan for gaps now"
  button, a last-scan panel (held lines / benchmark / gaps), inline Convert / Dismiss
  (with a reason), and a detail screen. New "Cross-sell" nav item and a "Cross-sell"
  section on the customer profile. Four states, `@a11y` + keyboard covered.
- **Deferred**: a resolved (converted/dismissed) gap is never re-flagged — re-opening
  isn't just a missing endpoint, it needs the `@@unique([customerId, gapLine])` narrowed
  to a partial unique on `status = 'OPEN'` first (a migration), so the current shape is a
  deliberate "one shot per gap, ever". An `OPEN` opportunity is also never auto-closed
  once the customer later buys that line — `runDetection` only ever adds rows, it does
  not reconcile existing `OPEN` rows against current cover (moot while `Policy` is empty;
  wire it in when Domain B lands). The benchmark is global, not per-sector; the
  `CONVERTED → Opportunity/RFQ` link is Process 11+; `cross-sell.convert` is role-level
  (no per-officer queue); no reassignment.
- **Verification**: 20 new api unit tests (`cross-sell.config.spec.ts` ×7,
  `cross-sell.service.spec.ts` ×10 — incl. a `P2002`-on-a-racing-insert skip,
  `cross-sell-detection.scheduler.spec.ts` ×3) + 2 new
  `workflow-transitions.config.spec.ts` cases; `cross-sell.e2e-spec.ts` (7 tests — the
  gap scan + idempotency, **two concurrent scans → one row per gap**, no-policy no-op,
  convert/dismiss lifecycle + resolver stamp + terminal 422, dismiss-needs-a-reason 400,
  RBAC 403, visibility 404); `cross-sell.spec.ts` Playwright (7 tests incl. `@a11y` +
  keyboard).

**Part C #9 — Up-Selling (Domain A, Process 9)**

- **`apps/api/src/modules/up-sell/`**: a nightly `@Cron('0 5 * * *')` sweep
  (`up-sell-detection.scheduler.ts`) and an on-demand `POST
  /up-sell-recommendations/detect` (`{ customerId }`, new seeded `up-sell.detect` →
  Sales/Manager) compare a customer's **designed property Sum Insured** against the
  **current value of their surveyed assets** and raise an `UpSellRecommendation` when the
  gap is material. `GET /up-sell-recommendations?customerId=&status=` + `GET /:id` (new
  seeded `up-sell.read` → Sales/Manager/Executive); `POST /:id/convert` and `POST
  /:id/dismiss` (`{ reason }`) under `up-sell.convert` (Sales only — its seed description
  was tightened from "Act on…" to "Convert or dismiss…" to match `cross-sell.convert`).
- **Deterministic verdict** (`up-sell.config.ts`, pure + unit-tested): `assessUnderinsurance({ currentSumInsured, currentAssetValue })`
  returns `{ shortfall, thresholdAmount, isUnderinsured }`. `isUnderinsured` is true when
  `currentSumInsured > 0` and `shortfall >= UNDERINSURANCE_THRESHOLD_PERCENT` (**10%, a
  drafted default** — roughly where an average clause bites, but no IBMS source names a
  figure) of the Sum Insured. Every figure runs through `money.util.ts` (fils precision,
  `ibms-brain/meta/lex/money-decimal-jod.md`) — `subtractMoney` / `applyPercentage` /
  `compareMoney`, never a JS number.
- **Where the two figures come from.** `currentSumInsured` = Σ of the "Property All
  Risks" line's `sumInsuredBasis` over the customer's non-SUPERSEDED `InsuranceProgram`s
  (#7). `currentAssetValue` = `deriveSumInsured(...).propertySumInsured` over every asset
  behind the customer's whole book of `RiskProfile`s (#6). Both are **snapshotted onto
  the row** at detection. The comparison is deliberately **property/asset-value only** —
  a BI up-sell on annual-gross-profit growth is a separate concern, deferred. Because
  `currentSumInsured` reads the *designed* programme line (not an in-force `Policy` — the
  Policy module isn't built), and `reassemble` (#7) re-derives that line from the current
  survey, the job specifically catches a **survey that grew without a re-assembly /
  endorsement**. When Domain B lands this should read the in-force `Policy`/`PolicySchedule`
  sum insured instead.
- **`UpSellStatus` through `WorkflowTransitionService`** (A.6, 18th entity): `OPEN
  -[convert]-> CONVERTED` and `OPEN -[dismiss]-> DISMISSED`, both terminal (the
  `CONVERTED → endorsement / re-quote` link is Process 22 / 11+). Migration
  `20260827220000_add_up_sell_status_enum` converts `UpSellRecommendation.status` from
  free-text `String` (the fifth such enum conversion), adds
  `detectedByUserId`/`resolvedByUserId`/`resolvedAt`/`dismissReason`, `@@index([customerId])`
  + `@@index([status])`, and a **partial `UNIQUE` index** (`customerId WHERE status =
  'OPEN'` — raw SQL, Prisma can't express the predicate). Unlike #8's `CrossSellOpportunity`
  (a **full** `UNIQUE` — a line gap is binary and one-shot), an up-sell gap is a
  continuous, growing quantity, so a customer who converts/dismisses one recommendation
  can get a fresh one **once their assets grow further**. On top of the DB constraint, a
  pre-check heuristic suppresses an immediate re-flag until `currentAssetValue` exceeds
  the most recent resolved recommendation's — so a customer who declined an increase
  isn't nagged nightly with the same figure. **Re-run `npm run db:migrate:dev` /
  `db:test:migrate:dev` (or `db:migrate:deploy` given the pre-existing checksum drift),
  then `npm run db:seed` / `db:test:seed`** for the two new permissions.
- **Only customers with ≥1 non-SUPERSEDED `InsuranceProgram` are scanned** — there is no
  "current Sum Insured" to compare against otherwise. Unlike #8, this is **buildable
  data**: assemble a programme (#7), grow the asset survey (#6), and the scan flags a
  real recommendation.
- **No maker/checker** — acting on a system-surfaced nudge is a single-actor Sales task.
  Visibility inherited from the Customer's owner, same as `cross-sell.service.ts` /
  `lead.service.ts`.
- **`apps/web/app/(app)/up-sell/`**: a `?customerId=` list with a "Scan for
  under-insurance now" button, a last-scan panel (both figures + shortfall + verdict),
  inline Convert / Dismiss (with a reason), and a detail screen. New "Up-sell" nav item
  and a "Up-sell" section on the customer profile. Four states, `@a11y` + keyboard
  covered.
- **Deferred**: property/asset-value only (no BI up-sell); `currentSumInsured` is the
  designed programme line, not an in-force policy (Domain B); the 10% threshold and the
  re-nag heuristic are drafted, not sourced; no absolute-shortfall floor (a 10% gap on a
  tiny Sum Insured still flags); `up-sell.convert` is role-level (no per-officer queue);
  no reassignment.
- **`@code-reviewer` pass** (mandatory — workflow + money) returned **APPROVE WITH
  MINORS** (no blocker, no lex violation — money/workflow/race-safety all verified
  clean). Three MINORs fixed before this landed: `findCustomerIdsWithLiveProgram`'s
  `distinct` was redundant + divergent from its sibling and had no real-DB coverage (→
  dropped it; added an e2e that runs the actual nightly sweep via
  `app.get(UpSellDetectionScheduler).runSweep()`); `PROPERTY_ALL_RISKS_LINE` was a
  hand-copied literal (→ exported `PROGRAM_LINE_PROPERTY_ALL_RISKS` from
  `insurance-program.config.ts` and re-exported it, so the two can't drift);
  `findLatestResolvedByCustomerId` ordered by `detectedAt` where resolution recency is
  `resolvedAt` (→ ordered by `resolvedAt`). Plus a NIT: added a CONVERTED-prior
  suppression test.
- **Verification**: 23 new api unit tests (`up-sell.config.spec.ts` ×7,
  `up-sell.service.spec.ts` ×13 — incl. the re-nag suppression off both a DISMISSED and
  a CONVERTED prior, re-flag-on-growth, and a `P2002`-on-a-racing-insert skip,
  `up-sell-detection.scheduler.spec.ts` ×3) + new `workflow-transitions.config.spec.ts`
  cases; `up-sell.e2e-spec.ts` (8 tests — the full assemble → grow assets → flag →
  idempotent → dismiss → suppress → re-flag chain, the real nightly sweep
  (`runSweep()`) flags an under-insured customer, **two concurrent scans → one row**,
  no-programme no-op, convert + resolver stamp + terminal 422, dismiss-needs-a-reason
  400, RBAC 403, visibility 404); `up-sell.spec.ts` Playwright (7 tests incl. `@a11y` +
  keyboard). Full suites: **543** api unit (47 files), **91** api e2e (13 files), 4
  contract, 6 web unit, 66 web e2e, 13 a11y, `npm audit` 0.

**Part C #10 — Relationship Management / CRM (Domain A, Process 10)**

- **No schema migration, no seed change.** `Interaction` + the `InteractionChannel` enum
  (meeting / call / email / WhatsApp / visit / proposal / renewal / claim / complaint /
  portal / SMS / other) were already in the schema, and `interaction.log`
  (Sales/Placement/Claims/Finance/Compliance/Manager) + `customer.360-view.read`
  (Sales/Manager/Executive/Compliance/Auditor) were already seeded by A.2. This process
  needed only application code.
- **`apps/api/src/modules/crm/`** (+ `repositories/interaction.repository.ts`), routes
  nested under `customers/:customerId` alongside `ubos` / `documents`:
  - `POST /customers/:customerId/interactions` (`{ channel, summary, occurredAt? }`,
    `interaction.log`) — logs one touchpoint. **Gated by the permission alone, not by
    customer ownership**: relationship touchpoints are cross-functional (a Claims Officer
    logs a claim call, a Finance Officer a collection call), which is exactly why six
    roles hold `interaction.log`. The customer must exist (404 otherwise). A future
    `occurredAt` is rejected 422 (backdating a call/meeting logged after the fact is
    allowed).
  - `GET /customers/:customerId/interactions` and `GET /customers/:customerId/360-view`
    (`customer.360-view.read`) — owner-or-cross-owner visibility, identical to
    `CustomerService.get()` (`NotFoundException` either way, no existence oracle).
- **The 360° view** aggregates the interaction log with the customer's policies, claims
  and complaints and runs all four through `crm.config.ts`'s **pure, deterministic**
  `buildCustomerTimeline()` — one reverse-chronological list, each kind placed at its
  representative instant (interaction→`occurredAt`, policy→`inceptionDate ?? createdAt`,
  claim→`lossDate`, complaint→`createdAt`), ties broken by a fixed kind order then
  `refId` so the output never depends on input order. Same "pure config module" pattern
  as `needs-assessment.config.ts` / `cross-sell.config.ts` / `up-sell.config.ts`.
- **`Interaction` is NOT a `WorkflowTransitionService` entity** — it has no status column
  — and has no maker/checker. It is a factual log: create + read only, no edit or delete.
  (Same judgement as Prospect #2 leaving `Prospect.status` alone — the backlog bullets
  don't ask for a governed progression.)
- **The Policy / Claim / Complaint modules (Domains B / C / E) are not built, so those
  three collections are empty in every environment and the timeline is interactions-only
  today** — built ahead of its data source, the same shape as #8. The read-only
  `Policy` / `Claim` / `Complaint` finders live on `InteractionRepository` (the same
  reason `cross-sell-opportunity.repository.ts` owns its own `Policy` reads).
- **Sensitive data** (`ibms-brain/meta/lex/sensitive-data-handling.md`): `Claim` is
  HIGHLY_CONFIDENTIAL, so the claim projection `select`s an id, number, status and dates
  **only** — never `causeOfLoss`, `lossLocation`, `estimatedLoss`, any money figure, or a
  money-derived flag like `isLargeClaim` (money is dropped from the policy projection
  too). The 360° read writes a `READ` `AuditLogEntry` — counts only, never content —
  flagged `isSensitiveDataAccess` when the aggregate actually surfaced a claim, giving the
  A.4 read-logging requirement its first real business-entity caller.
- **`occurredAt`** (optional, backdate-only) must carry an explicit timezone offset when
  it includes a time component — `new Date("2026-02-01T09:00:00")` is parsed as
  server-local time by the JS engine and would silently shift the recorded instant for
  any caller that isn't the web client (which always sends `…Z`). A bare date
  (`2026-02-01`) is accepted (parsed as UTC midnight, unambiguous); an offset-less
  datetime is rejected 422.
- **Shared:** `CUSTOMER_CROSS_OWNER_ROLES` moved from a private const in
  `customer.service.ts` to `common/rbac-visibility.util.ts`, and a new
  `isCustomerVisibleTo(customer, actor)` helper there is the one place the
  owner-or-cross-owner rule is decided (now used by `customer.service.ts` and
  `crm.service.ts`; `cross-sell.service.ts` / `insurance-program.service.ts` still carry
  an inline equivalent, candidates to migrate).
- **`apps/web/app/(app)/crm/`**: a `?customerId=` customer-timeline screen (a log-an-
  interaction form — channel select + summary + optional date — over the merged timeline
  and a counts row), reached from a new "Relationship (CRM)" nav item and a
  customer-profile section. The log form renders for any role holding `interaction.log`
  **even when the 360° view 403s** (Placement/Claims/Finance can log but not browse the
  timeline), with a note in place of the timeline. Four states, `@a11y` + keyboard
  covered.
- **Deferred**: the three non-interaction collections are empty until Domains B/C/E land;
  no edit/delete of a logged interaction; no link to `CommunicationLog` / `ConsentRecord`
  (Process 44 / Part D — this logs what happened, it does not send anything or check
  marketing consent); no pagination on the interaction list; a role holding
  `interaction.log` but not `customer.360-view.read` (Placement/Claims/Finance) can log
  but cannot see the timeline it feeds (a grid choice, not a bug); no per-officer queue;
  no reassignment.
- **`@code-reviewer` pass** (mandatory — the 360° view reads `Claim` / HIGHLY_CONFIDENTIAL
  data): returned **5 findings, all fixed** — (1) the web screen returned the load-error
  view before the log form, dead-ending the three cross-functional roles that can only
  log → the form now renders on a 403 view; (2) `@IsISO8601()` let an offset-less
  datetime through and `new Date()` parsed it server-local → an explicit offset is now
  required for a datetime `occurredAt`, 422 otherwise, with an e2e for it; (3)
  `isLargeClaim` (a loss-value threshold flag) was in the claim projection, contradicting
  the "no money signal" contract → removed from the projection, the type, and the
  timeline `detail`, with an e2e proving it is stripped even when set; (4)
  `new Date(occurredAt).toISOString()` on the web could throw `RangeError` into the
  generic catch → guarded with a date-specific message; (5) the owner-or-cross-owner
  visibility check was a fourth inline re-implementation → extracted
  `isCustomerVisibleTo()` into `rbac-visibility.util.ts` and adopted it in
  `crm.service.ts` and `customer.service.ts`.
- **Verification**: 20 new api unit tests (`crm.config.spec.ts` ×6,
  `crm.service.spec.ts` ×14 — log + audit, not-owner-gated logging, 404 / 422 guards
  (future, offset-less datetime, bare date accepted), audit best-effort, read visibility
  404s, the sensitive-read flag); `crm.e2e-spec.ts` (7 tests — log + newest-first
  timeline, 422 future / 400 empty / 400 bad channel / 422 offset-less datetime / 201
  bare date, 404 missing customer, 360° aggregate of a directly-seeded Policy + Claim +
  Complaint with correct counts + merged order + a claim projection that omits loss
  detail / money / `isLargeClaim`, a Claims Officer logs a non-owned customer but 403s
  the 360° view, an External Auditor 403s logging but reads the view, other-Sales-officer
  404 on view + interactions); `crm.spec.ts` Playwright (8 tests incl. the log-form-on-403
  path, a neither-permission friendly message, `@a11y` + keyboard). Full suites green:
  563 api unit (49 files), 98 api e2e (14 files), 4 contract, web e2e 73, a11y 14 (the
  pre-existing `rbac.e2e-spec.ts` full-suite flake — passes 5/5 in isolation — is
  unrelated).

**Part C #11 — RFQ / Market Submission (Domain B, Process 11)**

- **First Domain B module.** `RFQ` requires an `Opportunity` parent and no Opportunity
  module existed, so this ships a **minimal `Opportunity` module** — the same "build the
  minimal parent" shape as #5's minimal `RiskProfile`. The full Opportunity lifecycle
  (Recommendation, Client Decision's 6 outcomes, renegotiation, close-lost,
  `targetPremiumThreshold`) is Processes 16–17 and deliberately out of scope.
- **Migration `20260828120000_add_rfq_market_submission`** (hand-authored + applied +
  `migrate resolve`, the known `_prisma_migrations` checksum-drift workaround — run
  `npm run db:migrate:deploy` on a fresh checkout). No enum conversion — `OpportunityStatus`
  / `RfqInsurerStatus` were already proper enums (modeled ahead at A.6). It adds:
  `Opportunity.createdByUserId` + `RFQ.issuedByUserId` provenance (bare scalars, the
  `AuditLogEntry` is authoritative); `@@index([insuranceProgramId])` on `Opportunity`,
  `@@index([insurerId])` + `@@index([status])` on `RFQInsurer`; `@@unique([opportunityId,
  insuranceLine])` on `RFQ` (one RFQ per line per Opportunity); and a **partial `UNIQUE`
  index** `Opportunity(insuranceProgramId) WHERE status <> 'CLOSED_LOST'` (raw SQL — Prisma
  can't express the predicate; `ibms-brain/meta/lex/race-safe-invariants.md`). Partial, not
  full: a lost placement leaves the Opportunity `CLOSED_LOST` and frees the finalized
  programme to be re-marketed.
- **Seed:** three new permissions — `opportunity.create` (Placement), `opportunity.read` +
  `rfq.read` (Sales/Placement/Manager/Executive). `rfq.create` + `rfq.insurer.update`
  (Placement) were already seeded by A.2.
- **`apps/api/src/modules/opportunity/`** (+ `repositories/opportunity.repository.ts`):
  `POST /opportunities` (`{ insuranceProgramId }`, `opportunity.create`) — the programme
  must be `FINALIZED` (422 otherwise); `customerId` is resolved server-side
  (programme → `RiskProfile` → `Customer`), never caller-supplied; a descriptive 409
  pre-check plus the partial-UNIQUE `P2002 → 409` backstop enforce one live Opportunity per
  programme. `GET /opportunities?customerId=` + `GET /:id` (`opportunity.read`). Visibility
  is the `CUSTOMER_FILE_CROSS_OWNER_ROLES` rule (Placement works the whole book; a Sales
  Officer is scoped to customers they own), identical to `InsuranceProgramService`.
- **`apps/api/src/modules/rfq/`** (+ `repositories/rfq.repository.ts`, two controllers):
  - `POST /rfqs` (`{ opportunityId, insuranceLine, insurerIds[], followUpThresholdDays? }`,
    `rfq.create`) — the Opportunity must be `NEEDS_CONFIRMED` or `RFQ_ISSUED`; `insurerIds`
    are de-duplicated and every id must resolve to a real `Insurer` (422); a pre-check plus
    the `@@unique` `P2002 → 409` enforce one RFQ per `(opportunity, line)`; the `CREATE`
    audit row is written **before** the shortlist insert (recoverable on a partial crash,
    same ordering as `InsuranceProgramService.assemble`); each shortlisted insurer becomes a
    `SENT` `RFQInsurer` (per-row insert, `P2002` tolerated). On the **first** RFQ the
    Opportunity is moved `NEEDS_CONFIRMED → RFQ_ISSUED` through `WorkflowTransitionService`
    — **best-effort**: a concurrent transition that already moved it is logged, never
    surfaced as a failure of the (already committed) RFQ.
  - `GET /rfqs/selectable-insurers` (`rfq.create`) — read-only `Insurer` master data for
    the shortlist picker (there is no Insurer-management module — narrative Process 31).
  - `GET /rfqs?opportunityId=|customerId=` + `GET /:id` (`rfq.read`) — exactly one scope
    param required (422 otherwise).
  - `POST /rfqs/:id/insurers` (`rfq.create`) — broaden the shortlist; ids already on it are
    skipped, `@@unique([rfqId, insurerId])` the backstop; audits only the ids actually added.
  - `POST /rfq-insurers/:id/transition` (`{ toStatus }`, `rfq.insurer.update`) — `VIEWED` /
    `QUOTED` / `DECLINED` / `NO_RESPONSE` (`SENT` is not a target); the legal-move map is
    `WorkflowTransitionService`'s (`WORKFLOW_TRANSITIONS.RFQInsurer`, modeled ahead at A.6);
    `QUOTED` / `DECLINED` stamp `respondedAt` in the same write via the transition `data`
    hook.
- **Follow-up alert sweep** — nightly `@Cron('0 6 * * *')` `rfq-followup.scheduler.ts` +
  `RfqService.runFollowUpScan()` (system service account, same convention as the
  cross-sell / up-sell schedulers). For every not-yet-alerted submission still `SENT` /
  `VIEWED` whose RFQ's `followUpThresholdDays` has elapsed since `sentAt` — counted in
  **Jordan business days** (`rfq.config.ts`'s pure `isFollowUpDue()` → `addBusinessDays()`,
  same weekend-only lower-bound caveat as every other deadline: no public-holiday calendar
  exists yet) — it stamps `followUpAlertSentAt` (race-safe: `updateMany` conditional on the
  timestamp still being null) and writes an `UPDATE` audit row. **Alert only in #11** — it
  did not move a silent insurer to `NO_RESPONSE`; **Process 12 (below) adds that
  auto-advance**, and the `/brain-gap` on `policy-lifecycle.md` was filed then.
- **No maker/checker** — issuing an RFQ and recording insurer responses is single-actor
  Placement work, and the coverage set was maker/checker-approved at the Needs Assessment
  stage (A.5).
- **`apps/web/app/(app)/opportunities/` + `apps/web/app/(app)/rfqs/`**: a `?customerId=`
  opportunity list, an opportunity detail (its RFQs + a "Create RFQ for a line" button), an
  RFQ create screen (line + insurer shortlist checkboxes + threshold), an RFQ detail
  (insurer-submissions table with a per-row status `<select>` + an "Add insurers" control),
  and a `?opportunityId=|customerId=` RFQ list. A "Take to market" button on a **FINALIZED**
  insurance program creates the Opportunity and routes into the RFQ flow (on a 409 it routes
  to the customer's opportunity list). One "RFQ / market" nav item. Non-Placement roles see
  the read views without the create/transition controls.
- **Deferred**: full Opportunity lifecycle (#16–17); new-business Opportunities with no
  programme; a real public-holiday calendar; one RFQ per `(opportunity, line)` (re-marketing
  needs a deliberate relaxation at #15/#17); an Insurer-management module (Process 31); a
  per-officer queue / reassignment; `Quotation` / `ComparisonMatrix` / `Recommendation`
  (#13–16). (Auto-`NO_RESPONSE` on follow-up was deferred here and landed in #12, below.)
- **`@code-reviewer` pass** (mandatory — workflow / approval logic on `Opportunity` +
  `RFQInsurer`): **APPROVE WITH MINORS — no blockers, no lex violations.** The race-safety
  of both invariants, the transition routing, and the visibility gates were all confirmed
  correct. Findings addressed: (1) the RFQ line is now validated against the designed
  `InsuranceProgram`'s canonical line set (422 for a typo / off-programme line, so #13–16
  don't inherit a forked line); (2) `addInsurers` now refuses to broaden a shortlist once
  the parent Opportunity has left the market phase (modelled ahead of #16–17), while
  `transitionInsurer` deliberately stays ungated (recording a factual insurer response is
  always valid); (3) the stale "a follow-up alert marks a silent insurer NO_RESPONSE"
  comment in `workflow-transitions.config.ts` reconciled to match the alert-only behaviour;
  (4) `markOpportunityRfqIssued` now documents that #12 must derive "has RFQs" from the RFQ
  table, not `Opportunity.status` (the best-effort transition can lose a race or swallow an
  audit-write failure inside `transition()`). NITs (unpaginated sweep, api/web enum
  duplication, PLACEMENT-only rationale) resolved with comments.
- **Verification**: 41 new api unit tests (`rfq.config.spec.ts` ×5,
  `opportunity.service.spec.ts` ×11, `rfq.service.spec.ts` ×22,
  `rfq-followup.scheduler.spec.ts` ×3); `rfq.spec.ts` Playwright (5 tests incl. `@a11y`).
  Full suites green: **604** api unit (53 files), api e2e **96/98** (the 2 failures are the
  pre-existing `rbac.e2e-spec.ts` access-recertification full-suite flake — timeouts under
  load, unrelated to this change), 4 contract, 6 web unit, web e2e (Playwright + axe).

**Part C #12 — Market Placement (Domain B, Process 12)**

- **Extends the `apps/api/src/modules/rfq/` module** — no new module. The backlog names
  `RFQInsurer` + `CommunicationLog`; the two deliverables are "update each insurer's
  response status" and "answer insurer queries and supply additional information".
- **`CommunicationLog` is widened, not replaced.** The schema's `CommunicationLog` is
  Process 44 — *outbound customer* comms (required `customerId`, `templateId`,
  `languageUsed`, `respectedConsent`; no RFQ/Insurer link, no direction, no free-text body).
  Rather than a dedicated model, the table is extended to carry broker↔insurer RFQ
  correspondence too (**the deliberate call recorded here**): `customerId` + `languageUsed`
  relaxed to nullable; new `direction CommunicationDirection @default(OUTBOUND)` (new enum
  `INBOUND | OUTBOUND` — the default keeps Process 44's always-outbound semantics for when
  it is built); `rfqId?` / `rfqInsurerId?` FKs (`ON DELETE SET NULL`); `subject?`, `body?`
  (nullable in DB so a Process-44 template row needs none; the DTO requires it),
  `loggedByUserId?`, `createdAt`; `@@index` on `customerId` / `rfqId` / `rfqInsurerId`.
  Migration `20260829120000_extend_communication_log_for_placement` (hand-authored +
  applied + `migrate resolve`, the checksum-drift workaround — run `npm run db:migrate:deploy`
  on a fresh checkout). Zero rows and zero code referenced the table before this item.
- **Seed:** one new permission — `rfq.communication.log` (Placement). Reading the
  correspondence is folded into the existing `rfq.read` (same roles that see the RFQ).
- **`POST /rfqs/:id/communications`** (`{ direction, channel, body, subject?, rfqInsurerId?,
  occurredAt? }`, `rfq.communication.log`) — visibility via the RFQ's Opportunity's Customer
  (`findVisibleRfq`); a `rfqInsurerId` must be on *this* RFQ (422 otherwise; omit it to
  address the whole panel); `occurredAt` (optional) must carry an explicit offset and not be
  in the future (422, in the service so the message explains). `customerId` is backfilled
  from the RFQ's Opportunity. **The `CREATE` audit row records metadata only — `direction` /
  `channel` / `rfqInsurerId` / `subject`, never the free-text `body`** (Confidential — loss
  history, sums insured; `ibms-brain/meta/lex/sensitive-data-handling.md`), the same shape
  as CRM's interaction audit. A factual log — no workflow status, no maker/checker.
- **`GET /rfqs/:id/communications`** (`rfq.read`) — reverse-chronological (`sentAt`, then
  `createdAt` for same-instant ties).
- **Auto-`NO_RESPONSE`.** `RfqService.runFollowUpScan` (the nightly sweep) now, for every
  past-threshold open submission, *also* moves it `SENT`/`VIEWED → NO_RESPONSE` through
  `WorkflowTransitionService` — not just alerts (#11 was alert-only). The engine's
  status-conditional write is the race backstop (`ibms-brain/meta/lex/race-safe-invariants.md`):
  a concurrent manual `QUOTED`/`DECLINED` makes the move a no-op — `ConflictException`, or an
  illegal-move 422 from a now-terminal state — which is caught and counted `transitionSkipped`,
  not `failed`. `respondedAt` is left null (there was no response). A late responder can
  still be moved `NO_RESPONSE → QUOTED/DECLINED`. `findOpenSubmissionsForFollowUp` drops its
  `followUpAlertSentAt: null` filter so a submission alerted under #11 still becomes
  NO_RESPONSE-eligible; it stays idempotent (status filter + the conditional stamp). The
  `RFQInsurer` comment in `workflow-transitions.config.ts` is rewritten (manual + sweep
  paths); `FollowUpScanResult` gains `autoNoResponse` / `transitionSkipped`. **(#13
  extends this: the sweep first drops any open submission whose insurer already has a
  current `Quotation` — see Part C #13 § "RFQ follow-up sweep / `Quotation`-table
  awareness" — and `FollowUpScanResult` gains a `skippedQuoted` counter.)**
- **Shared util** — `crm.service.ts`'s private `parseOccurredAt` (offset-required, no-future,
  ~1 min skew) is extracted to `apps/api/src/common/historical-instant.util.ts`
  (`parseHistoricalInstant(raw, label)`), used by both CRM interaction logging and RFQ
  correspondence. CRM behaviour is unchanged.
- **`apps/web/app/(app)/rfqs/[id]/`** — a "Correspondence" section on the RFQ detail screen:
  the exchange list (everyone with `rfq.read`) plus a Placement-only log form (direction,
  channel, optional insurer scoped to the shortlist, subject, body). One line of helper copy
  notes `NO_RESPONSE` may be set by the nightly sweep.
- **Deferred**: no attachment upload for "additional information" — the log is a free-text
  note (a Document-module concern, narrative Process); no per-insurer thread view or
  pagination on the correspondence list; a placement row leaves `respectedConsent` /
  `languageUsed` / `templateId` unused (Process 44's columns); auto-`NO_RESPONSE` is
  best-effort and inherits the same business-day *lower bound* (no public-holiday calendar).
  **Process 44 (outbound customer communication) is unbuilt and will share this widened
  table** — the discriminator is `rfqId IS NULL` (a placement row also carries a backfilled
  `customerId`, so a future "all communications for customer X" read must filter
  `rfqId IS NULL`), documented on the `CommunicationLog` model. The free-text `body` is
  handled as Confidential (never audit-logged, never masked-logged) but could attract
  Highly-Confidential content on a medical/life-line RFQ with no guard — the same latent
  free-text risk already accepted for `Interaction.summary` at #10; no lex covers it.
- **No `apps/api` e2e for the RFQ module** — a pre-existing gap (#11 also shipped with unit
  + web-e2e only). `@code-reviewer` recommends a small `rfq.e2e-spec.ts` against real
  Postgres covering `POST/GET /rfqs/:id/communications` (happy path + the
  `rfqInsurerId`-not-on-this-RFQ 422 + not-visible 404) and `runFollowUpScan` moving a real
  past-threshold row to `NO_RESPONSE` while leaving a concurrently-`QUOTED` row untouched —
  the migration and the system-actor `transition()` path are exactly what an e2e catches
  cheaply. Not built here; carried as a Domain-B follow-up.
- **`@code-reviewer` pass** (mandatory — system-actor workflow transition + Confidential
  data): **APPROVE WITH MINORS — no blockers, no lex violations.** The auto-`NO_RESPONSE`
  race analysis (engine status-conditional `updateMany` → `ConflictException` / illegal-move
  422, both classified `transitionSkipped`), the `transition()`-only status write, the
  metadata-only `CommunicationLog` CREATE audit (no `subject`/`body`), the maker/checker
  non-applicability, and the existence-oracle-free visibility were all verified. Minors
  addressed: the `/brain-gap` row wording (`followUpThresholdDays` is on `RFQ`, not
  `RFQInsurer`) — fixed in a follow-up brain commit; the `CommunicationLog` `rfqId IS NULL`
  discriminator — documented on the model + here; the `FollowUpScanResult` counter-overlap
  and the scheduler's `transitionSkipped`-only log path — comment + guard added. The api
  e2e gap is carried as the follow-up above.
- **`/brain-gap`** filed + pushed — `ibms-brain/meta/context/policy-lifecycle.md` § "The
  rules that aren't obvious" gains a row on RFQ follow-up / insurer non-response (a lapsed
  threshold auto-marks the silent submission `NO_RESPONSE` via the engine, not just alerts;
  `NO_RESPONSE` is non-terminal).
- **Verification**: +22 api unit tests — `historical-instant.util.spec.ts` ×8;
  `rfq.service.spec.ts` gains `logCommunication` ×8 + `listCommunications` ×2 and its
  `runFollowUpScan` block was rewritten for the auto-`NO_RESPONSE` path (×7, incl. the
  concurrent-response skip); `rfq-followup.scheduler.spec.ts` +1. `rfq.spec.ts` Playwright
  6/6 (a correspondence-log test added), `@a11y` clean. Full suites green: **626** api unit
  (54 files), api e2e **96/98** (the 2 failures are the pre-existing `rbac.e2e-spec.ts`
  access-recertification full-suite flake — timeouts under load, unrelated), web unit 6,
  turbo `lint` 3/3, api + web `typecheck` clean.

**Part C #13 — Quotation Management (Domain B, Process 13)**

- **New module** `apps/api/src/modules/quotation/` + `apps/api/src/repositories/quotation.repository.ts`.
  The backlog names `Quotation` and two bullets: capture an insurer's quote
  (premium / deductible / limits / BI period / liability limit / exclusions / conditions),
  and a version chain (`previousVersionId` / `isCurrentVersion`) where a renegotiation
  creates a new version and never overwrites the old one. The `Quotation` model already
  existed in the schema (migration `20260825124114`) with the chain columns — this item is
  its first consumer.
- **Migration `20260901120000_add_quotation_capture`** (hand-authored + `migrate deploy` —
  the checksum drift blocks `migrate:dev`, not `deploy`; applied to `db` + `db-test`):
  adds `Quotation.capturedByUserId` (bare scalar provenance, like `RFQ.issuedByUserId`),
  a `Quotation_insurerId_idx`, and a **partial `UNIQUE` index**
  `Quotation(rfqId, insurerId) WHERE isCurrentVersion = true` — "at most one current
  version per version chain" as a real DB invariant, the exact example
  `ibms-brain/meta/lex/race-safe-invariants.md` names. The existing `previousVersionId @unique`
  additionally serializes two concurrent revisions of the same node (only one successor).
- **Seed** — one new permission `quotation.read` (Sales / Placement / Manager / Exec,
  mirroring `rfq.read`). `quotation.capture` and `quotation.negotiate` (both Placement)
  were already seeded. Run `npm run db:seed` (and `db:test:seed`).
- **`POST /quotations`** (`quotation.capture`) — captures a version-1 `Quotation`.
  Validates: RFQ visible via its Opportunity's Customer (`loadVisibleRfq`, no existence
  oracle); the insurer is on the RFQ's shortlist (422) and is not `DECLINED` (422); the
  money terms normalize (`normalizeQuotationTerms` — 422 on a negative amount, a zero
  premium, a bad currency code, a BI period outside 1..120, a commission rate outside
  0..100). A `P2002` on the partial `UNIQUE` → 409 pointing at `revise`.
- **`POST /quotations/:id/revise`** (`quotation.negotiate`) — the `:id` must be its
  chain's current version (422 otherwise). `QuotationRepository.reviseChain` does both
  writes in **one Prisma interactive `$transaction`** — a deliberate, local exception to
  this codebase's no-`$transaction` convention (documented at the method): a
  status-conditional `updateMany` clears the predecessor's `isCurrentVersion` (0 rows → the
  transaction returns `null`, a concurrent revise won → 409), then the successor is
  inserted **as** current with `previousVersionId` set and `versionNumber + 1`. A `P2002`
  from the insert (partial `UNIQUE` / `previousVersionId @unique`) rolls the whole
  transaction back → 409, with the predecessor's flag never left cleared. A hard crash
  between the two steps cannot leave the chain headless (which would dead-end future
  `revise()` and let a later `capture()` mint a disconnected second v1).
- **`GET /quotations?rfqId=|opportunityId=|customerId=`** + **`GET /quotations/:id`**
  (`quotation.read`) — exactly one scope param (422 otherwise); rows grouped into
  per-insurer chains (`{ rfqId, insurerId, insuranceLine, insurer, current, versions[] }`,
  `versions` oldest-first, never pruned).
- **Money** — every monetary field goes through `money.util.ts` (`quantizeMoney` /
  `toMoney`, fils precision, `ibms-brain/meta/lex/money-decimal-jod.md`); the pure
  `normalizeQuotationTerms` is the only place it happens and is unit-tested. `limits` is
  stored as opaque JSON (Prisma `Json?`); `commissionRatePercent` is captured verbatim to
  2 dp, **not** applied to any premium (that is Finance, #31+).
- **Best-effort workflow advance** — on a successful capture / revise the service also
  calls `WorkflowTransitionService` for the matching `RFQInsurer` `SENT`/`VIEWED`/`NO_RESPONSE`
  `→ QUOTED` (stamping `respondedAt`) and the parent `Opportunity` `RFQ_ISSUED →
  QUOTES_RECEIVED`. Both are logged, never thrown (the quotation is already committed +
  audited — same philosophy as `RfqService.markOpportunityRfqIssued`). **Not
  authoritative**: derive "this insurer has quoted" from the `Quotation` table, not
  `RFQInsurer.status` (a best-effort move can lose a race or hit a transient error).
- **`Quotation` is not a `WorkflowTransitionService` entity** — `isCurrentVersion` is a
  boolean, not a workflow `status`; the chain has no state machine (same as `Interaction`
  #10 / `CommunicationLog` #12). No maker/checker — capturing what an insurer sent is a
  factual, single-actor Placement record; the coverage set was maker/checker-approved at
  the Needs Assessment stage (#5).
- **The `CREATE` audit row is metadata + money only** (`quotationAuditSnapshot`):
  `versionNumber` / `isCurrentVersion` / `previousVersionId` / `premium` / `currency` /
  `deductible` / `liabilityLimit` / `commissionRatePercent` / `biPeriodMonths` plus
  `hasExclusions` / `hasConditions` / `hasLimits` booleans — **never** the free-text
  `exclusions` / `conditions` or the `limits` blob (insurer policy wording, Confidential —
  Part 6.1; same "metadata not body" shape as the #12 correspondence audit). Money in an
  audit `afterValue` is an established pattern here (up-sell logs `currentSumInsured`).
- **`apps/web/app/(app)/rfqs/[id]/`** — a "Quotations" section
  (`components/quotation/QuotationsSection.tsx`): per-insurer chain cards (premium /
  deductible / liability limit / BI period / commission rate + exclusions / conditions),
  an expandable version-history table, and a Placement-only form that captures a quote for
  a shortlisted insurer without one yet, or revises an existing chain's current version.
  No new nav item — quotations live under the existing "RFQ / market" screen.
- **Deferred**: the `Recommendation` (#16) that consumes the comparison is not built (the
  `ComparisonMatrix` at #14 now is); `limits` has no validated internal schema (a real coverage-limits shape
  is a later refinement — an empty `{}` is normalized to `null` so `hasLimits` stays
  honest); no attachment / quote-document upload (Document module); no per-officer queue;
  `quotation.capture` / `quotation.negotiate` are role-level; no `apps/api` e2e for the
  quotation module — carried from the same #11–12 gap (a real `$transaction` +
  partial-`UNIQUE` path is exactly what an e2e catches cheaply); the best-effort
  `Opportunity` advance stops at `QUOTES_RECEIVED` (the `→ COMPARISON_BUILT` move is #14);
  a foreign-currency quote is captured as sent, with no FX conversion; `Quotation.receivedAt`
  is always server-`now()` (no way to record the insurer's actual send date, unlike #12's
  offset-required `occurredAt`).
- **RFQ follow-up sweep / `Quotation`-table awareness — solved in this item, not deferred.**
  `RfqService.runFollowUpScan` (#12's nightly sweep) now calls
  `RfqRepository.findCurrentQuotationKeys(rfqIds)` up front and drops any open submission
  whose `(rfqId, insurerId)` already has a current `Quotation`, before the business-day
  threshold check — so an insurer that quoted is never auto-marked `NO_RESPONSE`, even if
  its best-effort `RFQInsurer → QUOTED` move failed on capture. `FollowUpScanResult` gains
  a non-overlapping `skippedQuoted` counter (surfaced in the scheduler's summary log); the
  `workflow-transitions.config.ts` `RFQInsurer` comment and the sweep docstrings are
  updated. `RFQInsurer.status` is **not** the authoritative "has this insurer quoted?"
  signal — the `Quotation` table is (`ibms-brain/meta/context/policy-lifecycle.md` §
  "The rules that aren't obvious", extended by the `/brain-gap` filed here). Residual race
  (a `Quotation` captured between the sweep's key query and its `transition()` call)
  self-corrects: whichever of the sweep / the capture's best-effort move wins, the other
  becomes a no-op or a legal `NO_RESPONSE → QUOTED`.
- **`@code-reviewer` pass** (mandatory — financial calculation: premium / deductible /
  commission; workflow logic): **APPROVE WITH MINORS — no blockers, no lex violations.**
  All five lex-critical areas verified correct and consistent with established patterns:
  money (every field via `money.util.ts`, no float path, `commissionRatePercent` captured-
  not-applied), race-safety (partial `UNIQUE` + `previousVersionId @unique` + status-
  conditional clear; you cannot end up with two current versions), workflow transitions
  (`Quotation` rightly not an engine entity; the two best-effort moves go through
  `transition()`; `QUOTABLE_FROM` accurately transcribes `WORKFLOW_TRANSITIONS.RFQInsurer`),
  sensitive data (`quotationAuditSnapshot` reduces `exclusions`/`conditions`/`limits` to
  presence booleans; the spec asserts `JSON.stringify` omits them), maker/checker (correct
  to have none — the gate sits upstream at #5 and downstream at #16). Minors addressed:
  the `revise` write pair moved into a Prisma `$transaction` (`reviseChain`) so a hard
  crash can't leave the chain headless — no more best-effort repair step; a deliberate
  "not phase-gated, and why" comment added to `capture` (mirroring how #11 recorded the
  `transitionInsurer` choice); the `revise` DTO comment now states it REPLACES the full
  term set; an empty `{}` `limits` normalized to `null`; `list` scope filter switched to
  `!= null`; the missing gates (`build`, `test:contract`, `test:security`) run — all pass.
  Reviewer's `/brain-gap` candidate (RFQ follow-up sweep unaware of the `Quotation` table)
  was **filed and then solved** in this item — see the bullet above. Carried: no `apps/api`
  e2e for the quotation module.
- **Verification**: +38 api unit tests — `quotation.config.spec.ts` ×14
  (`normalizeQuotationTerms` money quantization / range checks / trimming / empty-`limits`,
  and `quotationAuditSnapshot`'s metadata-not-body guarantee), `quotation.service.spec.ts`
  ×20 (capture happy path + best-effort transitions + the 422/404/409 edges; revise's
  `reviseChain` inputs + the concurrent-revise `null` → 409 + the `P2002` → 409; list
  scoping + chain grouping; get), `rfq.service.spec.ts` +1 (the sweep drops an
  already-quoted submission, counts `skippedQuoted`), `rfq-followup.scheduler.spec.ts` +1
  (`skipped (already quoted)` in the summary log). `rfq.spec.ts` Playwright **8/8** (+2:
  capture a quote, revise into a new version; `@a11y` now also covers the Quotations
  section). Full suites green: **662** api unit (56 files, workspace-scoped), api e2e
  **98/98**, api contract
  4/4, `npm audit` 0 high, `nest build` OK, web unit 6, web Playwright **95/95**, `next build`
  OK, api + web + db `typecheck` + `eslint` clean. Migration applied to `db` + `db-test`
  via `migrate deploy`; `prisma validate` OK; seed re-run (**138** permissions).
  (Root-level `npx vitest run` also sweeps in the 16 Playwright specs it cannot execute and
  a pre-existing `app.controller.spec.ts` DI failure — both absent from the workspace-scoped
  `apps/api` run; unrelated to this change.)

**Part C #14 — Quote Comparison (Domain B, Process 14)**

- **New module** `apps/api/src/modules/comparison/` + `apps/api/src/repositories/comparison.repository.ts`.
  Backlog: automatically build the matrix from every current-version quotation (price +
  coverage + exclusions + deductibles + limits + insurer quality + service), and flag the
  insurers that did not respond. The `ComparisonMatrix` / `ComparisonMatrixRow` models
  already existed in the schema (migration `20260825124114`, `ComparisonMatrix.rfqId`
  UNIQUE) — this item is their first consumer.
- **`POST /comparison-matrices`** (`comparison.build`, Placement) — `{ rfqId, scores? }`.
  Loads the RFQ (visibility via its Opportunity's Customer, no existence oracle), reads
  every `Quotation` on it, and `planComparison` (`comparison.config.ts`, pure) partitions
  the shortlist: one row per **current-version** quote (`isCurrentVersion = true`); a
  shortlisted insurer with no current quote and status ≠ `DECLINED` → `missingInsurers`; a
  `DECLINED` one → the (unstored) declined list. 422 when there is nothing to compare, when
  a score names an insurer with no current quote, when a score is out of `0..100`, or on a
  duplicate score. A row is only a pointer to its `Quotation` — every objective dimension
  (premium, deductible, `limits`, `biPeriodMonths`, `liabilityLimit`, `exclusions`,
  `conditions`, `commissionRatePercent`) lives there, so the matrix is **never price
  alone** (`ibms-brain/meta/context/policy-lifecycle.md` § "The rules that aren't obvious"),
  and the row order is deliberately **by insurer, not by premium** (no "cheapest = the
  pick" implication — that reasoning is Process 16).
- **Subjective scores** — `insurerQualityScore` / `serviceScore` (`Decimal(5,2)?`, 0–100)
  are **optional manual inputs on the build request** (Placement's judgement). There is no
  Insurer-scoring module (narrative Process 61) and `Insurer.financialStrengthRating` is
  free-text, so nothing derives them; omitted → `null`. Normalised in `comparison.config.ts`
  through `money.util.ts`'s fixed 2dp rounding (a score is a ratio, not a stored amount —
  `money-decimal-jod.md` "what does NOT trigger" — but the same rounding path keeps it
  consistent with `commissionRatePercent`).
- **`GET /comparison-matrices?rfqId=`** + **`GET /comparison-matrices/:id`**
  (`comparison.read` — **new seeded permission**, Sales / Placement / Manager / Exec,
  mirroring `rfq.read` / `quotation.read`). `?rfqId=` 404s with a friendly message when no
  matrix has been built. The view **recomputes both `missingInsurers` and
  `declinedInsurers` live on every read** — from the current shortlist vs. the insurers
  actually in the matrix rows — so the two buckets stay mutually disjoint even after a
  post-build `RFQInsurer` status change (`ComparisonMatrix.missingInsurers` stores the
  build-time snapshot but only feeds the audit counts; surfacing it would let an insurer
  that was silent at build then went `DECLINED` appear in *both* lists). `builtAt` and each
  row's `quotation.isCurrentVersion` are surfaced so a stale row (a quote revised since the
  build) is visible — "rebuild to refresh" is the model.
- **Rebuild** — `ComparisonRepository.buildOrRebuild` does upsert-the-matrix-on-`rfqId` +
  `deleteMany` rows + `createMany` rows in **one Prisma `$transaction`** (a deliberate,
  documented local exception to the no-`$transaction` convention, like
  `QuotationRepository.reviseChain`): a rebuild must never be observable half-applied. The
  build is deterministic (same current quotes → same matrix), so last-write-wins on a
  concurrent rebuild is correct; `@@unique([comparisonMatrixId, quotationId])` (migration
  `20260901160000`, Prisma-expressible — no raw SQL) is the structural backstop against a
  doubled row (`ibms-brain/meta/lex/race-safe-invariants.md`).
- **Migration `20260901160000_add_quote_comparison`** (hand-authored + `migrate deploy`;
  applied to `db` + `db-test`): `ComparisonMatrix.builtByUserId` provenance,
  `ComparisonMatrixRow_comparisonMatrixId_idx` + `_quotationId_idx`, and the `@@unique`.
- **Best-effort workflow advance** — on a build the service calls
  `WorkflowTransitionService` for `Opportunity QUOTES_RECEIVED → COMPARISON_BUILT` (only
  from that exact state), logged, never thrown — not authoritative (derive "a comparison
  exists" from the `ComparisonMatrix` table, not `Opportunity.status`).
- **`ComparisonMatrix` is not a `WorkflowTransitionService` entity** (no `status` column)
  and has **no maker/checker** — it is a derived artefact; the maker/checker gate in this
  lifecycle sits downstream at the Recommendation (#16). The audit row carries counts only
  — `rowCount` / `scoredRowCount` / `missingInsurerCount` / `declinedInsurerCount`, no
  quote content. Its action is `CREATE` on the first build, `UPDATE` on a rebuild;
  `buildOrRebuild` reports created-vs-rebuilt from **inside the transaction** (a separate
  pre-read would let a concurrent first-build mislabel — the data is still correct,
  `rfqId @unique`).
- **`QuotationModule` now `exports: [QuotationRepository]`** (the comparison reads every
  current-version quote through it). `BuildComparisonDto` is the first DTO in the codebase
  to use `@ValidateNested` + `@Type` (a nested object array) — required because the global
  `ValidationPipe` has `whitelist: true`, which would otherwise strip the inner properties.
- **`apps/web/app/(app)/rfqs/[id]/`** — a "Comparison" section
  (`components/comparison/ComparisonSection.tsx`): a wide, horizontally-scrollable table
  (insurer × premium / deductible / liability limit / BI period / commission % / quality /
  service / exclusions+conditions), "No quote to compare" and "Declined" callouts, a
  "· superseded" marker on a row whose `quotation.isCurrentVersion` is false, and a
  Placement-only build / rebuild control with an optional per-insurer score grid
  (`aria-label`led inputs). A 404 from the read is the empty state, not an error. No new
  nav item.
- **Deferred**: no computed ranking, weighting, or "best value" flag on the matrix (that
  is the Recommendation, #16); the two scores are unweighted free inputs with no
  Insurer-scoring source; a **row's quote terms** can go stale (a `Quotation` revised since
  the build — the read does not re-filter or drop the row; `builtAt` + `isCurrentVersion` +
  the "superseded" marker signal it, rebuild to refresh); `limits` is compared as opaque
  JSON (no structural diff); no `apps/api` e2e for the comparison module (carried from the
  #11–13 gap — the `$transaction` + `@@unique` + best-effort `transition()` path is what an
  e2e catches cheaply); `comparison.build` is role-level (no per-officer queue); a
  foreign-currency quote in the matrix is shown in its own currency with no FX
  normalisation.
- **`@code-reviewer` pass** (mandatory — workflow logic + the "never price alone" controls
  rule + carries `Quotation` money): **APPROVE WITH MINORS — no blockers, no lex
  violations.** All focus areas cleared: "never price alone" is structurally enforced (a
  row is only a pointer to its `Quotation`; rows ordered by insurer, not premium — the API
  physically cannot return a price-only view), the `rfqId @unique` + `@@unique` + the
  `$transaction` hold the race-safe invariants, the Opportunity move goes through the engine
  from the exact `QUOTES_RECEIVED` source and `COMPARISON_BUILT` is a legal target, no
  maker/checker owed, no quote content in the audit / logs, and no existence oracle. Minors
  fixed: the `missing` / `declined` buckets are now **recomputed live on read** (was:
  stored snapshot + live declined — could overlap after a status change);
  `buildOrRebuild` returns the CREATE-vs-UPDATE flag from **inside the transaction** (was: a
  separate pre-read); a "· superseded" marker on a stale row + the docstring / README note
  it; the redundant `RfqInsurerWithInsurer` cast dropped; a comment on `normalizeScore`
  that `money.util.ts` is reused only for the Decimal parse + fixed rounding (a score is a
  ratio, not an amount). Carried: no `apps/api` e2e for the module.
- **Verification**: +20 api unit tests — `comparison.config.spec.ts` ×8 (`planComparison`
  partitioning / score normalisation / range + unknown-insurer + duplicate rejection /
  empty-string→null), `comparison.service.spec.ts` ×12 (build happy path + CREATE/UPDATE
  audit from the repo flag + best-effort transition + the 422/404 edges + live-recomputed
  missing/declined, incl. the disjoint-buckets-after-a-DECLINE case; get / getById).
  `rfq.spec.ts` Playwright **10/10** (+2: build the matrix and see the
  missing-insurer flag, a non-Placement user sees the matrix but no build control; `@a11y`
  now also covers the Comparison section). Full suites green: **682** api unit (58 files,
  workspace-scoped), api contract 4/4, `npm audit` 0 high, `nest build` OK, web unit 6, web
  Playwright **97/97**, `next build` OK, api + web + db `typecheck` + `eslint` clean.
  Migration applied to `db` + `db-test` via `migrate deploy`; `prisma validate` OK; seed
  re-run (**139** permissions). api e2e initially came back **96/98** — the 2 failures were
  the long-standing `test/rbac.e2e-spec.ts:203/264` access-recertification flake
  (`startCycle` timing out with a `PrismaClientUnknownRequestError`, in a module this item
  does not touch). That flake is now **fixed** in a follow-up commit — `startCycle` and
  `listItemsForReviewer` were doing O(N)-over-every-active-user writes that blew the 30s
  e2e timeout once the shared test DB had accumulated enough users; they now batch into one
  `INSERT … RETURNING` each (`AccessRecertificationRepository.createManyItems`,
  `AuditService.recordMany`, `UserRepository.getRoleNamesByIds`). Full api e2e **98/98**
  after the fix; `rbac.e2e-spec.ts` 5/5 in ~18s (was ~69s).

**Part C #15 — Negotiation (Domain B, Process 15)**

- **No new module** — negotiation is the `POST /quotations/:id/revise` mechanism already
  built at #13 (a round is a NEW `Quotation` version: `versionNumber+1`, linked by
  `previousVersionId`, `isCurrentVersion` flipped, the predecessor kept verbatim). The
  backlog's single requirement — "every negotiation round is recorded as a new quotation
  version — never deleted or replaced" — was mechanically satisfied by #13; #15 makes the
  **"never deleted or replaced"** half a real guarantee rather than a convention, and gives
  a negotiation round a documented rationale and a history surface.
- **Migration `20260901180000_add_quotation_negotiation`** — `Quotation.negotiationNotes
  TEXT` plus a DB-layer immutability trigger, `prevent_quotation_version_mutation`, on
  `BEFORE DELETE` and `BEFORE UPDATE` (same pattern as `prevent_audit_log_entry_mutation`,
  migration `20260826083942`): any `DELETE` of a `Quotation` row is rejected; any `UPDATE`
  of an already-superseded version (`isCurrentVersion = false`) is rejected; the only
  `UPDATE` a live version accepts is the supersede flip itself (`isCurrentVersion`
  true→false — what `QuotationRepository.reviseChain` issues). The application layer already
  had no other path; this holds regardless of caller (raw SQL, a future code path, a
  mistaken migration). Verified against `db-test` with a hand-run 4-case `psql` script
  (superseded-`UPDATE` rejected, `DELETE` rejected, live in-place edit rejected, the
  supersede flip allowed; after the `@code-reviewer` fix, a 5th case — a flip that also
  rewrites a term — is rejected too) and by `test/quotation.e2e-spec.ts`.
- **Column-level freeze on the supersede flip** — the one permitted `UPDATE`
  (`isCurrentVersion` true→false) must touch nothing else: the trigger raises if
  `to_jsonb(NEW) - 'isCurrentVersion' IS DISTINCT FROM to_jsonb(OLD) - 'isCurrentVersion'`,
  so a `SET isCurrentVersion = false, premium = …` in the same statement is rejected too
  (`@code-reviewer` MINOR — closed the narrow "rewrite a term as a version is frozen" gap).
- **Same documented residual risk as the `AuditLogEntry` trigger** — `apps/api` and Prisma
  Migrate share one Postgres role (`ibms`), so a session as that role can still bypass a
  trigger via `SET session_replication_role = replica`; a true fix needs a least-privilege
  app role with `REVOKE UPDATE, DELETE` (separate infra change). A data fix or a PDPL
  Correction DSR touching a historical version now requires that privileged, logged bypass
  — the same posture `AuditLogEntry` already has (`data-model.md`), disclosed here and in
  the migration; carry it into #16 and any retention/disposal work.
- **`negotiationNotes`** — the broker's rationale for a round (what was requested /
  conceded), added to `ReviseQuotationDto` **only** (a version-1 `capture` is an insurer's
  opening quote, not a negotiation round; `CaptureQuotationDto` has no such field). Treated
  as Confidential commercial correspondence: `quotationAuditSnapshot` carries only a
  `hasNegotiationNotes` boolean, never the text — same "metadata not body" shape as
  `exclusions` / `conditions` (Part 6.1).
- **`buildNegotiationHistory`** (`quotation.config.ts`, pure) — every quotation read
  (`QuotationChainView`) now also carries `history: NegotiationRound[]`: round 0 is the
  opening quote; each later round is diffed against the version its `previousVersionId`
  names (positional fallback if absent) and carries `premiumDeltaFromPrevious` (sign
  preserved, fils-quantized through `money.util.ts`'s `subtractMoney` / `formatMoney` —
  never a raw Decimal op; `null` when that round changed `currency`, a cross-currency
  subtraction being meaningless — the currency move is still in `changedTermFields`),
  `changedTermFields` (which of the nine versioned terms moved — a `limits` key reorder
  counts as a change, a stringify compare being a display aid not a semantic diff), and
  that round's `negotiationNotes`. Deterministic, same shape as `planComparison` (#14) /
  `buildCustomerTimeline` (#10).
- **`Quotation` is still not a `WorkflowTransitionService` entity** and has no maker/checker
  — recording a negotiated term set is a factual, single-actor Placement record; the
  approval gate is the Broker Recommendation (#16). `quotation.negotiate` already existed
  (seeded at #13); its description was updated. No new permission, no new nav item.
- **`apps/web/app/(app)/rfqs/[id]/`** — the "Quotations" version-history table gains
  Round / Δ premium / Terms-changed columns and shows a round's rationale inline; the
  revise form gains a "Negotiation notes" textarea (revise only).
- **`@code-reviewer` (mandatory — workflow logic + financial calc + Confidential data +
  a DB migration/trigger)** → **APPROVE WITH MINORS, no blockers, no MAJOR, no lex
  violation** (all six mandatory lex checks pass — money / transitions / maker-checker /
  sensitive-data / SLA / race-safe). Both MINORs fixed: (1) `premiumDeltaFromPrevious` is
  `null` on a currency change instead of a meaningless cross-currency subtraction; (2) the
  supersede-flip trigger now asserts column-by-column that only `isCurrentVersion` moved.
  NITs fixed: history diffs against `previousVersionId` (not just the adjacent row); the
  web Δ-sign glyph is picked by string inspection, no float round-trip; the e2e now does a
  second consecutive revise (proves the flip still works with a superseded predecessor
  present) and asserts the column-freeze guard.
- **Deferred**: no structured "negotiation ask vs. insurer counter" model (`negotiationNotes`
  is one free-text field per round); no per-round approval or premium-threshold gate (that
  is #16's `Opportunity.targetPremiumThreshold`); a foreign-currency round is captured
  as-sent with no FX (and its premium delta is suppressed); `changedTermFields` is
  field-level, not a value-diff.
- **Verification**: +15 api unit tests — `quotation.config.spec.ts` ×24 (was 14: +
  `negotiationNotes` trim/default, `hasNegotiationNotes` in the snapshot + never the text,
  and `buildNegotiationHistory` ×9 — round numbering / sort / signed delta / changed-field
  detection incl. a `limits` null→object transition / notes pass-through / currency-change
  delta suppression / `previousVersionId` linkage),
  `quotation.service.spec.ts` ×22 (was 20: + rationale passed to `reviseChain`, + the
  chain view's `history`). **New** `test/quotation.e2e-spec.ts` ×2 — the real capture →
  revise → revise path (history + deltas + notes across 3 versions) and the immutability
  trigger (raw `UPDATE` of a superseded version rejected, a flip-that-rewrites-a-term
  rejected, `DELETE` of any version rejected, every version survives, a `revise` of a
  superseded version is 422). Full suites green: **697** api unit (58 files,
  workspace-scoped), api contract 4/4, **api e2e 100/100** (15 files, + the new
  quotation e2e), `npm audit` 0 high, `nest build` OK, web unit 6, web Playwright
  **rfq.spec.ts 10/10** (the "revises a captured quotation" test now also fills the
  negotiation-notes field and asserts the round rationale + "Round 1" render), `next build`
  OK, api + web + db `typecheck` + `eslint` clean. Migration applied to `db` + `db-test`
  (function re-applied + checksum reconciled after the `@code-reviewer` MINOR fix);
  `prisma validate` OK, `prisma migrate status` clean; seed re-run (**139** permissions —
  description-only change).

**Part C #16 — Broker Recommendation (Domain B, Process 16)**

- **New module** `apps/api/src/modules/recommendation/` (+ `apps/api/src/repositories/recommendation.repository.ts`).
  The `Recommendation` / `ConflictOfInterestDisclosure` models and the
  `Recommendation_maker_checker_distinct` CHECK (`approvedByUserId <> draftedByUserId`,
  migration `20260826091424`) already existed — this item is their first consumer.
  Backlog: draft the documented rationale (six named factors), a mandatory approval gate
  above a configurable premium threshold, and automatic conflict-of-interest detection +
  disclosure before send.
- **`Recommendation` is NOT a `WorkflowTransitionService` entity** — it has no `status`
  column, so its lifecycle (DRAFTED → APPROVED → SENT) is nullable timestamps, and the
  parent `Opportunity` carries the same progression through the engine
  (`COMPARISON_BUILT → RECOMMENDATION_DRAFTED → SENT_TO_CLIENT`, best-effort on draft /
  send). Same "no engine entity where the schema has no status" call as #13–15.
- **`POST /recommendations`** (`recommendation.draft`, Placement) — one per Opportunity
  (`opportunityId @unique` → 409), pointing at one current-version `Quotation` on one of
  its RFQs (422 otherwise); the Opportunity must be **at** `COMPARISON_BUILT`.
  `normalizeRecommendationRationale` (`recommendation.config.ts`, pure) requires a non-empty
  note for **every** one of `coverage` / `price` / `financialStrength` / `claimsService` /
  `deductible` / `policyConditions` (422 naming the offender; an unknown key is rejected,
  not dropped). Two gate flags snapshot at draft time.
- **Approval gate** — `approvalRequired` = recommended premium **>** the Opportunity's
  `targetPremiumThreshold` (via `money.util.ts` `compareMoney`; no threshold → never
  required). `PATCH /opportunities/:id/target-premium-threshold` (`opportunity.set-target-threshold`
  — **new perm, Manager / Executive**) sets or clears it (`null`); refused once the
  Opportunity is past `RECOMMENDATION_DRAFTED`. `POST /recommendations/:id/approve`
  (`recommendation.approve`, Manager) — 422 when no approval is required, **maker/checker**
  `assertDifferentActors(draftedByUserId, actor.id)` (403) backed by the CHECK constraint,
  409 when already approved, and a **status-conditional `updateMany`** (`WHERE
  approvedByUserId IS NULL`) so a concurrent approve loses cleanly (0 rows → 409).
- **Conflict of interest** — `detectConflictOfInterest` (pure): among the *other*
  current-version quotes on the Opportunity, a "comparable" one is priced within
  `COI_COMPARABLE_PREMIUM_BAND_PERCENT` (**10%, drafted/unsourced**) of the recommended
  premium; flag when the recommended quote's `commissionRatePercent` exceeds the lowest
  comparable competitor's by ≥ `COI_MATERIAL_COMMISSION_DIFF_POINTS` (**2 percentage
  points, drafted/unsourced**) — both are `ibms-app` product decisions, `/brain-gap`
  candidates (same status as #9's 10% under-insurance threshold). Recommended quote with no
  `commissionRatePercent` → cannot assess → not flagged. `coiCompetingQuotationId` /
  `coiCommissionDiffPercent` explain the flag. `POST /recommendations/:id/conflict-of-interest-disclosure`
  (`conflict-of-interest.disclose`, Placement / Compliance) — 422 when not flagged, one per
  recommendation (409), and the **acknowledger must differ from the drafter** (403 —
  `assertDifferentActors`, the conflicted officer cannot self-clear). A Compliance Officer
  can reach any recommendation for this (`canReachAnyCustomer` adds `COMPLIANCE_OFFICER`).
- **`POST /recommendations/:id/send`** (`recommendation.send` — **new perm**, Placement) —
  422 while `blockedFromSend` is non-empty (a required approval or COI disclosure
  outstanding), 409 if already sent; stamps `sentToClientAt` / `sentByUserId` via a
  status-conditional write and best-effort advances the Opportunity.
- **Money / sensitive data** — every rate comparison runs through `money.util.ts` (`toMoney`
  parse + `MONEY_ROUNDING`, at the `Decimal(5, 2)` scale — a commission *rate* is a ratio,
  not a fils amount, so it does not use `subtractMoney`; same reuse `comparison.config.ts`
  makes). `recommendationAuditSnapshot` carries metadata + money + the gate flags but
  **never** the free-text `rationale` / `rationaleFactors` / `disclosureText` (booleans
  `hasRationale` / `rationaleFactorsComplete` instead — same "metadata not body" shape as
  #12 / #13 / #15).
- **Migration `20260901200000_add_broker_recommendation`** (hand-authored + `migrate
  deploy`; applied to `db` + `db-test`) — `Recommendation.rationaleFactors JSONB NOT NULL`
  (add-with-default / drop-default two-step), `approvalRequired` / `conflictOfInterestFlagged`
  booleans, `coiCompetingQuotationId` / `coiCommissionDiffPercent` / `sentByUserId`, plus
  `Recommendation_draftedByUserId_idx` and `ConflictOfInterestDisclosure_competingQuotationId_idx`.
  `Recommendation.coiCommissionDiffPercent` added to `NON_MONEY_DECIMAL_FIELDS` (a rate, not
  a JOD amount — the schema-inventory test enforces the classification).
- **`apps/web/app/(app)/opportunities/[id]/`** — a "Broker recommendation" section
  (`components/recommendation/RecommendationSection.tsx`): Manager-only target-threshold
  control, Placement-only draft form (recommended-quote picker + overall rationale + the six
  factor fields), Manager-only Approve, Placement/Compliance COI-disclosure form, and a Send
  button that lists the outstanding block reasons. New nav: none.
- **Send-gates are re-derived from LIVE data, not the draft-time snapshot** (`@code-reviewer`
  MAJOR — a control that only fires when a human configured data in the right order before
  draft is procedural, not structural). `RecommendationService.effectiveGates(rec)` OR's the
  stored `approvalRequired` / `conflictOfInterestFlagged` snapshot with a fresh check
  (`recommendedQuotation.premium` vs. the Opportunity's *current* `targetPremiumThreshold`;
  `detectConflictOfInterest` re-run over the *current* current-version quotes on the
  recommended quote's **own RFQ line**) — so a threshold configured, or a comparable
  competitor quoting, *after* the draft still blocks `send`, but a gate can never be
  silently *cleared*. `approve` / `discloseConflictOfInterest` / every read use the same
  effective gates; the snapshot columns stay the draft-time record. COI competitors are
  RFQ-line-scoped (a cross-line quote is not a "comparable competing offer" — matches #14).
- **`@code-reviewer` (mandatory — approval / workflow logic + financial calc + Confidential
  data + a migration)** → **CHANGES REQUESTED → resolved.** One MAJOR (send-gates trusted
  stale draft snapshots) fixed as above, with three new tests (2 unit: a late threshold /
  a late competitor each still block; 1 e2e: threshold set after draft → `send` 422 → GET
  shows `approvalRequired: true` → approve → `send` 201). MINORs: audit `entityId` for the
  COI disclosure now keys to the disclosure row's own id (was the recommendation id);
  COI competitors scoped to the RFQ line; `conflict-of-interest.disclose` kept `[PLACEMENT,
  COMPLIANCE]` with a documented rationale (the seed is additive — narrowing needs an
  explicit grant revoke; `assertDifferentActors` is the structural control, and a
  `/brain-gap` is filed to add a Recommendation-drafter → COI-acknowledger row to
  `maker-checker-segregation.md` at which point it narrows). NITs: `send` reads
  status/threshold off the already-loaded `rec` (dropped a redundant round-trip); the
  disclosure override is documented as a deliberate human choice. **`/brain-gap` filed** —
  `ibms-brain/meta/context/policy-lifecycle.md` § "The rules that aren't obvious" now
  quantifies "comparable" (10% premium band) and "materially higher" (2 pp commission),
  records the deterministic tie-break, the no-rate-→-not-flagged rule, the RFQ-line
  scoping, and the live-recompute-at-send requirement.
- **Deferred**: one recommendation per Opportunity pointing at **one** quote — a multi-line
  programme's per-line recommendation is a schema-constraint deferral (like #7's
  one-programme-per-`RiskProfile`); the 10% band and 2 pp figures are unsourced drafts
  (now in the brain);
  `CommissionAgreement.ratePercent` (the governed rate table, Finance) is not consulted;
  draft gates on the Opportunity *status* being `COMPARISON_BUILT`, not a hard FK to a
  `ComparisonMatrix` row; `recommendation.draft` / `.send` are role-level (no per-officer
  queue); the disclosure records that a disclosure was made — the system sends nothing to
  the client itself; no renegotiation / close-lost from here (#17).
- **Verification**: +50 api unit — `recommendation.config.spec.ts` ×18
  (`normalizeRecommendationRationale` — missing / blank / unknown factor, short summary;
  `detectConflictOfInterest` — flagged / marginal / out-of-band / no-rate / deterministic
  tie-break; `approvalRequired`; `recommendationAuditSnapshot` — never the rationale text),
  `recommendation.service.spec.ts` ×28 (draft gate flags + 422/409/404 edges + best-effort
  advance; approve 422-not-required / 403-self / 409 / 409-race; disclose 422-not-flagged /
  403-self / 409 / override validation; send 409-sent / 422-approval / 422-COI / happy +
  **the two live-gate recompute tests**; list/get), `opportunity.service.spec.ts` +4
  (`setTargetPremiumThreshold`). **New** `test/recommendation.e2e-spec.ts` ×3 — the full
  gated path (threshold → draft → approval → COI disclosure → send, Opportunity ends
  `SENT_TO_CLIENT`, second send 409), the maker/checker self-approval refusal (a
  dual-hatted Placement + Manager drafter is 403 on their own recommendation), and the
  **live approval-gate recompute** (threshold set after draft still blocks). Full suites
  green: **748** api unit (60 files, workspace-scoped), api contract 4/4, **api e2e
  103/103** (16 files), `npm audit` 0 high, `nest build` OK, web unit 6, web Playwright
  **rfq.spec.ts 11/11** (+1: draft a recommendation, clear both gates, send), `next build`
  OK, api + web + db `typecheck` + `eslint` clean. Migration applied to `db` + `db-test`;
  `prisma validate` OK, `prisma migrate status` clean; seed re-run (**142** permissions —
  `opportunity.set-target-threshold`, `recommendation.read`, `recommendation.send` new).

**Part C #17 — Client Decision Handling (Domain B, Process 17)**

- **New module** `apps/api/src/modules/client-decision/` (+ `apps/api/src/repositories/client-decision.repository.ts`).
  The `ClientDecision` model + the `ClientDecisionType` enum (six values) already existed —
  this item is their first consumer. Backlog: capture one of six decision types and route
  each to a different path (placement / close the request / renewed negotiation).
- **`ClientDecision` is NOT a `WorkflowTransitionService` entity** — `decision` is a
  one-shot enum, not a state machine (same "no engine entity" call as #13–16). Its
  *routing* is the parent `Opportunity`'s engine transitions. No maker/checker — recording
  the client's stated decision is a factual, single-actor Sales/Placement act.
- **`POST /client-decisions`** (`client-decision.capture`, Sales / Placement) — one per
  Opportunity (`opportunityId @unique` → a friendly pre-check 409, `P2002` → 409). The
  precondition is checked against `Recommendation.sentToClientAt != null`
  (**authoritative** — the Opportunity status can lag a #16 best-effort advance; 422 "there
  is nothing to decide on" otherwise). `evidenceType` (∈ `signature` / `e-signature` /
  `email_confirmation`) and a non-empty `evidenceRef` are required (Part 4.1). `notes` are
  optional and **Confidential** — the audit snapshot carries a `hasNotes` boolean, never
  the text.
- **The six → three routing** (`routeFor`, `client-decision.config.ts`, pure & total over
  the enum): `ACCEPT → PLACEMENT`, `REJECT → CLOSED_LOST`, and
  `REQUEST_FURTHER_NEGOTIATION` / `REQUEST_ALTERNATIVE_OPTIONS` / `REQUEST_PRICE_REDUCTION`
  / `REQUEST_COVERAGE_INCREASE → RENEGOTIATE`. The route is applied as an
  Opportunity engine walk — `ROUTE_PATH_FROM` indexes the fixed path
  `[SENT_TO_CLIENT, CLIENT_DECISION, <route>]` so the walk starts from wherever the
  Opportunity currently sits (`RECOMMENDATION_DRAFTED` → all three hops, catching up a
  lagging #16 advance; `SENT_TO_CLIENT` → two; `CLIENT_DECISION` → one; anything else →
  logged, not routed). **Best-effort** (logged, never thrown — the `ClientDecision` row +
  `routeFor(decision)` is the authoritative record, same philosophy as #13–16). The view
  carries `route` / `routeLabel` / `opportunityStatus` / `routingComplete`.
- **`GET /client-decisions?opportunityId=|customerId=`** + `/:id` (`client-decision.read` —
  **new seeded perm**, Sales/Placement/Manager/Exec). Visibility mirrors #16 (the decision
  inherits its Opportunity's Customer's visibility; no Compliance-reach needed here).
- **Migration `20260902120000_add_client_decision_capture`** (hand-authored + `migrate
  deploy`; `db` + `db-test`) — `ClientDecision.notes TEXT` + `capturedByUserId TEXT`. No
  new index (`opportunityId` is already `@unique`). `RecommendationModule` now
  `exports: [RecommendationRepository]`.
- **`apps/web/app/(app)/opportunities/[id]/`** — a "Client decision" section
  (`components/client-decision/ClientDecisionSection.tsx`): a Sales/Placement form (decision
  type + evidence type + evidence ref + notes) that appears once the Opportunity is at a
  post-recommendation state, then a read-only display of the recorded decision + its route.
  No new nav item.
- **`@code-reviewer` (mandatory — workflow/routing logic)** → **APPROVE WITH MINORS, no
  blockers, no MAJOR, no lex violation** (transitions all go through
  `WorkflowTransitionService`, every route target + path hop is a legal `Opportunity` move
  from every start point, `@unique` is the race backstop, `notes` never in the audit /
  logs). Minors fixed: (1) `routeOpportunity` now **re-reads the live `Opportunity.status`
  before every hop** and derives the next hop from it — so a hop a concurrent actor
  already applied is skipped (self-healing) rather than aborting the walk; it stops only on
  a genuine `transition` failure, on reaching the route, or on an off-path status; (2) the
  stacked double "Process 17 —" `///` block on `model ClientDecision` collapsed to one.
  NITs: dropped a redundant `evidenceRef.trim()` (the DTO already trims), fixed a stale
  e2e comment.
- **Deferred**: **one decision per Opportunity** — a RENEGOTIATE loop that produces a
  *second* client decision is blocked by the `@unique` (schema constraint, same class as
  #16); the RENEGOTIATE route stops at `RENEGOTIATE` — it does **not** auto-advance to
  `RFQ_ISSUED` or relax the one-RFQ-per-`(opportunity, line)` constraint (re-marketing a
  line is a deferred edge from #11; new quote versions / negotiation rounds via #13/#15
  still work on the existing RFQ); the routing transitions are best-effort with no
  re-trigger endpoint if a hop fails mid-route (`routingComplete: false` signals it); the
  four `REQUEST_*` types behave identically beyond the recorded `decision` + `notes`;
  `client-decision.capture` is role-level (no per-officer queue).
- **Verification**: +24 api unit — `client-decision.config.spec.ts` ×10 (`routeFor` for all
  six types + the 6→3 completeness check; `routeLabel`; `clientDecisionAuditSnapshot` —
  never the notes text), `client-decision.service.spec.ts` ×14 (the three routes + the
  RECOMMENDATION_DRAFTED catch-up walk + the **self-healing skip-a-hop-a-concurrent-actor-
  already-applied** case + unexpected-status-does-not-route + best-effort stops after one
  failed hop; 422 no/unsent recommendation; 409 pre-check + `P2002`; 404 visibility;
  list/get — a **stateful** Opportunity mock where each `transition` moves the status so
  the re-reading walk progresses naturally). **New** `test/client-decision.e2e-spec.ts` ×2
  — the six types down three real Opportunity paths (ACCEPT → `PLACEMENT`, REJECT →
  `CLOSED_LOST`, REQUEST_PRICE_REDUCTION → `RENEGOTIATE`, each verified via
  `GET /opportunities/:id`), a second decision is a 409, and 422 / 400 edges (no sent
  recommendation, bad decision / evidence type). Full suites green: **772** api unit (62
  files, workspace-scoped), api contract 4/4, **api e2e 105/105** (17 files, + the new
  client-decision e2e), `npm audit` 0 high, `nest build` OK, web unit 6, web Playwright
  **rfq.spec.ts 12/12** (+1: record a client decision and see its route), `next build` OK,
  api + web + db `typecheck` + `eslint` clean. Migration applied to `db` + `db-test`;
  `prisma validate` OK, `prisma migrate status` clean; seed re-run (**143** permissions —
  `client-decision.read` new).

**Part C #18–19 — Policy Placement & Issuance (Domain B, Processes 18–19)**

- **New module** `apps/api/src/modules/policy/` (+ `apps/api/src/repositories/policy.repository.ts`).
  The `Policy` / `PolicySchedule` / `Document` models already existed (big migration
  `20260825124114`) — this item is their first consumer. Backlog: create the Policy from
  the Opportunity on acceptance and set the inception date; receive and record the
  insurer-issued policy / schedule / endorsement template / certificates / premium invoice.
- **`Policy` IS a `WorkflowTransitionService` entity** — the first one in Domain B. Its
  `status` (`PolicyStatus`) moves ONLY through the engine
  (`ibms-brain/meta/lex/workflow-state-transitions.md`); the `WORKFLOW_TRANSITIONS.Policy`
  map (`PLACEMENT_CONFIRMED → ISSUED → CHECKING_IN_PROGRESS → …`) already existed. **No
  maker/checker at this stage** — placing the cover and recording what the insurer issued
  is single-actor Placement work; the mandatory *independent* line-by-line check of
  requested-vs-issued coverage is Process 20 (`PolicyChecking`, `ISSUED →
  CHECKING_IN_PROGRESS`), not built.
- **`POST /policies`** (`{ opportunityId, inceptionDate, expiryDate? }`, `policy.create`,
  Placement — the permission was already seeded). Creates the `Policy` row at the schema
  `@default(PLACEMENT_CONFIRMED)` — **not** through the engine (initial creation is not a
  state *change*, same call as `OpportunityService.create` at `NEEDS_CONFIRMED` /
  `RFQ`/`RFQInsurer`). The **authoritative placement precondition is a `ClientDecision`
  of `ACCEPT`** for the Opportunity — the Opportunity status can lag #17's best-effort
  routing, so a `422` is raised against the decision row, not the status (same "authoritative
  child row, not the parent status" call as #17 checking `Recommendation.sentToClientAt`).
  Insurer / insurance line / requested premium / currency are taken from the accepted
  `Recommendation.recommendedQuotation`, **never the request body**. One Policy per
  Opportunity: `opportunityId @unique` — a friendly pre-check `409` plus a `P2002` → `409`.
  `requestedPremium = quantizeMoney(quote.premium)`.
- **`POST /policies/:id/issuance`** (`{ policyNumber, issuedPremium, inceptionDate?,
  expiryDate?, schedule: { effectiveFrom?, limits, sumsInsured, namedPerils?, extensions? },
  documents: [{ category, classification, fileName, storageRef }] }`, `policy.issue`,
  Placement — already seeded). Drives `Policy PLACEMENT_CONFIRMED → ISSUED` through
  `WorkflowTransitionService.transition`, passing the issued scalars (`policyNumber`,
  `issuedPremium` (a `Prisma.Decimal` from `quantizeMoney`), `issuedByUserId`, and any
  `inceptionDate` / `expiryDate` correction) as the transition's **`data`** — so the status
  flip and the `policyNumber` / `issuedPremium` write are **one atomic, engine-audited
  `updateMany`** (the engine's `WHERE status='PLACEMENT_CONFIRMED'` is the race gate — a
  concurrent issuance matches 0 rows → `ConflictException` → `409`; a `policyNumber @unique`
  collision → `409`). Then `PolicyRepository.createIssuanceArtifacts` writes the opening
  `PolicySchedule` + the insurer-issued `Document` rows in **one Prisma `$transaction`** — a
  deliberate local exception to this codebase's no-`$transaction` convention (same as
  `QuotationRepository.reviseChain` / `ComparisonRepository.buildOrRebuild`), so a crash
  between the two can't leave an ISSUED policy with a schedule but no documents. A
  `P2002` there is the partial `UNIQUE` `PolicySchedule_one_open_per_policy` firing → `409`.
- **Crash-recovery re-entry** — if the engine transition committed (status `ISSUED`, scalars
  persisted + TRANSITION-audited) but the artefact `$transaction` then failed, calling
  `POST /policies/:id/issuance` again with a **byte-identical** payload (status `ISSUED`, no
  open schedule, `policy.policyNumber === dto.policyNumber` **and**
  `compareMoney(policy.issuedPremium, issuedPremium) === 0`) skips the transition and just
  writes the missing schedule + documents (from *this* call's payload — the first attempt
  rolled back entirely, so there is nothing to reconcile against). No `UPDATE Policy` audit
  row is emitted on a resume (nothing on the Policy changed). Any other state, or a
  mismatched `policyNumber` / `issuedPremium`, → `422` "issuance is recorded once".
- **`POST /policies/:id/documents`** (`document.manage` — existing perm) appends `Document`
  rows to the electronic Insurance File (Part 4.2) at any lifecycle stage — the path used
  when certificates / an endorsement template / the wording PDF arrive after the issuance
  call.
- **`GET /policies?opportunityId=|customerId=`** + `/:id` (`policy.read` — **new seeded
  perm**, Sales/Placement/Manager/Exec). Visibility mirrors `RecommendationService`
  (`CUSTOMER_FILE_CROSS_OWNER_ROLES` + the Customer owner; every miss → one
  `NotFoundException`). The view carries `premiumVariance` (signed
  `subtractMoney(issued, requested).toFixed(3)`, fils-quantized, `null` until issued) and
  `issuanceComplete` (past `PLACEMENT_CONFIRMED` **and** ≥1 schedule). `storageRef` /
  `fileName` are returned to authorised readers — a pointer to the encrypted-at-rest object
  (Part 10.2), not content, consistent with `customer.service.listDocuments`.
- **Money** — `requestedPremium` / `issuedPremium` via `quantizeMoney`, `premiumVariance`
  via `subtractMoney`, the re-entry gate via `compareMoney`, views via `formatMoney`. No
  raw `Decimal` / float arithmetic; no new `Decimal` schema columns (both premium fields
  were already in `MONEY_DECIMAL_FIELDS`).
- **Audit — metadata not body** (`ibms-brain/meta/lex/sensitive-data-handling.md`):
  `policyScheduleAuditSnapshot` stores the coverage-key *names* + counts, never the
  figures; `policyDocumentAuditSnapshot` **excludes `fileName` and `storageRef`** (a health
  certificate's filename can name insured persons — HIGHLY_CONFIDENTIAL — and `storageRef`
  is an internal object key); logs carry ids only. `policy.config.spec.ts` asserts the
  exclusion via `JSON.stringify`.
- **Migration `20260902140000_add_policy_placement_issuance`** (hand-authored + `migrate
  deploy`; `db` + `db-test`) — `Policy.placedByUserId` / `Policy.issuedByUserId` (bare
  `TEXT` provenance scalars, no FK — the AuditLogEntry `CREATE` / `TRANSITION` rows are
  authoritative, same pattern as `Opportunity.createdByUserId` / `RFQ.issuedByUserId`) + a
  **partial `UNIQUE` index** `PolicySchedule_one_open_per_policy ON
  "PolicySchedule"("policyId") WHERE "effectiveTo" IS NULL` — "at most one open coverage
  schedule per Policy" as a real DB invariant, not a read-then-write pre-check
  (`ibms-brain/meta/lex/race-safe-invariants.md`); Prisma can't express a partial `UNIQUE`
  so it's raw SQL + a `///` note on `model PolicySchedule`. It backstops the re-entry
  branch and the schedule versioning a future `Endorsement` module (#22) will drive.
  `ClientDecisionModule` now `exports: [ClientDecisionRepository]`.
- **`apps/web/app/(app)/opportunities/[id]/`** — a "Policy" section
  (`components/policy/PolicySection.tsx` + `lib/policy/policy-api.ts`): a Placement
  place form (inception + optional expiry) once the Opportunity reaches `PLACEMENT`, then an
  issuance form (policy number, issued premium, `limits` / `sumsInsured` JSON textareas,
  perils / extensions comma-separated, a repeatable document-row editor), then a read-only
  display of the issued policy + coverage schedule + document list with a post-issuance
  "attach a document" control. No new nav item.
- **`@code-reviewer` (mandatory — workflow transition + financial calculation +
  Confidential data + a DB migration)** → **APPROVE WITH MINORS, no BLOCKER, no MAJOR, no
  lex violation** (all six mandatory lex checks pass: creation-at-`@default` matches the
  established precedent and is not a state change; both "one of these" invariants are real
  DB constraints with a `P2002` catch alongside the pre-check; money all funnels through
  `money.util.ts`; audit rows carry no schedule figures / filenames; no PDPL-registry SLA;
  no privacy rule re-derived). MINORs fixed: (1) the issuance period check now compares the
  effective inception against `(expiryOverride ?? policy.expiryDate)` — an
  `inceptionDate` override alone could previously be pushed past the stored `expiryDate`
  with no error; (2) the re-entry branch no longer emits an `UPDATE Policy` audit row (on a
  resume nothing on the Policy row changed — the first attempt already wrote and
  TRANSITION-audited the scalars — so the row's `issuedByUserId` was drifting to the
  *retrying* actor). NITs fixed: +2 service specs (the re-entry gate REJECTS a mismatched
  `policyNumber` / `issuedPremium`; an inception override past the stored expiry), and the
  `///` partial-`UNIQUE` note relocated onto `model PolicySchedule` to match the migration
  header wording.
- **Deferred**: the transition-then-artefacts ordering has one seam — if the schedule /
  documents `$transaction` fails after the engine transition committed, the `Policy` is
  `ISSUED` with no schedule (recoverable via the re-entry branch); a hard crash *between*
  the engine's status `updateMany` and its own audit write would additionally leave the
  `TRANSITION` row unwritten (bounded, rare, separately alarmed — folding child-table
  writes into the engine's scalar-only `data` isn't expressible, and an outer `$transaction`
  would mean re-implementing the transition outside the engine). `limits` / `sumsInsured`
  are stored opaquely (a non-empty flat object of string / finite-number values) — no
  per-figure `Decimal(18,3)` precision until a consumer does arithmetic on them (a Claim
  resolving "coverage in force at the loss date", Part 3.7). A `CoverNote` / binder interim
  state (Process 18) is in the schema but has no endpoint. One `Policy` per Opportunity.
  `policy.create` / `policy.issue` are role-level (no per-officer queue). No
  `Endorsement`-driven schedule versioning (#22) — the partial `UNIQUE` is in place for it.
- **Verification**: +39 api unit — `policy.config.spec.ts` ×15 (`parseCalendarDate` — bare
  date as UTC midnight, future allowed, offset-less datetime rejected; `assertCoverageFigures`
  — non-empty flat object, array / nested / non-finite rejected; `premiumVariance` sign;
  audit snapshots exclude `fileName` / `storageRef` / the figures), `policy.service.spec.ts`
  ×24 (`place` — creates from the ACCEPT decision + the quotation's insurer/line/premium,
  422 without ACCEPT / non-ACCEPT, 409 pre-check + `P2002`, expiry ≤ inception, 404
  visibility; `recordIssuance` — the atomic engine transition + the schedule / document
  writes + the three audit rows, 422 negative premium / empty `limits` / off-path status /
  inception-override-past-stored-expiry, the **resume** path + its **mismatch rejection**,
  409 on the transition race / the partial-`UNIQUE` / a `policyNumber` collision;
  `attachDocuments`; list/get scoping — a **stateful** Policy mock where each `transition`
  moves `state.status`). **New** `test/policy.e2e-spec.ts` ×2 — the full place → issuance
  (schedule + 2 documents) → attach-a-certificate → read path (`premiumVariance` `-1500.000`,
  `issuanceComplete`, a `TRANSITION` audit row asserted), a second `POST /policies` → `409`,
  a re-issuance → `422`; and 422 (no ACCEPT decision) / 400 (missing `inceptionDate`).
  `policyNumber` is uniquified per run because `Policy.policyNumber @unique` spans the
  shared cumulative `db-test`. Full suites green: **811** api unit (64 files,
  workspace-scoped), api contract 4/4, **api e2e 107/107** (18 files, + the new policy e2e),
  `npm audit` 0 vulnerabilities, `nest build` OK, web unit 6, web Playwright **rfq.spec.ts
  13/13** (+1: place a policy from an accepted opportunity and record its issuance),
  `next build` OK, api + web + db `typecheck` + `eslint` clean. Migration applied to `db` +
  `db-test`; `prisma validate` OK, `prisma migrate status` clean; seed re-run (**144**
  permissions — `policy.read` new). One pre-existing MFA-timing flake in `rbac.e2e-spec.ts`
  surfaced once under load during a full-suite run and passed on isolation / re-run
  (documented in `vitest-e2e.config.ts`), unrelated to this change.

**Part C #20 — Policy Checking / Quality Control (Domain B, Process 20)**

- **Extends the `policy` module** (`apps/api/src/modules/policy/policy-checking.*` +
  `apps/api/src/repositories/policy-checking.repository.ts`). Backlog: a line-by-line
  comparison of Requested Coverage vs Issued Policy (limits / sums insured / named perils /
  extensions); actually enforce maker/checker `placedByUserId != checkedByUserId`; on a
  discrepancy → `DISCREPANCY` state, block Delivery, auto-log a
  `ProfessionalIndemnityRiskEvent`.
- **No migration.** The `PolicyChecking` model, the `PolicyChecking_maker_checker_distinct`
  CHECK constraint (`checkedByUserId IS NULL OR checkedByUserId <> placedByUserId`,
  migration `20260826091424`), the `ProfessionalIndemnityRiskEvent` model, the `policy.check`
  permission (`POLICY_CHECKING_OFFICER`), and the full `ISSUED → CHECKING_IN_PROGRESS →
  DISCREPANCY | VERIFIED` / `DISCREPANCY → CHECKING_IN_PROGRESS` transition map all already
  existed. The only seed change is **additive**: `POLICY_CHECKING_OFFICER` gains `policy.read`
  (so a checker can read the policy it checks) and is added to a new shared
  `POLICY_CROSS_OWNER_ROLES` visibility constant.
- **`PolicyChecking` is NOT a `WorkflowTransitionService` entity** (no `status` column — its
  lifecycle is the parent `Policy`'s status). `Policy` IS, and every status move goes
  through the engine.
- **`POST /policies/:id/checking`** (`{ requestedCoverage: { limits, sumsInsured,
  namedPerils?, extensions? } }`, `policy.check`). The "issued" side is the current open
  `PolicySchedule` (from #19); the "requested" side is **transcribed by the Policy Checking
  Officer** into the same shape (there is no separately-stored requested schedule). The pure
  `diffCoverage` derives the comparison:
  - `limits` / `sumsInsured` — per-key (union of keys, sorted). A pair is equal if both
    parse as money (compared at fils precision via `compareMoney` — `"5000000"` equals
    `"5000000.000"`, never a float compare) else as **case- and whitespace-normalised**
    descriptors (so `"Fire"` vs `"fire"` or `"debris  removal"` vs `"debris removal"` is not
    a discrepancy). A key on only one side → `match: false` with `null` for the missing side.
  - `namedPerils` / `extensions` — set diffs → `missing` (requested, not issued) / `extra`
    (issued, not requested), same normalisation.
  - `discrepancyFound = mismatchCount > 0` — **derived, never caller-asserted**. `summary`
    is a human-readable mismatch list that embeds the differing figures (→
    `PolicyChecking.discrepancyDetail` + the PI event description).
- **Maker/checker** (`ibms-brain/meta/lex/maker-checker-segregation.md`) — enforced both in
  the app (`assertDifferentActors(placedByUserId, actor)`, throws `ForbiddenException`) and
  structurally (the pre-existing DB CHECK). `assertDifferentActors(issuedByUserId, actor)`
  is **also** applied app-side — the checker should not be whoever transcribed the issued
  record either; the lex table maps only the placer today, so this is a stricter-than-lex
  belt (`/brain-gap` filed to decide whether the DB CHECK should extend). A `422` is raised
  if `Policy.placedByUserId` is null (a maker-less policy can't be checked — defensive
  against a future backfill / integration).
- **On a discrepancy** — `PolicyCheckingRepository.recordChecking` does the `PolicyChecking`
  `upsert` (`policyId @unique`; a re-check UPDATEs the row) **and** creates the linked
  `ProfessionalIndemnityRiskEvent` (`sourcePolicyCheckingId`, optional `piPolicyId` from the
  broker's latest PI policy) **in one Prisma `$transaction`** — a documented local exception
  (like `QuotationRepository.reviseChain`), so "a discrepancy is recorded" and "a PI risk
  event exists" can never diverge. A re-check that still finds the **same** discrepancy does
  not double-log (a `discrepancyLoggedAsPiRiskEvent` guard); a re-check that finds a
  **materially changed** discrepancy refreshes the existing event's `description` (a Process
  54 risk-register entry must not go stale).
- **The status walk** — `PolicyCheckingService.driveCheckingOutcome` walks the `Policy`
  `(ISSUED | DISCREPANCY) → CHECKING_IN_PROGRESS → (VERIFIED | DISCREPANCY)` through
  `WorkflowTransitionService.transition`, re-reading the live status before every hop
  (self-healing; a re-call from a stalled `CHECKING_IN_PROGRESS` resumes). It is
  **best-effort for a clean `VERIFIED` outcome** (a clean result that can't be applied
  because the policy moved on is harmless) but **a `DISCREPANCY` outcome that can no longer
  be applied is a hard `409`** (a concurrent divergent check verified the policy first, and
  the map has no edge back onto the checking path) — otherwise a policy could sit at
  `VERIFIED` with `discrepancyFound = true` and its PI event logged, yet Delivery unblocked:
  the exact PI-claim failure mode Process 20 exists to catch. The check row + PI event stay
  on record; the `409` forces manual resolution. `/brain-gap` filed on this class ("a
  best-effort status walk whose terminal state is a safety gate must fail loudly").
- **Delivery block is structural** — `WORKFLOW_TRANSITIONS.Policy` has `DISCREPANCY →
  [CHECKING_IN_PROGRESS]` only (never `→ DELIVERED`), and every intermediate state
  (`ISSUED` / `CHECKING_IN_PROGRESS`) likewise has no `DELIVERED` edge. So #20 only needs to
  drive the status to `DISCREPANCY`; no separate Delivery guard.
- **Audit — metadata not body** — `policyCheckingAuditSnapshot` = counts + ids + booleans
  only. The `checklistResult` JSON and `discrepancyDetail` embed coverage figures, so they
  never enter the audit trail (a `JSON.stringify` unit assertion enforces it). The
  `ProfessionalIndemnityRiskEvent.description` **does** carry the figures — that is the
  Process 54 risk-register entry's purpose ("requested Sum Insured not matching amount sent
  to insurer"). `PolicyView.checking.checklist` / `.discrepancyDetail` are returned to
  authorised `policy.read` readers — coverage data (Confidential, not Highly Confidential),
  the same tier as the schedule figures those roles already see; not logged.
- **`apps/web/app/(app)/opportunities/[id]/`** — the "Policy" section gains a checker-only
  QC-check form (`limits` / `sumsInsured` JSON textareas + perils / extensions comma-lists
  + "Run check") and a discrepancy display (the mismatch detail + a "PI risk event logged"
  note + "DISCREPANCY — Delivery blocked" / "verified"). No new nav item.
- **`@code-reviewer` (mandatory — workflow logic + maker/checker + Confidential data + a
  regulatory obligation)** → **APPROVE WITH MINORS, no BLOCKER, no MAJOR, no lex violation**
  (maker/checker enforced app + DB; every `Policy` status move through the engine; audit
  withholds the coverage figures; money equality via `compareMoney`, never a float; no PDPL
  SLA row; no privacy rule re-derived). MINORs fixed: (1) an unappliable `DISCREPANCY` walk
  outcome now throws `409` instead of a swallowed warn; (2) case/whitespace-normalised
  free-text comparison — no false-positive PI events from a `"Fire"`/`"fire"` transcription;
  (3) a materially-changed re-check refreshes the linked PI event's `description`;
  (4) `assertDifferentActors` also rejects the issuing officer; (5) `recordChecking` `P2002`
  → `409` (two concurrent first checks); (6) the maker/checker e2e now dual-hats the placer
  so the `403` is the `assertDifferentActors` rejection, not the RBAC guard. NITs: dropped
  two unused repo methods; extracted the shared `POLICY_CROSS_OWNER_ROLES` helper.
  `/brain-gap` filed + pushed (`ibms-brain` `3b246ad` — `policy-lifecycle.md` § "The rules
  that aren't obvious", Policy Checking row: the "unappliable discrepancy must throw" rule
  and the issuer-segregation open question).
- **Deferred**: "Requested Coverage" is transcribed by the checker each time — a corrected
  re-check (the checker fixes their transcription) or an insurer-re-issued corrected
  `PolicySchedule` (which needs #22 `Endorsement`, not built) are the only exits from
  `DISCREPANCY`. `PolicyChecking.complianceOverrideByUserId` is surfaced in the view but no
  endpoint sets it — a compliance override that bypasses a discrepancy is deferred, so
  clearing a `DISCREPANCY` is currently single-actor. The concurrent-divergent-checks race
  on `PolicyChecking.discrepancyFound` itself (`policyId @unique` serialises the row and a
  `P2002` → `409`, but not the *value*) needs per-policy serialisation of the check to fully
  close. `policy.check` is role-level (no per-officer queue). A re-check that clears a prior
  discrepancy leaves the earlier PI risk event on the register unannotated (closing it out
  is a Process 54 concern).
- **Verification**: +23 api unit — `policy-checking.config.spec.ts` ×9 (`diffCoverage` —
  clean; money trailing-zero equality; a lowered limit; a one-sided key; a
  missing-peril / extra-extension; **a casing / whitespace-only difference is NOT a
  discrepancy**; `piRiskEventDescription`; `policyCheckingAuditSnapshot` excludes the
  checklist / figures via `JSON.stringify`), `policy-checking.service.spec.ts` ×14 (clean →
  APPROVE audit + `ISSUED → CHECKING_IN_PROGRESS → VERIFIED` walk; discrepancy → REJECT
  audit + PI event passed to the repo + `→ DISCREPANCY` walk; 403 self-check /
  issuer-check; 422 no placing officer / not-checkable status / no open schedule; a
  re-check from `DISCREPANCY` still-dirty does not move the status; a re-check now-clean
  walks to `VERIFIED`; a resumed walk from `CHECKING_IN_PROGRESS`; **best-effort walk still
  records the QC result on a transition failure**; **409 when a discrepancy outcome can no
  longer be applied (concurrent verify mid-walk)**; **409 on a concurrent first-check unique
  violation**; 404 visibility — a **stateful** Policy mock where each `transition` moves
  `state.status`) → **834** api unit (66 files, workspace-scoped). `test/policy.e2e-spec.ts`
  gains a 3rd test — a real checker verifies a clean policy → `VERIFIED`; a discrepant check
  → `DISCREPANCY` + a real `ProfessionalIndemnityRiskEvent` row linked by
  `sourcePolicyCheckingId`; a re-check with a materially changed discrepancy does not
  double-log but **refreshes the PI event description**; a re-check with the correct
  requested coverage clears to `VERIFIED`; the placing officer (dual-hatted with
  `policy.check`) checking → `403` (the `assertDifferentActors` rejection). Full suites
  green: **834** api unit, api contract 4/4, **api e2e 108/108** (18 files), `npm audit` 0
  vulnerabilities, `nest build` OK, web unit 6, web Playwright **rfq.spec.ts 14/14** (+1: a
  Policy Checking Officer runs the QC check and sees a discrepancy block Delivery), `next
  build` OK, api + web + db `typecheck` + `eslint` clean. No migration; `prisma validate`
  OK, `prisma migrate status` clean (29 migrations, unchanged); seed re-run (**144**
  permissions — `POLICY_CHECKING_OFFICER` gains `policy.read`, additive). The known
  `rbac.e2e-spec.ts` MFA-timing flake surfaced once under full-suite load and passed on
  isolation / re-run (documented in `vitest-e2e.config.ts`), unrelated.

**Part C #21 — Policy Delivery (Domain B, Process 21)**

- **Extends the `policy` module** — new `apps/api/src/modules/policy/policy-delivery.service.ts`
  + `policy-delivery.config.ts` + `apps/api/src/repositories/policy-delivery.repository.ts`.
  Backlog: record date / method / recipient / receipt acknowledgement.
- **No migration.** The `DeliveryRecord` model (`policyId @unique`, `deliveredAt
  @default(now())`, `method`, `recipient`, `receiptAcknowledgedAt DateTime?`), the
  `policy.deliver` permission (`[SALES, PLACEMENT]`), and the `VERIFIED → [DELIVERED]` /
  `DELIVERED → [ACTIVE]` transition-map entries all already existed. **No seed change.**
- **`POST /policies/:id/delivery`** (`{ method ∈ email | portal | courier | in_person,
  recipient, deliveredAt? }`, `policy.deliver`). Drives `Policy VERIFIED → DELIVERED`
  through `WorkflowTransitionService.transition` — the engine's status-conditional
  `updateMany` is the race gate; a concurrent delivery matches 0 rows → `ConflictException`
  → `409`. The engine can also reject a concurrent delivery with an
  `UnprocessableEntityException` ("already in status DELIVERED", from its own pre-read) —
  since the pre-check already ruled out the non-racing bad-state case, **both are
  normalised to one `409`** so the loser's status code is deterministic (`@code-reviewer`
  MINOR). Then `DeliveryRecord.create` (`policyId @unique` → `P2002` → `409`). A
  **crash-recovery re-entry branch** (status already `DELIVERED`, no `DeliveryRecord` yet)
  creates the missing record without re-transitioning; any other state → `422`.
- **`POST /policies/:id/delivery/acknowledge-receipt`** (`{ acknowledgedAt? }`,
  `policy.deliver`). `422` if no `DeliveryRecord`. Stamps `receiptAcknowledgedAt` via a
  status-conditional `updateMany WHERE receiptAcknowledgedAt IS NULL` (0 rows → `409`),
  then **best-effort** advances `Policy DELIVERED → ACTIVE` (`advance` re-reads the live
  status before the hop; logged, never thrown). A **resume branch** — `receiptAcknowledgedAt`
  already set but `status === 'DELIVERED'` — does just the `ACTIVE` advance rather than
  `409`ing.
- **Why the `DELIVERED → ACTIVE` advance is best-effort, not a hard error** — `#20`'s
  `/brain-gap` rule ("a best-effort status walk whose terminal state is a safety gate must
  fail loudly") is scoped to a terminal state that *is itself a control*: reaching
  `DISCREPANCY` **blocks Delivery**, so a swallowed failure there leaves a policy
  `VERIFIED` with `discrepancyFound = true` and Delivery unblocked. `ACTIVE` is not such a
  gate — failing to reach it leaves the policy in the *more* restrictive `DELIVERED`
  state, self-healing on the next call, and observable (`deliveryComplete: true` while
  `status: DELIVERED`). Every move still goes through the engine, so
  `workflow-state-transitions.md` is satisfied.
- **Dates** — `deliveredAt` / `acknowledgedAt` are parsed with `parseHistoricalInstant`
  (a delivery / acknowledgement is a past event: not-future, an explicit offset required
  on datetimes). `acknowledgedAt < deliveredAt` → `422`. `deliveredAt` **can** be
  backdated to before the policy's own issuance date (bounded only by not-future — the
  same latitude as `parseCalendarDate` at #18/#19).
- **`DeliveryRecord` is NOT a `WorkflowTransitionService` entity** (no `status`). **No
  maker/checker** — recording where / how / when a policy document was sent is single-actor
  factual work (`maker-checker-segregation.md` § "what does NOT trigger this rule").
- **Audit** — `CREATE` / `UPDATE DeliveryRecord` carry `method` / `recipient` /
  `deliveredAt`. `recipient` (a name / email / courier ref) stays in the trail: delivery is
  an accountability record ("we sent it to X, this way, on this date"), `recipient` is not
  Highly Confidential (the only tier `sensitive-data-handling.md` bars from the audit
  trail), and `AuditLogEntry` is the Part 10.3 accountability record — materially the same
  as the user emails already on `LOGIN` rows.
- **Refactor (touches #20's reviewed code)** — `PolicyService.loadVisible` promoted from
  `private` to `public` so `PolicyCheckingService` and `PolicyDeliveryService` resolve
  visibility through one path; `PolicyCheckingService` **drops** its own `loadVisiblePolicy`
  + `canReachAnyPolicy` + its `CustomerRepository` dependency (a behaviour-preserving
  equivalence — same `POLICY_CROSS_OWNER_ROLES` + owner check, same collapse-to-404). No
  circular DI (`PolicyService` injects neither sub-service). `POLICY_INCLUDE` gains
  `deliveryRecord: true`; `PolicyView` gains `delivery` + `deliveryComplete`.
- **`apps/web/app/(app)/opportunities/[id]/`** — the "Policy" section gains a Sales/Placement
  delivery form (method select + recipient) shown once the policy is `VERIFIED`, an
  "Acknowledge receipt" button while `receiptAcknowledgedAt` is null, and a read-only
  delivery display. `canDeliver = isSales || isPlacement`. No new nav item.
- **`@code-reviewer` (mandatory — `Policy` status transitions + a two-endpoint state
  machine + audit)** → **APPROVE WITH MINORS, no BLOCKER, no MAJOR, no lex violation**
  (all six mandatory checks pass — no money arithmetic; every `Policy` status move through
  the engine; no approval step, so no maker/checker; no Highly Confidential field logged;
  no PDPL-registry SLA). MINORs fixed: (1) a concurrent-delivery loser now always gets a
  `409` (was `409`-or-`422` depending on which way the engine rejected); (2) the
  `deliveryComplete` doc comment corrected to say it tracks the `receiptAcknowledgedAt`
  stamp, not `status === 'ACTIVE'` (the best-effort `ACTIVE` advance may still be catching
  up). NITs: the e2e now asserts **exactly 5** `TRANSITION` audit rows across the
  `PLACEMENT_CONFIRMED → ISSUED → CHECKING_IN_PROGRESS → VERIFIED → DELIVERED → ACTIVE`
  chain (a direct `.status =` write anywhere in that chain would drop the count and fail).
- **Deferred**: no compliance / management sign-off on delivery — it is single-actor.
  `ACTIVE` here means only "delivered + client-confirmed"; **premium-collection or
  inception-date gating of `ACTIVE`** is a Finance concern (#31+) not modelled. No reminder
  / escalation for a delivery left unacknowledged (Policy Delivery has no `pdpl-sla-timers.md`
  row and no statutory basis, so no timer). `policy.deliver` is role-level (no per-officer
  queue). `deliveredAt` backdating is unbounded on the past side.
- **Verification**: +18 api unit — `policy-delivery.config.spec.ts` (the method
  vocabulary; both audit snapshots serialise the timestamps as ISO strings),
  `policy-delivery.service.spec.ts` (`recordDelivery` — the `VERIFIED → DELIVERED` walk
  + `CREATE DeliveryRecord`; `409` on the engine `ConflictException` **and** on the
  "already in status" `UnprocessableEntityException`; `422` off-state; the re-entry branch;
  `422` when `DELIVERED` + a record exists; `409` on the `policyId` `P2002`; `404`
  visibility. `acknowledgeReceipt` — stamp + `UPDATE` audit + best-effort `DELIVERED →
  ACTIVE`; `422` no record; `409` already-acked (past `DELIVERED`); the resume branch does
  just the `ACTIVE` advance; `422` `acknowledgedAt < deliveredAt`; `409` on the stamp race;
  the acknowledgement still records when the `ACTIVE` advance fails — a **stateful** Policy
  mock where each `transition` moves `state.status`). `test/policy.e2e-spec.ts` gains a 4th
  test — delivery refused pre-`VERIFIED` → `422`; a `verifiedPolicy` helper
  (place + issue + a clean check by a *different* officer); `POST /delivery` → `DELIVERED`
  with the method / recipient echoed; a second delivery → `422`; an acknowledgement dated
  before the delivery → `422`; `POST /acknowledge-receipt` → `ACTIVE`, `deliveryComplete`;
  a second acknowledgement → `409`; and the exactly-5-`TRANSITION`-rows assertion. Full
  suites green: **852** api unit (68 files), api contract 4/4, **api e2e 109/109** (18
  files), `npm audit` 0 vulnerabilities, `nest build` OK, web unit 6, web Playwright
  **rfq.spec.ts 15/15** (+1: records policy delivery and the client receipt
  acknowledgement), `next build` OK, api + web + db `typecheck` + `eslint` clean. **No
  migration; no seed change** (`policy.deliver` already seeded); `prisma validate` OK,
  `prisma migrate status` clean (29 migrations, unchanged).

**Part C #22 — Endorsement Management (Domain B, Process 22)**

- **New module** `apps/api/src/modules/endorsement/` — `endorsement.service.ts` +
  `endorsement.config.ts` (pure) + `endorsement.controller.ts` + `endorsement.module.ts` +
  `apps/api/src/repositories/endorsement.repository.ts`. Backlog: positive/negative
  endorsement + premium-adjustment calculation + a new (never-overwritten) policy-schedule
  version; the cancellation sub-flow (short-period / pro-rata return premium); refund
  approval via maker/checker with a configurable value threshold; commission reversal tied
  1:1 automatically to the same premium adjustment.
- **`Endorsement` IS a `WorkflowTransitionService` entity** — `status` moves ONLY through
  the engine along `REQUESTED → SUBMITTED_TO_INSURER → INSURER_CONFIRMED →
  FINANCIAL_ADJUSTMENT_CALCULATED → (REFUND_APPROVAL_PENDING →) APPLIED → CLIENT_NOTIFIED`
  (`workflow-transitions.config.ts` already carried the map). The child `Cancellation` /
  `Refund` / `CommissionReversal` are **NOT** `WorkflowTransitionService` entities (no
  `status` column — their lifecycle is the parent endorsement's), the same shape as
  `PolicyChecking` / `DeliveryRecord`.
- **`POST /policies/:id/endorsements`** (`{ type ∈ POSITIVE | NEGATIVE, changeType ∈` the
  nine `ENDORSEMENT_CHANGE_TYPES `, premiumAmount` (unsigned) `, effectiveFrom, targetCoverage? }`,
  `endorsement.create`/Placement). Policy must be `ACTIVE` → `422` otherwise.
  `signedPremiumAdjustment(type, amount)` (pure) fils-quantizes via `money.util.ts` and
  signs by `type` — a NEGATIVE (return-premium) endorsement stores a negative
  `premiumAdjustment`. `targetCoverage` (optional) is validated with `assertCoverageFigures`
  (the #18/#19 helper) and materialised into the new schedule version at APPLY; omitted →
  the current coverage is carried forward, the new version just marking the "as amended by
  endorsement X from date Y" boundary.
- **`POST /policies/:id/cancellation`** (`{ reason, basis ∈ short_period | pro_rata,
  effectiveFrom }`, `cancellation.create`/Placement) — implemented as a NEGATIVE
  endorsement with `changeType: cancellation`. `cancellationReturnPremium` (pure):
  `pro_rata` = `issuedPremium × unexpiredDays / totalDayCount` (the ratio expressed as a
  percentage so `money.util.ts` `applyPercentage` does the quantized multiply);
  `short_period` = `SHORT_PERIOD_CLIENT_RETURN_PERCENT`% of the pro-rata figure (the client
  gets 90% — a 10% early-cancellation penalty; the constant was renamed from
  `SHORT_PERIOD_RETAINED_PERCENT` per a `@code-reviewer` MINOR, the old name read as
  "retained by whom?"). `422` if the policy has no `issuedPremium` / `inceptionDate` /
  `expiryDate` on record, or the period is zero / inverted, or `effectiveFrom` falls
  outside `[currentOpenSchedule.effectiveFrom, policy.expiryDate]` (a backdated value would
  corrupt the "coverage in force at the loss date" resolution). The `Endorsement` and its
  `Cancellation` child are created in **one Prisma `$transaction`**
  (`EndorsementRepository.createCancellationEndorsement`) — a documented local exception to
  the no-`$transaction` convention (like `QuotationRepository.reviseChain`), since the pair
  is meaningless apart and a crash between them would strand an un-appliable endorsement.
- **At most one in-flight cancellation per policy** (`@code-reviewer` MAJOR) — the `Policy`
  stays `ACTIVE` from cancellation-request until the first cancellation is APPLIED, so a
  plain status check lets a second cancellation `Endorsement` be raised (wrong `basis`
  picked, re-raised — there is no void/withdraw endpoint) and driven independently to
  APPLIED, **minting a second `Refund` + `CommissionReversal`**. Backed by the partial
  `UNIQUE` index `Endorsement_one_live_cancellation_per_policy` (migration `20260902170000`,
  `WHERE "changeType" = 'cancellation' AND "status" <> 'CLIENT_NOTIFIED'` — raw SQL, Prisma
  can't express a two-column partial `UNIQUE` on the mutable `status`), a friendly
  pre-check (`findLiveCancellation` → `409`), and `P2002 → 409`. A cancellation reaching
  terminal `CLIENT_NOTIFIED` drops out of the index (a later cancellation of a reinstated
  policy stays possible); a stuck in-flight one blocks re-raising until pushed through.
- **`SHORT_PERIOD_CLIENT_RETURN_PERCENT = '90'` and `REFUND_APPROVAL_THRESHOLD_JOD = '5000.000'`
  are drafted, unsourced module constants.** No market short-period scale table (by months
  elapsed) is available, and no CBJ / Part-3.5 / Finance approval-matrix source specifies a
  refund threshold — a real Finance approval matrix (narrative Process 37/40) belongs to a
  Finance-config surface that does not exist yet. Both are the same pattern as #16's drafted
  10% / 2 pp conflict-of-interest bands. **Filed via `/brain-gap`** to
  `ibms-brain/meta/context/policy-lifecycle.md` § "The rules that aren't obvious"
  (`ibms-brain` `7b60bbd`, pushed; submodule pin bumped in this commit).
- **`POST /endorsements/:id/advance`** (`endorsement.create`) — walks one hop of
  `REQUESTED → SUBMITTED_TO_INSURER → INSURER_CONFIRMED`, stamping the milestone timestamp
  (`occurredAt?` backdates it via `parseHistoricalInstant`, past-only). `422` once past
  `INSURER_CONFIRMED`.
- **`POST /endorsements/:id/calculate-adjustment`** (`{ premiumAmount? }`,
  `endorsement.apply`) — from `INSURER_CONFIRMED` (idempotent re-call from
  `FINANCIAL_ADJUSTMENT_CALCULATED`). An optional `premiumAmount` overrides the
  request-time figure with the insurer's final confirmed number — accepted only on the
  first call (from `INSURER_CONFIRMED`); a materially different value on a later re-call
  (once the Refund + CommissionReversal have been minted from it) is a loud `422`, not a
  silent no-op (`@code-reviewer` MINOR). Ignored for a cancellation. For a NEGATIVE
  endorsement it then creates the auto-tied **`Refund`** (maker side,
  `raisedByUserId = actor`) **and `CommissionReversal`** (`|premiumAdjustment| ×
  recommendedQuotation.commissionRatePercent`, `commissionReversalAmount` pure — the "two
  numbers must move together", `policy-lifecycle.md`; `422` if the placed quote captured no
  commission rate) in **one `$transaction`** (`EndorsementRepository.createRefundAndReversal` —
  both rows always, so `Refund` existing ⟺ `CommissionReversal` existing; `P2002` → `409`).
  Then transitions to `FINANCIAL_ADJUSTMENT_CALCULATED`, and further to
  `REFUND_APPROVAL_PENDING` iff `refundNeedsApproval` (refund `≥`
  `REFUND_APPROVAL_THRESHOLD_JOD`). A below-threshold refund is auto-cleared
  (`approvalThresholdMatrixLevel = below_threshold_auto`, `approvedByUserId` stays null).
- **`POST /endorsements/:id/apply`** (`endorsement.apply`) — `FINANCIAL_ADJUSTMENT_CALCULATED
  → APPLIED` (stamping `appliedAt` in the same engine write). **`applyCore` first refuses
  outright** when `refund != null && refundNeedsApproval(refund.amount) &&
  refund.approvedByUserId == null` — regardless of status (`@code-reviewer` BLOCKER: the
  `→ REFUND_APPROVAL_PENDING` hop is a *separate* best-effort transition, so a crash or a
  concurrent `apply` between the two writes could otherwise strand the endorsement at
  `FINANCIAL_ADJUSTMENT_CALCULATED` with an unapproved above-threshold refund, and the
  engine map allows `→ APPLIED` unconditionally — the maker/checker gate must be structural,
  not status-only). `PolicyRepository.versionScheduleForEndorsement` — in **one
  `$transaction`** — closes the open `PolicySchedule` at `effectiveFrom` and, unless this is
  a cancellation, opens a **NEW** version (`sourceEndorsementId @unique` — `P2002` → `409`;
  coverage from `targetCoverage` or carried forward from the closed row). The prior version
  is never updated in place. A **cancellation** apply then drives `Policy ACTIVE → CANCELLED`
  through the engine and **throws a hard `409` if that cannot be applied** (`@code-reviewer`
  MINOR — a policy left `ACTIVE` after its cover was cancelled still accepts claims /
  renewals; same "a control-action status walk must fail loudly" generalisation as #20);
  already-`CANCELLED` (a concurrent apply won) is success, and the endorsement is already
  APPLIED so a retry of `apply` is re-entrant and just re-attempts the policy transition.
  `422` while `REFUND_APPROVAL_PENDING`
  ("apply via `POST /refunds/:id/approve`").
- **`POST /refunds/:id/approve`** (`refund.approve`/**Manager or Finance** — seed row
  widened to `[MANAGER, FINANCE_COLLECTIONS_OFFICER]` per a `@code-reviewer` MINOR, since
  `maker-checker-segregation.md` maps the refund checker to a "Finance approver"; the
  Branch/Department Manager is kept for a small brokerage with no separate Finance
  approver on hand) — **maker/checker**: `assertDifferentActors(refund.raisedByUserId,
  actor)` (`403`) **plus** the pre-existing `Refund_maker_checker_distinct` CHECK
  (structural). `422` if the endorsement is not `REFUND_APPROVAL_PENDING`; `409` if the
  refund row already shows an approver; status-conditional `recordRefundApproval`
  `updateMany WHERE approvedByUserId IS NULL` (0 rows → `409`, a concurrent approver won —
  and it sets `approvalThresholdMatrixLevel = 'approved_above_threshold'`, keeping the
  "was above threshold" signal). On success it runs the shared apply path
  (`REFUND_APPROVAL_PENDING → APPLIED` + schedule version + hard policy-cancel for a
  cancellation).
- **`POST /endorsements/:id/notify-client`** (`endorsement.apply`) — `APPLIED →
  CLIENT_NOTIFIED`, and stamps `Cancellation.clientNotifiedAt` for a cancellation.
- **`GET /policies/:id/endorsements`** + **`GET /endorsements/:id`** (**new seeded perm
  `endorsement.read`** — `[SALES, PLACEMENT, FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER,
  EXECUTIVE_MANAGEMENT]`). Visibility: `EndorsementService.CROSS_OWNER_ROLES` =
  `CUSTOMER_FILE_CROSS_OWNER_ROLES` + `FINANCE_COLLECTIONS_OFFICER`, else the customer's
  `ownerUserId`; every miss collapses to one `404`.
- **Migrations** (both hand-authored, `migrate deploy`, applied to `db` + `db-test`):
  `20260902160000_add_endorsement_management` — `Endorsement.targetCoverage JSONB`,
  `effectiveFrom` / `submittedToInsurerAt` / `financialAdjustmentCalculatedAt TIMESTAMP(3)`,
  `Endorsement_policyId_idx` (the `effectiveFrom` column was folded in during the same
  session with `ADD COLUMN IF NOT EXISTS` per a `@code-reviewer` MINOR, and
  `_prisma_migrations` checksum reconciled — a `///` NOTE records it).
  `20260902170000_endorsement_one_live_cancellation` — the partial `UNIQUE`
  `Endorsement_one_live_cancellation_per_policy` (the `@code-reviewer` MAJOR fix, above).
  **No new `Decimal` columns** — all four money fields (`Endorsement.premiumAdjustment`,
  `Cancellation.returnPremium`, `Refund.amount`, `CommissionReversal.amount`) were already
  classified in `MONEY_DECIMAL_FIELDS`.
- **Audit — metadata not body.** `endorsementAuditSnapshot` / `cancellationAuditSnapshot` /
  `refundAuditSnapshot` / `commissionReversalAuditSnapshot` carry ids, counts, booleans and
  money as fixed 3dp strings — never the cancellation `reason` (only `hasReason: true`). A
  `CREATE` row is written per `Endorsement`, `Cancellation`, `Refund`, `CommissionReversal`
  and `PolicySchedule`; the engine writes the `TRANSITION` rows.
- **`advance` ordering** (`@code-reviewer` NIT) — the `SUBMITTED_TO_INSURER →
  INSURER_CONFIRMED` hop rejects an `occurredAt` earlier than the recorded
  `submittedToInsurerAt`.
- **Bug fixed pre-review** — `EndorsementService.calculateAdjustment` passed `e.policy.id`
  (the Policy id) to `commissionRateFor`, which expects an `opportunityId`;
  `ENDORSEMENT_INCLUDE` now also selects `policy.opportunityId` and the call uses it.
- **`apps/web/app/(app)/opportunities/[id]/`** — a new **"Endorsements"** section
  (`components/policy/EndorsementSection.tsx`, mounted below `PolicySection`). It fetches
  the opportunity's policy, and while that policy is `ACTIVE` shows Placement
  request-endorsement / request-cancellation forms; every endorsement row shows its status,
  premium adjustment, tied commission reversal, refund state and schedule-version marker
  plus the one action its status offers (`Advance` / `Calculate adjustment` / `Apply` /
  `Notify client` for Placement, `Approve refund` for Manager). `canManage = isPlacement`,
  `canApproveRefund = isManager`. No new nav item.
- **Deferred**: `SHORT_PERIOD_CLIENT_RETURN_PERCENT` and `REFUND_APPROVAL_THRESHOLD_JOD` are
  drafted constants (filed, above). `Refund.paidAt` is surfaced in the view but no endpoint
  stamps it — payment execution is Finance (#37). The parent-`Opportunity` progression is
  best-effort. There is no void/withdraw endpoint, so a stuck in-flight cancellation blocks
  re-raising until it is pushed through. `endorsement.create` / `.apply` / `refund.approve`
  are role-level (no per-officer queue). No SLA timer on an unapplied endorsement
  (Endorsement Management has no `pdpl-sla-timers.md` row). A positive endorsement's
  `targetCoverage` is stored opaquely (a non-empty flat object of string/number values — no
  per-figure `Decimal(18,3)` precision until a consumer does arithmetic on it, same
  treatment as `PolicySchedule` at #18/#19). Residual race: two near-simultaneous
  cancellations still serialise on the partial `UNIQUE` (one wins, the other `409`s) but
  two divergent *non-cancellation* negative endorsements on one policy are both allowed.
- **`@code-reviewer` (mandatory — workflow transitions + maker/checker + financial
  calculation + a migration)** → **CHANGES REQUESTED → resolved.** One **BLOCKER**: the
  maker/checker gate on an above-threshold refund was enforced only by the
  `REFUND_APPROVAL_PENDING` status, set by a *separate* best-effort transition — a crash or
  concurrent `apply` between the two writes could reach `APPLIED` with an unapproved refund.
  Fixed: `applyCore` refuses `refund && needsApproval && approvedByUserId == null`
  regardless of status (+ unit test simulating the stranded state). One **MAJOR**: double
  cancellation → double `Refund` + `CommissionReversal` (the `Policy` stays `ACTIVE` until
  APPLY, so the status check let a second one through). Fixed: partial `UNIQUE`
  `Endorsement_one_live_cancellation_per_policy` (migration `20260902170000`) + pre-check +
  `P2002 → 409` (+ 2 unit tests). MINORs fixed: (1) `effectiveFrom` bounded to
  `[openSchedule.effectiveFrom, expiry]`; (2) the cancellation `Policy → CANCELLED` walk is
  a hard `409` on an unappliable outcome, not a swallowed warn; (3) `SHORT_PERIOD_RETAINED_PERCENT`
  renamed `SHORT_PERIOD_CLIENT_RETURN_PERCENT` (+ comment) — the old name/behaviour
  mismatched; (4) both drafted constants filed via `/brain-gap` (`ibms-brain` `7b60bbd`);
  (5) `refund.approve` widened to `[MANAGER, FINANCE]` to match `maker-checker-segregation.md`;
  (6) a materially different late `premiumAmount` override at `calculate-adjustment` is a
  `422`, not a silent no-op; (7) the folded `effectiveFrom` ALTER carries `IF NOT EXISTS`.
  NITs: dead `skipRefund` / `skipReversal` flags removed (the pair is atomic); `advance`
  rejects an out-of-order `occurredAt`; `approvalThresholdMatrixLevel` keeps the
  above-threshold signal on approval.
- **Verification**: +47 api unit — `endorsement.config.spec.ts` (16 — `signedPremiumAdjustment`
  sign/quantize; `cancellationReturnPremium` pro-rata / short-period / clamp-before-inception
  / zero-period `422` / inverted-period `422`; `commissionReversalAmount`;
  `refundNeedsApproval` threshold boundary; the four audit snapshots withhold free text),
  `endorsement.service.spec.ts` (31 — a stateful `Endorsement` + `Policy` mock where
  `workflow.transition` moves the status: request POSITIVE / NEGATIVE; `422` non-`ACTIVE`;
  `422` `effectiveFrom` before the open schedule; `404` visibility; cancellation pro-rata +
  both audit rows; `422` no premium/period; `409` live-cancellation pre-check; `409`
  `P2002`; `422` cancel `effectiveFrom` past expiry; the `advance` walk + `422` past
  `INSURER_CONFIRMED`; `calculateAdjustment` POSITIVE no-refund, NEGATIVE below-threshold
  auto-clear + reversal tied 1:1, NEGATIVE at/above threshold → `REFUND_APPROVAL_PENDING`,
  `422` no commission rate, `P2002` → `409`; `apply` → schedule version, `422` while pending
  approval, **`422` when an above-threshold refund is unapproved even if stranded at
  FINANCIAL_ADJUSTMENT_CALCULATED**, cancellation → `Policy CANCELLED` + no successor
  schedule, **`409` when the `Policy → CANCELLED` walk cannot apply**; `approveRefund` `403`
  self-approve, distinct approver applies + versions, `409` race, `409` already-approved,
  `422` not pending; `notifyClient` + cancellation stamp, `422` not `APPLIED`; list/get
  visibility). `test/endorsement.e2e-spec.ts` (**new** — 4 tests: the full positive
  lifecycle applying the insurer-confirmed premium and asserting a NEW schedule version +
  exactly 5 `TRANSITION` rows; a negative endorsement above threshold where the raiser gets
  `403` and a distinct manager approves; a pro-rata cancellation that auto-clears, applies
  and drives the `Policy` to `CANCELLED`; `422` on an endorsement against a non-`ACTIVE`
  policy). Full suites green: **api unit 899** (70 files), api contract 4/4, **api e2e
  112/113** (19 files — the one failure is the pre-existing `insurance-program.e2e-spec.ts`
  MFA-timing flake under full-suite load, unrelated to #22, passes 7/7 on isolation;
  `endorsement.e2e-spec.ts` + `policy.e2e-spec.ts` 8/8 after the review fixes),
  `npm audit` 0 vulnerabilities, `nest build` OK, web unit + Playwright **rfq.spec.ts 16/16**
  (+1: raises a positive endorsement on an ACTIVE policy) incl. `@a11y`, `next build` OK,
  api + web + db `typecheck` + `eslint` clean. Both migrations applied to `db` + `db-test`;
  `prisma validate` OK, `prisma migrate status` clean (31 migrations); seed re-run (**145**
  permissions — new `endorsement.read`; `refund.approve` grant widened to Finance).

**Part C #23 — Claim Notification (Domain C, Process 23)**

- **New module** `apps/api/src/modules/claim/` — `claim.service.ts` + `claim.config.ts`
  (pure) + `claim.controller.ts` + `claim.module.ts` + `apps/api/src/repositories/claim.repository.ts`.
  Opens Domain C. Backlog: record loss date / location / cause + the estimated loss +
  third-party involvement; validate coverage in force **at the exact loss date** via
  `PolicySchedule.effectiveFrom/effectiveTo`, not just the current schedule.
- **No migration.** The `Claim` / `ClaimStatusHistory` / `ThirdPartyClaimant` / `Settlement`
  / `Adjuster` / `ClaimFollowUpAlert` models, the `ClaimStatus` enum, the
  `WORKFLOW_TRANSITIONS.Claim` map (`NOTIFIED → REGISTERED → DOCUMENTATION_IN_PROGRESS →
  UNDER_ASSESSMENT → APPROVED | PARTIALLY_APPROVED | DECLINED → SETTLED → CLOSED`), all four
  claim `Decimal` money fields (already in `MONEY_DECIMAL_FIELDS`), and
  `ENCRYPTED_FIELDS.ThirdPartyClaimant = ['contactDetailsEnc']` all pre-existed. The only
  seed change is one additive permission (`claim.read`) + one additive grant
  (`CLAIMS_OFFICER` on `policy.read`).
- **`Claim` IS a `WorkflowTransitionService` entity**, but #23 only does the **initial
  creation** at the schema `@default(NOTIFIED)` — NOT through the engine (the same
  initial-creation pattern as `Policy` at `PLACEMENT_CONFIRMED`, `Opportunity` at
  `NEEDS_CONFIRMED`, `Endorsement` at `REQUESTED`). `NOTIFIED → REGISTERED` is Process 24
  (out of scope). Nothing here writes `status`.
- **No maker/checker at notification** — recording a reported loss is single-actor
  Sales/Claims work per `maker-checker-segregation.md` § "what does NOT trigger this rule".
  The mandatory second approver is at settlement (Process 28).
- **`POST /claims`** (`{ policyId, lossDate, causeOfLoss, lossLocation?, estimatedLoss,
  isThirdPartyInvolved?, thirdParty?: { fullName?, contactDetails?, subrogationRecoveryFlag? } }`,
  `claim.notify`/**Sales or Claims** — already seeded). `ClaimRepository.createNotification`
  writes, in **one Prisma `$transaction`** (a documented local exception, like
  `QuotationRepository.reviseChain` / `PolicyRepository.createIssuanceArtifacts`): the
  `Claim`; its opening `ClaimStatusHistory` row (`fromStatus: null → NOTIFIED`,
  `changedByUserId` = the notifier — there is no `Claim.notifiedByUserId` scalar, the
  history row + the `CREATE` `AuditLogEntry` are the provenance trail); and, for a
  third-party loss, the one `ThirdPartyClaimant` (`contactDetails` field-level encrypted
  into `contactDetailsEnc` via `encryptEntityFields(... 'ThirdPartyClaimant' ...)`, the id
  pre-generated so the `ENCRYPTION_KEY_USED` key-use audit attributes to the real row).
  `lossDate` via `parseHistoricalInstant` (past-only, offset required on datetimes);
  `estimatedLoss` `quantizeMoney`'d and must be `> 0`.
- **Coverage in force AT THE LOSS DATE** — `resolveCoverageAtLossDate` (pure, **total** —
  never throws) finds the `PolicySchedule` version whose window `[effectiveFrom,
  effectiveTo)` contains the loss date. The full set of schedule versions **is** the
  materialised endorsement history (every #22 APPLY closes the open version and opens a new
  one), so this is "querying against endorsement history" — a loss under a policy endorsed
  *after* the loss resolves to the (now closed) version that actually applied, **not** the
  current open schedule (`claims-lifecycle.md` / `data-model.md`). `Policy.expiryDate` is an
  **independent upper bound** — nothing closes the open schedule row at expiry, so its
  `effectiveTo` stays `null` and can't be relied on to reject a post-expiry loss. On
  `POST /claims` an unresolvable loss (`not_issued` / `before_inception` /
  `after_cover_ended` / `coverage_gap`) is a hard **422** with a reason-specific message;
  on a later read it is a non-throwing `coverage: null` + `coverageResolvedAtLossDate:
  false` — a mid-term loss can be validly notified while cover is open and then a #22
  forward cancellation strands it, and the read must still return the claim.
- **`isLargeClaim`** — derived at notification from `CLAIM_LARGE_THRESHOLD_JOD = '25000.000'`,
  a **drafted, unsourced** constant (no CBJ / Part-3.7 / broker authority-matrix figure;
  `claims-lifecycle.md`'s worked example uses a JOD 20,000 Estimated Loss as a *routine*
  claim). It is an **advisory notification-time SNAPSHOT** — the `claims-lifecycle.md`
  large-claim / second-approver gate at Process 28 must **re-derive from live data** (the
  approved amount) at the settlement decision point, never trust this flag (the #16 review
  generalisation). **Filed via `/brain-gap`** to `ibms-brain/meta/context/claims-lifecycle.md`
  (`ibms-brain` `67582ee`, pushed; submodule pin bumped in this commit).
- **`GET /claims?policyId=|customerId=`** + **`GET /claims/:id`** (**new seeded perm
  `claim.read`** — `[SALES, CLAIMS_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT]`).
  Visibility: a new shared `CLAIM_CROSS_OWNER_ROLES` (`[CLAIMS_OFFICER, BRANCH_DEPARTMENT_MANAGER,
  EXECUTIVE_MANAGEMENT]` reach any claim cross-book; a Sales Officer sees only claims on a
  Customer they own); every miss collapses to one `404`. **`CLAIMS_OFFICER` added to
  `policy.read`** (seed, additive — a claims officer needs the underlying policy context;
  same cross-book rationale as `POLICY_CHECKING_OFFICER` at #20).
- **Every read is audit-logged** (`@code-reviewer` MAJOR) — `Claim` is
  `@default(HIGHLY_CONFIDENTIAL)` and a read returns `causeOfLoss` / `lossLocation` free
  text (which may name an injured person or describe a medical event) plus the third-party
  name. `get` and `list` each emit an `AuditLogEntry` `action: READ`,
  `isSensitiveDataAccess` true when a claim was actually returned — ids / counts only,
  never claim content — so the audit anomaly detector (bulk / repeated sensitive reads)
  sees it. Mirrors `CrmService.get360View`. The list is capped at `CLAIM_LIST_LIMIT = 200`
  (newest first).
- **Audit snapshots — metadata not body.** `claimNotificationAuditSnapshot` records
  `hasLossLocation` (bool) + the resolved coverage schedule id / window, never the
  `causeOfLoss` / `lossLocation` text; money as a fixed 3dp string.
  `thirdPartyClaimantAuditSnapshot` records `hasFullName` / `hasContactDetails` bools +
  `subrogationRecoveryFlag`, never the name or the (encrypted) contact.
- **`apps/web/app/(app)/opportunities/[id]/`** — a **"Claims"** block in the "Policy"
  section (`components/policy/ClaimSection.tsx`, mounted below `EndorsementSection`). It
  fetches the opportunity's policy and, once it is issued, shows a Sales/Claims notify form
  (loss date / cause / location / estimated loss / third-party toggle → name / contact /
  subrogation) and a read-only claim list with status, estimated loss, cause, third-party
  and the resolved coverage window. `canNotify = isSales || isClaims`. No new nav item.
- **`@code-reviewer` (mandatory — a workflow entity + a validation gate + Highly
  Confidential data + a financial figure)** → **CHANGES REQUESTED → resolved.** One
  **MAJOR**: `list` / `get` served Highly Confidential claim content with no access trace —
  fixed by the sensitive-data `READ` audit above (+ 2 unit tests, + an e2e assertion).
  MINORs fixed: (1) `CLAIM_LARGE_THRESHOLD_JOD` `/brain-gap` filed + pushed (not just
  asserted in a comment); (2) `findManyBy*` bounded at `CLAIM_LIST_LIMIT = 200`; (3) a new
  `coverage_gap` reason so a hole between schedule versions is not mislabelled "cover
  ended". NITs: `@IsString()` added before `@Matches` on `estimatedLoss`; unused
  `status` / `inceptionDate` dropped from the `CLAIM_INCLUDE` policy select. NIT left as
  the reviewer marked it optional: `notify` re-loads the claim to build the response.
- **Deferred**: `CLAIM_LARGE_THRESHOLD_JOD` is a drafted constant (filed, above) and
  `isLargeClaim` is a snapshot only — #28 must re-derive. `ThirdPartyClaimant.recoveryAmount`
  is a settlement-phase figure and is **not** accepted at notification; a bare
  `isThirdPartyInvolved: true` with no details still creates the (all-null)
  `ThirdPartyClaimant` row as the anchor for the subrogation/recovery process. No
  `claimNumber` / `insurerClaimReference` (assigned at #24 registration with the insurer);
  no `Adjuster` assignment (#24/#26), no `ClaimFollowUpAlert` sweep (#27), no `ClaimDocument`
  upload (#25); Loss Ratio / Claims Analytics (#29) is not fed yet. The resolver assumes
  contiguous schedule versions — `coverage_gap` exists for a hole but that shouldn't occur
  (each #22 APPLY closes-and-opens contiguously). `claim.notify` / `claim.read` are
  role-level (no per-officer queue); no PDPL-registry SLA attaches at `NOTIFIED`.
- **Verification**: +33 api unit — `claim.config.spec.ts` (16 — `resolveCoverageAtLossDate`
  version-in-force / `[from, to)` boundary / `before_inception` / `after_cover_ended` past
  expiry / cancelled-forward / `coverage_gap` / `not_issued` / null-`expiryDate`;
  `coverageGapMessage` per reason; `isLargeClaim` boundary + value-not-string compare; both
  audit snapshots withhold free text), `claim.service.spec.ts` (17 — a stateful `Claim` +
  `Policy` mock: create at `NOTIFIED` resolving the older version; resolve to the current
  version for a later loss; large-claim flag; `422` before inception / on-or-after expiry /
  not-issued / zero estimate / future loss date; third-party encrypts + audits the child +
  no plaintext leak; `422` `thirdParty` without the flag; no encrypt with no contact;
  `404` visibility; read after a forward cancellation returns `coverage: null` not an
  error; scope validation; **`get` / `list` emit the sensitive `READ` audit, sensitive
  only when a claim was returned**). `test/claim.e2e-spec.ts` (**new** — 4 tests: a pure
  Claims Officer notifies two losses resolving to the pre- and post-endorsement schedule
  versions + the opening `ClaimStatusHistory` row + the sensitive `READ` audit rows;
  `422` for a loss before inception and on/after expiry; a third party whose contact
  details are encrypted and never reach the response or any audit row + `ENCRYPTION_KEY_USED`
  logged; `403` without `claim.notify`). Full suites green: **api unit 932** (72 files),
  api contract 4/4, api e2e (claim 4/4; crm / rbac / policy / endorsement unaffected by the
  `policy.read` grant + `rbac-visibility.util.ts` change), `npm audit` 0, `nest build` OK,
  web `typecheck` / `eslint` / `next build` OK, Playwright **rfq.spec.ts 17/17** (+1: notifies
  a claim against an issued policy) incl. `@a11y`. No migration; `prisma validate` OK,
  `prisma migrate status` clean (31); seed re-run (**146** permissions — new `claim.read`;
  `policy.read` grant widened to `CLAIMS_OFFICER`).

**Part C #24 — Claim Registration with Insurer (Domain C, Process 24)**

- **Extends** `apps/api/src/modules/claim/` — `claim.service.ts` `register()` +
  `completeRegistration()`, `claim.repository.ts` `recordRegistration()`, a new
  `dto/register-claim.dto.ts`, a `claim.config.ts` `adjusterAuditSnapshot` /
  `claimRegistrationAuditSnapshot`, and `POST /claims/:id/registration` on
  `claim.controller.ts`. Backlog: transition to `REGISTERED`, assign the loss adjuster.
- **Migration `20260902180000_claim_status_history_unique_transition`** (hand-authored,
  `migrate deploy`, applied to `db` + `db-test`) — `@@unique([claimId, toStatus])` on
  `ClaimStatusHistory` and nothing else. A `@code-reviewer` MINOR: `recordRegistration`
  guards the `REGISTERED` history-row insert with a `count()`-then-`if`-then-`create`
  (the `race-safe-invariants.md` check-then-act shape). Today that is transitively
  backstopped by the sibling `Adjuster.claimId @unique` inside the same `$transaction`,
  but the constraint makes "one history row per `(claimId, toStatus)`" **structural**.
  It is correct over the whole lifecycle because `WORKFLOW_TRANSITIONS.Claim` is an
  acyclic DAG (`NOTIFIED → REGISTERED → DOCUMENTATION_IN_PROGRESS → UNDER_ASSESSMENT →
  APPROVED | PARTIALLY_APPROVED | DECLINED → SETTLED → CLOSED`) — a status is entered
  exactly once. The `count()` pre-check stays (a crash-recovery resume legitimately
  finds the row present and must skip the insert, not hit the constraint). **No new
  `Decimal` column; no seed change** — the `Adjuster` model, `Claim.insurerClaimReference`
  / `Claim.claimNumber @unique`, `ClaimStatus.REGISTERED`, the transition map and
  `claim.register` (`[CLAIMS_OFFICER]`) all pre-existed.
- **`POST /claims/:id/registration`** (`{ insurerClaimReference, claimNumber?,
  adjuster: { name, firm? } }`, `claim.register`/**Claims Officer**). `insurerClaimReference`
  required non-empty (the acknowledgement artefact); `claimNumber` optional (assignable
  here if not set at notification). Drives `Claim NOTIFIED → REGISTERED` through
  `WorkflowTransitionService.transition` with `{ insurerClaimReference, claimNumber? }`
  as the transition `data` — the status flip and the scalar write are **one atomic,
  engine-audited write** (its status-conditional `updateMany` is the race gate). Then
  `ClaimRepository.recordRegistration` writes the `REGISTERED` `ClaimStatusHistory` row
  and the one loss `Adjuster` in **one `$transaction`** (documented local exception, like
  `createNotification`). **This is the first real engine transition on a `Claim`** — the
  e2e asserts exactly **one** `TRANSITION` `AuditLogEntry` across the register + every
  re-call.
- **No maker/checker** — registering a claim and assigning the adjuster has no
  financial / coverage-approval / deletion consequence (`maker-checker-segregation.md`
  § "what does NOT trigger this rule"). The mandatory second approver is at settlement
  (Process 28) and is untouched here.
- **Idempotent / race-safe re-entry**:
  - a byte-identical re-call — `insurerClaimReference`, adjuster `name`, adjuster `firm`
    and `claimNumber` all equal — returns the current view (`200`, network-retry safe);
  - **any** difference in a registration field is a `409` ("registration details are
    recorded once — a correction is not yet supported"), never a silently-discarded
    no-op (a `@code-reviewer` MINOR: the first cut compared only ref + adjuster name);
  - a concurrent register that lost the `NOTIFIED → REGISTERED` race — the engine
    either matched 0 rows (`ConflictException`) or its pre-read already saw `REGISTERED`
    (`UnprocessableEntityException` "already in status") — is caught, the claim
    reloaded, and handled as an already-registered claim (idempotent or `409`);
  - a crash-recovery re-entry (status already `REGISTERED`, no `Adjuster`) does only
    the artefact write, without re-transitioning and without the `UPDATE Claim`
    scalar-audit row (`transitionedNow` gates it);
  - any other non-`NOTIFIED`, non-`REGISTERED` state is a `422`.
- **Audit**: `CREATE Adjuster` carries the adjuster `name` + `firm` — a professional
  loss-assessment provider, **not** the claimant/insured, so not a
  `sensitive-data-handling.md` Highly Confidential category; same tier as the #21
  `DeliveryRecord.recipient` a prior review accepted. `UPDATE Claim` carries
  `insurerClaimReference` + `claimNumber` (administrative identifiers), only on the
  call that actually transitioned. The #23 sensitive-`READ` audit on `get` / `list`
  is unchanged.
- **`ClaimView`** gains `insurerClaimReference` and `adjuster` (`name` / `firm` /
  `assignedAt` / `surveyCompletedAt` / `investigationCompletedAt`).
- **`apps/web/`** — `claim-api.ts` `registerClaim`; `ClaimSection.tsx` gains a
  per-`NOTIFIED`-claim "Register with the insurer" form (`canRegister={isClaims}`),
  and registered claims show the insurer ref + adjuster.
- **`@code-reviewer` (mandatory — a workflow transition + a Highly Confidential
  entity)** → **APPROVE WITH MINORS, no blockers, no MAJOR, no lex violation.**
  Addressed: (1) `@@unique([claimId, toStatus])` on `ClaimStatusHistory` (migration
  `20260902180000`) makes the "one history row per status" invariant structural, not
  emergent (`race-safe-invariants.md`); (2) the idempotency key now compares **every**
  registration field, so a changed `firm` / `claimNumber` is a `409`, not a silent
  no-op; (3) a comment documents the concurrent-different-payload winner/loser
  outcome; (4) the module docstring updated to "Process 23-24". Noted, no code change:
  the transition-then-artefacts seam (accepted #19/#21 pattern); Process 27 should key
  its follow-up clock off the `REGISTERED` `ClaimStatusHistory.changedAt`. NIT:
  `recordRegistration` returns `Adjuster` directly (dropped the unused
  `statusHistoryCreated`).
- **Deferred**: `insurerClaimReference` + the `Adjuster` name/firm are **write-once**
  at registration — no amend endpoint, no `Adjuster` re-assignment (the insurer
  swapping adjusters); `Adjuster.surveyCompletedAt` / `investigationCompletedAt` are
  in the view but no endpoint stamps them (Process 26); the transition-then-artefacts
  ordering has a narrow crash seam (`REGISTERED` with no `Adjuster` / no `REGISTERED`
  history row until the next `register` call — the engine `TRANSITION` audit row is
  written, so the PDPL trail is intact, but the Analytics-feeding domain
  `ClaimStatusHistory` row lags; nothing reconciles it automatically); no PDPL-registry
  SLA attaches at `REGISTERED`; `claim.register` is role-level (no per-officer queue).
- **Verification**: +12 api unit — `claim.config.spec.ts` (+2 — `adjusterAuditSnapshot`
  carries name/firm, `claimRegistrationAuditSnapshot` administrative-only),
  `claim.service.spec.ts` (+10 register tests — the engine walk + `data` payload; the
  claim-number omitted from `data` when absent; idempotent no-op; `409` on a changed
  ref / adjuster / firm; crash-recovery resume without re-transitioning + no `UPDATE`
  audit; `422` for a non-`NOTIFIED` state; `409` on a duplicate broker claim number;
  `404` on an invisible claim; the lost-race normalisation to the already-registered
  path). `test/claim.e2e-spec.ts` (+1 — a pure Claims Officer registers a `NOTIFIED`
  claim, Sales gets `403`, the adjuster + insurer ref land in the view, the
  `NOTIFIED → REGISTERED` `ClaimStatusHistory` row is `clm.userId`, exactly one
  `TRANSITION` audit row, an idempotent re-call is `201`, any field change is `409`).
  Full suites green: **api unit 944** (72 files), api contract 4/4, api e2e (claim 5/5;
  the full suite's other 19 files unaffected), `npm audit` 0, `nest build` OK, web
  `typecheck` / `eslint` / `next build` OK, Playwright **rfq.spec.ts 18/18** (+1:
  registers a `NOTIFIED` claim) incl. `@a11y`. Migration `20260902180000` applied to
  `db` + `db-test`; `prisma validate` OK, `prisma migrate status` clean (**32**); no
  seed change.

**Part C #25 — Claim Documentation (Domain C, Process 25)**

- **Extends** `apps/api/src/modules/claim/` — `claim.service.ts` `attachDocuments()` +
  `documentationView()`, `claim.repository.ts` `attachDocuments()` +
  `recordStatusHistory()`, `claim.config.ts` (`CLAIM_DOC_TYPES`,
  `classifyInsuranceLine`, `mandatoryDocTypesFor`, `buildDocumentChecklist`,
  `claimDocumentAuditSnapshot`), a new `dto/attach-claim-documents.dto.ts`, and
  `POST /claims/:id/documents` on `claim.controller.ts`. Backlog: a mandatory document
  checklist per claim type (claim form / police report / medical report / photos /
  invoices / repair estimate / expert report).
- **No migration of its own, no seed change.** The `ClaimDocument` / `Document` models,
  the `DocumentCategory` / `DataClassification` enums, and the `claim.document`
  permission (`[CLAIMS_OFFICER]`) all pre-existed. Migration `20260902180000` (the #24
  `@@unique([claimId, toStatus])` on `ClaimStatusHistory`) additionally backstops the
  #25 best-effort `DOCUMENTATION_IN_PROGRESS` history-row write.
- **`POST /claims/:id/documents`** (`{ documents: [{ docType, classification, fileName,
  storageRef }] }`, `claim.document`/**Claims Officer**). Valid from `REGISTERED`
  onward — a `NOTIFIED` claim has no insurer reference to file against, so it is a
  `422` ("register it first"). `ClaimRepository.attachDocuments` writes, in **one
  `$transaction`** (documented local exception, like `createNotification`): one
  `Document` per file (`category: CLAIM`, `storageRef` pointer — never the bytes) and
  one `ClaimDocument` join carrying the claim-specific `docType`. A `medical_report`
  MUST be `HIGHLY_CONFIDENTIAL` (`claims-lifecycle.md` — health data is
  classification-driven from first contact; any other classification is a `422`).
- **The first attach best-effort advances `Claim REGISTERED →
  DOCUMENTATION_IN_PROGRESS`** through `WorkflowTransitionService.transition`, then
  writes the domain `ClaimStatusHistory` row via `ClaimRepository.recordStatusHistory`
  (idempotent — a `count()` pre-check + the `@@unique([claimId, toStatus])`
  backstop). Best-effort (logged, never thrown): `DOCUMENTATION_IN_PROGRESS` is a
  forward-progress marker, **not** a #20-style safety gate, so a failed advance is
  retried on the next attach. A later attach (already
  `DOCUMENTATION_IN_PROGRESS`+) does not re-transition. Documents can be filed at any
  status from `REGISTERED` (Part 4.2 — the electronic file grows throughout the
  lifecycle). The e2e asserts every `Claim` status move is an engine `TRANSITION` row.
- **The mandatory-document checklist per claim type** — `classifyInsuranceLine`
  (pure) maps the free-text `Policy.insuranceLine` to a broad line family
  (`property` / `motor` / `medical` / `liability` / `marine` / `other`) by keyword;
  `mandatoryDocTypesFor` maps each family (+ a `police_report` for any third-party
  loss, + a `claim_form` always) to a required `docType` set;
  `buildDocumentChecklist` derives the per-`docType` checklist (all 8 types),
  `documentationComplete` (every required type present), and
  `missingMandatoryDocuments`. **The classifier and the matrix are `ibms-app`
  product decisions, drafted, unsourced** — Part 3.7 lists the document *types* but no
  per-line matrix, and `insuranceLine` has no taxonomy. Same drafted-constant status
  as `CLAIM_LARGE_THRESHOLD_JOD` (#23), #16's 10 % / 2 pp, #22's constants.
  **Filed via `/brain-gap`** to `ibms-brain/meta/context/claims-lifecycle.md`
  (`ibms-brain` `0dfa33f`, pushed; submodule pin bumped in this commit).
- **`ClaimView`** gains `documents` (id / `docType` / category / classification /
  `fileName` / versionNumber / uploadedByUserId / createdAt — **no `storageRef`**),
  `documentChecklist`, `documentationComplete`, `missingMandatoryDocuments`. `fileName`
  is returned to an authorised `claim.read` holder (in-app claim data — the read is
  already logged as a sensitive-data access, #23); the audit `CREATE ClaimDocument`
  snapshot **excludes `fileName` and `storageRef`** (a claim doc filename can name an
  injured person — same rule as #18-19's `policyDocumentAuditSnapshot`).
- **A claim `Document` carries no `policyId`** — the `ClaimDocument` join is the
  canonical link; a future "full insurance file" view unions `Document WHERE policyId
  = X` with the claim documents.
- **No maker/checker** — filing documents is single-actor Claims work.
- **`apps/web/`** — `claim-api.ts` `attachClaimDocuments`; `ClaimSection.tsx` gains a
  per-claim `ClaimDocumentation` block (the checklist + a single-file attach form,
  Claims Officer, `canDocument={isClaims}`).
- **`@code-reviewer` (mandatory — a workflow transition + Highly Confidential data)**
  → **APPROVE WITH MINORS, no blockers, no MAJOR, no lex violation** (all six mandatory
  lex checks pass — every `Claim` status move through the engine; no money arithmetic; a
  `medical_report` is forced `HIGHLY_CONFIDENTIAL` and never logged; no maker/checker
  needed — filing is single-actor Claims work; no PDPL-registry SLA; the one-`REGISTERED`
  / one-`DOCUMENTATION_IN_PROGRESS` history invariant is the DB `@@unique`, not a
  check-then-act). MINORs fixed: (1) the best-effort `REGISTERED →
  DOCUMENTATION_IN_PROGRESS` advance now keys its resume off the **domain history row
  being absent** (`!statusHistory.some(h => h.toStatus === 'DOCUMENTATION_IN_PROGRESS')`),
  not `status === 'REGISTERED'` — a transition that committed but whose separate history
  write then threw is now backfilled on the next attach (only the transition is skipped
  when `status` is already `DOCUMENTATION_IN_PROGRESS`); (2) `classifyInsuranceLine`'s
  `property` branch regex `\b(propert|…)\b` could never match the bare word "property"
  (the `\b` between `t` and `y` fails) — changed to `\bpropert\w*`, so "Property",
  "Commercial Property", "Householder Property Owners" now classify `property`;
  (3) `attachDocuments` now emits the `READ` sensitive-data-access audit row (ids /
  counts only) that `get` / `list` emit — its response echoes every file's `fileName`
  plus `causeOfLoss` / third-party name. NITs fixed: (1) the best-effort warn message
  now says the advance "will retry on the next attach"; (2) `CLAIM_INCLUDE.documents`
  gets a secondary `{ id: 'asc' }` sort (one `$transaction` gives every `Document` the
  same `createdAt`). +5 spec tests cover the three MINORs.
- **Deferred**: the mandatory-document matrix + the `insuranceLine → family`
  classifier are drafted / unsourced (filed, above) — a Business Interruption claim
  (family `property`) inherits `photo` / `repair_estimate` rather than an accounts
  requirement (no "financial statements" `docType`); the checklist is surfaced but
  nothing yet **gates** on `documentationComplete` — the `DOCUMENTATION_IN_PROGRESS →
  UNDER_ASSESSMENT` move + that gate is Process 26; `Document.versionNumber` is always
  1 (no claim-doc version chain / re-upload); no delete (the schema's `deletionLocked`
  privileged-override path is unused); `claim.document` is role-level (no per-officer
  queue).
- **Verification**: +36 api unit — `claim.config.spec.ts` (+26 —
  `classifyInsuranceLine` across 16 line names incl. bare "Property" / "Commercial
  Property" / "Householder Property Owners" (the MINOR 2 regex fix);
  `mandatoryDocTypesFor` per family + third-party + never-`correspondence`;
  `buildDocumentChecklist` complete / missing / extra-non-required;
  `claimDocumentAuditSnapshot` carries no `fileName` / `storageRef`),
  `claim.service.spec.ts` (+10 — files + audits each `ClaimDocument` with no
  filename/ref + best-effort advance to `DOCUMENTATION_IN_PROGRESS`; the per-claim-type
  checklist + `documentationComplete`; `422` on a non-HC `medical_report`; a HC
  `medical_report` accepted; `422` on an attach while `NOTIFIED`; no re-transition on a
  later attach; the docs still file if the advance throws; `404` on an invisible claim;
  **the history row is backfilled on a later attach when the first attach transitioned
  but its history write threw** (MINOR 1); **a `READ` sensitive-data-access audit fires
  on the attach** (MINOR 3)). `test/claim.e2e-spec.ts` (+1 — a Claims
  Officer files documentation: `422` before registration, `403` for Placement, `422`
  for a non-HC `medical_report`, the first attach → `DOCUMENTATION_IN_PROGRESS` +
  exactly 2 `TRANSITION` rows, the checklist tracks `missingMandatoryDocuments`, the
  `Document` is `CLAIM` category with `policyId: null`, the `ClaimDocument` audit
  carries no `fileName` / `storageRef`, a second attach completes the checklist
  without re-transitioning). Full suites green: **api unit 980** (72 files), api
  contract 4/4, api e2e — `claim.e2e-spec.ts` 6/6 in isolation; full suite **118/119**,
  the single failure the pre-existing `enrollMfa` MFA-timing flake under full-suite
  load (this run on `cross-sell.e2e-spec.ts`; 400 on the TOTP enrol-verify — same class
  as the known `insurance-program` / `rbac` / `needs-assessment` flake, unrelated to
  #25 and passes on isolation). `npm audit` 0, `nest build` OK, web `typecheck` /
  `eslint` / `next build` OK, Playwright **rfq.spec.ts 19/19** (+1: files claim
  documentation) incl. `@a11y`. No new migration; `prisma validate` OK, `prisma migrate
  status` clean (**32**); no seed change.

**Part C #26 — Claim Assessment (Domain C, Process 26)**

- **Extends** `apps/api/src/modules/claim/` — `claim.service.ts` gains
  `recordAdjusterProgress()` / `submitForAssessment()` / `decideAssessment()` (+ the
  `recordHistoryBestEffort` / `backfillStatusHistory` / `toViewAudited` helpers),
  `claim.repository.ts` gains `recordAdjusterProgress()` (per-field `<field> IS NULL`
  `updateMany` — write-once, race-safe), `claim.config.ts` gains
  `CLAIM_ASSESSMENT_OUTCOMES`, `isAssessmentOutcome`, `deriveAssessmentView`,
  `adjusterAssessmentAuditSnapshot`, two new DTOs (`record-adjuster-progress.dto.ts`,
  `decide-claim-assessment.dto.ts`) and three routes on `claim.controller.ts`. Backlog:
  track survey/investigation completion, log every status change in its own record.
- **No migration, no seed change.** The `claim.assess` permission (`[CLAIMS_OFFICER]`),
  `Adjuster.surveyCompletedAt` / `investigationCompletedAt`, the `ClaimStatus`
  verdict values and the `WORKFLOW_TRANSITIONS.Claim` map (`DOCUMENTATION_IN_PROGRESS →
  UNDER_ASSESSMENT → APPROVED | PARTIALLY_APPROVED | DECLINED`) all pre-existed.
- **`POST /claims/:id/assessment/adjuster-progress`** (`{ surveyCompletedAt?,
  investigationCompletedAt? }`, `claim.assess`/**Claims Officer**) — stamps the loss
  adjuster's completion timestamps. Valid `REGISTERED` .. `UNDER_ASSESSMENT` (an
  adjuster exists from #24; once a verdict is recorded the phase is closed → 422). Each
  value is past-only (`parseHistoricalInstant`) and no earlier than the loss date;
  **write-once per field** — an identical re-send is a no-op, a different value is a
  `409` (no amend path). At least one field required (422 otherwise). Audit `UPDATE
  Adjuster` (ids + the two ISO timestamps, no claim narrative) + the `READ`
  sensitive-data-access row.
- **`POST /claims/:id/assessment/submit`** (`claim.assess`) — drives `Claim
  DOCUMENTATION_IN_PROGRESS → UNDER_ASSESSMENT` through
  `WorkflowTransitionService.transition`. **A hard safety gate on the
  mandatory-document checklist** (`claims-lifecycle.md` — "the checklist is what gates
  the move to insurer assessment"), **recomputed from the loaded `ClaimDocument` rows**
  at submit time (never a stored `documentationComplete` snapshot — the #16
  generalisation): a `422` names the missing docTypes. Idempotent — a re-call once
  already `UNDER_ASSESSMENT` backfills a missing `ClaimStatusHistory` row without
  re-transitioning; anything past `UNDER_ASSESSMENT` is a `422`.
- **`POST /claims/:id/assessment/decision`** (`{ outcome ∈ APPROVED |
  PARTIALLY_APPROVED | DECLINED }`, `claim.assess`) — drives `Claim UNDER_ASSESSMENT →
  <outcome>` through the engine and records only the *decision* (the four settlement
  figures are Process 28). **Gated on the loss adjuster having completed BOTH the
  survey and the investigation** — a **drafted, unsourced** `ibms-app` rule (Part 3.7
  tracks the completion data but does not say it blocks the verdict), same status as
  `CLAIM_LARGE_THRESHOLD_JOD` (#23) / the #25 checklist matrix / #16's 10 % / 2 pp.
  **Filed via `/brain-gap`** to `ibms-brain/meta/context/claims-lifecycle.md`
  (`ibms-brain` `d1dba95`, pushed; submodule pin bumped in this commit). The verdict is
  **write-once** — a different outcome once one is recorded is a `409` (a disputed
  verdict routes to Complaint Management, Process 42, not a status walk-back).
- **Every `Claim` status move goes through the engine** and also writes a domain
  `ClaimStatusHistory` row — the write is best-effort *after* the loud transition (the
  #24/#25 seam: the status can lead its history row by one failed call, reconciled by
  `backfillStatusHistory` on the next call). The e2e asserts the `TRANSITION` audit-row
  count grows 3 → 4 across submit → decision.
- **No maker/checker** — recording the insurer's verdict is single-actor Claims work,
  not the broker approving a payment (`maker-checker-segregation.md` § "what does NOT
  trigger this rule"). The mandatory second approver is at settlement (Process 28).
- **`ClaimView`** gains `assessment` (`surveyCompletedAt` / `investigationCompletedAt`
  / `adjusterWorkComplete` / `readyForAssessment` / `outcome`). The `READ`
  sensitive-data-access audit is also **retrofitted onto `register` (#24)** so every
  endpoint returning a full `ClaimView` logs the access uniformly.
- **`apps/web/`** — `claim-api.ts` `recordAdjusterProgress` / `submitClaimForAssessment`
  / `decideClaimAssessment`; `ClaimSection.tsx` gains a per-claim `ClaimAssessment`
  block (adjuster survey/investigation stamps, "Submit for assessment" disabled until
  the checklist is complete, a verdict `<select>` once `UNDER_ASSESSMENT`),
  `canAssess={isClaims}`.
- **`@code-reviewer` (mandatory — workflow transitions + a state machine + Highly
  Confidential data)** → **APPROVE WITH MINORS, no blockers, no MAJOR, no lex
  violation** (all six mandatory checks pass — no money arithmetic anywhere; every
  `Claim.status` move through the engine; no approval step exists and none is required
  — recording the insurer's verdict / an adjuster's completion dates / a
  submit-for-review is single-actor Claims work per `maker-checker-segregation.md`;
  no Highly Confidential field logged or put in an audit snapshot; no statutory SLA on
  `UNDER_ASSESSMENT`; the "one history row per status" invariant is the
  `@@unique([claimId, toStatus])` constraint). The four MINORs were robustness gaps
  where `decideAssessment` / the `recordAdjusterProgress` repo / `backfillStatusHistory`
  didn't harden the crash/concurrency seams as thoroughly as `submitForAssessment`
  already does — data integrity held in every case (the engine's status-conditional
  write + the `@@unique` constraint), so none was merge-blocking. Fixed:
  (1) `decideAssessment` now **backfills a missing `UNDER_ASSESSMENT` `ClaimStatusHistory`
  row** (via a shared `concludeIdempotently` helper + a `backfillStatusHistory` call
  before the verdict transition) — a `submit` whose best-effort history write failed
  no longer permanently gaps the analytics trail if the caller goes straight to the
  verdict; (2) `decideAssessment`'s `workflow.transition` is now wrapped like
  `submitForAssessment`'s — a concurrent decider that lost the engine race gets the
  clean idempotent-200 (same outcome) or `409` (different outcome), not the engine's
  raw `ConflictException`; (3) `ClaimRepository.recordAdjusterProgress` now returns
  `{ adjuster, wrote: { … } }` (the per-field `updateMany` count) so the service
  **409s a losing concurrent writer whose value differs** instead of feigning success;
  (4) `backfillStatusHistory` routes its write through `recordHistoryBestEffort` so a
  concurrent double-backfill that trips `@@unique` is swallowed as "already reconciled",
  not surfaced as a raw `P2002`/500. NIT: `isAssessmentOutcome` → `isAssessmentConcluded`
  (it returns true for `SETTLED`/`CLOSED` too — "phase over", not "is a verdict"). NIT
  noted for #28: `deriveAssessmentView.outcome` reverts to `null` at `SETTLED`, so the
  web Assessment sub-block hides a settled claim's verdict — a `TODO(#28)` comment left
  in `ClaimSection.tsx` (the verdict survives in `statusHistory` meanwhile). +8 spec
  tests for the four MINORs.
- **Deferred**: the adjuster-work gate on the verdict + the write-once semantics are
  drafted / unsourced (filed, above) — a desktop assessment with no site survey has no
  route past the gate today; no `Adjuster` stamp amend path; the `submit`/`decision`
  history-row seam matches #24/#25; no `Settlement` (Process 28); `DECLINED → CLOSED`
  and `→ SETTLED` are #28–29; no SLA timer on a claim in `UNDER_ASSESSMENT` (#27);
  `claim.assess` is role-level.
- **Also fixed here**: `claim.repository.ts` `CLAIM_INCLUDE.documents` secondary sort
  (the #25 NIT-2) had been added as an inline array literal under `as const`, which
  made it a `readonly` tuple `Prisma.ClaimInclude` rejects — `nest build` /
  `turbo typecheck` was red on `0fc3922`. Moved to a typed
  `CLAIM_DOCUMENTS_ORDER: Prisma.ClaimDocumentOrderByWithRelationInput[]` const; the
  full turbo `build` + `typecheck` are green again.
- **Verification**: +31 api unit — `claim.config.spec.ts` (+5 — `isAssessmentConcluded`,
  `deriveAssessmentView` readiness / adjuster-work / outcome derivation,
  `adjusterAssessmentAuditSnapshot`), `claim.service.spec.ts` (+26 —
  `recordAdjusterProgress` stamps / write-once 409 / no-op / 422 no-fields / 422
  before-loss / 422 no-adjuster / audit + **concurrent-writer 409 / matching-value
  no-op**; `submitForAssessment` 422 incomplete-docs / engine transition + history row
  / idempotent / backfill-on-failed-history-write / 422 wrong-status;
  `decideAssessment` 422 before-submit / 422 adjuster-work-incomplete / each of the
  three verdicts / idempotent + 409 on a different verdict + **`UNDER_ASSESSMENT`
  backfill after a failed `submit` history write** + **lost-decision-race → clean
  409**; `404` for an invisible claim on all three). `test/claim.e2e-spec.ts` (+1 —
  adjuster progress, the checklist gate blocking `submit`, `403` for a Placement
  officer, the write-once `409`, `submit` once complete → `UNDER_ASSESSMENT` + 3
  `TRANSITION` rows, idempotent submit, `decision` → `PARTIALLY_APPROVED` + 4
  `TRANSITION` rows, `409` on a second verdict, `422` on adjuster progress after the
  verdict, and a second claim proving the adjuster-work gate blocks `decision`). Full
  suites green: **api unit 1007** (72 files), api contract 4/4, `claim.e2e-spec.ts`
  7/7 in isolation, **full api e2e 120/120** (20 files, no flake — a confirming run
  after the review fixes was clean); `npm audit` 0, full turbo `build` + `typecheck`
  OK, web `typecheck` / `eslint` OK, Playwright **rfq.spec.ts 20/20** (+1: tracks the
  adjuster survey / submits / records the verdict) incl. `@a11y`. No new migration;
  `prisma validate` OK, `prisma migrate status` clean (**32**); no seed change.

**Part C #27 — Claim Follow-up (Domain C, Process 27)**

- **Extends** `apps/api/src/modules/claim/` — a new `claim-followup.scheduler.ts`
  (`@Cron`), `claim.service.ts` `runFollowUpScan()` + `resolveFollowUpAlert()`,
  `claim.repository.ts` `findClaimsAwaitingInsurerResponse()` /
  `findOpenFollowUpAlertsForRespondedClaims()` / `raiseFollowUpAlert()` /
  `resolveFollowUpAlert()`, `claim.config.ts` (`CLAIM_AWAITING_INSURER_STATUSES`,
  `followUpThresholdDaysFor`, `isClaimFollowUpDue`, `deriveFollowUpView`,
  `claimFollowUpAlertAuditSnapshot`), two new routes on `claim.controller.ts`, and a
  new shared `apps/api/src/common/follow-up.util.ts` (`isFollowUpDue` moved here from
  `rfq.config.ts`, which now re-exports it). Backlog: an automated alert job once the
  insurer non-response threshold is exceeded (configurable per line).
- **Migration `20260902190000_claim_followup_alert_one_open`** — a partial `UNIQUE
  ("claimId") WHERE "resolvedAt" IS NULL` on `ClaimFollowUpAlert` (at most one
  unresolved alert per claim; Prisma cannot express the `WHERE`, hand-authored) + a
  plain `@@index([claimId])`. The `ClaimFollowUpAlert` model, the
  `Claim.followUpAlertThresholdDays` column (`@default(9)`) and the
  `claim.followup.manage` permission (`[CLAIMS_OFFICER]`) all pre-existed. **No seed
  change.**
- **The sweep** — `ClaimFollowUpScheduler` (`@Cron` 07:00 UTC, after the 06:00 RFQ
  follow-up sweep) and an on-demand **`POST /claims/follow-up-sweep`**
  (`claim.followup.manage`; returns counts only, no claim content) both call
  `ClaimService.runFollowUpScan`. Two passes, per-row isolated so one bad row does not
  abandon the run (the `CrossSellDetectionScheduler` shape):
  1. **Raise** — for every claim in a pre-verdict status (`REGISTERED` /
     `DOCUMENTATION_IN_PROGRESS` / `UNDER_ASSESSMENT`) whose business-day
     `followUpAlertThresholdDays` has elapsed since its `REGISTERED`
     `ClaimStatusHistory.changedAt`, and which has no open `ClaimFollowUpAlert`, create
     one. `raiseFollowUpAlert` = `create` + `P2002` → `created: false` — the partial
     `UNIQUE` is the race gate, so a concurrent sweep is counted `skippedAlreadyAlerted`,
     never `failed`.
  2. **Resolve** — for every open alert whose claim has since moved past the pre-verdict
     stage (the insurer responded), stamp `resolvedAt` via a conditional `updateMany`
     (0 rows = a concurrent resolve — race-safe).
- **The clock** is a single clock from the `REGISTERED` `ClaimStatusHistory.changedAt`
  (registration = submission to the insurer, per the #24 note) — **not** reset when the
  claim advances to `UNDER_ASSESSMENT`.
- **The threshold is per broad line family** — `followUpThresholdDaysFor` maps the
  free-text `Policy.insuranceLine` (via `classifyInsuranceLine`) to `motor` 7 /
  `property` 10 / `medical` 7 / `liability` / `marine` 15 / else 9 (the Part 3.7
  worked-example figure). **Drafted, unsourced** — no per-line table in Part 3.7, no
  line taxonomy; same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23) / the #25 checklist
  matrix / #16's 10 % / 2 pp. **`/brain-gap` filed** (ibms-brain `8618f29`). The value
  is **snapshotted onto `Claim.followUpAlertThresholdDays` at notification** (Process
  23's `notify` now sets it from the policy line family) so a later taxonomy change
  does not retroactively shift live claims — the sweep reads the column.
- **`POST /claims/:id/follow-up-alerts/:alertId/resolve`** (`claim.followup.manage`) —
  a Claims Officer manually resolves an open alert (they chased the insurer). The
  claim's own status is **not** touched — an alert is an accountability nudge, not a
  lifecycle state. Idempotent (an already-resolved alert / a lost concurrent resolve is
  a no-op); an alert id not on this claim is a `404`.
- **No maker/checker** — raising / resolving an insurer-chase alert is single-actor
  operational work.
- **`ClaimView`** gains `followUp` (`followUpAlerts` — id / `triggeredAt` /
  `resolvedAt`; `followUpAlertOpen`; `followUpAlertThresholdDays`;
  `awaitingInsurerResponse`; `awaitingInsurerSince` = the `REGISTERED` clock start).
- **Audit** — `CREATE` / `UPDATE ClaimFollowUpAlert` carries ids + the threshold + the
  clock timestamps + `resolvedBy` (`sweep` / `manual`), never any claim narrative.
- **`apps/web/`** — `claim-api.ts` `runClaimFollowUpSweep` / `resolveClaimFollowUpAlert`;
  `ClaimSection.tsx` gains a section-level "Run follow-up sweep" button (Claims Officer)
  and a per-claim `ClaimFollowUp` block showing any open alert with a "Resolve" button,
  `canFollowUp={isClaims}`.
- **`@code-reviewer` (mandatory — a scheduled job + a migration + Highly Confidential
  data)** → **APPROVE WITH MINORS, no blocker, no MAJOR, no lex violation** (all six
  mandatory checks pass — no money; the sweep / raise / resolve / manual endpoint never
  write `Claim.status` and `ClaimFollowUpAlert` has no `status`; no approval step and
  none required per `maker-checker-segregation.md`; the audit snapshot + scheduler logs
  carry ids / counts / timestamps only, and `resolveFollowUpAlert` routes its
  full-`ClaimView` response through `toViewAudited` → the `READ`
  `isSensitiveDataAccess` row; the SLA is a real business-day timer + `@Cron`
  escalation job, not a comment). The raise/resolve race handling was called out as "a
  textbook application of `race-safe-invariants.md`" (partial `UNIQUE` + `create`/`P2002`,
  the pre-check kept only as a fast-path; status-conditional `updateMany` for resolve).
  Six MINORs (all observability / maintainability / test-hygiene) fixed:
  (1) `findClaimsAwaitingInsurerResponse`'s return type now declares the filtered
  `followUpAlerts: { where: { resolvedAt: null } }` shape it actually returns;
  (2) a pre-verdict claim with **no `REGISTERED` `ClaimStatusHistory` row** (the #24
  seam) now falls back to its earliest known instant (fires earlier — the safe
  direction) **+ a `logger.warn`** so a genuinely stuck claim is still chased and ops
  can see the gap, rather than a silent `continue`; (3) a sweep that hits
  `FOLLOWUP_SWEEP_LIMIT` (either candidate query) now **`logger.warn`s** instead of
  silently truncating a compliance sweep; (4) `ibms-brain/meta/lex/pdpl-sla-timers.md`'s
  "Claim follow-up" registry row reconciled with the new per-line-family table + flagged
  drafted/unsourced (brain `155b233`); (5) the repo's `AWAITING_INSURER_STATUSES` is now
  exported and a `claim.config.spec.ts` test asserts it stays equal to the config's
  `CLAIM_AWAITING_INSURER_STATUSES` (the two are hand-duplicated to avoid a
  repo→module import); (6) the e2e's raw `prisma.claim.update({ status: 'DECLINED' })`
  gained a comment marking it a deliberate shortcut (the auto-resolve pass only reads
  `claim.status`; the #26 e2e covers the real chain). NIT: the web `ClaimFollowUp`
  block dropped its dead multi-alert plural branch (one open alert per claim is a DB
  invariant). +4 spec tests (the two status-set sync assertions + the fallback-warn +
  the cap-warn).
- **Deferred**: the per-line threshold map + the classifier are drafted / unsourced
  (filed, above); the clock is one clock from `REGISTERED` (a per-status clock is a
  possible refinement); auto-resolve happens on the **next sweep** after the claim
  progresses, not the instant a verdict lands (`followUp.followUpAlertOpen` can be
  stale for up to a day; `awaitingInsurerResponse` already reads false, and there is a
  `TODO(#28)` note in `ClaimSection.tsx` about a settled claim's verdict visibility);
  the sweep is a global scan (`FOLLOWUP_SWEEP_LIMIT = 1000`, no pagination); no
  escalation ladder (one open alert per claim; a still-stuck claim needs a human);
  `ClaimFollowUpAlert` has no `resolvedByUserId` scalar (the actor is on the audit
  row); `claim.followup.manage` is role-level.
- **Verification**: +41 api unit — `claim.config.spec.ts` (+21 —
  `followUpThresholdDaysFor` per family, `isClaimFollowUpDue` business-day math + the
  non-positive-threshold guard, `deriveFollowUpView` open/awaiting/pass-through,
  `claimFollowUpAlertAuditSnapshot` raise + resolve shapes, **the
  `CLAIM_AWAITING_INSURER_STATUSES` ↔ repo `AWAITING_INSURER_STATUSES` sync
  assertion** — review MINOR 5), `claim.service.spec.ts` (+12 — `runFollowUpScan`
  raises + audits / not-yet-due / already-alerted / `P2002`-loss / auto-resolve /
  per-row isolation / **the no-`REGISTERED`-row fallback + warn** (MINOR 2) / **the
  `FOLLOWUP_SWEEP_LIMIT` warn** (MINOR 3); `resolveFollowUpAlert` resolve + audit /
  `404` wrong alert / idempotent already-resolved / `404` invisible claim),
  `claim-followup.scheduler.spec.ts` (+5 — missing system account / delegates /
  scan-throws / logs a summary / stays quiet), `common/follow-up.util.spec.ts` (+3).
  `test/claim.e2e-spec.ts` (+1 — an overdue pre-verdict claim: `403` for Sales, the
  sweep raises exactly one alert, a second sweep raises none (partial `UNIQUE`), the
  audit carries no narrative, the claim progresses → a sweep auto-resolves it, then a
  fresh claim is manually resolved (`403` for Sales; a wrong alert id → `404`)). Full
  suites green: **api unit 1048** (74 files), api contract 4/4, `claim.e2e-spec.ts`
  8/8 in isolation, **full api e2e 121/121** (20 files, no flake — a confirming run
  after the review fixes was clean); `npm audit` 0, full turbo `build` OK, web
  `typecheck` / `eslint` OK, Playwright **rfq.spec.ts 21/21** (+1: raises + resolves a
  follow-up alert) incl. `@a11y`. `prisma validate` OK, `prisma migrate status` clean
  (**33**); no seed
  change.

**Part C #28 — Claim Settlement (Domain C, Process 28)**

- **Extends** `apps/api/src/modules/claim/` — `claim.config.ts`
  (`CLAIM_SETTLEABLE_STATUSES`, `computeNetSettlement`, `isSecondApproverRequired`,
  `deriveSettlementView`, `settlementAuditSnapshot`), `claim.service.ts`
  (`recordSettlement` / `secondApproveSettlement` / private `settleCore`),
  `claim.repository.ts` (`createSettlement` / `recordSettlementSecondApproval`,
  `settlement: true` folded into `CLAIM_INCLUDE`), a new `dto/record-settlement.dto.ts`,
  two new routes on `claim.controller.ts`. Backlog: always four distinct figures
  (estimated / approved / deductible / net — never collapsed into one number); a
  mandatory second approver for large claims (`isLargeClaim`) and any claim payment the
  broker processes.
- **Migration `20260902200000_settlement_broker_processed_payment`** — adds only
  `Settlement.brokerProcessedPayment BOOLEAN NOT NULL DEFAULT false` (the "any claim
  payment the broker processes" trigger, `IF NOT EXISTS`, hand-authored + `migrate
  deploy` to `db` + `db-test`). The `Settlement` model, all four `Settlement` `Decimal`
  money fields (already classified in `money-fields.inventory.ts`), the
  `Settlement_maker_checker_distinct` CHECK (`20260826091424`,
  `secondApproverUserId IS NULL OR approvedByUserId IS NULL OR secondApproverUserId <>
  approvedByUserId`), the `WORKFLOW_TRANSITIONS.Claim` `APPROVED` /
  `PARTIALLY_APPROVED → SETTLED` edges, and the `claim.settle.approve`
  (`[CLAIMS_OFFICER, MANAGER]`) / `claim.settle.second-approve` (`[MANAGER, FINANCE]`)
  permissions all already existed. **No seed change.**
- **`POST /claims/:id/settlement`** (`{ approvedAmount, deductible,
  brokerProcessedPayment? }`, `claim.settle.approve`) — valid only from `APPROVED` /
  `PARTIALLY_APPROVED` (422 otherwise, message distinguishes "record the verdict first"
  from "already done").
  - **Four distinct figures, never collapsed** — `estimatedLoss` is carried from
    `Claim.estimatedLoss`; `approvedAmount` + `deductible` are the only inputs;
    **`netSettlement` is ALWAYS `approvedAmount − deductible` computed server-side**
    (`subtractMoney`, fils-quantized) — the DTO does not even accept a `netSettlement`
    field.
  - **Hard bounds** — `approvedAmount > 0`; `approvedAmount ≤ estimatedLoss` (422 — an
    insurer cannot approve more than the claimed amount); `deductible ≥ 0`;
    `deductible ≤ approvedAmount` (422 — net cannot go negative).
  - **The recorder of the four figures IS the first approver**
    (`Settlement.approvedByUserId = actor`). Recording is **write-once**: a
    byte-identical re-`POST` (all figures + `brokerProcessedPayment` equal via
    `compareMoney`) is a 200 no-op / resume; any changed figure is a 409; a concurrent
    create hits `claimId @unique` → `P2002` → 409.
- **The second-approver gate** is re-derived from **live data**, never from the
  notification-time `Claim.isLargeClaim` snapshot: `isSecondApproverRequired` =
  `approvedAmount ≥ CLAIM_LARGE_THRESHOLD_JOD` (the **same drafted, unsourced**
  `'25000.000'` #23 uses for `isLargeClaim`, applied to the *approved* figure) **OR**
  `Settlement.brokerProcessedPayment === true`.
  - Neither → `POST /settlement` drives `Claim → SETTLED` straight through.
  - Either → the claim holds at its verdict status until
    **`POST /claims/:id/settlement/second-approve`** (`claim.settle.second-approve` /
    **Manager or Finance**) — **maker/checker**
    `assertDifferentActors(approvedByUserId, actor)` (403) + the DB CHECK; a
    status-conditional `recordSettlementSecondApproval` `updateMany` (0 rows → 409); a
    *different* second approver on an already-approved settlement → 409, the *same* one
    → an idempotent `settleCore` resume; 422 if the settlement does not actually need a
    second approver.
- **`settleCore` structurally re-checks the second approval at the `→ SETTLED` write** —
  it refuses to walk a claim whose live `Settlement` `isSecondApproverRequired(...)` is
  true while `secondApproverUserId IS NULL`, regardless of how it was reached
  (record-settlement and second-approve are separate writes and the engine map allows
  `APPROVED` / `PARTIALLY_APPROVED → SETTLED` unconditionally — the #22 "APPLY must
  re-check approval structurally" generalisation). The `Claim → SETTLED` move goes
  through `WorkflowTransitionService.transition`; a best-effort domain
  `ClaimStatusHistory` row follows (the #24–27 seam, backfilled on the next call). The
  e2e asserts exactly **5** `TRANSITION` audit rows across the #23→#28 chain
  (`REGISTERED`, `DOCUMENTATION_IN_PROGRESS`, `UNDER_ASSESSMENT`, the verdict, `SETTLED`).
- **`Settlement` is not a `WorkflowTransitionService` entity** (no `status` — its
  lifecycle is the parent `Claim`'s), same shape as `Adjuster` / `ClaimDocument` /
  `ThirdPartyClaimant` / `ClaimFollowUpAlert`.
- **`ClaimView`** gains `settlement` (`estimatedLoss` / `approvedAmount` / `deductible` /
  `netSettlement` / `brokerProcessedPayment` / `approvedByUserId` /
  `secondApproverUserId` / `secondApproverRequired` — re-derived in the view, not stored
  — / `settled`), or `null` before a settlement is recorded.
- **Audit** — `CREATE` (record) / `APPROVE` (second-approve) `Settlement` snapshots the
  four figures as fixed strings + `brokerProcessedPayment` + the maker/checker ids +
  `secondApproverRequired`, **never the claim narrative**; both endpoints also emit the
  `READ` `isSensitiveDataAccess` row `get` / `list` emit (the full `ClaimView` response
  echoes `causeOfLoss` / `documents[].fileName` / the third-party name).
- **`apps/web/`** — `claim-api.ts` `recordClaimSettlement` / `secondApproveClaimSettlement`
  + the `Claim.settlement` type; `ClaimSection.tsx` gains a per-claim `ClaimSettlement`
  block — a four-figure record form (`approvedAmount` / `deductible` inputs + a
  broker-processed checkbox, `canSettle = isClaims || isManager`), a read-only
  four-figure display, and a "Second-approve settlement" button
  (`canSecondApproveSettlement = isManager || isFinance`, shown only while a second
  approver is required and none is recorded). `opportunities/[id]/page.tsx` wires
  `isFinance` (`FINANCE_COLLECTIONS_OFFICER`).
- **`/brain-gap` filed** (ibms-brain `1999311`): `claims-lifecycle.md` § "The rules that
  aren't obvious" — the four-figures row gains a Process 28 sub-point (net is always
  computed, never an input; the two hard bounds; the recorder is the first approver;
  write-once) and the "large / broker-processed needs a second approver" row gains the
  live-re-derived threshold, the `brokerProcessedPayment` trigger, the
  `assertDifferentActors` + DB CHECK pair, and the `settleCore` structural re-check.
- **`@code-reviewer` (mandatory — money arithmetic + maker/checker + Highly Confidential
  data + a migration)** → **APPROVE WITH MINORS, no blocker, no MAJOR, no lex violation**
  (all six mandatory checks pass — money is `Decimal` end-to-end through `money.util.ts`
  with no float / `parseFloat` / `round`; the only `Claim.status` write is the engine
  `transition({ toStatus: 'SETTLED' })` in `settleCore` and `Settlement` correctly has
  no `status`; maker/checker = the app guard + the DB CHECK + two distinct identities +
  the status-conditional `updateMany` + the structural re-check at `→ SETTLED`, and
  `claim.settle.second-approve` is not granted to `CLAIMS_OFFICER`; the audit snapshot +
  logs carry ids / `formatMoney` strings / booleans only; settlement has no statutory
  SLA). No crash/concurrency window to `SETTLED`-unapproved was found. Two MINORs
  (crash-recovery-seam robustness, integrity preserved either way) fixed: (1)
  `recordSettlement`'s byte-identical re-post now resumes a stuck-but-fully-approved
  settle for **any** `claim.settle.approve` holder — `settleCore` is called whenever the
  second approval is satisfied (not required, or already recorded), not only when a
  second approver was never required, so recovery is no longer bottlenecked on the one
  user who happened to second-approve; (2) `secondApproveSettlement` no longer coalesces
  a missing first approver to `'' === actor.id` (which would silently pass the
  maker/checker guard) — a `Settlement` with a null `approvedByUserId` now throws a 409.
  NIT fixed: an `isSettleableStatus(status)` helper in `claim.config.ts` (mirrors
  `isAssessmentConcluded`) replaces the repeated `(CLAIM_SETTLEABLE_STATUSES as readonly
  string[]).includes(...)` cast at three sites. NIT noted, not taken: the web
  "Second-approve settlement" button still renders for a Manager who was the first
  approver (clicking it returns a clear 403) — hiding it needs the current user id
  threaded through `ClaimSection`, which the single-identity Playwright auth mock cannot
  exercise; the server-side guard is the real enforcement. +2 unit tests for the MINORs.
- **Deferred**: `CLAIM_LARGE_THRESHOLD_JOD` (25,000) is drafted / unsourced (filed,
  above); the four figures are write-once (no amend path — a corrected settlement needs
  a future endpoint, a disputed one routes to Complaint Management, Process 42);
  `brokerProcessedPayment` is set once at record time and not re-evaluated; **no payment
  execution** — `Settlement` records the decision + the four figures, the actual
  disbursement, `ThirdPartyClaimant.recoveryAmount` / subrogation, and `Claim → CLOSED`
  are Processes 29–30; Loss Ratio / Claims Analytics (#29) still not fed; the
  record-then-second-approve seam is two writes (a crash between the `Settlement` create
  and a straight-through `→ SETTLED` leaves the settlement recorded with the claim at
  its verdict status until the next byte-identical `POST /settlement` resumes it —
  `settleCore`'s structural re-check is the backstop); `claim.settle.approve` /
  `claim.settle.second-approve` are role-level (no per-officer queue); no SLA timer on a
  recorded-but-unsettled claim.
- **Verification**: +9 api unit — `claim.config.spec.ts` (+7 — `CLAIM_SETTLEABLE_STATUSES`
  / `isSettleableStatus`, `computeNetSettlement` worked example (17,500 − 2,500 = 15,000)
  + trailing-decimal + net-zero, `isSecondApproverRequired` large / broker / neither,
  `deriveSettlementView` null / money strings / re-derived gate / `settled` flag,
  `settlementAuditSnapshot` four fixed strings + no narrative), `claim.service.spec.ts`
  (+? — straight-through settle + net compute, broker-processed blocks the
  straight-through settle, 422 wrong status / approved > estimated / deductible >
  approved / approved zero, 409 different figures, byte-identical re-post resume
  (**review MINOR 1** — any approver can drive it once the second approver is recorded),
  404 invisible; `secondApproveSettlement` → `SETTLED` + `APPROVE` audit, 403
  self-approval, 409 another user, idempotent same approver, 422 not-required, 404 no
  settlement, 409 concurrent 0-rows, **fails loudly on a null first approver — review
  MINOR 2**; `settleCore` structural refuse). `test/claim.e2e-spec.ts` (+1 — a small
  claim: `403` for Sales, `422` approved > estimated, `POST /settlement` → `SETTLED` with
  all four figures + `secondApproverRequired: false`, `409` on a changed-figure re-post,
  exactly 5 `TRANSITION` rows, the `Settlement` audit carries `17500.000` not the claim
  narrative; a large claim (estimated 40,000, `PARTIALLY_APPROVED`): `POST /settlement`
  (approved 30,000) → still `PARTIALLY_APPROVED` + `secondApproverRequired: true`, the
  first approver's `second-approve` → `403`, a distinct Manager → `SETTLED` with
  `secondApproverUserId` set, DB `approvedByUserId <> secondApproverUserId`). Full suites
  green: **api unit 1073** (74 files), **claim.e2e-spec.ts 9/9** in isolation, **full api
  e2e 121/122** (the 1 fail = the known full-suite-load flake — this run a 30 s `boot()`
  timeout in `up-sell.e2e-spec.ts` setup, which passes **8/8 in isolation**; `claim`
  changes are `claim`-module-only); full turbo `build` +
  `typecheck` OK, api / web `eslint` OK, Playwright **rfq.spec.ts 23/23** (+2: small
  settlement straight through / large settlement needs a distinct second approver) incl.
  `@a11y`. `prisma validate` OK, `prisma migrate status` clean (**34**); no seed change.
  `npm audit` reports **1 moderate** transitive `qs` advisory (`GHSA-x5fp-wj9c-mxmx` /
  `GHSA-4mjr-xmp4-gh2g`, published after #27) — **not introduced here**: no
  `package.json` / `package-lock.json` change in this item; tracked under § Security for
  a dependency-bump pass.

**Part C #29 — Claim Closure (Domain C, Process 29)**

- **Extends** `apps/api/src/modules/claim/` — `claim.config.ts` (`SettlementView`
  gains `clientPaymentConfirmedAt`), `claim.service.ts` (`closeClaim` + private
  `closeCore`; `ClaimView.closedAt`; the `LossRatioService` dependency),
  `claim.repository.ts` (`confirmSettlementPayment` — a write-once status-conditional
  `updateMany`), a new `dto/close-claim.dto.ts`, one new route on `claim.controller.ts`.
  **Plus a small new `apps/api/src/modules/loss-ratio/`** (`LossRatioModule` →
  `LossRatioService`, `loss-ratio.config.ts`'s pure `computeLossRatio` /
  `lossRatioAuditSnapshot`) + `apps/api/src/repositories/loss-ratio.repository.ts`.
  Backlog: formal closure after the client's receipt of payment is confirmed; triggers a
  Loss Ratio recompute.
- **No migration, no seed change** — the `claim.close` permission (`[CLAIMS_OFFICER]`),
  `ClaimStatus.CLOSED`, the `WORKFLOW_TRANSITIONS.Claim` `SETTLED → CLOSED` /
  `DECLINED → CLOSED` edges, `Settlement.clientPaymentConfirmedAt`, and the `RenewalCase`
  / `LossRatio` models (migrated in `20260825124114`) all already existed.
- **`POST /claims/:id/closure`** (`{ clientPaymentConfirmedAt? }`, `claim.close` /
  **Claims Officer**) — **no maker/checker** (single-actor Claims work; the mandatory
  second approver is at settlement, #28).
  - **`SETTLED → CLOSED` is gated on the client's payment receipt.**
    `clientPaymentConfirmedAt` is supplied in the body, stamped **write-once** on the
    `Settlement` (a `updateMany({ where: { id, clientPaymentConfirmedAt: null } })`),
    parsed past-only (`parseHistoricalInstant`) and **no earlier than the loss date** (a
    tighter "after the `Settlement` was recorded" bound is deliberately not enforced —
    data-entry lag between a real payment and its capture is normal, the #21
    `deliveredAt` latitude). Closing without it → **422**; a *different* instant once one
    is recorded → **409**; a byte-identical re-close resumes a stuck close.
  - **`DECLINED → CLOSED` is direct** — a declined claim has no payout, so a
    `clientPaymentConfirmedAt` on a declined claim → **422**.
  - Any other status → **422**; an already-`CLOSED` claim is a **200 no-op** that does
    **not** re-fire the recompute.
- **`closeCore`** drives the engine transition (+ a best-effort domain
  `ClaimStatusHistory` row — the #24–28 seam; a concurrent close normalises to an
  idempotent no-op), then **only the call that actually transitioned the claim**
  best-effort triggers `LossRatioService.recomputeForPolicy` (logged, never thrown —
  closure has committed; the recompute is a downstream input, not a gate). The e2e
  asserts exactly **6** `TRANSITION` audit rows across the #23→#29 chain.
- **`LossRatioService.recomputeForPolicy(policyId)`** — `LossRatio` is
  **renewal-case-scoped** (`renewalCaseId @unique`), so this recomputes and upserts the
  `LossRatio` for the policy's open `RenewalCase`. **The renewal module (Part 3.9) is not
  built, so no policy has a `RenewalCase` — it is a logged no-op today.** A standalone
  per-claim / per-policy loss ratio is deliberately **not** created; the closed claim's
  `CLOSED` `ClaimStatusHistory` row is the durable trigger the renewal workflow will
  recompute from.
  - `computeLossRatio` (pure) — `periodClaims` = Σ `Settlement.netSettlement` over the
    policy's `SETTLED` / `CLOSED` claims (a `DECLINED` claim contributes 0);
    `periodPremium` = `Policy.issuedPremium ?? requestedPremium`; `ratio` =
    `periodClaims ÷ periodPremium` quantized to 4 dp (`ROUND_HALF_UP`; a zero premium →
    a zero ratio, never a divide-by-zero). All money via `money.util.ts` (`addMoney`);
    the ratio via `Prisma.Decimal.div().toDecimalPlaces(4, ROUND_HALF_UP)`.
  - **The "period" is drafted / unsourced** — computed all-time for the policy; the
    renewal module will narrow it to the policy year (same status as
    `CLAIM_LARGE_THRESHOLD_JOD` / the #25 checklist matrix / #16's 10 % / 2 pp).
- **`ClaimView`** gains `closedAt` (the `CLOSED` `ClaimStatusHistory.changedAt`, or
  `null`) and `settlement.clientPaymentConfirmedAt`.
- **Audit** — the engine `TRANSITION` row + an `UPDATE Settlement` row when
  `clientPaymentConfirmedAt` is stamped (ids + the ISO timestamp, no narrative) + an
  `UPDATE LossRatio` row per real recompute (ids + the three figures as fixed strings +
  the trigger `claim-closed` + the closed claim id); every closure also emits the `READ`
  `isSensitiveDataAccess` row `get` / `list` emit.
- **`apps/web/`** — `claim-api.ts` `closeClaim`; `ClaimSection.tsx` gains a per-claim
  `ClaimClosure` block (a "Client received the settlement payment on" date input +
  "Confirm payment & close claim" for a `SETTLED` claim, a "Close claim" button for a
  `DECLINED` one, a read-only "Closed …" line once `CLOSED`), `canClose={isClaims}`.
- **`/brain-gap` filed** (ibms-brain `194888c`): `claims-lifecycle.md` — a new Claim
  Closure (Process 29) bullet + the Loss Ratio bullet extended (renewal-case-scoped
  upsert, the logged no-op, `periodClaims` / `periodPremium` / the drafted "period").
- **`@code-reviewer` (mandatory — money arithmetic + a workflow transition + Highly
  Confidential data)** → **APPROVE WITH MINORS, no blocker, no MAJOR, all six mandatory
  lex checks pass** (money is `Decimal` end-to-end through `money.util.ts` — no float /
  `parseFloat` / `Number()` / `Math.round`, and `.toFixed(4)` is `Decimal.prototype.toFixed`
  string format; the only `Claim.status` write is the engine `transition({ toStatus:
  'CLOSED' })` and `CLOSED` is reachable in `WORKFLOW_TRANSITIONS.Claim` only from
  `SETTLED` / `DECLINED`; `confirmSettlementPayment` is a status-conditional `updateMany`
  + reload-and-compare, `upsertLossRatio` leans on `renewalCaseId @unique`; closure is
  single-actor by design per `maker-checker-segregation.md`; every path returns via
  `toViewAudited` → the `READ` `isSensitiveDataAccess` row, and no audit `afterValue` /
  log line carries claim narrative). The "only the actual transitioner fires the
  recompute" property was confirmed to hold. Three MINORs (robustness / observability /
  coverage in the new `loss-ratio` module) fixed: (1) **`computeLossRatio` clamps the
  ratio at `999.9999`** (the `LossRatio.ratio @db.Decimal(7, 4)` column max) and returns
  `ratioCapped` — surfaced into the recompute result + audit row + a `logger.warn` — so
  an all-time claims total that runs a four-figure multiple of a cheap premium cannot
  make the upsert throw once renewal is wired; (2) **`LossRatioService` now audits
  best-effort** (`recordAuditBestEffort` — a `logger.error`, no rethrow) so a transient
  audit failure after the `LossRatio` row has committed does not surface at the caller
  as a false "the recompute did not run"; (3) **the claim `#29` e2e now creates a
  `RenewalCase`** so the closure drives a *real* recompute — `loadPolicyForRecompute` +
  `computeLossRatio` + `upsertLossRatio` + the audit are now exercised against a real DB
  (asserts one `LossRatio` row with `periodClaims` = the net settlement, `periodPremium`
  = the policy premium, `ratio` = claims ÷ premium at 4 dp, + one `UPDATE LossRatio`
  audit row with no narrative). NIT fixed: dropped "open `RenewalCase`" (it is 1:1 with
  the `Policy`; a `TODO(renewal)` now marks that the renewal module owns any real status
  predicate). NITs noted, not taken: re-closing an already-`CLOSED` claim with a
  *different* `clientPaymentConfirmedAt` is a 200 no-op not a 409 (the brain sanctions
  "already-`CLOSED` = 200 no-op"; the stored value is write-once and unchanged); the
  `dto.clientPaymentConfirmedAt?.trim()` guard is belt-and-braces over `@IsISO8601`.
- **Deferred**: `computeLossRatio`'s all-time "period" is drafted (filed, above) — the
  renewal module owns the policy-year window, and whether a `RenewalCase` in a terminal
  status still receives recomputes (`TODO(renewal)`); `Settlement.clientPaymentConfirmedAt`
  is write-once with no correction path; **no payment execution / disbursement** (the
  money movement + `ThirdPartyClaimant.recoveryAmount` / subrogation are Finance / a
  later process); a `CLOSED` claim is terminal (no reopen edge); `claim.close` is
  role-level; no SLA timer on a SETTLED-but-unclosed claim.
- **Verification**: +23 api unit — new `loss-ratio.config.spec.ts` (9 — `computeLossRatio`
  worked example (15,000 + 5,000 ÷ 40,000 → 0.5000), empty / null-filtered nets,
  ROUND_HALF_UP 4 dp, zero-premium → zero ratio, **the `999.9999` cap + `ratioCapped`
  flag** — review MINOR 1, a fitting ratio not flagged; `lossRatioAuditSnapshot` fixed
  strings + `ratioCapped`), new `loss-ratio.service.spec.ts` (4 — policy-not-found /
  no-renewal-case no-ops with no upsert + no audit; recompute + upsert + `UPDATE
  LossRatio` audit when a `RenewalCase` exists; **`recomputed: true` still returned when
  the audit write throws after the row committed** — review MINOR 2),
  `claim.service.spec.ts` (+10 — 422 close-without-confirm, close stamps the settlement +
  `→ CLOSED` + `closedAt` + fires the recompute once, 422 confirm predates the loss date,
  stuck-close 409-on-different / resume-on-identical, DECLINED closes directly + fires the
  recompute, 422 confirm on a DECLINED claim, 422 wrong status, already-CLOSED 200 no-op
  does not re-fire, 404 invisible, closure survives a throwing recompute).
  `test/claim.e2e-spec.ts` (+1 — `#29`: a small claim to SETTLED, `403` for Sales, `422`
  close-without-confirm, `422` confirm before the loss, close with a valid
  `clientPaymentConfirmedAt` → `CLOSED` + `closedAt` + the stamp on the settlement + **6**
  `TRANSITION` rows; **a `RenewalCase` is created first, so the closure drives a real
  recompute — one `LossRatio` row (`periodClaims` = the net, `periodPremium` = the policy
  premium, `ratio` = claims ÷ premium) + one narrative-free `UPDATE LossRatio` audit row**
  — review MINOR 3; byte-identical re-close → `200`; a `DECLINED` claim: `422` with a
  payment date, `CLOSED` without; **every `LossRatio` / audit query is scoped to this
  run's `RenewalCase` — `db-test` is cumulative**). Full suites green: **api unit 1095**
  (76 files), **claim.e2e-spec.ts 10/10** in isolation, **full api e2e 123/123** (20
  files, a clean run — no flake); full turbo `build` + `typecheck` OK, api / web
  `eslint` OK, Playwright **rfq.spec.ts 24/24** (+1: closes a settled claim once the
  client payment receipt is confirmed) incl. `@a11y`. `prisma validate` OK, `prisma
  migrate status` clean (**34**); no seed change. `npm audit` — the same 1 pre-existing
  moderate transitive `qs` advisory as #28 (no `package.json` / lock change here).

**Part C #30 — Claims Analytics (Domain C, Process 30)**

- **Extends** the `loss-ratio` module — `loss-ratio.config.ts` (the pure
  `buildLossRatioBreakdown` + `LOSS_RATIO_GROUP_BY` / `AnalyticsPolicyLike` /
  `LossRatioBreakdown*` types), `loss-ratio.repository.ts`
  (`loadPoliciesForAnalytics` + `ANALYTICS_WRITTEN_POLICY_STATUSES`), a new
  `claims-analytics.service.ts` + `claims-analytics.controller.ts` + a
  `dto/loss-ratio-breakdown-query.dto.ts`; `LossRatioModule` gains the controller +
  `ClaimsAnalyticsService`. Backlog: Loss Ratio (Claims ÷ Premium) by client / policy /
  line, feeding `LossRatio` at renewal and the reporting dashboard.
- **No migration, no seed change** — `claims-analytics.view`
  (`[CLAIMS_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`)
  was already seeded; `computeLossRatio` (#29) is reused unchanged.
- **`GET /claims-analytics/loss-ratio?groupBy=customer|policy|line`** (`claims-analytics.view`).
  - **Book-wide** — the permission is a cross-book reporting role, so there is no
    per-owner visibility filter (contrast `claim.read`'s `CLAIM_CROSS_OWNER_ROLES`).
    Optional `customerId` / `policyId` / `insuranceLine` params just narrow the policy
    set before aggregation. A bad `groupBy` → 400 (`@IsIn`).
  - **Computed on the fly** — `loadPoliciesForAnalytics` loads every *written* policy
    (status past `PLACEMENT_CONFIRMED`) with `customer.legalName` and its `SETTLED` /
    `CLOSED` claim `netSettlement`s; `buildLossRatioBreakdown` groups them and runs
    `computeLossRatio` **over each group's pooled net settlements + pooled written
    premium** (a *paid, all-time* loss ratio — **not** a sum or average of per-policy
    ratios), plus a `totals` row that pools every in-scope policy regardless of `groupBy`.
  - Each row: `key` / `label` / `periodClaims` / `periodPremium` / `ratio` / `ratioCapped`
    / `claimCount` / `policyCount`. **Rows are ordered worst-first** (highest ratio, then
    label A→Z). No stored aggregate table — the per-`RenewalCase` `LossRatio` write stays
    #29's.
- **Audit** — `ClaimsAnalyticsService` writes a `READ` row (`entityType: 'ClaimsAnalytics'`,
  `entityId` = the scoping id or `'book-wide'`, `afterValue` = `groupBy` + the filters +
  policy / claim / group counts — **never a figure or a customer name** — flagged
  `isSensitiveDataAccess` when a claim contributed; best-effort, a `logger.error` on
  failure, mirroring `CrmService.get360View`).
- **`apps/web/`** — a new **"Claims analytics"** top-level screen
  (`app/(app)/claims-analytics/page.tsx` + `lib/claims-analytics/analytics-api.ts` + an
  `AppNav` entry): a group-by `<select>` and a worst-first table (loss ratio as a %,
  claims paid, written premium, claim / policy counts) + a bold totals row; a friendly
  message when `claims-analytics.view` is missing.
- **`/brain-gap` filed** (ibms-brain `d1a0a1a`): `claims-lifecycle.md` — the Loss Ratio
  bullet gains a Process 30 sub-point (computed on the fly / no stored table; pooled
  figures not averaged ratios; written premium incl. full cancelled / expired — not
  earned; book-wide + audit-logged).
- **`@code-reviewer` (mandatory — money arithmetic + Highly Confidential data
  aggregation)** → **APPROVE WITH MINORS, no blocker, no MAJOR, all six mandatory lex
  checks pass** (money is `Prisma.Decimal` through `money.util` end to end — the pooled
  ratio is `computeLossRatio` over `Σclaims ÷ Σpremium`, asserted with hand-computed
  literals, never an average of per-policy ratios; `totals` is over *all* in-scope
  policies, not a sum of the group rows; the web `Number()` is display-only formatting;
  no status write, no invariant, no approval step; the `READ` audit payload carries only
  ids / counts / the line string — negative-asserted against figure / customer-name
  leakage — and the response body's per-customer legal-name row + money aggregates are
  Confidential-tier for the documented `claims-analytics.view` audience, logged as a
  sensitive access). Two MINORs (both the same fix window, with the `#27
  FOLLOWUP_SWEEP_LIMIT` precedent) fixed: (1) `loadPoliciesForAnalytics` is now capped at
  `ANALYTICS_POLICY_LIMIT = 5000` (`take` + `orderBy createdAt`) and the service
  `logger.warn`s when a query hits the cap — an unbounded book-wide `findMany` +
  in-memory group would otherwise degrade silently; (2) the pooled sums no longer spread
  a book-scale array into `addMoney(0, ...list)` — a new **`sumMoney(values[])`** helper
  in `money.util.ts` (list arg, empty → `0`, no throw) reduces internally, removing a
  latent "too many arguments" `RangeError` (`computeLossRatio` + `breakdownRowFor` both
  switched). NITs fixed: `localeCompare` for the equal-ratio tie-break now passes a fixed
  `'en'` locale (deterministic order across environments); the audit `entityId` prefers
  the *narrowest* scope (`policyId ?? customerId ?? 'book-wide'` — the full filter set is
  in `afterValue.filters` regardless).
- **Deferred**: the "period" is **all-time** and "written premium" counts a `CANCELLED` /
  `EXPIRED` policy's **full** premium — both **drafted** (filed, above); the renewal
  module owns the policy-year window + earned-premium proration · **no incurred loss
  ratio** (open-claim `estimatedLoss` reserves) — paid net settlements only · no
  date-range / as-of filter · no CSV / export · no per-line-*family* rollup (the raw
  `Policy.insuranceLine` string is the `line` key — #25's keyword classifier is not
  applied here) · in-memory aggregation (`findMany` + JS grouping — the first
  `groupBy`-style query in the repo; **capped at `ANALYTICS_POLICY_LIMIT = 5000` with a
  truncation `logger.warn`** — moving the aggregation into the query is the fix when a
  book outgrows that) · `claims-analytics.view` is role-level.
- **Verification**: +14 api unit — `loss-ratio.config.spec.ts` (+6 —
  `buildLossRatioBreakdown` by customer / policy / line with pooled figures + worst-first
  ordering, `totals` independent of `groupBy`, empty breakdown, ratio-cap propagation),
  new `claims-analytics.service.spec.ts` (5 — the breakdown + scope filters passed to the
  repo, the `READ` audit (counts / filters only, `isSensitiveDataAccess` on / off), the
  best-effort audit swallow, `'book-wide'` entityId), `money.util.spec.ts` (+3 — the new
  `sumMoney` — list sum, empty → `0`, a 200k-element list a spread could not take).
  `test/claim.e2e-spec.ts` (the `#29`
  test extended → `#29/#30`: after closing the settled claim, `GET
  /claims-analytics/loss-ratio` — `403` for Sales (no `claims-analytics.view`),
  `groupBy=policy&policyId=` → one row (`periodClaims` `15000.000`, `ratio` = 15,000 ÷
  the policy premium, `claimCount` 1 — the `DECLINED`-then-`CLOSED` claim contributes 0),
  `groupBy=customer&customerId=` → one customer row, a `READ` / `ClaimsAnalytics` audit
  row with no figure in the payload + at least one `isSensitiveDataAccess`, a bad
  `groupBy` → 400). Full suites green: **api unit 1109** (77 files), **claim.e2e-spec.ts
  10/10** in isolation, **full api e2e 123/123** (a clean run); full turbo `build` +
  `typecheck` OK, api / web `eslint` OK, Playwright **claims-analytics.spec.ts 3/3** (the
  breakdown + group switch, the no-permission message, `@a11y`) + **rfq.spec.ts 24/24**.
  `prisma validate` OK, `prisma migrate status` clean (**34**); no seed change. `npm
  audit` — the same 1 pre-existing moderate transitive `qs` advisory (no `package.json` /
  lock change here).

**Part C #31 — Premium Billing (Domain D, Process 31)**

- **Opens Domain D (Finance).** `POST /invoices` (`invoice.create` / **Finance**) raises
  the one **new-business premium `Invoice`** per policy: `premiumAmount` carried from
  `Policy.issuedPremium` (422 if unissued — including a policy that reached `ISSUED` and
  was later `CANCELLED` / `EXPIRED`, which is deliberately still billable, the mid-term
  return being a separate #22 `Refund`); `commissionDeducted = applyPercentage(premium,
  commissionRatePercent)` where the rate is the placed
  `Recommendation.recommendedQuotation.commissionRatePercent` (422 if none captured);
  `taxAmount` + `feesAmount` the only money inputs (each `0 ≤ x ≤ premium`; fees
  default `0`); **`totalAmount` always `premium + tax + fees − commissionDeducted`,
  computed server-side** (`addMoney` → `subtractMoney`, the DTO rejects a `totalAmount`
  field). `dueDate` a required `YYYY-MM-DD`, today .. +365d.
- **One new-business premium invoice per policy** — a partial `UNIQUE ("policyId") WHERE
  "invoiceType" = 'new_business_premium'` (migration `20260902210000`, raw SQL —
  `race-safe-invariants.md`); a pre-check + `P2002` → 409. Write-once #24/#28-style: a
  byte-identical re-`POST` (five figures + `dueDate`) returns the existing invoice, any
  different figure → **409**. The resume/409 gate runs **before** the input-bound checks
  (the #28 `recordSettlement` ordering — a MINOR fix, below), so an idempotent retry
  after the original due date has elapsed still resumes rather than 422-ing.
- **`Invoice` IS a `WorkflowTransitionService` entity** but #31 only creates it at the
  schema `@default(INVOICED)` — no engine transition (the `INVOICED → COLLECTED` cycle
  is Process 32; precedent #23 creating a `Claim` at `@default(NOTIFIED)`).
- **No maker/checker** (`roles-and-segregation-of-duties.md` lists "raise invoices" as a
  Finance single-actor duty; the Finance maker/checker pair is refunds / write-offs).
  Book-wide reads (`client-accounting.read` — Finance, Manager, Exec, Auditor; `GET
  /invoices` with no `policyId` / `customerId` scope → 400, `GET /invoices/:id` → one).
- Audit: one best-effort `CREATE Invoice` row (ids + all five figures as fixed 3dp
  strings + the commission rate + due date, **no free text**); reads are **not** audited
  (an invoice total is Confidential, not Highly Confidential — same tier as the `Policy`
  premium read, which #18–21 also do not audit).
- **`/brain-gap` filed** (`ibms-brain` `f8843ed`): **new `meta/context/finance-lifecycle.md`**
  (Domain D seed) documents Process 31; `policy-lifecycle.md` § Out of scope now points
  there. Submodule pin bumped in this commit.
- **`@code-reviewer` (mandatory — financial calculation + a migration + Confidential
  financial data) → APPROVE WITH MINORS**, no blocker, no MAJOR, **all six mandatory
  lex checks pass** (`money-decimal-jod` — every figure through `money.util.ts`,
  `Prisma.Decimal` end to end; `workflow-state-transitions` — born at `@default`, never
  assigned; `race-safe-invariants` — "a textbook application"; `maker-checker-segregation`
  — correctly not applied; `sensitive-data-handling` — snapshot is ids + fixed strings;
  `pdpl-sla-timers` — nothing to escalate at `INVOICED`). 3 MINORs fixed: (1)
  `computeInvoiceFigures`'s comment claimed the caller guaranteed a non-negative total
  but nothing bounded the commission rate at billing time — added a `0 ≤ rate ≤
  MAX_COMMISSION_RATE_PERCENT` billing-time backstop + a `totalAmount ≥ 0` assert on the
  new-invoice path, and corrected the comment; (2) the write-once resume/409 check now
  runs **before** `parseDueDate` + the tax/fees bounds (split into `parseDueDateInstant`
  + `assertDueDateInWindow`) so a genuine idempotent retry is validation-independent;
  (3) the stale-commission-rate risk (no `Policy → Quotation` link — a post-recommendation
  #15 negotiation round could leave the invoice netting the recommended-quote's rate) is
  now called out in a code comment + here, tracked until Process 35's `CommissionAgreement`
  replaces the lookup. NITs: `commissionRatePercent.toFixed(2)` replaces
  `quantizeMoney(...).toFixed(2)` in the audit snapshot (money quantizer over a rate);
  the `issuedPremium != null` gate has a comment noting `CANCELLED` / `EXPIRED` is
  intentionally billable; `GET /invoices/:id` keeps a bare `@Param('id')` (matches the
  claim / policy / endorsement controllers — a non-UUID id falls through to a clean 404).
  +2 unit tests for the MINOR fixes.
- **Deferred**: `commissionDeducted` derives from the *placed quotation's* rate, not a
  governed table — Process 35 (`CommissionAgreement`, by insurer + line) replaces it, and
  a policy whose quotation captured no rate cannot be billed today (422) · **no
  premium-tax-rate table** — `taxAmount` is a raw Finance input (no computed default, no
  exemption model); a real Jordan insurance-premium-levy figure belongs to a Finance
  config surface that does not exist · `INVOICE_MAX_DUE_DAYS_AHEAD` (365) is a **drafted**
  sanity bound · the five figures are **write-once** — no amend / credit-note path ·
  `PremiumTransaction` (the generic premium-ledger model) is **not** written — #31 fills
  `Invoice.premiumAmount` directly; the ledger is #32/#35/#36 · only the
  `new_business_premium` `invoiceType` is modelled (`endorsement_adjustment` /
  `renewal_premium` invoices are not) · no `Invoice → COLLECTED` / Receipt / Remittance
  (Process 32); `invoice.create` / `client-accounting.read` are role-level; no
  PDPL-registry SLA at `INVOICED`.
- **Verification**: +26 api unit — new `finance.config.spec.ts` (10 —
  `computeInvoiceFigures` with hand-computed literals `125.000` / `375.075` / `41.667` /
  `291.668`, `invoiceFiguresMatch` scale-insensitivity, `deriveInvoiceView`,
  `invoiceAuditSnapshot` shape) + new `invoice.service.spec.ts` (16 — the happy path +
  audited CREATE, 404 / 422 (no issued premium, no commission rate, tax > premium, fees >
  premium, due date past, due date > 365d, **rate outside 0..100**), write-once resume /
  409, **resume after the stored due date has elapsed**, `P2002` → 409, best-effort
  audit swallow, `list` scope-required 400 + list-by-policyId). New `test/invoice.e2e-spec.ts`
  (2 — raise (premium carried, commission `14400.000` netted from 12 %, total
  `115350.000`), non-Finance 403 on POST + GET, past / +400d due date 422, `GET
  /invoices?policyId=`, `GET /invoices/:id`, exactly one `CREATE Invoice` audit row,
  unscoped `GET /invoices` 400; write-once resume + changed-figure / changed-date 409,
  still one invoice on the policy). Full suites green: **api unit 1135** (79 files),
  **invoice.e2e-spec.ts 2/2** in isolation, **full api e2e 125/125** (a clean run); full
  turbo `build` + `typecheck` OK, api / web `eslint` OK, Playwright **rfq.spec.ts 26/26**
  (the 24 prior + 2 new Finance tests — raise from the "Billing" block with commission
  netted + total computed, a non-Finance user sees no raise control). `prisma validate`
  OK, `prisma migrate status` clean (**35** — migration `20260902210000`); no seed
  change. `npm audit` — the same 1 pre-existing moderate transitive `qs` advisory (no
  `package.json` / lock change here).

**Part C #32 — Collection (Domain D, Process 32)**

- **The full `Invoice → Collection → Receipt → Reconciliation → Remittance` cycle.**
  `Invoice` IS a `WorkflowTransitionService` entity — #31 created it at
  `@default(INVOICED)`; **#32 is where the engine transitions happen.** Three endpoints
  on `InvoiceController`, one hop each: `POST /invoices/:id/receipt` (`receipt.record` /
  **Finance**) → `INVOICED → COLLECTED`; `POST /invoices/:id/reconcile` (`receipt.record`)
  → `COLLECTED → RECONCILED`; `POST /invoices/:id/remittance` (`remittance.record`) →
  `RECONCILED → REMITTED`. Every move via `WorkflowTransitionService.transition`; the e2e
  asserts exactly **3** `TRANSITION` audit rows.
- **Migration `20260902220000`** adds ONLY `Receipt.invoiceId @unique`
  (`Receipt_invoiceId_key`) — the "one collection receipt per invoice" race backstop (a
  `@code-reviewer` BLOCKER, below). No seed change (`receipt.record` / `remittance.record`
  `[FINANCE_COLLECTIONS_OFFICER]`, the `Receipt` / `Remittance` / `ClientFundsLedgerEntry`
  models and the `WORKFLOW_TRANSITIONS.Invoice` cycle all pre-existed).
- **One exact-amount receipt per invoice.** `Receipt.amount` must equal
  `Invoice.totalAmount` (`compareMoney === 0`) — a partial / over payment is a **422**
  (`money-decimal-jod.md`: a mismatch is raised as an exception, never silently written
  off — the variance path is Process 39). The `Receipt.invoiceId @unique` +
  `P2002` → reload → byte-identical resume / 409 is the structural gate; the transition-
  then-`$transaction` artefact write follows the #24 `register` pattern (lost race →
  resume/409; crash between → re-entry writes only the artefact).
- **Reconcile re-derives `sumMoney(receipts) === totalAmount` from the live rows** (the
  #16 "re-check at the decision point" rule) — a mismatch is a 422, an already-
  `RECONCILED` / `REMITTED` invoice is an idempotent 200.
- **The remittance is `premiumAmount − commissionDeducted`, computed server-side**
  (`subtractMoney`, `≥ 0` since #31 bounds commission ≤ premium; tax + fees stay with the
  broker). `insurerId` from `Policy.insurerId`; a non-policy invoice → 422. Deterministic
  → a re-`POST` is an idempotent no-op; `Remittance.receiptId @unique` + `P2002` backstop.
- **Part 7.3 client-money segregation** — every collection books an `in`
  `ClientFundsLedgerEntry`, every remittance an `out` one, **each in the same
  `$transaction`** as its `Receipt` / `Remittance` (a deliberate local `$transaction`
  exception, same rationale as `PolicyRepository.createIssuanceArtifacts`);
  `reference` is an `invoice:<id>` pointer.
- **No maker/checker** (`roles-and-segregation-of-duties.md` — "record receipts" is a
  Finance single-actor duty; the Finance maker/checker boundary is refunds / write-offs;
  moving client money to the insurer is mechanical, not an approval). Book-wide.
- `InvoiceView` gains `netRemittance` (`premium − commission`, computed server-side so
  the web never does money math — a `@code-reviewer` MINOR fix), `receipt` and
  `remittance` sub-objects; `InvoiceRepository.findById` / list now `include` the cycle.
- Audit: a best-effort `CREATE` row for each `Receipt` / `Remittance` /
  `ClientFundsLedgerEntry` (amount as a fixed 3dp string + method / insurer / direction,
  no free text) + the three engine `TRANSITION` rows.
- **`/brain-gap` filed** (`ibms-brain` `2cfbe4f`): `finance-lifecycle.md` gains a
  "Collection (Process 32)" section. Submodule pin bumped in this commit.
- **`@code-reviewer` (mandatory — workflow state-machine + financial calc + a
  `$transaction` seam + Confidential data) → CHANGES REQUESTED, then re-reviewed → APPROVE.** All six
  mandatory lex checks pass except the one BLOCKER (now fixed). **BLOCKER (fixed)**:
  "one receipt per invoice" was a read-then-create with no structural backstop — a
  retried / concurrent `POST /receipt` where request B lost the `INVOICED → COLLECTED`
  transition but reached `finishReceipt` before request A's `$transaction` committed
  would write **two** `Receipt` rows + **two** `in` `ClientFundsLedgerEntry` rows
  (double-booking the client's premium — `race-safe-invariants.md`). Fixed with
  `Receipt.invoiceId @unique` (migration `20260902220000`) so the already-written
  `P2002 → 409` handling becomes real, plus a reload-and-resume on a byte-identical
  race (matching the remittance path and #31). **MINOR (fixed)**: `FinanceSection.tsx`
  computed the net remittance with naked JS float subtraction (`Number(premium) −
  Number(commission)`) for a button label — a foot-gun in a `money.util.ts`-only
  codebase; replaced with a server-computed `InvoiceView.netRemittance`. **NIT (noted,
  kept)**: the "stored remittance disagrees → 409" branch is unreachable given
  deterministic figures — kept as defence-in-depth against a future partial-payment
  feature / data corruption.
- **Deferred**: **one exact-amount receipt per invoice** — partial payments (multiple
  receipts summing to the total) would replace the `Receipt.invoiceId @unique` · the
  **`EXCEPTION_RAISED` / `EXCEPTION_RESOLVED` states + the `ReconciliationException`
  model + the investigate/resolve path are Process 39** — #32 422s a variance rather
  than raising a formal exception · **no payment execution** — `Receipt` / `Remittance`
  record the client payment and the broker transfer as facts (`receivedAt` /
  `remittedAt`); no bank integration, no reversal / clawback · `ClientFundsLedgerEntry`
  is an append-only movement log — no running-balance query / client-funds
  reconciliation report yet · `PremiumTransaction` (the generic premium-ledger model)
  is still not written · `receipt.record` / `remittance.record` are role-level (no
  worklist of un-reconciled invoices).
- **Verification**: +25 api unit — `finance.config.spec.ts` (10 → 15: `computeRemittance`
  literals `105600` = `120000 − 14400`, the extended `deriveInvoiceView` incl.
  `netRemittance`), new `collection.service.spec.ts` (20: the three cycle methods —
  happy path + audit + ledger, the exact-amount 422, idempotent resume, `409` on a
  different receipt, the transition-crash re-entry for receipt + remittance, the P2002
  race → byte-identical resume / 409, the non-policy 422, the not-yet-reconciled 422).
  `test/invoice.e2e-spec.ts` (+1: the full cycle — receipt → reconcile → remittance,
  asserting `COLLECTED` / `RECONCILED` / `REMITTED`, `remittance.amount` `105600.000`,
  exactly 3 `TRANSITION` rows, exactly **1** `Receipt`, and one `in` (`115350.000`) +
  one `out` (`105600.000`) `ClientFundsLedgerEntry`; plus the non-Finance 403s and the
  reconcile / remittance-before-receipt 422s). Full suites green: **api unit 1157**
  (80 files) → **1160 after the blocker-fix tests** (recount on re-run), **invoice.e2e-spec.ts
  3/3** in isolation, **full api e2e 126/126** (a clean run); full turbo `build` +
  `typecheck` OK, api / web `eslint` OK, Playwright **rfq.spec.ts 27/27** (+1 —
  the collection cycle walked from the "Billing" block). `prisma validate` OK,
  `prisma migrate status` clean (**36** — migration `20260902220000`); no seed change.
  `npm audit` — the same 1 pre-existing moderate transitive `qs` advisory.

**Part C #33 — Client Accounting (Domain D, Process 33)**

- **The accounts-receivable / ageing report per customer.** `GET
  /client-accounting/ageing?customerId=&asOf=` (`client-accounting.read` /
  **Finance, Manager, Exec, Auditor**) returns one row per customer with an outstanding
  balance, split into `current` / `d1_30` / `d31_60` / `d61_90` / `d90_plus` buckets,
  ordered worst-first, plus a `totals` row pooling every outstanding invoice in scope.
  New `ClientAccountingService` + `ClientAccountingController` in the `finance` module;
  `InvoiceRepository.loadOutstandingReceivables`; the pure `buildReceivablesAgeing` /
  `daysOverdue` / `ageingBucketFor` in `finance.config.ts`. **No migration, no seed
  change** — `client-accounting.read` pre-existed (its seeded description is literally
  "View the client accounts-receivable/ageing report").
- **Computed on the fly — no stored aggregate table** (the #30 Claims Analytics shape;
  the unscoped `GET /invoices` 400 message already pointed here).
- **"Outstanding" is structural — an `Invoice` with no collection `Receipt`.** #32
  records exactly one `Receipt` per invoice for the full total, so a receipt means paid
  in full (partial payments are a deferred #32 refinement). An `EXCEPTION_RAISED`
  invoice with no receipt still reads as outstanding; the #32 crash seam (`COLLECTED`,
  no `Receipt`) reads as outstanding until the re-entry heals it.
- **`asOf` is the ageing reference date** — a bare `YYYY-MM-DD`, today or earlier (a
  future `asOf` → **422**, via `parseHistoricalInstant`), default today. It is
  **point-in-time correct for the outstanding set with no history table**: the query
  filters `Invoice.createdAt < asOf+1d` (did it exist yet) and requires
  `Receipt.receivedAt < asOf+1d` to be `none` (was it still unpaid then) — and
  `Invoice.dueDate` is write-once at #31, so nothing else needs reconstructing.
- **Buckets are the textbook 30 / 60 / 90-day bands — drafted / unsourced** (`≤ 0` days
  overdue is `current`, then 1–30 / 31–60 / 61–90 / 90+; `ageingBucketFor` over
  `daysOverdue(dueDate, asOf)` on whole UTC calendar days). Same drafted status as
  `INVOICE_MAX_DUE_DAYS_AHEAD` (#31), `CLAIM_LARGE_THRESHOLD_JOD` (#23), the #27
  follow-up thresholds, the #29 loss-ratio "period".
- **Book-wide** (`client-accounting.read` is a Finance / cross-book reporting perm — no
  per-owner filter; the optional `customerId` just narrows to one client). Rows
  worst-first (largest days-overdue, then largest balance, then customer name in a fixed
  `en` locale). Capped at `AR_AGEING_INVOICE_LIMIT = 5000` (the #30
  `ANALYTICS_POLICY_LIMIT` precedent — `logger.warn` on truncation). Every figure pooled
  through `sumMoney` (`money.util.ts`).
- **No maker/checker** (a read). **Not audit-logged** — an invoice total is
  Confidential, not Highly Confidential: the #31 decision (`GET /invoices` is likewise
  not audited, same tier as the `Policy` premium read); contrast the #30 breakdown,
  which aggregates HIGHLY_CONFIDENTIAL `Claim` rows and does write a `READ` row.
- **`/brain-gap` filed** (`ibms-brain` — `finance-lifecycle.md` gains a "Client
  Accounting (Process 33)" section; the brain `CLAUDE.md` What's New row too). Submodule
  pin bumped in this commit.
- web: a new **"Client accounting"** screen (`app/(app)/client-accounting/page.tsx` +
  `lib/client-accounting/ageing-api.ts` + an `AppNav` entry) — an `asOf` date input and
  a worst-first table of per-customer ageing buckets + a bold totals row, with a
  friendly `client-accounting.read`-missing message and a "no outstanding receivables"
  empty state.
- **`@code-reviewer` (mandatory — financial calculation + Confidential financial data)
  → APPROVE WITH MINORS**, no BLOCKER, no MAJOR, no lex violation; all six mandatory
  checks pass (no float money path — every figure through `money.util.ts` /
  `Prisma.Decimal`, `outstandingTotal` provably `=` Σ the five bucket strings by
  construction; pure read, no status write / approval step / Highly-Confidential log;
  the `asOf` `createdAt` + receipt-`receivedAt` point-in-time query confirmed correct
  with no off-by-one; the not-audited decision confirmed consistent with the
  Confidential tier + the #31 / `GET /invoices` precedent). **1 MINOR (documented, not
  code-changed)**: `buildReceivablesAgeing` pools a customer's bucket + `outstandingTotal`
  figures with no currency split and hardcodes `report.currency = 'JOD'` — harmless
  today (every `Invoice.currency` is JOD, `money.util.ts` is fils-precision JOD, no
  non-JOD path exists) and identical to #30's `buildLossRatioBreakdown`, but a
  mixed-currency customer would pool a wrong total if a foreign-currency invoice ever
  lands; now a `SINGLE-CURRENCY` code comment marking the assumption + the `(customerId,
  currency)` fix (same treatment as #31's stale-commission-rate MINOR). **NITs noted,
  not taken**: (a) truncation past `AR_AGEING_INVOICE_LIMIT` returns `200` with partial
  totals + only a server `logger.warn`, no `truncated: true` in the payload — the #30
  `ANALYTICS_POLICY_LIMIT` precedent, and 5000 outstanding invoices is far beyond a
  broker's book; (b) `parseHistoricalInstant` compares the parsed UTC-midnight `asOf`
  to `Date.now()`, so a direct API caller in Jordan (UTC+2/＋3) passing today's *local*
  date between 00:00 and ~03:00 local can get a `422` "future" — pre-existing shared-util
  behaviour (#10 / #12 use it identically); the web screen caps its date input the same
  UTC way, so web ↔ API agree, and the omitted-`asOf` default always works.
- **Deferred**: the 30 / 60 / 90-day bucket boundaries are **drafted / unsourced** (no
  CBJ / Part-3.6 ageing-band rule) · **single-currency pooling** (the MINOR above) —
  `(customerId, currency)` grouping is the fix if multi-currency ever lands · **no
  partial-payment ageing** — an invoice is all-outstanding or all-paid (#32 records one
  full-amount `Receipt`); a `ClientFundsLedgerEntry` running balance / client-funds
  reconciliation report is still not built · no per-invoice drill-down in the report
  (the row is the aggregate; `GET /invoices?customerId=` is the line-item list) · no
  CSV / export; no `truncated` flag in the payload (NIT above) · `client-accounting.read`
  is role-level (no per-officer collections worklist) · **`insurer-accounting.read` /
  the #34 accounts-payable-per-insurer report (from `Remittance`) is not built**.
- **Verification**: +12 api unit — `finance.config.spec.ts` (+7: `daysOverdue` /
  `ageingBucketFor` boundary cases, `buildReceivablesAgeing` grouping / bucketing /
  pooled totals / worst-first + tie-break / empty / `asOf` UTC-midnight normalisation),
  new `client-accounting.service.spec.ts` (5: the `customerId` scope + `asOfExclusiveUpper`
  passed to the repo, `asOf` defaults to today, a future `asOf` 422, a non-calendar-date
  422, the report built from the loaded rows). `test/invoice.e2e-spec.ts` (+1: raise an
  invoice → the customer appears with the balance in `current`; non-Finance 403; a
  future `asOf` 422; an `asOf` before the invoice existed → absent; backdate `dueDate`
  45 days → the balance ages into `d31_60`; collect it → the customer drops out; an
  unknown `customerId` → empty). api unit **1172** (81 files); `invoice.e2e-spec.ts`
  **4/4** in isolation; full api e2e green; full turbo `build` + `typecheck` OK, api /
  web `eslint` OK; new Playwright `client-accounting.spec.ts` (3 — worst-first table +
  totals, the permission-missing message, `@a11y`). `prisma migrate status` unchanged
  (**36**); no seed change. `npm audit` — the same 1 pre-existing `qs` advisory.
- **Follow-up fix (same branch, next commit)**: `packages/db`
  `prisma/seed-data/permissions.spec.ts` had one failing assertion since Part C #22
  (commit `4aa7c3b` added `FINANCE` to `refund.approve` — brain-correct — but left the
  stale role-level test). **Corrected the test, not the seed**:
  `roles-and-segregation-of-duties.md` says Finance "Cannot approve **own**
  refunds/write-offs" (instance-level — the "own"), and `maker-checker-segregation.md`
  maps the refund *checker* to a "Finance approver above the value threshold", so
  `FINANCE` legitimately holds `refund.approve`; raiser ≠ approver on a given `Refund`
  is enforced by `assertDifferentActors` + the `Refund_maker_checker_distinct` CHECK in
  `endorsement.service.ts` `approveRefund`, not by withholding the code — the same shape
  as the Claims Officer first-approver assertion in the same spec, and exactly what the
  spec's own header comment ("instance-level self-check … is A.5's `assertDifferentActors`,
  not this grid's job") already carves out. `@ibms/db` tests 15/15; full `npm run test`
  green.

**Part C #34 — Insurer Accounting (Domain D, Process 34)**

- **The accounts-payable / remittance-obligations report per insurer.** `GET
  /insurer-accounting/payables?insurerId=&asOf=` (`insurer-accounting.read` / **Finance,
  Manager, Exec, Auditor**) returns one row per insurer with `outstandingAmount` (net
  premium the broker has collected but not yet remitted), `remittedAmount` (paid to
  date), the counts, and `oldestDaysOutstanding` — ordered worst-first, plus a `totals`
  row. New `InsurerAccountingService` + `InsurerAccountingController` in the `finance`
  module; `InvoiceRepository.loadInsurerObligations` / `loadInsurerRemittances`; the pure
  `buildInsurerPayables` + `INSURER_PAYABLES_ROW_LIMIT` in `finance.config.ts`. **No
  migration, no seed change** — `insurer-accounting.read` pre-existed.
- **Computed on the fly — no stored aggregate table** (the insurer-side mirror of #33 /
  #30).
- **"Outstanding" is a collected-but-not-yet-remitted invoice, not a `Remittance` row.**
  #32 only creates a `Remittance` *after* the transfer (and always stamps `remittedAt`),
  so a `Remittance` row means *settled*. The obligation is derived from the invoice
  cycle state: a `Receipt` exists (client paid) and no `Remittance` has discharged it.
- **The amount owed per invoice is `premiumAmount − commissionDeducted`** —
  `computeRemittanceAmount`, exactly #32's `Remittance.amount` (tax + fees stay with the
  broker), derived in the pure builder, never re-typed. The remitted side is straight
  from `Remittance.amount`.
- **`asOf`** (bare `YYYY-MM-DD`, today or earlier → **422** if future, via
  `parseHistoricalInstant`; default today) makes both sides point-in-time correct: a
  `Receipt` counts as collected when `receivedAt < asOf+1d`, a `Remittance` as remitted
  when `remittedAt < asOf+1d`, and an invoice is outstanding-as-at-`asOf` when it was
  collected by then and any `Remittance` came after. One `where` on the `receipts`
  relation: `{ some: { receivedAt: { lt: X } }, none: { remittance: { remittedAt: { lt: X } } } }`
  (the `Invoice → Receipt → Remittance` cycle is 1:1:1). Non-policy invoices
  (`policyId IS NULL`) are skipped — no insurer to owe.
- **No ageing buckets** (#34's backlog line is "a query", not "an ageing query" like
  #33) — a single `outstandingAmount` + `oldestDaysOutstanding` (whole UTC days since
  the earliest unremitted `Receipt.receivedAt`, reusing `daysOverdue`; `-1` when nothing
  is outstanding). `Insurer.creditTermsDays` (a grace period before the remittance is
  "due") is **not** applied — a deferred refinement.
- **Book-wide** (the optional `insurerId` just narrows); rows worst-first (largest
  days-outstanding, then largest amount owed, then insurer name in a fixed `en` locale);
  capped at `INSURER_PAYABLES_ROW_LIMIT = 5000` per side (`logger.warn` on truncation);
  every figure pooled through `sumMoney`. **No maker/checker** (a read). **Not
  audit-logged** — same Confidential tier / #31 decision as #33.
- **`/brain-gap` filed** (`ibms-brain` — `finance-lifecycle.md` gains an "Insurer
  Accounting (Process 34)" section; the brain `CLAUDE.md` What's New row too). Submodule
  pin bumped in this commit.
- web: a new **"Insurer accounting"** screen (`app/(app)/insurer-accounting/page.tsx` +
  `lib/insurer-accounting/payables-api.ts` + an `AppNav` entry after "Client
  accounting") — an `asOf` date input and a worst-first table of per-insurer outstanding
  / remitted figures + a bold totals row, with a friendly `insurer-accounting.read`-missing
  message and a "nothing owed to or remitted from any insurer" empty state.
- **`@code-reviewer` (mandatory — financial calculation + Confidential financial data)
  → APPROVE WITH MINORS**, no BLOCKER, no MAJOR, no lex violation; all six mandatory
  checks pass (every figure through `money.util.ts` / `Prisma.Decimal`, no client-side
  money arithmetic; `totals` proven `=` Σ the per-row figures by the same exact-3dp
  partition argument as #33; the `receipts: { some, none }` point-in-time `where` and
  the exclusive upper bound confirmed correct for the 1:1:1 cycle; the nullable
  `Remittance.remittedAt < X` correctly excludes un-remitted rows; the not-audited
  decision confirmed consistent with the Confidential tier + #31 / #33 / `GET /invoices`
  precedent — and the payload carries no personal data). **1 MINOR (process, resolved)**:
  the `ibms-brain` submodule must not be pinned `-dirty` — the #34 brain-gap is committed
  + pushed in `ibms-brain` first, then the `ibms-app` pointer bumped to that real hash
  (the standard `/brain-gap filed + pushed (ibms-brain <hash>)` flow). **NITs taken**:
  the two independent repo reads now run under `Promise.all`; the `buildInsurerPayables`
  tie-break test gains a third-tier fixture (equal age **and** equal amount → insurer
  name). **NIT noted**: the truncation check compares the post-`flatMap` `obligations`
  length rather than the raw DB row count — exact in practice (the `flatMap` only drops
  on the orphan branch the repo documents as impossible), now a code comment.
- **Deferred**: **no ageing buckets** — a single "days outstanding" figure, not the
  30/60/90 bands #33 uses; `Insurer.creditTermsDays` is not applied · the obligation is
  **derived from the invoice cycle state**, not a first-class `PayableObligation` row —
  no "insurer statement reconciliation" (that is #39) · **no partial-payment** — an
  invoice is fully unremitted or fully remitted (#32 records one `Remittance` per
  receipt) · no per-invoice drill-down; no CSV / export; no currency split (every figure
  assumed JOD — `money-decimal-jod.md`; `Remittance` has no currency column) ·
  `insurer-accounting.read` is role-level (no per-officer remittance worklist) ·
  `CommissionAgreement` / the governed commission ledger (#35–36) is not built — the net
  owed still derives from `Invoice.commissionDeducted` (the placed quote rate, #22/#31).
- **Verification**: +10 api unit — `finance.config.spec.ts` (+5: `buildInsurerPayables`
  grouping / net-owed-through-money.util / pooled totals / worst-first + tie-break /
  remitted-only row / empty / `asOf` UTC-midnight normalisation), new
  `insurer-accounting.service.spec.ts` (5: the `insurerId` scope + `asOfExclusiveUpper`
  passed to both repo reads, `asOf` defaults to today, a future `asOf` 422, a
  non-calendar-date 422, the report built from the loaded rows). `test/invoice.e2e-spec.ts`
  (+1: raise + collect (→ COLLECTED, unremitted) → the insurer shows
  `outstandingAmount 105600.000` / `remittedAmount 0.000`; non-Finance 403; future `asOf`
  422; `asOf` before the receipt → absent; reconcile + remit → outstanding drops to 0,
  remitted becomes `105600.000`; unknown `insurerId` → empty). api unit **1182** (82
  files); `invoice.e2e-spec.ts` **5/5** in isolation; new Playwright
  `insurer-accounting.spec.ts` (3). `prisma migrate status` unchanged (**36**); no seed
  change.

**Part C #35 — Commission Calculation (Domain D, Process 35)**

- **The governed commission-rate table + the commission ledger with a manual-override
  maker/checker.** New module `apps/api/src/modules/commission/`. **Migration
  `20260903120000`** adds a partial `UNIQUE ("insurerId", "insuranceLine") WHERE
  "effectiveTo" IS NULL` on `CommissionAgreement` (one open rate window per pair — raw
  SQL), `CommissionLedgerEntry.policyId @unique` (one commission entry per policy), and
  `CommissionLedgerEntry.overrideAmount DECIMAL(18,3)` (the proposed override, held
  apart from `amount`). The models, the `CommissionLedgerEntry_maker_checker_distinct`
  CHECK (`20260826091424`), and the four Finance commission perms all pre-existed — **no
  seed change**.
- **`POST /commission/agreements` (`commission-rate.manage` / Compliance + Manager — not
  Finance)** opens a rate window for `(insurerId, insuranceLine)`. A still-open window
  for the pair is superseded (`effectiveTo` stamped at the new `effectiveFrom`), both in
  one `$transaction` (`supersedeAndCreateAgreement` — the `reviseChain` exception); the
  partial `UNIQUE` + `P2002` → 409 is the race backstop; `effectiveFrom` may be
  future-dated but not earlier than the superseded window (422); a same-rate same-date
  re-`POST` returns the open window. `resolveGovernedRate` (pure) picks the window whose
  `[effectiveFrom, effectiveTo)` contains a date (`from` inclusive, `to` exclusive).
- **`POST /commission/entries` (`commission.calculate` / Finance)** records the one
  `CommissionLedgerEntry` per policy (`policyId @unique`, write-once) at the governed
  rate in force for the policy's pair **at `inceptionDate ?? createdAt`**;
  `amount = premium × ratePercent%` (`applyPercentage`); **422** if unissued / no covering
  agreement; the rate is bounded `0..100` so `amount ≤ premium`; a re-`POST` whose
  recomputed governed figure differs from the stored one → **409** ("a correction is a
  manual override"), an already-overridden entry always resumes. **No maker/checker** —
  applying the governed figure is mechanical single-actor Finance work (like #31 raising
  an invoice).
- **#31's `Invoice.commissionDeducted` is NOT rewired** onto this table — it stays on
  the placed-quotation rate (the client-facing figure); the `CommissionLedgerEntry` is
  the broker's governed commission-earned record. Reconciling the two is a later
  process.
- **The manual override is a maker/checker pair.** `POST /commission/entries/:id/override`
  (`commission-override.raise` / Finance) proposes `{ overrideAmount, reason }` (`reason`
  mandatory, `@MinLength(10)`; `0 ≤ overrideAmount ≤ premium`), writes `overrideAmount`
  + `isManualOverride` + `overrideReason` + `overrideRequestedByUserId` and **leaves
  `amount` (the governed figure) untouched** — the override is *pending*; Finance may
  revise a still-pending override freely, an approved one is write-once.
  `POST .../override/approve` (`commission-override.approve` / Manager) —
  `assertDifferentActors(overrideRequestedByUserId, actor)` (403) + the
  `CommissionLedgerEntry_maker_checker_distinct` CHECK, a status-conditional `updateMany`
  (0 rows → 409), **copies `overrideAmount` into `amount`**; a null requester → 409 (the
  #28 `'' === actor` fix), a different approver on an already-approved override → 409,
  the same one → idempotent. `CommissionLedgerEntryView` carries `amount` (governed) /
  `overrideAmount` / `effectiveAmount` (`overrideApproved ? overrideAmount : amount`) /
  `overridePending`.
- Audit: `CREATE` / `UPDATE CommissionAgreement`, `CREATE CommissionLedgerEntry` (ids +
  the rate applied + amount, no free text), `UPDATE` (override raise) / `APPROVE`
  (override approve) — both carry `overrideReason` **verbatim** (the reason IS the
  "separately logged" requirement, a business justification not personal data — same as
  #22's `refundAuditSnapshot`). Book-wide reads (`GET /commission/agreements`
  `commission-rate.manage`; `GET /commission/entries` + `/:id` `financial-report.view`;
  a `GET /commission/insurers` `{ id, name }` helper). `vatAmount` stays `0` (VAT on
  commission is #36's "tax implications" line).
- **`/brain-gap` filed** (`ibms-brain` — `finance-lifecycle.md` gains a "Commission
  Calculation (Process 35)" section; the brain `CLAUDE.md` What's New row too). Submodule
  pin bumped in this commit.
- web: a new **"Commission rates"** screen (`app/(app)/commission/page.tsx` +
  `lib/commission/commission-api.ts` + an `AppNav` entry — the rate-table history + a
  Compliance/Manager add form) and a per-policy **"Commission"** block on the opportunity
  detail screen (`components/policy/CommissionSection.tsx` — calculate / raise override /
  approve, `canCalculate={isFinance}` / `canApproveOverride={isManager}`).
- **`@code-reviewer` (mandatory — financial calculation + a migration + maker/checker +
  Confidential financial data) → APPROVE WITH MINORS**, no BLOCKER, no MAJOR, no lex
  violation; all six mandatory checks pass (every figure through `money.util.ts` /
  `Prisma.Decimal`, no client-side money arithmetic; the override approve resolves maker
  and checker to two distinct IDs at **both** layers — `assertDifferentActors` + the
  null-requester 409 guard in the service, and the `CommissionLedgerEntry_maker_checker_distinct`
  CHECK in the DB — with no interleaving that can persist `requester == approver`; the
  status-conditional `updateMany`s are the race gates; `overrideReason` is a sanctioned
  business-justification audit field, not a Highly-Confidential leak; the migration is
  idempotent). **5 MINORs / 2 NITs — all addressed**:
  (1) **`recordOverrideApproval`'s `updateMany` `where` now re-asserts the exact
  `overrideRequestedByUserId` `assertDifferentActors` checked and the exact
  `overrideAmount` being copied into `amount`**, so a concurrent `raiseOverride` between
  the load and the write is a clean 0-row → 409 rather than a DB-CHECK 500 or a stale
  amount — this also drove a new clause in `meta/lex/race-safe-invariants.md` ("a
  status-conditional write must re-assert *every* validated field, not just `status`");
  (2) the write-once resume now compares the **figure only** (not the agreement id), so
  superseding a window with the same numeric rate doesn't 409 a harmless recalc;
  (3) an omitted `effectiveFrom` now defaults to **today at UTC midnight** (was wall-clock
  `new Date()`), so the same-rate/same-date idempotency short-circuit engages for the
  no-date double-submit too; (4) the governed-rate lookup matches `insuranceLine`
  **case-insensitively + trimmed** (`mode: 'insensitive'`), so a casing / whitespace
  drift between `Policy.insuranceLine` and `CommissionAgreement.insuranceLine` can't
  silently 422 a calculation whose rate does exist; (5) the write-once `existing` resume
  now runs **ahead of** the no-issued-premium 422 (the #31 `recordSettlement` ordering);
  NIT — `raiseOverride` now **404s** on a missing / unissued policy rather than silently
  dropping the `overrideAmount ≤ premium` bound; NIT — `CommissionLedgerEntryView
  .effectiveAmount` now reads `amount` unconditionally (the post-approval source of
  truth) so a divergence would surface.
- **Deferred**: the rate table is time-windowed but has **no scheduled-change
  automation** (a future `effectiveFrom` is honoured only by `resolveGovernedRate`'s date
  arithmetic — nothing sweeps windows) · **`calculate` resolves the rate at
  `inceptionDate ?? createdAt`** — a governed "as of the binding instant" would need a
  `Policy.boundAt` that does not exist · **#31 / #22 are not migrated onto the governed
  rate** (documented above) — a reconciliation of `Invoice.commissionDeducted` vs
  `CommissionLedgerEntry.effectiveAmount` is a later process · **one
  `CommissionLedgerEntry` per policy** — renewal / a second entry type would relax the
  `policyId @unique` to a discriminated constraint (renewal is not built) · **no `paid`
  / `reversed` transitions and no VAT on commission** — #35 only ever creates at
  `outstanding` with `vatAmount = 0`; the lifecycle is #36 · **no override reject /
  withdraw** — a bad *pending* override is revised in place; an *approved* one needs a
  future correction path · `commission.calculate` / the override perms are role-level.
- **Verification**: +36 api unit — `commission.config.spec.ts` (15: `resolveGovernedRate`
  window containment / inclusive-from-exclusive-to / null, `computeCommissionAmount`
  hand-computed literals, the two views incl. `effectiveAmount` / `overridePending`,
  `overrideProposalMatches`, the audit snapshots), `commission-agreement.service.spec.ts`
  (8: open / supersede + UPDATE audit / 422 rate-bounds + earlier-effectiveFrom / 404
  insurer / `P2002` 409 / idempotent re-post / omitted-date-opens-at-UTC-midnight),
  `commission-ledger.service.spec.ts` (17: governed calculate + CREATE audit / 422
  no-premium + no-agreement / write-once resume / 409 drifted figure /
  resume-after-agreement-closed / **resume-before-no-premium-422** /
  **figure-only resume when a same-rate window was re-opened** / override raise + UPDATE
  audit / **raise 404 on missing policy** / 422 non-outstanding + over-premium / **403
  raiser-approves-own** / distinct approve copies `overrideAmount` into `amount` + APPROVE
  audit / 422 no-pending / 409 different-approver + idempotent same / 409
  status-conditional 0-row). New `test/commission.e2e-spec.ts` (1 end-to-end: no-agreement
  422 → Finance-can't-manage 403 → Compliance opens a window → non-Finance calculate 403 →
  Finance calculates `18000.000` (120000 × 15%) → write-once re-calc → a dual-hatted user
  raises an override (`amount` stays `18000.000`, `overridePending`) → **raiser-approves-own
  403** + Finance-only-can't-approve 403 → a distinct Manager approves (`amount` →
  `12000.000`, `effectiveAmount 12000.000`) → idempotent → reads → a CREATE + an APPROVE
  audit row carrying the reason → supersede closes the '15' window). api unit **1222**
  (85 files); `commission.e2e-spec.ts` 1/1 isolated + in the full run; new Playwright
  `commission.spec.ts` (3).
  **Migration `20260903120000` deployed to `db` + `db-test`; `prisma migrate status`
  clean (37)**; no seed change.

**Part C #37 — Refund Management (Domain D, Process 37)** — **no separate build; covered
  by #22.** The `Refund` model, its raise (auto-minted with `CommissionReversal` in one
  `$transaction` from a negative / cancellation endorsement's premium adjustment), the
  value-threshold gate (`refundNeedsApproval` / `REFUND_APPROVAL_THRESHOLD_JOD`, drafted —
  below it auto-clears single-actor, at/above it drives `Endorsement →
  REFUND_APPROVAL_PENDING`), the maker/checker approval (`POST
  /endorsements/refunds/:id/approve`, `refund.approve` / Manager + Finance,
  `assertDifferentActors(raisedByUserId, actor)` + the `Refund_maker_checker_distinct`
  DB CHECK + a status-conditional `recordRefundApproval` → 0 rows = 409), and the
  **structural re-check at APPLY** (the apply path refuses when `refund != null &&
  refundNeedsApproval && approvedByUserId == null`, regardless of status —
  `maker-checker-segregation.md`) all landed at #22 and are e2e- + unit-covered. **Not
  covered (deferred, not a #37 build):** no standalone refund-raise endpoint — every
  `Refund` is endorsement-driven, so an **overpayment** refund (the `reason` enum lists
  it) or a refund not tied to an endorsement has no path; the `refund.raise` perm is
  seeded but wired to nothing (reserved for that future endpoint) · `Refund.paidAt` is a
  column + a view field but **nothing writes it** — there is no "mark refund disbursed"
  step / `ClientFundsLedgerEntry` `out` / payment channel (disbursement is #38 / a future
  Finance-config concern) · no premium / commission **write-off** path (the brain pairs
  "refunds *and write-offs*"; #22 does refunds only) · a `Refund` is write-once after
  approval — no reversal / void.

**Part C #38 — Payment Processing (Domain D, Process 38)** — **migration
  `20260903140000` (39th)** adds the `PaymentChannel` table + the
  `PaymentChannel_owner_exactly_one` CHECK + nullable `Receipt.paymentChannelId` /
  `Remittance.paymentChannelId` FKs; **seed +`payment-channel.manage`
  `[FINANCE_COLLECTIONS_OFFICER]`** (148 perms). `PaymentChannel` is a governed
  reference list (NOT a workflow entity) — `POST /payment-channels` (`active` on create),
  `POST /payment-channels/:id/disable` (status-conditional, idempotent),
  `GET /payment-channels` (book-wide, filterable). **No maker/checker.** **Masked-only:**
  `label` + `bankName` + `accountLast4` (`^\d{2,4}$`), NO full account / card number
  anywhere — the DTO has no full-number field, the model stays `CONFIDENTIAL`, the audit
  snapshot never carries `accountLast4` (`sensitive-data-handling.md`). #32's `Receipt` /
  `Remittance` reference a channel — **optional but validated** (an `active` channel for
  the right owner, in the invoice currency; on the receipt side it **derives
  `Receipt.method`** and a conflicting explicit `method` is a 422). The channel id is
  *loaded* (404-only) up front but the owner / status / currency / method checks run
  **after** #32's write-once resume (the #31/#28 ordering — an idempotent retry after
  the channel was later disabled still resumes 200). #32's write-once / idempotency
  comparisons now also compare `paymentChannelId` (a re-`POST` with a different channel
  → 409), including **both** `finishReceipt` **and** `finishRemittance`'s
  concurrent-landed same-checks (the latter previously returned a silent 200). The two
  owner FKs are **`ON DELETE RESTRICT`** (Prisma's `SET NULL` default would violate the
  `owner_exactly_one` CHECK on a hard delete of the owner). `InvoiceView` + the `CREATE
  Receipt` / `Remittance` audit snapshots gain `paymentChannelId`.
  **`@code-reviewer` (mandatory — a migration + payment/bank data + Confidential
  data) → APPROVE WITH MINORS**, no blocker / MAJOR / lex violation (masked-only
  confirmed genuinely complete; the `owner_exactly_one` CHECK backs the service
  validation; the derived-`method` rule matches #28 / #31; #32's contract preserved).
  **4 MINORs + 2 NITs addressed**: `finishRemittance` concurrent early-return now
  409s on a channel mismatch (was a silent 200); the usability checks moved after the
  write-once resume; the owner FKs → `ON DELETE RESTRICT` (migration re-deployed fresh);
  a forward-looking maker/checker clause added to `maker-checker-segregation.md` (the
  single-actor exemption ends the day the channel becomes mandatory / gains a "release
  payment" step); NITs — a `channel.currency === invoice.currency` 422 guard,
  remittance `loadChannel` runs after the "no collection" 422. **Verification:**
  +22 api unit (`finance.config.spec.ts` +3 — view / audit-never-carries-`accountLast4`;
  new `payment-channel.service.spec.ts` 9; `collection.service.spec.ts` +10 — method
  derived, channel disabled / wrong-owner / conflicting-method / currency-mismatch 422,
  retry-after-disable resumes, remittance wrong-insurer 422, `finishRemittance`
  concurrent-different-channel 409); `test/invoice.e2e-spec.ts` +1 (non-Finance 403 → add a customer + insurer channel
  → disable-then-use 422 → wrong-owner 422 → conflicting-method 422 → clean receipt
  (method derived) → different-channel re-post 409 → reconcile → wrong-owner remittance
  422 → clean remittance → list masked → audit carries no fragment). api unit **1271**;
  `invoice.e2e-spec.ts` 6/6 isolated; new Playwright `payment-channels.spec.ts` (3);
  turbo build / typecheck / lint OK; `prisma migrate status` clean (**39**). **Deferred:**
  no full IBAN / SWIFT / encryption; the channel on a `Receipt` / `Remittance` is
  optional not mandatory; no per-owner "default channel"; no channel on refunds (#37) /
  commission settlement (#36); no bank / gateway integration (a `Receipt` / `Remittance`
  records that money moved as a fact, not an executed transfer); no approval workflow on
  the channel itself (`active` / `disabled` only).

**Part C #39 — Bank Reconciliation (Domain D, Process 39)** — **migration
  `20260903150000` (40th)** adds `ReconciliationException.raisedByUserId` /
  `resolvedByUserId` / `resolutionNote` (all nullable), two plain indexes
  (`invoiceId`, `status`) and a partial `UNIQUE ("invoiceId") WHERE "status" <>
  'resolved' AND "invoiceId" IS NOT NULL` (raw SQL). The `ReconciliationException`
  model, the `EXCEPTION_RAISED` / `EXCEPTION_RESOLVED` `InvoiceStatus` values + the
  `WORKFLOW_TRANSITIONS.Invoice` exception hops, and the
  `reconciliation-exception.investigate` `[FINANCE_COLLECTIONS_OFFICER]` /
  `.resolve` `[FINANCE_COLLECTIONS_OFFICER, BRANCH_DEPARTMENT_MANAGER]` perms all
  pre-existed (seeded `a440c1b`) — **no seed change**. `ReconciliationException` is
  a plain-string-`status` entity (NOT a `WorkflowTransitionService` entity — the
  `CommissionLedgerEntry` precedent): `RECON_EXCEPTION_TRANSITIONS`
  (`open→[investigating,resolved]`, `investigating→[resolved]`, `resolved→[]`) +
  `assertTransition`, every move a status-conditional `updateMany` + audit row.
  `POST /reconciliation-exceptions/detect` (`reconciliation-exception.investigate`
  / Finance) takes the statement lines **in the request body** (`{ lines: [{
  invoiceId, insurerStatementAmount }] }` — there is no `InsurerStatement` model);
  `brokerRecordAmount = premiumAmount − commissionDeducted` (`computeRemittanceAmount`,
  == #32's `Remittance.amount`), `varianceAmount = computeVariance(statement,
  broker) = subtractMoney(...)` — exact, ±, never rounded away. **A non-zero
  variance ALWAYS raises a `ReconciliationException`** (`open`, exact
  `varianceAmount`) — never a silent write-off (`money-decimal-jod.md`); a zero
  variance reconciles silently. Cap `RECON_DETECT_MAX_LINES = 500` (drafted); a
  duplicate `invoiceId` → 422; an unknown / non-policy invoice is flagged per-line
  (`invoice_not_found` / `not_a_policy_invoice`), not thrown. **One non-resolved
  exception per invoice** — the partial `UNIQUE` + `P2002` are the backstop; a
  re-`detect` with the **same** figures → `exception_exists`, **different** →
  `conflicting_exception` (both report **this run's** freshly computed variance,
  a review fix). **The parent `Invoice` IS a workflow entity** — `detect` drives
  `COLLECTED | RECONCILED → EXCEPTION_RAISED` through the engine state-gated +
  best-effort (`raiseInvoiceExceptionBestEffort` — any other invoice state → the
  exception is still recorded, no transition, `logger.error` not throw; a
  same-figures re-`detect` self-heals a missed hop — a review fix).
  `POST .../:id/investigate` — `open → investigating`, stamps
  `investigatedByUserId` (already-`investigating` idempotent regardless of who;
  `resolved` → 422). `POST .../:id/resolve` (`reconciliation-exception.resolve` /
  Finance, Manager) — `{ resolutionNote (mandatory, `@MinLength(10)` /
  `@MaxLength(2000)`, logged verbatim), resumeInvoiceAs? }`;
  `{open|investigating} → resolved`; **NO figure is adjusted** — the
  `varianceAmount` stays recorded. When the `Invoice` is mid-exception the engine
  drives it `EXCEPTION_RAISED → EXCEPTION_RESOLVED → RECONCILED` (or just the last
  hop on a crash re-entry; re-reads between hops so a concurrent `resolve` is a
  clean no-op not a same-state 422). **`resumeInvoiceAs` can only be `RECONCILED`**
  (a review fix — `RECON_INVOICE_RESUME_STATUSES = ['RECONCILED']`): the engine
  map also allows `EXCEPTION_RESOLVED → REMITTED`, but resuming straight there
  would land a terminal-state invoice with **no `Remittance` row and no `out`
  `ClientFundsLedgerEntry`** (both minted only inside `POST
  /invoices/:id/remittance`'s `$transaction` — Part 7.3 client-money trace), so
  `resolve` returns the invoice to `RECONCILED` and Finance remits normally.
  `resumeInvoiceAs` required when mid-exception (422 if omitted), ignored
  otherwise. Ordering: the invoice hops run before `recordResolution` so a crash
  before the exception write is a clean retry. Idempotent re-`resolve` same note
  → 200, different note → 409. **No maker/checker** (`roles-and-segregation-of-duties.md`
  — the Finance maker/checker pair is refunds / overrides). Book-wide reads
  (`GET /reconciliation-exceptions?invoiceId=&status=` + `/:id`; capped
  `RECON_EXCEPTION_READ_LIMIT = 5000`). Audit: `CREATE ReconciliationException`
  (three figures as fixed 3dp strings + ids + status, no free text), `UPDATE` on
  investigate + on resolve (`resolutionNote` verbatim + `resolvedByUserId` +
  `resumeInvoiceAs`, the last recorded only when a hop used it) + the engine
  `TRANSITION` rows. **`/brain-gap` filed + pushed** (ibms-brain —
  `finance-lifecycle.md` gains a "Bank Reconciliation (Process 39)" section).
  web: a new **"Bank reconciliation"** screen
  (`app/(app)/bank-reconciliation/page.tsx` + `lib/finance/reconciliation-api.ts` +
  an `AppNav` entry) — an `invoiceId, amount` textarea posting a detect batch and
  a table of open exceptions with per-row Investigate / Resolve.
  **`@code-reviewer` (mandatory — workflow state-machine + financial calc +
  Confidential financial data) → APPROVE WITH MINORS**, no blocker / MAJOR / lex
  violation, all six mandatory checks pass. **3 MINORs + 2 NITs addressed**:
  fresh-variance on conflict, self-heal the missed transition, `resumeInvoiceAs`
  → `RECONCILED`-only + a `finance-lifecycle.md` Deferred note; re-read between
  resume hops, audit `resumeInvoiceAs` only when used. **Verification:** +29 api
  unit (`finance.config.spec.ts` +10 → 40; new `reconciliation.service.spec.ts`
  19); `test/invoice.e2e-spec.ts` +1 (the Process 39 path — variance → exception
  → EXCEPTION_RAISED → investigate → resolve → RECONCILED → remit → idempotent →
  audit CREATE + UPDATE carrying the note). api unit **1300** (88 files);
  `invoice.e2e-spec.ts` 7/7 isolated (re-verified after the review fixes); full
  `apps/api` e2e **22 files / 131 tests** green (no flakes this run); new Playwright
  `bank-reconciliation.spec.ts` (3); turbo `typecheck` / `lint` (api + web) OK,
  `web build` OK; `prisma migrate status` clean (**40**). **Deferred:** no
  `InsurerStatement` model / statement audit trail (the statement figures are a
  transient request input); the broker record is always the deterministic
  `premium − commission`, not the posted `Remittance.amount` (equal by #32's
  construction); `resolve` cannot itself correct a figure (a genuine broker-record
  correction is a manual / #40 concern); `resumeInvoiceAs` cannot be `REMITTED`
  until `resumeInvoice` mints the remittance artefacts; no ageing / dashboard of
  open exceptions; no automatic detection sweep (no statement data source to
  sweep); `RECON_DETECT_MAX_LINES` (500) is a drafted bound;
  `reconciliation-exception.*` are role-level (no per-officer queue).

**Part C #40 — Financial Reporting (Domain D, Process 40)** — **no migration, no
  seed change** (`financial-report.view` = `[FINANCE_COLLECTIONS_OFFICER,
  BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT, EXTERNAL_AUDITOR]`, the same
  perm `GET /commission/entries` uses — seeded in `a440c1b`). The backlog line
  has no checkboxes ("Financial Reporting — dashboard D in Part E"); #40 is the
  **backend** for Part E's Financial Dashboard. `GET /financial-report/summary?asOf=`
  (`financial-report.view`) returns `{ asOf, currency: 'JOD', receivables,
  payables, commission, profitability }`, computed on the fly, book-wide, no
  maker/checker. `receivables` / `payables` are #33's `buildReceivablesAgeing` /
  #34's `buildInsurerPayables` **totals verbatim** (the service calls
  `ClientAccountingService` / `InsurerAccountingService` and passes `asOf`
  through — future `asOf` → 422, default today; **these two sections are
  point-in-time**). `commission` is the new pure `buildCommissionRollup` — per
  `CommissionLedgerEntry` `earned = amount` (the effective commission),
  `paid = paidAmount ?? 0`, `reversed = reversedAmount ?? 0`,
  **`outstanding = max(0, amount − paid − reversed)`** (floored — a
  reconciled-then-clawed-back entry would otherwise go negative; a
  `@code-reviewer` BLOCKER, fixed). `earned == paid + outstanding + reversed`
  holds only without a paid+reversed overlap; **`netEarned = earned − reversed`**
  is the recognised-income figure; totals + `byInsurer[]` (worst-first).
  `profitability` is
  the new pure `buildProfitability` — every written policy grouped `byLine` /
  `bySegment` (`Customer.customerType`), each with `premiumWritten` /
  `claimsPaid` (Σ SETTLED / CLOSED claim net settlements) / `commissionEarned`
  (Σ `amount − reversedAmount`) / **`netPosition = premiumWritten − claimsPaid −
  commissionEarned`** (the backlog line's literal "premium − claims − commission"
  — a **drafted** metric; can be negative; worst-first). `commission` +
  `profitability` are **current-state** (`asOf` doesn't constrain them). The
  profitability section aggregates HIGHLY_CONFIDENTIAL `Claim` net settlements →
  the service writes a best-effort `READ` audit row (`entityType:
  'FinancialReport'`, `entityId: 'summary'`, counts + `asOf` only,
  `isSensitiveDataAccess` when a settled claim contributed — the #30
  precedent); #33 / #34 stay not-audited (Confidential tier). All four reads
  under one `Promise.all`; each capped at `FINANCIAL_REPORT_ROW_LIMIT = 5000`
  (`logger.warn` on truncation). New `financial-report.service.ts` /
  `financial-report.controller.ts` (`@Controller('financial-report')`) /
  `repositories/financial-report.repository.ts`; `finance.config.ts` gains
  `buildCommissionRollup` / `buildProfitability` (+ types) /
  `FINANCIAL_REPORT_ROW_LIMIT` / `PROFITABILITY_GROUP_BY`. web: a new "Financial
  report" screen. **`/brain-gap` filed + pushed** (ibms-brain —
  `finance-lifecycle.md` gains a "Financial Reporting (Process 40)" section,
  intro → "Domain D is complete"). **`@code-reviewer` (mandatory — financial
  aggregation + aggregates HIGHLY_CONFIDENTIAL `Claim` data + a new audit row) →
  CHANGES REQUESTED → resolved.** **1 BLOCKER fixed:** `buildCommissionRollup`'s
  `outstanding = amount − paid − reversed` went **negative** for a
  reconciled-then-clawed-back entry (`paidAmount == amount` **and**
  `reversedAmount > 0` — a legal #36 / #22 state), dragging the pooled total
  down and inverting the worst-first sort → now `outstanding = max(0, …)` per
  entry, plus a new `netEarned = earned − reversed` field for recognised income,
  the strict identity documented as holding only without a paid+reversed
  overlap, and a settled-then-reversed spec case added. **1 MINOR:** the
  "Net position" column now carries an on-screen caption (it is the book's
  underwriting result, not the brokerage's margin — which is `commission`).
  **3 NITs:** the summary now passes the **canonical `YYYY-MM-DD`** down to both
  sub-services (no midnight-straddle drift); the truncation `logger.warn` is
  split so it names *which* book overflowed; the book totals reduce the
  per-insurer accumulators instead of re-iterating the entry list. Six mandatory
  checks pass (money all through `money.util.ts`; read-only, no status write, no
  approval; the `READ` audit `afterValue` carries only counts + `asOf`,
  `isSensitiveDataAccess` gated on `settledClaims > 0`; not an SLA entity).
  **Verification:** +15 api unit (`finance.config.spec.ts` +9 —
  `buildCommissionRollup` no-overlap-invariant / **settled-then-reversed
  never-negative** / worst-first / empty, `buildProfitability` netPosition /
  grouping / worst-first / null-entry / empty; new
  `financial-report.service.spec.ts` 6 — composes the four sections, canonical
  `asOf` passthrough, defaults / future-422, the READ audit
  sensitive/not-sensitive + failed-audit-doesn't-break). api unit **1315**
  (88 files); `test/invoice.e2e-spec.ts` +1 (Process 40 — issue policy →
  invoice + collect → open commission agreement → calculate + settle →
  `GET /financial-report/summary` asserts all four sections, non-Finance 403,
  future `asOf` 422, the `FinancialReport` READ audit row) — **8/8 isolated**;
  new Playwright `financial-report.spec.ts` (3); turbo `typecheck` / `lint` OK;
  full `apps/api` e2e green bar the two documented chronic flakes (`rbac` /
  `up-sell` `Test timed out`, machine-load).
  **Deferred:** the `asOf` / line / insurer / branch / language **filters** + the
  dashboard UI are Part E; `commission` + `profitability` are current-state only;
  `netPosition` is a drafted metric; no CSV / export; JOD-only; in-memory
  aggregation (capped at 5000 rows / section); `financial-report.view` is
  role-level.

**Part C #41 — Customer Requests (Domain E, Process 41)** — **opens Domain E**.
  **New module** `apps/api/src/modules/customer-service/`. **Migration
  `20260903160000` (41st)** only **widens** the pre-existing `ServiceRequest`
  model — `policyId` (nullable FK, `ON DELETE SET NULL`), `detail`,
  `raisedByUserId` / `assignedToUserId` / `fulfilledByUserId`, `outcomeNote`,
  `@@index([customerId])` / `@@index([status, createdAt])` (open-queue read) /
  `@@index([assignedToUserId])` (my-queue read). The `ServiceRequest` model,
  its `slaTimerId @unique` link, and the `service-request.manage`
  (`[SALES_RELATIONSHIP_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) perm all already
  existed — **no seed change**. `ServiceRequest.status` is a **plain string,
  NOT a `WorkflowTransitionService` entity** (`SERVICE_REQUEST_TRANSITIONS` +
  `assertTransition` + a status-conditional `updateMany` per move — the
  `CommissionLedgerEntry` / `ReconciliationException` pattern):
  `open → in_progress → {fulfilled | cancelled}` (a request may be fulfilled
  on the spot from `open`). Endpoints (all `service-request.manage`):
  `POST /service-requests` (create at `open`, starts the SLA timer),
  `.../:id/assign`, `.../:id/start` (idempotent), `.../:id/fulfil` +
  `.../:id/cancel` (`{ outcomeNote }` mandatory, logged verbatim — stamps
  `closedAt` + (fulfil) `fulfilledByUserId`, resolves the SLA timer; same-note
  re-close 200, different 409, other terminal 422), `GET /service-requests` +
  `/:id`. `policyId` (optional) must belong to `customerId` (422 / 404);
  `assignedToUserId` validated (404). **The SLA timer is the generic
  `SlaTimerService` engine** — a new `SLA_REGISTRY` entry
  `service_request_fulfilment` (`entityType: 'ServiceRequest'`, **5 business
  days — DRAFTED / UNSOURCED**, escalating to `BRANCH_DEPARTMENT_MANAGER`). A
  customer-service turnaround is a courtesy target, **not a PDPL statutory
  SLA** (`pdpl-sla-timers.md` § "does NOT trigger" — internal targets are
  KPIs), but the backlog line names `SlaTimer` so it is a real timer + the
  existing nightly escalation sweep; the registry `citation` marks it
  DRAFT/UNSOURCED like the two KYC rows. **Started BEST-EFFORT at create** (the
  A.8 / `AccessRecertificationService` precedent — the request is committed, a
  timer failure must not roll it back), then a best-effort `attachSlaTimer`
  populates the 1:1 `slaTimerId` (the schema intends it — `SlaTimer.serviceRequest`
  back-relation); `SlaTimerService.resolve` (best-effort) clears it on
  fulfil / cancel. `deriveServiceRequestView`'s `sla` block has a computed
  `breached` (`resolvedAt === null && dueAt <= now`) so the UI flags "overdue"
  before the sweep stamps `escalatedAt`. **No maker/checker** (single-actor
  service-desk work — the mandatory supervisor sign-off is #42 Complaints'
  `complaint.close`, not #41). Audit: best-effort `CREATE` (ids + type +
  `detail` + status) + `UPDATE` per move (`outcomeNote` verbatim + who +
  `closedAt`) + the `SlaTimer` engine rows; `detail` / `outcomeNote` are
  Confidential business notes, not personal data — a **`NO_FULL_ACCOUNT_NUMBER`
  `@Matches` guard** (rejects a run of 9+ digits, message points at
  `PaymentChannel` #38) keeps a full bank/card number out of the free text +
  the audit row (`sensitive-data-handling.md` — a free-text field next to a
  masked-data path must not be its capture point). **`/brain-gap` filed +
  pushed** (ibms-brain — **new `meta/context/customer-service-lifecycle.md`**
  (Domain E seed) with a "Customer Requests (Process 41)" section;
  `sensitive-data-handling.md` gains the free-text-guard clause).
  **`@code-reviewer` (mandatory — a migration + a new SLA-bearing workflow with
  an escalation path + a Confidential free-text note field) → APPROVE WITH
  MINORS**, no blocker / MAJOR / lex violation, all six mandatory checks pass.
  **2 MINORs + 5 NITs addressed:** (1) `start` on a terminal request returned a
  409 from `assertTransition` — now a **422** guard first, matching `assign` /
  `fulfil` / `cancel`; (2) the `NO_FULL_ACCOUNT_NUMBER` guard on `detail` /
  `outcomeNote` + the new lex clause; NITs — the composite `@@index([status,
  createdAt])` + `@@index([assignedToUserId])` (migration re-deployed fresh),
  `detail` gained `@Transform(emptyStringToUndefined)`, a redundant `.trim()`
  removed, the drafted-citation spec iterates `EXPECTED_NON_PDPL_WORKFLOW_NAMES`,
  `assign` / `close` 0-row race + `start`-on-terminal unit tests added.
  **Verification:** +29 api unit (`service-request.config.spec.ts` 9,
  `service-request.service.spec.ts` 20; `sla-registry.config.spec.ts`
  `service_request_fulfilment` in the expected-name + drafted-citation sets).
  api unit **1344** (90 files); new `test/service-request.e2e-spec.ts` **1/1
  isolated** (the full flow — 403 non-Sales → 404 / 422 policy checks → create
  + `SlaTimer` row → assign → start (+ idempotent) → fulfil-without-note 400 →
  fulfil (SLA resolved) → idempotent re-fulfil → 409 → 422 cancel-a-fulfilled →
  second request cancelled from open → list + filter → CREATE + UPDATE audit
  carrying the note); new Playwright `service-requests.spec.ts` (3); turbo
  `typecheck` / `lint` / `build` OK; `ibms-brain` `brain-doctor.sh` 0 errors;
  `prisma migrate status` clean (**41**).
  **Deferred:** the 5-business-day SLA is **drafted / unsourced** (no broker
  service charter / SOP figure); one SLA for all four `requestType`s (no
  per-type target); **no `ServiceRequest` → `Document` link** (a fulfilled
  certificate request doesn't attach the generated PDF); a `change` request
  records intent but **executes nothing** — no path from a service request to a
  `PaymentChannel` (#38) or an `Endorsement` (#22); **no re-open path**
  (terminal is terminal); no customer-facing portal / self-service; no bulk
  actions; `service-request.manage` is role-level (only the `assignedToUserId`
  filter, no per-officer queue).

**Part C #42 — Complaints Management (Domain E, Process 42)** — **extends the
  `customer-service` module**. **Migration `20260903170000` (42nd)** only
  **widens** the pre-existing `Complaint` / `ComplaintAction` /
  `EscalationRecord` — `Complaint.resolvedByUserId` / `resolvedAt`,
  `EscalationRecord.escalatedByUserId`, the
  `Complaint_closure_maker_checker_distinct` CHECK, and 4 indexes
  (`@@index([status, createdAt])` replacing the bare `@@index([status])`,
  `@@index([claimId])`, `@@index([responsibleEmployeeUserId])`,
  `@@index([complaintId])` on both child tables). The models, the
  `ComplaintStatus` enum, `Complaint.slaTimerId @unique`, the
  `WORKFLOW_TRANSITIONS.Complaint` map, and the `complaint.log` /
  `complaint.close` / `complaint.escalate` perms all already existed — **no
  seed change**. `Complaint.status` **IS a `WorkflowTransitionService` entity**
  (unlike #41): `LOGGED → ASSIGNED → IN_PROGRESS → {RESOLVED | ESCALATED}`,
  `ESCALATED → {IN_PROGRESS | RESOLVED}`, `RESOLVED → CLOSED` — every move
  through the engine; the one non-transition write is `recordAssignee` (sets
  `responsibleEmployeeUserId`, no status change). Only `CLOSED` is terminal.
  Endpoints (all under `complaint.log` except where noted): `POST /complaints`
  (create at `LOGGED`, starts the SLA timer), `.../:id/assign`, `.../:id/start`
  (idempotent), `.../:id/actions` (`{ actionText }` — appends a
  `ComplaintAction`), `.../:id/resolve` (`{ resolution }` mandatory verbatim —
  stamps `resolvedByUserId`; same-note re-resolve 200, different 409),
  `.../:id/escalate` (**`complaint.escalate`** / MANAGER, COMPLIANCE —
  `IN_PROGRESS → ESCALATED` + an `EscalationRecord`, default
  `dispute_resolution_committee`; resolves the SLA; re-escalate self-heals a
  missed record), `.../:id/close` (**`complaint.close`** / MANAGER —
  `RESOLVED → CLOSED`), `GET /complaints` + `/:id`. `claimId` (optional) must
  belong to `customerId` (422 / 404 — "link it to a claim on dispute"; same for
  `policyId`); `responsibleEmployeeUserId` validated (404). **Mandatory
  supervisor sign-off before closure** (Part 5.2 / maker-checker): the maker is
  `resolvedByUserId` (write-once once RESOLVED), the checker is
  `closureApprovedByUserId`; `assertDifferentActors` → **403** on a self-close,
  backed by the `Complaint_closure_maker_checker_distinct` CHECK; `Complaint`
  added to `maker-checker.util.ts`'s covered-pairs table. **The SLA timer is
  the generic `SlaTimerService` engine** — a new `SLA_REGISTRY` entry
  `complaint_resolution` (`entityType: 'Complaint'`, **10 business days —
  DRAFTED / UNSOURCED**, escalating to `BRANCH_DEPARTMENT_MANAGER`). A
  complaint-resolution turnaround is a CBJ conduct-of-business matter (the CBJ
  Insurance Dispute Resolution Committee is real), **not a PDPL statutory SLA**;
  `citation` DRAFT/UNSOURCED like #41 / the KYC rows. Started **BEST-EFFORT at
  create** + a follow-up `attachSlaTimer`; `SlaTimerService.resolve`
  (best-effort) flips `resolvedAt` when the complaint reaches **`RESOLVED` OR
  `ESCALATED`** (escalation stops the internal clock). `deriveComplaintView`'s
  `sla` block has a computed `breached` (same as #41). `issue` / `resolution` /
  `ComplaintAction.actionText` / `EscalationRecord.reason` carry the shared
  **`NO_FULL_ACCOUNT_NUMBER` `@Matches` guard** — moved from
  `service-request.config.ts` to `common/dto.util.ts` this pass. Audit:
  best-effort `CREATE Complaint` + `UPDATE` on resolve / close (`resolution`
  verbatim + `closureApprovedByUserId` + `closedAt`) + best-effort
  `CREATE ComplaintAction` / `CREATE EscalationRecord` + the engine's
  `TRANSITION` rows + the `SlaTimer` engine's own. **`/brain-gap` filed +
  pushed** (ibms-brain — `customer-service-lifecycle.md` gains a "Complaints
  Management (Process 42)" section). **`@code-reviewer` (mandatory — a
  migration + a workflow state-machine + a maker/checker closure surface +
  Confidential free-text) → CHANGES REQUESTED → resolved.** All six mandatory
  checks pass. **1 MAJOR + 1 MINOR + 4 NITs addressed:** (MAJOR)
  `escalate`'s already-ESCALATED branch was a `countEscalations() === 0 →
  createEscalation()` self-heal — the count-then-create race
  `race-safe-invariants.md` forbids — **removed**; it is now a plain idempotent
  no-op (a missed best-effort `EscalationRecord` leaves the engine `TRANSITION`
  row as the fact; a `UNIQUE` backstop is wrong because
  `ESCALATED → IN_PROGRESS → ESCALATED` legally mints a second record).
  (MINOR) `close` passed `resolvedByUserId ?? ''` to `assertDifferentActors`
  (vacuous pass if a maker were ever missing) → now a hard **422** first if a
  RESOLVED complaint has no recorded resolver ("fail closed"). NITs — a comment
  on `close`'s transition `where` giving the transitive-immutability argument;
  `start` now reloads on the engine's 0-row `ConflictException` → idempotent
  200 if now `IN_PROGRESS` (mirrors `assign` / #41) + writes an `UPDATE` audit
  row; `escalate-complaint.dto.ts` `reason` drops the ambiguous double
  `@Transform`. **Verification:** +37 api unit
  (`complaint.config.spec.ts` 9, `complaint.service.spec.ts` 28;
  `sla-registry.config.spec.ts` `complaint_resolution` in the expected-name +
  drafted-citation sets). api unit **1381** (92 files); new
  `test/complaint.e2e-spec.ts` **1/1 isolated** (the full flow — 403 non-log →
  404 / 422 claim checks → 400 full-card-number issue → create + `SlaTimer` row
  → assign → start (+ idempotent) → action → non-privileged escalate 403 →
  COMPLIANCE escalate to the committee (SLA resolved) → return-to-handling →
  MANAGER resolve (+ idempotent + 409) → **self-close 403** → distinct-MANAGER
  close → idempotent re-close → escalate-a-closed 422 → list by customer /
  claim+status → CREATE + UPDATE + TRANSITION audit carrying the resolution +
  an EscalationRecord CREATE); new Playwright `complaints.spec.ts` (3); turbo
  `typecheck` / `lint` / `build` OK; `prisma migrate status` clean (**42**).
  **Deferred:** one 10-day SLA for all categories (no per-category target) —
  the figure is drafted / unsourced; **no re-open** of a `CLOSED` complaint;
  escalation does **not restart** the SLA on a return-to-handling; **no
  automatic escalation sweep to the committee** — the nightly sweep escalates
  the SLA timer to the internal manager only, the committee route is a manual
  `complaint.escalate`; no link from a complaint to a generated
  acknowledgement / final-response `Document`; no customer-facing portal.

**Part C #43 — SLA Management (Domain E, Process 43)** — **new module**
  `apps/api/src/modules/sla-dashboard/` (+ `repositories/sla-dashboard.repository.ts`).
  A read-only cross-module monitoring dashboard over the generic `SlaTimer`
  engine (backlog A.8) — **no migration, no seed change** (`sla-dashboard.view`
  = `[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT,
  EXTERNAL_AUDITOR]`, seeded in `a440c1b`). The backlog line has **no
  checkboxes** ("a monitoring dashboard over `SlaTimer` across every module") —
  like #40 it is the **backend** for a Part E-style dashboard. Kept a
  **separate module from `SlaModule`** (which owns the engine + the 15-min
  escalation sweep) — this one only reads. **No maker/checker** (read-only).
  Today only 3 workflows create timers (`quarterly_access_review`,
  `service_request_fulfilment`, `complaint_resolution`); the dashboard shows
  **all** `SLA_REGISTRY` workflows as they come online (the #8 / #10 "built
  ahead of its data source" shape). **Endpoints** (both `sla-dashboard.view`,
  book-wide, computed at `now`, capped `SLA_DASHBOARD_TIMER_LIMIT = 5000` +
  `logger.warn` on truncation): **`GET /sla-dashboard/summary`** → `{ generatedAt,
  dueSoonWindow, totals, byWorkflow[], byEntityType[], byEscalationTarget[] }`
  — every `SlaTimer` classified into one of **6 mutually-exclusive leaf
  states** (`on_track` / `due_soon` / `breached` / `escalated` /
  `resolved_on_time` / `resolved_late`; `escalated` ⇒ past due, the sweep only
  escalates overdue rows) then tallied per group + `openBreached`
  (= breached + escalated) + `entityCount` (distinct `entityId`) +
  `oldestOverdueDays`; `totals.breachRate` =
  `(resolvedLate + breached + escalated) / (that + resolvedOnTime)` 4dp
  (`"0.0000"` when nothing has reached a deadline). **`GET
  /sla-dashboard/timers?state=&entityType=&workflowName=`** → the filterable
  per-timer drill-down, worst-first (state severity, then oldest deadline);
  `state` accepts a **leaf** state or a **group** (`open` = unresolved ·
  `open_breached` = breached+escalated · `at_risk` = due_soon+breached+escalated
  · `resolved`), default when omitted = `open`; `workflowName` is a **prefix**
  match so a base name catches its `::stage` rows; `baseWorkflowName()` strips
  the `SlaTimerService` stage suffix so the summary rolls all DSR stages into
  one `dsr_access_deletion` row. Registry labels / `configuredDuration` / a
  `drafted` flag come from a **new non-throwing `findSlaRegistryEntry()`** (a
  `SlaTimer.workflowName` could name a since-renamed workflow — a monitoring
  view degrades to the raw name, never crashes). **`SLA_DASHBOARD_DUE_SOON_WINDOW
  = { value: 3, unit: 'calendarDays' }`** is a **dashboard lookahead heuristic,
  NOT an SLA registry value** — it changes only which bucket a still-open timer
  shows in, never a deadline, so it is outside `pdpl-sla-timers.md`'s "any
  registry value must be sourced" rule; drafted, tune freely. All aggregation
  is pure / unit-tested in `sla-dashboard.config.ts` (mirrors
  `finance.config.ts`); the service only loads rows + writes the audit.
  **Best-effort `READ` audit row** per read (`entityType: 'SlaDashboard'`,
  `entityId: 'summary'|'timers'`, counts + `generatedAt` + filters only —
  **never an `entityId` or a name**), `isSensitiveDataAccess` when the loaded
  set contains a timer whose `entityType` names a data subject
  (`SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES` = DSR / consent-withdrawal /
  data-sharing / incident / complaint / KYC / claim / legal-hold) — the
  #30 / #40 precedent (contrast #33 / #34, not audited). **`/brain-gap` filed +
  pushed** (ibms-brain — `customer-service-lifecycle.md` gains an "SLA
  Management (Process 43)" section; the file's intro already named "the
  cross-module SLA dashboard (#43)"; `sensitive-data-handling.md` § "What
  triggers" gains a clause — an aggregate / dashboard `READ` flips
  `isSensitiveDataAccess` on **existence-context** from an **explicit**
  entity-type list, and the canonical list belongs in `PRIV-SRS-02` once its
  field names land). **`@code-reviewer` (touches Confidential-tier operational
  data + a new `READ` audit row) → APPROVE WITH MINORS** — no blocker /
  MAJOR / lex violation, all six mandatory checks pass. **2 MINORs + 4 NITs
  addressed:** (MINOR) the drill-down tiebreak sorts used `.localeCompare` with
  no locale — a UUID `id` tiebreak could reorder under a non-`en` ICU
  collation → a byte-stable `compareRaw`; (MINOR)
  `SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES` omitted `ConsentRecord` (M03) and
  `DataSharingApproval` (M08) — both name a data subject → added, with a
  comment listing the internal-governance types deliberately out
  (`AccessRecertificationCycle`, `Vendor`, `DisposalBatch`, `DpiaScreening`,
  `RenewalCase`, `AccessDeprovisioningChecklist`); NITs — dead
  `isSlaTimerStateFilter` export removed; `byEscalationTarget` `Map` keyed on
  `escalatedTo` directly (a `null` key, no sentinel string) + null-sorts-last
  explicitly; the redundant `sensitive` key dropped from the audit `afterValue`
  (it is the `isSensitiveDataAccess` column); the web state `<select>` shows
  friendly group-filter labels. `warnIfTruncated` keeps `>= LIMIT` (matches
  `financial-report` / `claims-analytics` / `client-accounting`).
  **Verification:** +31 api unit
  (`sla-dashboard.config.spec.ts` 23 — `classifyTimer` all 6 leaves +
  boundaries (`dueAt == now` → breached, `resolvedAt == dueAt` → on-time),
  `baseWorkflowName` strip, `buildSlaTimerRows` worst-first + leaf / group
  filters, `buildSlaDashboardSummary` stage-row grouping / `entityCount` /
  registry fallback / worst-first / `breachRate` incl. 0-denominator /
  `byEscalationTarget` null bucket, `deriveSlaTimerRow` `overdueDays` /
  `ageDays`, `hasSensitiveEntityType`; `sla-dashboard.service.spec.ts` 6 —
  summary aggregate shape + best-effort READ (sensitive iff a DSR/complaint
  present; failed audit never breaks the read) + cap `logger.warn`; `timers`
  default-`open` group + `workflowName` → `workflowNamePrefix` + explicit leaf
  filter + filters in the audit; `sla-registry.config.spec.ts` +2 —
  `findSlaRegistryEntry` undefined-for-unknown / entry-for-known). api unit
  **1412** (94 files). New `test/sla-dashboard.e2e-spec.ts` **1/1 isolated** —
  seeds 6 `SlaTimer` rows (one per leaf state) under a run-unique `entityType`
  + unregistered `workflowName`; SALES → 403 both endpoints; COMPLIANCE →
  `/summary` `byWorkflow` row asserts the full per-state tally + `entityCount:
  6` + `configuredDuration: null` (registry fallback) + `byEntityType` row;
  `/timers?entityType=…` (default `open`) worst-first `[e-esc, e-br, e-soon,
  e-on]`; `state=open_breached` → `[e-esc, e-br]`; `state=resolved_late` → the
  one row with `overdueDays: 2`; `state=resolved` → both closed rows;
  `state=not_a_state` → 400; a `SlaDashboard` `READ` audit row per endpoint.
  New Playwright `sla-dashboard.spec.ts` (3 — cards + tables render, 403
  friendly copy, `@a11y` no serious/critical). turbo `typecheck` / `lint` /
  `build` OK; `prisma migrate status` clean (**42**, no new migration).
  **Deferred:** the `SLA_DASHBOARD_DUE_SOON_WINDOW` (3 calendar days) is a
  drafted lookahead heuristic; **no historical SLA-performance trend** — the
  dashboard is a live "right now" view, no `asOf`, no over-time series;
  **counts are per timer-*row*** — a multi-stage workflow (the two DSR types)
  contributes one row per escalation stage, `entityCount` surfaces the
  distinct-entity number; **in-memory aggregation** capped at 5000 rows; no
  per-workflow drill-through page, no CSV / export, no notifications (the
  dashboard reads the same `SlaTimer` rows the nightly `SlaTimerScheduler`
  sweep already escalates).

**Part C #44 — Customer Communication (Domain E, Process 44)** — **extends the
  `customer-service` module.** Migration `20260904120000` (43rd) only **widens**
  — no new table, **no seed change** (`communication.send`
  `[SALES_RELATIONSHIP_OFFICER, PLACEMENT_TECHNICAL_OFFICER, CLAIMS_OFFICER,
  FINANCE_COLLECTIONS_OFFICER]` seeded in `a440c1b`; 149 perms). Adds
  **`Customer.preferredContactChannel InteractionChannel?`** (nullable — the
  recorded outbound-channel preference, the parallel to the pre-existing
  `Customer.languagePreference` where "recorded language" already lives; also
  threaded through `CreateCustomerDto` / `CustomerService.toMasked` + `list` /
  `CustomerRepository`), **`CommunicationLog.isMarketing Boolean
  @default(false)`** + **`CommunicationLog.consentRecordId String?`** (nullable
  FK → `ConsentRecord`, `ON DELETE SET NULL`) + a `ConsentRecord.communicationLogs`
  back-relation, `@@index([customerId])` → `@@index([customerId, sentAt])`, new
  `@@index([consentRecordId])`. **`CommunicationLog` is shared with Process 12**
  (RFQ correspondence) — **DISCRIMINATOR: `rfqId IS NULL` == a Process-44
  customer-communication row**; every Process-44 read filters `rfqId: null` (a
  #12 id 404s on `GET /communications/:id`). **Not a `WorkflowTransitionService`
  entity, no maker/checker, no `SlaTimer`** — a factual send log (the
  `Interaction` #10 / #12 shape; Process 44 has no SLA — the `consent_withdrawal`
  M03 timer is a separate concern #44 only *reads*). New
  `apps/api/src/modules/customer-service/communication.{config,service,controller}.ts`
  + `dto/create-communication.dto.ts` + `dto/list-communications-query.dto.ts` +
  `repositories/communication.repository.ts`, wired as the **3rd
  `CustomerServiceModule` controller**; `common/dto.util.ts` gains `queryBoolean`
  (a `?isMarketing=true` query-flag coercer). **Endpoints** (all
  `communication.send`): `POST /communications` (`{ customerId, body
  (mandatory), channel?, languageUsed?, isMarketing?, templateId?, subject?,
  sentAt? }` — creates at `direction: OUTBOUND`, `respectedConsent: true`;
  **404** unknown customer), `GET
  /communications?customerId=&channel=&isMarketing=&direction=` (book-wide
  Process-44 list, newest-first by `sentAt` then `createdAt`, capped
  `COMMUNICATION_READ_LIMIT = 5000` + `logger.warn`), `GET
  /communications/consent-status?customerId=` (`{ customerId, marketing: {
  allowed, reason, consentRecordId } }` — a pre-compose check, declared
  **before** `:id`; **400** if `customerId` omitted), `GET /communications/:id`
  (a #12 / unknown id → **404**). **"Respect the customer's recorded channel and
  language"** — both **derived, not an input** (`resolveChannel` /
  `resolveLanguage`, pure — the #28 / #31 / #38 "computed when derivable" rule):
  omit → taken from the `Customer` record; an explicit value that **disagrees** →
  **422**; `languageUsed` always resolves (`Customer.languagePreference` has a
  value), `channel` becomes a **required input** (**422** if also omitted) only
  when the customer has no `preferredContactChannel` on record; no per-message
  language override. **The marketing-consent gate** (`evaluateMarketingConsent`,
  pure) runs **only for `isMarketing: true`** — the repo loads the customer's
  `ConsentRecord` rows where `purpose = 'MARKETING' OR isMarketing = true`
  (`PRIV-SOP-04` keeps the two as separate controls), the pure fn picks the
  **most recent** by `grantedAt ?? createdAt` then `createdAt` (a fresh grant
  after a withdrawal is a valid re-opt-in), and `granted && withdrawnAt == null`
  ⇒ **allowed** (id stamped onto `CommunicationLog.consentRecordId`); otherwise
  the send is **BLOCKED with a 422** (`reason` ∈ `no_record` / `not_granted` /
  `withdrawn`), **no `CommunicationLog` row is written** (PDPL: no marketing
  without consent), and a **best-effort `REJECT` audit row** records the attempt
  (`entityType: 'CommunicationLog'`, `entityId: 'blocked'`, `afterValue` =
  `customerId` + `channel` + `blocked: 'marketing_consent_<reason>'` +
  `consentRecordId` — **no subject / body**); a non-marketing send never touches
  the consent table (`respectedConsent` stays `true`, `consentRecordId` null).
  **`subject` / `body` carry the shared `NO_FULL_ACCOUNT_NUMBER` `@Matches`
  guard** and are Confidential-tier free text — returned unmasked but **never in
  an audit row** (the `CREATE` `afterValue` is channel / language / consent
  metadata only — the #12 / CRM precedent); **reads are NOT audited**
  (Confidential tier — the #33 / #34 / #41 precedent). `sentAt` is backdatable
  via `parseHistoricalInstant` (an offset-less datetime or a future instant →
  **422**). **No maker/checker** (logging a send is single-actor cross-functional
  work). **`@code-reviewer` (mandatory — migration + Confidential free-text + a
  consent gate + a new `REJECT` audit row) → APPROVE WITH MINORS** — no blocker /
  MAJOR / lex violation, all six mandatory checks pass or N/A with a stated
  reason. **3 MINORs + 1 NIT addressed:** `resolveChannel` treats a recorded
  `preferredContactChannel` outside `COMMUNICATION_CHANNELS` (a `MEETING` /
  `VISIT` value) as **no usable preference** (was: a nonsensical logged channel,
  or a permanent 422); `evaluateMarketingConsent` rewritten to the **fail-safe
  rule** — "allowed only if there is an active grant AND no withdrawal event is
  `>=` the newest active grant's effective time" — so a withdrawal on a
  different / older record still blocks (multi-record precedence marked drafted
  pending a pinned `PRIV-SOP-04` section); `GET /communications/consent-status`
  gained a `ConsentStatusQueryDto` (`@IsUUID` → 400 on a malformed id). **For the
  record (no change):** the consent gate is a read-then-write with no DB
  constraint (a comment + a brain Deferred note say a real dispatch must
  re-check at send time); whether a consent-status lookup is itself a loggable
  read is an open `PRIV-SOP-04` check (reads stay unaudited, matching
  #33 / #34 / #41). **`/brain-gap` filed + pushed** (ibms-brain —
  `customer-service-lifecycle.md` gains a "Customer Communication (Process 44)"
  section; intro → "#41–44 are built"). web: a new **"Communications"** screen
  (`app/(app)/communications/page.tsx` +
  `lib/customer-service/communication-api.ts` + an `AppNav` entry after
  "Complaints"). **Verification:** +38 api unit (`communication.config.spec.ts`
  23 — `evaluateMarketingConsent` all four reasons + re-opt-in + `createdAt`
  fallback/tiebreak + the fail-safe multi-record cases, `resolveChannel` /
  `resolveLanguage` derive / disagree / no-recorded-channel / non-outbound-value,
  `isCommunicationChannel`, `deriveCommunicationView`, the `CREATE` + `REJECT`
  audit snapshots carry no `subject` / `body`; `communication.service.spec.ts` 15
  — 404 customer, derive + `CREATE` audit (no body/subject), the channel /
  language / no-channel 422s, marketing granted → `consentRecordId`, marketing
  no-consent → 422 + `REJECT` + no `create`, marketing withdrawn → 422,
  non-marketing skips consent, backdated / future `sentAt`, failed audit doesn't
  break the send, `consent-status` + 404, `get` 404 for a non-Process-44 id,
  `list` filter passthrough). api unit **1450** (96 files). New
  `test/communication.e2e-spec.ts` **1/1 isolated** — COMPLIANCE (no perm) → 403;
  unknown customer → 404; channel `SMS` vs recorded `EMAIL` → 422; language `EN`
  vs recorded `AR` → 422; a 9+-digit run in `body` → 400; a plain service send
  (channel + language derived) → 201; a marketing send with no consent → 422;
  `/consent-status?customerId=not-a-uuid` → 400, then `/consent-status`
  `no_record`;
  grant a `MARKETING` `ConsentRecord`, `/consent-status` `granted`, the marketing
  send → 201 with `consentRecordId`; withdraw it, `/consent-status` `withdrawn`,
  marketing send → 422; a no-recorded-channel customer → omit-channel 422 /
  explicit-channel 201; the list excludes a seeded `rfqId`-set row and `GET
  /:that-id` → 404; audit has 2 `CREATE` rows (no message text) + a `REJECT` row
  carrying `marketing_consent_`. New Playwright `communications.spec.ts` (3 — form
  + table render, 403 friendly copy, `@a11y` no serious/critical). turbo
  `typecheck` / `lint` / `build` (8 tasks) OK; `ibms-brain` `brain-doctor.sh` 0
  errors; `prisma migrate status` clean (**43**). **Deferred:** no real delivery
  integration — a *log*, not a sender (no email / SMS gateway, no bounce / read
  tracking); `isMarketing` is a caller-asserted boolean, not derived from
  `templateId`; one consent check covers all marketing (no per-campaign
  granularity beyond `MARKETING`); the `POST` endpoint only writes `OUTBOUND`; no
  `CommunicationLog` → CRM 360° timeline wiring; no template library / render
  step; no bulk / campaign send; no `Customer` update endpoint, so
  `preferredContactChannel` is set only at customer creation; the "recorded
  channel" is a plain enum preference — the system does not verify the customer
  has that channel's contact detail on file.

**Part C #45 — Customer Feedback (Domain E, Process 45)** — **extends the
  `customer-service` module.** **No migration, no seed change** —
  `CustomerFeedback` (Part 4 core schema) already had every field a
  satisfaction-survey log needs (`customerId`, `context`, `score`, `comments`,
  `submittedAt`); `feedback.log` (`[SALES_RELATIONSHIP_OFFICER]`) was seeded in
  `a440c1b` (149 perms), and there is **no separate read permission** —
  `feedback.log` covers create *and* read (the #41 / #44 shape). **Not a
  `WorkflowTransitionService` entity, no maker/checker, no `SlaTimer`** — a
  factual log, create + read only, the `Interaction` #10 shape (the simplest
  Domain E item so far: no status, no derived fields, no cross-entity
  validation beyond the customer existing). New
  `apps/api/src/modules/customer-service/feedback.{config,service,controller}.ts`
  + `dto/create-feedback.dto.ts` + `dto/list-feedback-query.dto.ts` +
  `repositories/feedback.repository.ts`, wired as the **4th
  `CustomerServiceModule` controller**. `context` restricted to the model's own
  three documented values (`post_issuance` / `post_claim` / `post_renewal`,
  `FEEDBACK_CONTEXTS` / `isFeedbackContext`); `score` optional, bounded `1`–`5`
  (`FEEDBACK_SCORE_MIN` / `FEEDBACK_SCORE_MAX`) — **DRAFTED / UNSOURCED** (Part
  3.8 names no scale), same status as `CLAIM_LARGE_THRESHOLD_JOD` (#23).
  **Endpoints** (all `feedback.log`): `POST /feedback` (`{ customerId, context,
  score?, comments?, submittedAt? }`; **404** unknown customer), `GET
  /feedback?customerId=&context=` (book-wide, newest-first by `submittedAt`,
  capped `FEEDBACK_READ_LIMIT = 5000`), `GET /feedback/:id`; `submittedAt`
  backdatable via `parseHistoricalInstant` (an offset-less datetime or a future
  instant → **422**; default now()). **`comments` carries the shared
  `NO_FULL_ACCOUNT_NUMBER` guard, same as #41 / #42 / #44's free-text fields.**
  **`comments` is deliberately excluded from the `CREATE` audit `afterValue`**
  (ids + `context` + `score` + `submittedAt` only) — the CRM
  `Interaction.summary` precedent (`crm.service.ts` `logInteraction` logs
  channel/`occurredAt`, never `summary`), not #41 (`detail`) / #42
  (`issue`/`resolution`)'s verbatim-note precedent: feedback `comments` is the
  customer's own subjective reflection, closer in kind to a private
  relationship-log note than to an operational "what was done / why"
  business-action record — the audit trail leans conservative, the input guard
  does not follow that distinction. No ownership-based read gating —
  `feedback.log` is single-role and the sole gate on both write and read,
  book-wide (CRM's ownership check exists only because `customer.360-view.read`
  is a separate, broader-granted read permission). Audit: best-effort `CREATE
  CustomerFeedback` only; reads are not audited (Confidential tier — the #33 /
  #34 / #41 / #44 precedent). **`@code-reviewer` (mandatory — code touching
  Confidential-tier customer commentary + a new `CREATE` audit-row shape) →
  CHANGES REQUESTED → resolved.** **1 MAJOR fixed**: a first pass reasoned
  `comments` was the CRM `Interaction.summary` shape and omitted the
  account-number guard entirely — the reviewer corrected this: unlike an
  arbitrary staff-authored CRM note, feedback `comments` is customer-typed text
  solicited *immediately after* a claim settlement / policy issuance / renewal,
  precisely the moment a dissatisfied customer is most likely to write
  something like "you still haven't refunded my JOD to account 0123456789"
  (`sensitive-data-handling.md` § "What triggers this rule" names "a claim
  note" as exactly this scenario), and the field is book-wide readable by any
  Sales officer; `@Matches(NO_FULL_ACCOUNT_NUMBER, …)` added to
  `create-feedback.dto.ts` — only the audit-row exclusion survives as the
  genuine divergence from #41/#42's precedent. **2 MINORs addressed**: the
  e2e's non-Sales check now also exercises `GET /feedback` + `GET
  /feedback?customerId=` (was `POST`-only, so the comment's "or read" claim
  wasn't actually proven); new e2e assertions for the `score: 1` / `score: 5`
  boundaries (previously only the invalid `score: 6` was tested) and a full
  account number in `comments` → **400**. **2 NITs — for the record, not
  fixed**: `CustomerFeedback` has no index at all, not even
  `@@index([customerId])` (unlike every sibling Domain E model) — deferred to a
  follow-up migration once feedback volume exists, consistent with this pass's
  "no migration" framing; the `FEEDBACK_READ_LIMIT` truncation `logger.warn`
  path has no test — a gap shared with every other Domain E list, not new
  here. **`/brain-gap` filed + pushed** (ibms-brain `0c5bc63` + `7974db7` —
  `customer-service-lifecycle.md` gains a "Customer Feedback (Process 45)"
  section; intro → "#41–45 are built"). web: a new **"Feedback"** screen
  (`app/(app)/feedback/page.tsx` + `lib/customer-service/feedback-api.ts` + an
  `AppNav` entry after "Communications"). **Verification:** +11 api unit
  (`feedback.config.spec.ts` 4 — `isFeedbackContext`, `deriveFeedbackView` incl.
  null score/comments, the audit snapshot never carries `comments`;
  `feedback.service.spec.ts` 7 — 404 customer, create + audit-excludes-comments,
  optional score/comments, backdated/future `submittedAt`, failed audit doesn't
  break the create, `get` 404, `list` filter passthrough). api unit **1461** (98
  files). `test/feedback.e2e-spec.ts` **1/1 isolated** — non-Sales → 403 on
  `POST` *and* both `GET` routes; unknown customer → 404; unknown context →
  400; score `0` / `6` → 400, score `1` / `5` boundaries → 201; a full account
  number in `comments` → 400; a post-claim response with score + comments →
  201; a post-issuance response with an empty-string `comments` → 201 (score /
  comments both null); a second customer's feedback proves the `customerId` /
  `context` list filters actually filter (4 rows for one customer, newest-first
  order asserted); `GET /:id` + an unknown id → 404; the `CustomerFeedback`
  `CREATE` audit row exists but never contains the comments text. New
  Playwright `feedback.spec.ts` (3 — form + table render, 403 friendly copy,
  `@a11y` no serious/critical). turbo `typecheck` / `lint` / `build` (8 tasks)
  OK; `ibms-brain` `brain-doctor.sh` 0 errors; `prisma migrate status` clean
  (**43**, no new migration). **Deferred:** the 1–5 score scale is drafted /
  unsourced; no link from a feedback row to the triggering
  `Policy`/`Claim`/`RenewalCase` (`context` is a label, not a foreign key); no
  automatic survey trigger — logging is always a manual `POST`; no
  duplicate-response detection; no aggregation / CSAT-dashboard reporting (the
  #40 / #43 "backend for a Part E dashboard" shape is not repeated here — reads
  are a plain filtered list); no index on `CustomerFeedback` (a follow-up
  migration once volume exists); the truncation-warn path is untested.

**Part C #46 — Customer Retention (Domain E, Process 46)** — **extends the
  `customer-service` module — Domain E (#41–46) is now complete.**
  **Genuinely no migration, no seed change** — `RetentionCase` (Part 4 core
  schema) already had every field needed; `RenewalCase` (Part 3.9 core
  schema) already carried `retentionEscalatedAt DateTime?`, a nullable
  timestamp clearly provisioned for exactly this mechanism, unused until
  now; `retention-case.manage` `[SALES_RELATIONSHIP_OFFICER,
  BRANCH_DEPARTMENT_MANAGER]` was seeded in `a440c1b` (149 perms). **Built
  ahead of its data source** (the #8 / #10 / #29 shape) — the renewal module
  (Part 3.9) that would create a `RenewalCase` per policy nearing expiry is
  **not built**, so in normal running the sweep is a logged no-op, exactly
  #29 Loss Ratio's precedent. **Not a `WorkflowTransitionService` entity, no
  maker/checker, no `SlaTimer`** — a factual log; `status` is a plain string
  `open → closed` (the model's own vocabulary — no outcome/resolution field,
  the bare schema has none). New
  `apps/api/src/modules/customer-service/retention-case.{config,service,controller}.ts`
  + `retention-sweep.scheduler.ts` + 2 DTOs +
  `repositories/retention-case.repository.ts`, wired as the **5th
  `CustomerServiceModule` controller** (`AuthModule` newly imported there, for
  the scheduler's system-account lookup). **The classifier**
  (`classifyRenewalCaseForRetention`, pure): `lapse_risk` ⇐ `status ===
  'LAPSED'` — checked first, always wins over inactivity; `renewal_inactivity`
  ⇐ the cycle has **not concluded** (`RENEWED` / `CANCELLED` excluded;
  `LAPSED` is deliberately NOT "concluded" — it's the other trigger) **and**
  `RENEWAL_INACTIVITY_THRESHOLD_BUSINESS_DAYS = 30` business days have
  elapsed since `triggeredAt`, reusing **`isFollowUpDue`**
  (`common/follow-up.util.ts` — the same test the RFQ #12 / Claim #27
  follow-up sweeps use) — **DRAFTED / UNSOURCED** (Part 3.9 names a
  90-*calendar*-day `leadTimeDays` default but no inactivity-escalation
  figure), same status as the #41 / #42 SLA figures; the two reasons are
  mutually exclusive by construction. **The race-safe invariant is
  `RenewalCase.retentionEscalatedAt`, not a new `RetentionCase` constraint**
  (`ibms-brain/meta/lex/race-safe-invariants.md`) — `escalateAndCreateRetentionCase`
  (`retention-case.repository.ts`) stamps + creates the `RetentionCase` in
  **ONE `$transaction`** (a deliberate local exception to this codebase's
  no-`$transaction` convention, the `claim.repository.ts createNotification`
  / `quotation.repository.ts` shape), a **status-conditional `updateMany`**
  (`WHERE retentionEscalatedAt IS NULL AND status NOT IN (RENEWED,
  CANCELLED)`, the `RfqInsurer.followUpAlertSentAt` / `stampFollowUpAlert`
  shape (#12) plus a `status` re-assertion that precedent didn't need);
  `runSweep` calls it once — a `null` return means the row was already
  escalated or concluded between the load and the write, counted as
  `skippedConcurrent` (distinct from `failed`). **`RenewalCase.status` is
  NEVER written by this sweep** — only checked; per-row isolation (the #9 /
  #12 / #27 shape). **No "one open `RetentionCase` per customer" invariant** —
  deliberately not built (would need a migration; the schema has no FK to
  dedupe against) — two at-risk policies for one customer legitimately open
  two cases. **Endpoints** (all `retention-case.manage`): `POST
  /retention-cases` (manual open, `{ customerId, reason }`; **404** unknown
  customer), `POST /retention-cases/sweep` (on-demand, declared before the
  `:id` routes, counts only — the #27 `follow-up-sweep` shape), `GET
  /retention-cases?customerId=&status=&reason=` (book-wide, capped
  `RETENTION_CASE_READ_LIMIT = 5000`) + `/:id`, `POST
  /retention-cases/:id/close` (`open → closed`, no body — the model has no
  note field; idempotent, **404** unknown). **`RetentionSweepScheduler`**
  nightly at **08:00 UTC** (after the 07:00 claim follow-up sweep), the
  `system@ibms.internal` account precedent, delegating to the same
  `runSweep` the on-demand endpoint calls. Audit: best-effort `CREATE
  RetentionCase` per opened case (sweep or manual), `UPDATE` on close;
  reads not audited (Confidential tier — the #33 / #34 / #41 / #44 / #45
  precedent). **`@code-reviewer` (mandatory — this change IS the
  `race-safe-invariants.md` implementation + a new scheduler) → CHANGES
  REQUESTED → resolved.** **1 BLOCKER fixed**: the first pass had
  `stampRetentionEscalation` and `create` as two separate, non-transactional
  writes — a `create` failure *after* a successful stamp permanently
  stranded the `RenewalCase` as "escalated" with no `RetentionCase` ever
  created, and since `findRenewalCasesForSweep` filters on
  `retentionEscalatedAt: null`, no future sweep would ever reconsider it —
  the backlog's one automatic-open checkbox silently and irrecoverably lost
  for that record, with a "next run will retry" log message that was false
  for exactly this failure mode; fixed by wrapping both writes in one
  `$transaction` so a failed create rolls the stamp back too (the
  `claim.repository.ts createNotification` precedent — "so a crash cannot
  leave a claim with no status-history trail," the same reasoning applies
  verbatim here). **1 MAJOR fixed**: the stamp's `where` originally
  re-asserted only `retentionEscalatedAt: null`, not `status` — a
  `RenewalCase` concluding (`RENEWED` / `CANCELLED`) *between* the sweep's
  load and the stamp could still pass and open a spurious case for a
  customer who just renewed successfully; fixed by re-asserting `status NOT
  IN (RENEWED, CANCELLED)` in the same `where`. Both gaps were dormant (no
  real `RenewalCase` traffic exists yet — the renewal module isn't built)
  but would have been live races the day it lands — exactly why this review
  is mandatory. **2 MINORs addressed**: a distinct `skippedConcurrent`
  counter (was indistinguishable from a plain "not due" skip in
  `RetentionSweepResult`); a new unit test proving a `create` failure
  *after* a successful stamp rolls back cleanly (the exact BLOCKER
  scenario). **`/brain-gap` filed + pushed** (ibms-brain `4c1f2c9` +
  `d7aad06` — `customer-service-lifecycle.md` gains a "Customer Retention
  (Process 46)" section; intro → "Domain E is complete — #41–46 are all
  built"). web: a new **"Retention"** screen
  (`app/(app)/retention-cases/page.tsx` +
  `lib/customer-service/retention-case-api.ts` + an `AppNav` entry after
  "Feedback") — an open form + a "Run detection sweep now" button + a table
  with a per-row Close. **Verification:** +28 api unit
  (`retention-case.config.spec.ts` 12 — the classifier's precedence + every
  non-terminal status + both concluded statuses + the reason/status
  predicates + the view/audit-snapshot shapes; `retention-case.service.spec.ts`
  13 — manual create + 404 + audit, the sweep's
  lapse/inactivity/skip/lost-race/post-stamp-create-failure/per-row-isolation
  branches, close idempotent/404, list filter passthrough;
  `retention-sweep.scheduler.spec.ts` 3 — missing system account / delegates
  with the system actor id / a service failure doesn't throw). api unit
  **1489** (101 files, from 1461). New `test/retention-case.e2e-spec.ts`
  **1/1 isolated** — seeds 4 `RenewalCase` rows (LAPSED / stale-unresolved /
  fresh-unresolved / RENEWED) under one customer; non-Sales/Manager → 403 on
  the sweep; the on-demand sweep opens exactly the lapsed + stale cases,
  stamps `retentionEscalatedAt` on both (leaves the fresh + renewed ones
  untouched), and a second sweep run opens nothing new (idempotency); manual
  open 404 unknown customer / 400 unknown reason / 201; close + idempotent
  re-close + 404 unknown; `customerId` / `status` / `reason` list filters; a
  `CREATE` audit row per opened case (3: 2 swept + 1 manual) + an `UPDATE` on
  close. New Playwright `retention-cases.spec.ts` (3 — form + table render
  (open case shows Close, closed does not), 403 friendly copy, `@a11y` no
  serious/critical). turbo `typecheck` / `lint` / `build` (8 tasks) OK;
  `ibms-brain` `brain-doctor.sh` 0 errors; `prisma migrate status` clean
  (**43**, no new migration). **Deferred:** the renewal module (Part 3.9)
  itself is not built, so the sweep has no real `RenewalCase` traffic in
  normal running — only e2e tests create one directly; the 30-business-day
  inactivity threshold is drafted / unsourced; no per-customer dedup of open
  cases — the schema has no `renewalCaseId` / `policyId` FK on
  `RetentionCase` to dedupe against; no outcome / resolution field on close
  — "was the customer retained or lost" is not recorded, the bare schema has
  none; no link from a `RetentionCase` back to the `RenewalCase` / `Policy`
  that triggered it; no auto-close when the underlying `RenewalCase`
  eventually reaches `RENEWED`.

**Part D §5.1 — Consent Management (M03)** — **opens Part D / PCMS**; new
  module `apps/api/src/modules/pdpl/`. The backlog bundles all nine Part D
  systems under Process **#52 Data Protection Compliance**; M03 is the
  first of the nine, and the first PCMS module (M01–M12) with any code.
  **Genuinely no migration, no seed change** — `ConsentRecord` (Part 4.1
  core schema) already had every field needed; `consent.manage`
  `[SALES_RELATIONSHIP_OFFICER, PLACEMENT_TECHNICAL_OFFICER,
  CLAIMS_OFFICER, DATA_PROTECTION_OFFICER]` was seeded in `a440c1b` (149
  perms) — one permission covers capture, withdrawal, and reads alike (the
  #41/#44/#45 shape). **Not a `WorkflowTransitionService` entity** — no
  `status` field at all, just `grantedAt` / `withdrawnAt` on an otherwise
  immutable row; a subject's multiple `ConsentRecord` rows across time ARE
  the audit trail (Process 44's pre-existing `evaluateMarketingConsent`
  already reads it that way). **Endpoints** (all `consent.manage`): `POST
  /consent-records` (`{ customerId? | insuredPersonId?, purpose, granted,
  consentTextVersion }` — a grant OR an explicit decline, always recorded,
  never silently dropped; `isMarketing` is DERIVED from `purpose`, never an
  input — the "computed, not an input, when derivable" rule, #28/#31/#38/
  #44 — enforcing `PRIV-SOP-04`'s "consent and contractual necessity are
  always two separate, independently-actionable controls" structurally);
  `POST .../:id/request-withdrawal` + `POST .../:id/confirm-withdrawal` — a
  **two-step withdrawal**, not one call; `GET /consent-records?customerId=
  &insuredPersonId=&purpose=&granted=` + `/:id`. Exactly one of
  `customerId` / `insuredPersonId` is a service-level 422, **not a DB
  CHECK** (unlike `PaymentChannel`'s `owner_exactly_one`, #38) — reasoned:
  a `ConsentRecord` is written by exactly one call site, once, never
  edited afterward, so there is no concurrent-write race to guard against.
  **The two-step withdrawal gives the pre-existing, previously-unused
  `consent_withdrawal` `SLA_REGISTRY` entry (2 business days, `PRIV-STD-01`
  §6.3) a real window**: `requestWithdrawal` starts the SLA clock
  (best-effort `SlaTimerService.startTimer`) without touching
  `ConsentRecord`; `confirmWithdrawal` stamps `withdrawnAt` and resolves
  the timer (best-effort). The model's own field comment — `withdrawnAt`
  "must reflect in register within 2 business days" — only makes sense if
  intake and reflection are genuinely separate events; a single atomic
  call would make the SLA vacuous by construction. `confirmWithdrawal`
  also works standalone with no prior request (`SlaTimerService.resolve`
  is a documented no-op when nothing is open). **Feeds Process 44's
  marketing-send gate for free**: `evaluateMarketingConsent` already reads
  the live `withdrawnAt` on every send, so "affected communications
  suppressed immediately" is satisfied the instant `confirmWithdrawal`
  runs, by code that shipped before this module did — M03 touches no
  `CommunicationLog` code at all. Audit: `CREATE` (ids + purpose + the
  decision — no free text, the model has none), `UPDATE` on the withdrawal
  (the event only) + the `SlaTimer` engine's own rows. New
  `apps/api/src/modules/pdpl/consent.{config,service,controller}.ts` + 2
  DTOs + `repositories/consent-record.repository.ts`, registered after
  `SlaDashboardModule`. `apps/web/` gains a **"Consent"** screen (a
  capture form + a table with per-row Request withdrawal / Confirm
  withdrawal). **Verification**: +29 api unit
  (`consent.config.spec.ts` 10, `consent.service.spec.ts` 19) → api unit
  **1518** (105 files, from 1489); new `test/consent-record.e2e-spec.ts`
  1/1 isolated (403 outside the four roles, 422 both/neither owner, 404
  unknown customer, grant + decline + InsuredPerson-owner capture,
  request-withdrawal 422 on a never-granted record, the `SlaTimer` row +
  its `consent_withdrawal` workflow name, confirm-withdrawal resolving it,
  idempotent re-confirm, a standalone confirm with no prior request,
  Process 44's `/communications/consent-status` reading the withdrawal
  live, list filters, `CREATE`+`UPDATE` audit rows); new Playwright
  `consent.spec.ts` (3). turbo `typecheck` / `lint` / `build` (8 tasks)
  OK; `ibms-brain` `brain-doctor.sh` 0 errors; `prisma migrate status`
  clean (**43**, unchanged). **Deferred:** the capture screen is generic,
  not wired into the backlog's 7 named touchpoints individually; no
  per-subject "current status" read for a non-MARKETING purpose (a caller
  must apply `evaluateMarketingConsent`-style logic itself); no bulk/
  import capture path; a genuine double-call race on `request-withdrawal`
  can create more than one open `SlaTimer` for the same record — cosmetic
  only, `resolve` closes every matching row together, not hardened
  further. The other eight Part D systems (DSR, retention & disposal
  *execution*, vendor risk, data sharing, incident & breach, DPIA,
  notices, RoPA) and the DPO Workspace dashboard remain unbuilt.

**Part C #47 — KYC (Domain F, Process 47)** — **no build required.** The backlog line
  reads "#47 KYC — fully covered under #3–4", with no checkboxes of its own. Verified
  2026-09-04 (user request, before starting #48): every #3-4 checkbox — the two-form
  Customer creation, KYC + document capture (`APPLICATION_PROPOSAL`), UBO + ownership% +
  PEP capture, sanctions/PEP/AML screening at intake / on material change / recurring
  batch, the automatic EDD path with a separate longer SLA, the maker/checker approval
  gate (app-level `assertDifferentActors` **plus** a DB `CHECK`) with `Customer.status`
  never reaching `ACTIVE` before approval, the risk-based periodic re-KYC schedule
  (`nextReviewDueAt`), and the step-by-step onboarding wizard — maps to real, tested,
  permission-gated code in `apps/api/src/modules/customer/` (`KycService`,
  `ScreeningService`, the two schedulers) and `CustomerOnboardingWizard.tsx`. The only
  gaps are ones the README already documented as deliberate before this check (a fixture
  watchlist, not a real sanctions/PEP/AML provider; drafted/unsourced SLA and re-KYC
  figures) — none are missing backlog checkboxes.

**Part C #48 — AML/CFT Transaction Monitoring (Domain F, Process 48)** — **opens
  Compliance & Risk beyond KYC**; new module `apps/api/src/modules/compliance-risk/`.
  **Migration `20260904130000` (44th) only widens** the pre-existing
  `TransactionMonitoringAlert` model (Part 7.2 core schema — no application code had
  ever written to it): `sourceEntityType` / `sourceEntityId` (nullable), three indexes,
  and two race-safe uniqueness guards. **No seed change** — `aml.monitor` /
  `aml.escalate` (both `[COMPLIANCE_OFFICER]`, module `compliance-risk`) were seeded
  ahead of time in `a440c1b` (149 perms, unchanged), the same "permission pre-seeded,
  code lands later" shape as every Domain E item. **Not a `WorkflowTransitionService`
  entity, no maker/checker** — `aml.monitor` (log/detect/read/close) and `aml.escalate`
  (the two-step suspicious-activity path) are two distinct permissions the seed clearly
  means to separate, even though both currently grant to the same single role — the #42
  `complaint.escalate` shape, not a dual-approver claim-settlement gate.

  **Detection** (`TransactionMonitoringSweepScheduler`, nightly 09:00 UTC — after the
  08:00 retention sweep — + on-demand `POST /transaction-monitoring-alerts/detect`,
  both `aml.monitor`) runs four pure classifiers (`transaction-monitoring.config.ts`)
  over existing Finance/Endorsement data — no new business process, just reading what
  #31-32/#22 already write: **`large_premium_payment`** and **`third_party_payment_source`**
  are both scanned off every `Receipt` (an actual collected payment, #32 — a
  raised-but-unpaid `Invoice` is not yet a "payment"), the first comparing the
  underlying `Invoice.premiumAmount` against a **drafted, unsourced**
  `AML_LARGE_PREMIUM_THRESHOLD_JOD = '15000.000'` (the `CLAIM_LARGE_THRESHOLD_JOD` #23
  shape), the second checking whether the `Receipt`'s `PaymentChannel` (#38) belongs to
  a customer other than the one invoiced. **`third_party_payment_source` is DORMANT
  in production, not merely gapped — a `@code-reviewer` BLOCKER**:
  `CollectionService.assertReceiptChannelUsable` (#38,
  `apps/api/src/modules/finance/collection.service.ts`) already rejects any real
  `Receipt` whose channel mismatches the invoiced customer before one can exist, so
  this classifier can never fire against a `Receipt` created through the real `POST
  /invoices/:id/receipt` path — the e2e test exercises it only by inserting a `Receipt`
  directly via Prisma, deliberately bypassing `CollectionService`. Kept coded,
  unit-tested, and wired into the sweep as a forward-compatible detector (activates
  with no further code change if a legitimate cross-customer payment path is ever
  added); documented prominently rather than architecturally changed, since relaxing
  `assertReceiptChannelUsable` is a business decision, not a code fix. A `Receipt` with
  no recorded channel at all (`paymentChannelId` is optional) is a separate, narrower
  gap: it cannot be classified either way and is silently skipped.
  **`frequent_cancellations`** / **`frequent_refunds`** are a rolling 90-calendar-day
  count of `Cancellation` / `Refund` rows per customer (reached only via
  `Endorsement.policy.customerId` — neither child table carries its own `customerId`)
  against a **drafted** threshold of 3.

  **Race-safety** (`ibms-brain/meta/lex/race-safe-invariants.md`): a plain
  `@@unique([patternType, sourceEntityId])` stops the sweep from re-alerting the same
  `Receipt` forever — Postgres treats every `NULL` `sourceEntityId` as distinct from
  every other, so the two customer-level aggregate patterns (which never set it) **and
  a manual log (which never sets it either)** are entirely unaffected; a hand-authored
  partial `UNIQUE ("customerId", "patternType") WHERE status = 'open' AND "patternType"
  IN ('frequent_cancellations', 'frequent_refunds')` (the `UpSellRecommendation` /
  `ClaimFollowUpAlert` shape — Prisma cannot express the predicate) caps the two
  aggregate patterns at one open alert per customer/pattern. **This predicate is
  scoped directly to `patternType`, NOT to `sourceEntityId IS NULL`** — a
  `@code-reviewer` BLOCKER on the first pass: a `sourceEntityId IS NULL` predicate
  would also have collided two unrelated manual `other`-pattern alerts for the same
  customer (the manual endpoint's own reason for existing — a repeated, ongoing note),
  and `create()` had no pre-check or `P2002` catch, so it surfaced as an uncaught 500;
  `create()` now catches `P2002` → a 409 `ConflictException`. The service pre-checks
  both indexes before writing (avoids the obvious duplicate on the common path) and
  separately maps a concurrent `P2002` on either to `skippedExisting`, distinct from
  `failed` — the `UpSellRecommendation` precedent. Per-candidate isolation: one bad row
  does not abandon the rest of the sweep (the #9/#12/#27/#46 shape).

  **Manual log**: `POST /transaction-monitoring-alerts` (`aml.monitor`) — any of the
  model's five documented `patternType`s (the four automated ones plus `other`), for a
  pattern Compliance notices that machine detection doesn't cover. `detailText` carries
  the shared `NO_FULL_ACCOUNT_NUMBER` guard (`common/dto.util.ts`, the #41/#42/#44/#45
  precedent) — the model's own default `classification` is `HIGHLY_CONFIDENTIAL`
  ("names payment sources/counterparties, AML-sensitive").

  **The suspicious-activity escalation path is two separate steps** — the M03
  consent-withdrawal request/confirm shape, chosen for the same reason: `POST
  /:id/escalate` (`aml.escalate`) records the internal decision (from `open` only,
  idempotent — checked in that order deliberately: the escalation flag is tested
  *before* the `status` guard, a MINOR fix, so an alert escalated and later closed
  still reports itself idempotently on a retried `escalate` rather than 422ing just
  because it is no longer open); `POST /:id/report-to-authority` (`aml.escalate`) records that the report
  was actually filed with the competent authority, and **requires `escalate` to have run
  first** (422 otherwise — a report with no internal decision behind it is not this
  flow's shape), idempotent. `POST /:id/close` (`aml.monitor`) is `open → closed`, no
  body — the model has neither a note field nor a `closedAt` column, so (unlike
  `RetentionCase`) the `UPDATE` `AuditLogEntry.occurredAt` is the closure timestamp of
  record. **Record-keeping**: no delete endpoint exists anywhere on this model — the row
  plus its `CREATE`/`UPDATE` audit trail *is* the regulator-mandated record; the actual
  retention **period** is undocumented/unsourced (no CBJ AML source figure identified),
  flagged in `ibms-brain/meta/context/transaction-monitoring.md` rather than built as a
  tracked deadline the way `kyc-aml-sla-timers.md`'s two figures are — the backlog names
  no filing deadline the way M03's "2 business days" was explicit, so this module adds
  no `SlaTimer`.

  `GET /transaction-monitoring-alerts?customerId=&patternType=&status=&
  escalatedToSuspiciousActivity=` + `/:id` (book-wide, capped
  `TRANSACTION_MONITORING_READ_LIMIT = 5000`). Audit: best-effort `CREATE` per alert
  (sweep or manual — ids + `patternType` + `status` + source provenance, **never
  `detailText`** — the #44 `subject`/`body` / #45 `comments` precedent), `UPDATE` on
  escalate / report / close, every row `isSensitiveDataAccess: true` (Highly Confidential
  AML data). **`get()`/`list()` also write a best-effort `READ` audit row** — a
  `@code-reviewer` MAJOR on the first pass, which had followed the Confidential-tier
  #33/#34/#41/#44/#45 "reads are not audited" precedent; `TransactionMonitoringAlert`
  is `HIGHLY_CONFIDENTIAL`, the same tier as `Claim`, whose `get()`/`get360View()`
  precedent (`sensitive-data-handling.md` / Part 10.3) says the opposite — every read
  of Highly Confidential data is logged (ids/counts only, never `detailText`).
  `apps/web/` gains an **"AML monitoring"** screen
  (`app/(app)/transaction-monitoring/page.tsx` +
  `lib/compliance-risk/transaction-monitoring-api.ts` + an `AppNav` entry after
  "Consent") — a log form + a "Run detection sweep now" button + a table with per-row
  Escalate / Report to authority / Close.

  **`@code-reviewer` (mandatory — Highly Confidential AML data + financial reads +
  a new race-safe-invariant pattern) → CHANGES REQUESTED → resolved: 2 BLOCKERs**
  (the partial-index scoping above — fixed by re-scoping to `patternType IN (...)`
  and adding the `P2002` catch in `create()`; `third_party_payment_source`'s
  production dormancy above — documented prominently rather than fixed, since
  relaxing `CollectionService.assertReceiptChannelUsable` needs its own product
  decision, not a unilateral code change) **+ 1 MAJOR** (the missing `READ` audit on
  `get()`/`list()` — fixed) **+ 2 MINORs** (`escalate()`'s idempotency-check ordering
  — fixed; the sweep's `scanned` count mixed row-counts with distinct-customer-counts
  — fixed to sum actual `Cancellation`/`Refund` rows examined).

  **Verification**: +57 api unit (`transaction-monitoring.config.spec.ts` 23 — every
  classifier + boundary + the audit-snapshot's `detailText` exclusion;
  `transaction-monitoring.service.spec.ts` 31 — manual log incl. no-customerId + the
  P2002→409 fix, all four sweep patterns incl. both patterns firing on one receipt +
  the pre-check skip + a `P2002` mapping to `skippedExisting` + a genuine failure not
  aborting the rest of the sweep, escalate/report/close incl. every guard +
  idempotency + the closed-but-escalated idempotency fix, the new `get()`/`list()`
  `READ`-audit tests;
  `transaction-monitoring-sweep.scheduler.spec.ts` 3) → api unit **1575** (106 files,
  from 1518). New `test/transaction-monitoring.e2e-spec.ts` **1/1 isolated** (extended
  post-review) — seeds a
  large-premium `Receipt`, a third-party-channel `Receipt`, an ordinary `Receipt`, 3
  `Cancellation`s (one `Endorsement`/`Policy` each —
  `Endorsement_one_live_cancellation_per_policy`, migration 20260902170000, permits only
  one live cancellation `Endorsement` per policy at a time, discovered by the first e2e
  run) and 3 `Refund`s under one customer; a non-Compliance actor → 403 on
  detect/list/escalate; the on-demand sweep flags all four patterns and is idempotent on
  re-run; manual log incl. the account-number-guard 400 + unknown-`patternType` 400 +
  unknown-customer 404; **a second independent manual `other` alert for the same
  customer succeeds** (the BLOCKER regression test) while **a manual log of an
  already-open aggregate pattern 409s** (the partial index's actual, intended
  invariant); report-before-escalate → 422; escalate → report → close, each
  idempotent; **re-escalating the closed-but-escalated alert stays idempotent** (the
  MINOR fix); a `CREATE` audit row per alert (6 total — 4 swept + 2 manual, none
  carrying `detailText`) + `UPDATE` rows for escalate/report/close + `READ` rows for
  `get()`/`list()` (the MAJOR fix). New Playwright `transaction-monitoring.spec.ts`
  (3 — form + table render, 403 friendly copy, `@a11y` no serious/critical). `npm run
  typecheck`/`lint`/`build` (api + web) OK; `prisma migrate status` clean (**44**).
  **Deferred**: the four thresholds are drafted/unsourced; `third_party_payment_source`
  is dormant in production (documented, see above) and separately cannot classify a
  `Receipt` with no recorded `PaymentChannel` either way; no cross-pattern dedup (the
  same underlying activity can trip more than one pattern with nothing linking the
  resulting alerts); no case-management workflow beyond `open`/`closed` (no assignment,
  no investigator notes beyond `detailText`, no link to a filed SAR document); no
  bulk/CSV export; `aml.monitor`/`aml.escalate` are role-level (no per-officer queue).

**Part C #49 — Sanctions & PEP Screening (Domain F, Process 49)** — the backlog's one
  checkbox: "Screen at onboarding + on any material change + a recurring batch against
  **updated lists**." The first two legs were already built under #3-4
  (`KycService`/`ScreeningService`, verified 2026-09-04 as fully covered); this item
  finishes the third leg by giving the recurring batch real list data — two free,
  publicly published sanctions lists, not a fictional fixture — and a cadence tied to
  how often those lists actually change, instead of an unsourced monthly guess.

  **Migration `20260904140000` (45th) adds `WatchlistSource` / `WatchlistEntry` /
  `WatchlistSyncRun`** — genuinely new tables, not a widening of an existing model.
  `WatchlistEntry` is the local sync cache: `sourceRecordId` (OFAC `ent_num` / UN
  `DATAID`) is the upsert/prune key, `normalizedName` is the canonical match key (see
  below). `WatchlistSyncRun` is the sync job's own operational health log — one row per
  attempt, `status`/`recordCount`/`errorMessage` — not an `AuditLogEntry` (the
  `SlaTimer`/`AccessRecertificationCycle` "own tracking table" shape). **No seed
  change** — `sanctions-pep.screen` (`[COMPLIANCE_OFFICER]`, module `compliance-risk`)
  was pre-seeded, gating three endpoints: `POST /watchlist-sync/run`, `GET
  /watchlist-sync/status`, `POST /screening/recurring-batch`.

  **Two real, free, no-API-key sanctions lists, verified reachable live on 2026-09-05**:
  OFAC SDN (`https://www.treasury.gov/ofac/downloads/sdn.csv`, 302-redirects to
  `sanctionslistservice.ofac.treas.gov`, ~19,000 records, a no-header 12-column CSV with
  mixed quoted/unquoted fields) and the UN Security Council Consolidated List
  (`https://scsanctions.un.org/resources/xml/en/consolidated.xml`, ~1,000 records,
  `<CONSOLIDATED_LIST><INDIVIDUALS>`/`<ENTITIES>` XML). Both parsers are **hand-rolled,
  no new npm dependency** — a general quoted-CSV-field parser (handles OFAC's doubled-
  quote escaping and mixed quoting) and a scoped regex block/tag extractor for the UN
  XML, safe specifically because every tag this module reads (`DATAID`, `FIRST_NAME`,
  `SECOND_NAME`, `THIRD_NAME`, `FOURTH_NAME`, `UN_LIST_TYPE`, `REFERENCE_NUMBER`,
  `COMMENTS1`) is a flat, single-occurrence leaf directly inside
  `<INDIVIDUAL>`/`<ENTITY>` — verified against the real, live document, not assumed from
  documentation alone. Both are unit-tested against real captured sample lines/blocks.
  Aliases are not matched — primary name only, the same scope limit `sample-watchlist.ts`
  already had.

  **The network boundary is two tiny injectable classes** (`OfacSdnFetcher`,
  `UnConsolidatedFetcher`, `watchlist-fetchers.ts`) so `WatchlistSyncService` never calls
  `fetch()` directly. `WatchlistSyncScheduler` runs every 12 hours (the lists' own
  real-world refresh cadence) or on demand: fetch → parse → `WatchlistEntryRepository.
  upsertMany` (stamps every parsed record with the current `WatchlistSyncRun.id`,
  chunked at 100 records with bounded `Promise.all` concurrency — not a raw-SQL bulk
  upsert, since OFAC alone is ~19,000 rows and a fully sequential await-per-row loop
  would take unnecessarily long for a background job nobody is waiting on) → `pruneStale`
  (deletes every row of that source NOT stamped with this run's id — i.e. dropped from
  the source list since the last sync). Two passes, not a `$transaction`: a cache
  refresh from a non-transactional external source is not a financial/workflow write —
  a sync that dies partway just leaves a mix of old/new rows, which the next sync
  supersedes (`race-safe-invariants.md` guards against a *stranded* invariant, e.g. a
  `Refund` with no matching stamp; this isn't that shape). Per-source isolation — one
  source's fetch/parse failure does not block the other.

  **`ScreeningService.run()` now checks TWO sources**: `sample-watchlist.ts` (unchanged
  — a fictional, dev/test-only fixture, disabled in production) and the real synced
  `WatchlistEntry` cache (every environment, including production). Matching is an
  exact comparison on `normalizeWatchlistName`'s canonical form — uppercase, strip
  everything but letters/digits/whitespace, sort the whitespace-split tokens — applied
  identically at ingestion time and match time. **Order-independent** (OFAC formats
  "LASTNAME, Firstname"; a customer record might store "Firstname Lastname" — both
  reduce to the same sorted token string) but **explicitly NOT fuzzy or phonetic** — a
  documented limitation carried forward from `sample-watchlist.ts`'s own header ("a
  simple case-insensitive substring check, not a fuzzy/fingerprint match a real
  sanctions screening product would use"): spelling variants, transliteration
  differences, honorifics, and a missing/extra middle name all defeat it.

  **`ScreeningBatchScheduler`'s cadence changed from a drafted monthly guess to every 4
  hours** — the two source lists resync every 12 hours, so re-screening customers twice
  within that window bounds the "the list changed but we haven't re-checked" gap to at
  most one sync interval plus one screening interval; this is now a **real, sourced
  ratio** (an observed publication cadence), not an arbitrary pair, though still
  **DRAFTED** in the sense that no OFAC/UN SLA document commits to exactly 12h. The
  scheduler's customer-selection + per-customer loop **moved into
  `ScreeningService.runRecurringBatch()`**, so the 4-hourly scheduler and the new
  on-demand `POST /screening/recurring-batch` (`sanctions-pep.screen`) share identical
  logic — the #46/#48 "service owns the sweep, scheduler + endpoint both delegate"
  shape; a batch-level failure (e.g. `findActive()` itself throwing) propagates to the
  caller rather than being swallowed, matching `RetentionCaseService.runSweep` /
  `TransactionMonitoringService.runSweep`.

  **`WatchlistEntryRepository` is provided in BOTH `ComplianceRiskModule` (owns the
  sync) and `CustomerModule` (`ScreeningService` reads it) deliberately** — a stateless
  `PrismaService` wrapper, safe to instantiate twice since both operate on the same
  underlying rows, avoiding a `ComplianceRiskModule` <-> `CustomerModule` dependency in
  either direction for one narrow read.

  **Neither the unit nor the e2e suite calls the real endpoints** — a scheduled
  background sync must never make automated tests flaky, slow, or dependent on an
  external government server's uptime. `test/watchlist-sync.e2e-spec.ts` stubs
  `globalThis.fetch` with fixture CSV/XML content (matching the real formats) and drives
  the real `POST /watchlist-sync/run` endpoint through the full Nest app, proving the
  whole fetch→parse→upsert→prune pipeline end to end without touching the live network.

  `apps/web/` gains a new **"Watchlist sync"** screen
  (`app/(app)/watchlist-sync/page.tsx` + `lib/compliance-risk/watchlist-sync-api.ts` +
  an `AppNav` entry after "AML monitoring") — a sync-runs table (source · status ·
  records · started · completed) plus "Sync watchlists now" / "Run recurring screening
  batch now" buttons.

  **`@code-reviewer` (mandatory — a new external-network sync job, Highly-Confidential-
  adjacent data, and a concurrency invariant `race-safe-invariants.md` governs) →
  CHANGES REQUESTED → resolved: 4 BLOCKERs + 3 MINORs.**

  - **BLOCKER 1 (concurrency)**: nothing stopped a manual `POST /watchlist-sync/run`
    from firing while the 12-hourly scheduler was mid-run for the same source (or two
    manual triggers overlapping) — one run's `pruneStale` could delete rows the other had
    just (re-)written under a different `syncRunId`, silently dropping currently-
    sanctioned entries until the next sync. Fixed with a hand-authored partial
    `UNIQUE (source) WHERE status='running'` on `WatchlistSyncRun` (the
    `race-safe-invariants.md` shape — Prisma cannot express the `WHERE` predicate in
    `@@unique`); `createSyncRun`'s resulting P2002 is now caught and mapped to a benign
    `'skipped'` outcome rather than an unhandled rejection.
  - **BLOCKER 2 (plausibility)**: a 200 response carrying the wrong content — a WAF or
    interstitial page, a changed redirect target — parses to zero or near-zero records
    without ever throwing, and nothing distinguished that from a genuine, drastic list
    shrink (which OFAC/UN don't do in practice); `pruneStale` would then wipe out the
    entire prior cache for that source on the strength of a bad fetch. Fixed with a
    plausibility floor before committing anything: the new parse must be at least
    `WATCHLIST_MIN_ACCEPTABLE_RATIO = 0.5` (drafted) of the last successful sync's
    record count, or `WATCHLIST_MIN_ABSOLUTE_RECORDS = 10` (drafted) if there is no
    prior successful sync — a suspicious drop now fails the sync (existing cache
    untouched) instead of pruning against a false signal.
  - **BLOCKER 3 (false-positive wildcard)**: `normalizeWatchlistName`'s original
    `[^A-Z0-9\s]` character class reduced ANY name written entirely in a non-Latin
    script — Arabic, for this Jordan-based broker, whose `Customer.languagePreference`
    defaults to `AR` — to `""`. An empty `normalizedName` is not "no match": every
    empty-string customer/UBO name and every empty-string watchlist entry would collide
    with every other empty-string name, a universal false-positive wildcard. Fixed by
    switching to Unicode-aware `\p{L}`/`\p{N}` (the `u` flag) so non-Latin letters stay
    real, distinguishing characters, **plus** a defense-in-depth empty-string refusal at
    three points: ingestion (`WatchlistSyncService` filters an empty-normalized record
    out before upsert, logged, not silently dropped without a trace), match time
    (`ScreeningService.findRealWatchlistHit` skips a subject name that normalizes to
    `""` before ever querying), and the repository itself
    (`WatchlistEntryRepository.findByNormalizedName` refuses an empty string outright,
    belt-and-suspenders since it has no other caller to rely on that). A residual,
    accepted MINOR: a real UN entity is listed under the single token "ADF" — any
    customer/UBO whose legal name normalizes to exactly one short token collides on an
    exact match the same way, with no lower-confidence tier (`ScreeningOutcome.
    PENDING_INVESTIGATION` exists on the model but this module doesn't use it) —
    documented, not fixed.
  - **BLOCKER 4 (classification)**: `WatchlistEntry` shipped with no
    `DataClassification` field at all, reasoned in a code comment ("public government
    text, not IBMS customer data") instead of a `PRIV-STD-02` citation —
    `2026-08-pcms-source-of-truth.md` forbids exactly this pattern (IBMS code must never
    re-derive a privacy classification). Fixed by adding
    `classification DataClassification @default(HIGHLY_CONFIDENTIAL)` to the model — a
    conservative default pending an actual PCMS determination; `remarks` (OFAC
    "Remarks" / UN "COMMENTS1") can carry a real, named individual's DOB and
    alleged-conduct text, so "public" was never the same question as "unclassified."
  - **3 MINORs fixed**: `parseCsvLine` silently merged fields across an unterminated
    quote instead of rejecting the line — a stray `"` in a name/remarks field (this is
    hand-typed government text, not machine-generated data) would previously corrupt
    that row's fields rather than being caught; it now returns `null` for such a line,
    treated as unparseable exactly like a blank one. `ScreeningService.
    runRecurringBatch`'s catch block gained a comment pinning down why logging
    `(err as Error).message` here is safe (every failure this loop can actually reach is
    keyed on `customer.id`, never built from a matched name or list content). The
    ADF-style single-short-token collision risk (above) is now explicit in the code
    comment rather than an implicit gap a future reader would have to rediscover.

  **Verification**: +59 api unit total. `watchlist-sync.config.spec.ts` grew to **23**
  (from 17) — `normalizeWatchlistName` order-independence, `parseCsvLine`'s quoted-field/
  escaping rules, `parseOfacSdnLine`/`parseOfacSdnCsv` against real captured SDN lines,
  `parseUnConsolidatedXml` against a real captured INDIVIDUAL+ENTITY block incl.
  multi-part names + XML-unescaping + a no-`DATAID` skip, **plus** the review-fix cases:
  an Arabic name normalizes to a non-empty, order-independent token set; a
  pure-punctuation name still normalizes to `""` (the documented residual risk); the two
  plausibility constants; an unterminated quote in both `parseCsvLine` and
  `parseOfacSdnLine` returns `null`/`null`, not a garbled record.
  `watchlist-sync.service.spec.ts` grew to **10** (from 4) — both sources sync + stamp
  `normalizedName`, per-source isolation on a fetch failure, **plus**: a P2002 on
  `createSyncRun` is skipped, not thrown; a non-P2002 failure still throws; a parse
  implausibly smaller than the last successful sync fails without pruning; a near-empty
  parse with no prior sync fails against the absolute floor; a parse exactly at the
  ratio-floor boundary still succeeds; a record whose `fullName` normalizes to `""` is
  filtered out before upsert. `watchlist-sync.scheduler.spec.ts` 3, unchanged.
  `screening.service.spec.ts` grew by 19 in the original build (a real-list HIT drives
  HIGH/isEdd, the bare-source-name fallback when `listProgram` is null, every subject
  name checked, `runRecurringBatch`'s per-customer isolation / status filter /
  batch-level-failure propagation) **plus 1 more** in the review-fix pass — an
  empty-normalized subject name never reaches the real-watchlist query at all.
  `screening-batch.scheduler.spec.ts` rewritten for the thin-delegator shape, unchanged
  since. → api unit **1617** (109 files, from 1604 pre-review-fix, from 1575 pre-#49).
  Isolated `test/watchlist-sync.e2e-spec.ts` **1/1** — the original assertions (a
  run-unique synthetic OFAC entity + UN individual; a non-Compliance actor → 403 on
  sync/status/batch; `POST /watchlist-sync/run` succeeds for both sources with
  `recordCount >= 1`; a real `WatchlistEntry` row matches the parsed shape; a second
  sync is idempotent; a customer whose legal name is a token-reordering of the synced
  sanctioned name gets flagged `HIT`/`isEdd: true`, `listSource` =
  `"OFAC_SDN (SDGT)"`; the on-demand recurring batch runs without error) **plus** a new
  assertion that the synced row's `classification` is `HIGHLY_CONFIDENTIAL` (BLOCKER 4,
  proven end to end, not just in the schema). Full api e2e suite green, no regression.
  Playwright `watchlist-sync.spec.ts` 3/3 unaffected (the review-fix pass touched no web
  code). `npm run typecheck`/`lint` (api) OK; `ibms-brain` `brain-doctor.sh` 0 errors;
  `prisma migrate status` clean (**45** — the same pre-commit migration widened with the
  `classification` column and the concurrency index, not a second migration).

  **Deferred**: matching is exact-on-canonical-form, **not fuzzy/phonetic** — the
  documented limitation above; aliases are not matched; the 12h/4h cadence, while now a
  real observed ratio, is still drafted (no pinned OFAC/UN SLA document); only
  `Customer`/`UltimateBeneficialOwner` names are screened (`InsuredPerson`/`Employee`/
  `ThirdPartyClaimant` aren't — no module writes those tables yet either); no paid/
  premium sanctions data provider — #49's scope is specifically the free lists; no UI
  filtering/search on the sync-runs table; `sanctions-pep.screen` is role-level (no
  per-officer queue); the single-short-token collision risk (BLOCKER 3's residual MINOR,
  above) is accepted, not fixed.

**Part C #50 — Conflict of Interest (Domain F, Process 50)** — needed **no separate
  build**. The backlog's own line reads "Conflict of Interest —
  `ConflictOfInterestDisclosure` (covered under #16)", with no checklist of its own —
  unlike #37/#47, which had checkboxes to verify against, #50 is a pure cross-reference in
  the backlog's own text. Verified 2026-09-05 against the real, current code (not just
  memory of the #16 landing): `ConflictOfInterestDisclosure` still exists in the schema;
  `RecommendationService.detectConflictOfInterest` (`recommendation.config.ts`) still does
  the automatic detection — a comparable competing quote (within a 10% premium band,
  drafted) with a materially lower commission rate (2 percentage points, drafted) flags
  the recommendation; the disclosure gate is still mandatory and **live-recomputed at
  `send`** via `RecommendationService.effectiveGates`, not just a draft-time snapshot
  (itself a `@code-reviewer` MAJOR fix at #16's original landing — a control checked only
  at draft time is bypassable by event ordering); `assertDifferentActors` still enforces
  that the conflicted drafter cannot self-clear their own disclosure. No code change was
  needed. The only follow-up this verification produced was fixing a real, pre-existing
  inaccuracy in this file's own scope-status summary paragraph (it had attributed "the
  regulatory license record" to #50 and "the compliance calendar" to #51 — actually both
  belong to #51; #50 is Conflict of Interest, not a licensing item at all).

**Part C #51 — Regulatory Compliance / CBJ (Domain F, Process 51)** — two checkboxes:
  "Automatically block new business issuance once the license lapses" and "A compliance
  calendar of regulatory obligations with owner, due date, and evidence-of-submission
  tracking." Two independent resources under Part 7.1: the broker's own CBJ license
  (`BrokerLicense`) and a compliance calendar (`ComplianceCalendarItem`). Both pre-existed
  as bare "core schema" models — **genuinely no migration, no seed change** —
  `license.manage`/`compliance-calendar.manage` (both `[COMPLIANCE_OFFICER]`) were
  pre-seeded ahead of time.

  **`BrokerLicense` is a true SINGLETON** — one row, ever, at a fixed id
  (`BROKER_LICENSE_SINGLETON_ID = 'the-broker-license'`), not a `findFirst()` guess over an
  unconstrained table. "The broker's own CBJ license status" (the model's own doc comment)
  is singular by nature — a broker holds exactly one current license — so rather than a
  migration adding a DB-level singleton constraint for a resource Compliance creates once
  and only ever updates afterward (an infrequent, deliberate, human action — the M03
  "exactly-one-owner is app-level, not a DB CHECK" reasoning), the row is simply always
  created under that fixed id. `POST /broker-license` 409s if it already exists; `POST
  /broker-license/renew` 404s if it doesn't yet and otherwise updates every field,
  resetting `status` to `'active'` (a fresh license period supersedes any prior manual
  lapse); `POST /broker-license/mark-lapsed` is a manual override ahead of the calendar
  expiry (e.g. a CBJ suspension), idempotent on an already-lapsed record; `GET
  /broker-license` returns the current view.

  **The lapse check is a pure LIVE recompute
  (`isBrokerLicenseCurrentlyLapsed(license, now) = status === 'lapsed' || expiresAt <=
  now`), not a scheduler-maintained flag** — deliberately: the #16 `@code-reviewer` MAJOR
  lesson ("a control that fires only when a human/sweep configured data in the right order
  first is procedural, not structural") applies directly here. `PolicyService.place()`'s
  block must be correct the INSTANT `expiresAt` passes, not only after some future nightly
  sweep has had a chance to flip a stored column. There is therefore **no
  `BrokerLicenseSweepScheduler` in this codebase at all** — every other "goes stale over
  time" backlog item (KYC periodic review, retention, transaction monitoring, watchlist
  sync) DOES have one; #51 is the one place that deliberately doesn't, because the same
  live function backs both the gate's decision and the read view's derived
  `isCurrentlyLapsed` flag, leaving nothing for a sweep to keep in sync.

  **`PolicyService.assertLicenseNotLapsed` is the literal first statement in `place()`**
  (backlog Part C #18-19's Policy Placement), checked before every other placement
  precondition — the client-decision ACCEPT check, the duplicate-policy check — the
  cheapest, most fail-fast gate, and logically prior to everything else: a lapsed broker
  may not even begin placing new business regardless of how complete its
  opportunity/recommendation/decision chain is. **An unconfigured license (no row at all)
  is deliberately treated as NOT blocked** — load-bearing, not an oversight: dozens of
  existing policy/endorsement/claim/finance e2e and unit tests place a `Policy` without
  ever configuring a license, and this system is built for an already-operating,
  already-licensed brokerage; treating "unconfigured" the same as "lapsed" would fail
  every one of those tests for a condition none of them are testing. **The gate is scoped
  to `place()` ONLY** — the moment a NEW `Policy` is created (today, every `Policy` is "new
  business"; the renewal module, Part 3.9, isn't built). `recordIssuance` (completing an
  ALREADY-placed policy's paperwork) is deliberately NOT gated — blocking that would strand
  legitimately in-flight business placed before the lapse, out of scope for "block new
  business issuance." `BrokerLicenseRepository` is provided directly by BOTH
  `ComplianceRiskModule` (owns create/renew/mark-lapsed) and `PolicyModule`
  (`place()`'s one narrow read) — the #49 `WatchlistEntryRepository`
  duplication-over-cross-import shape, avoiding a cross-module dependency for one narrow
  read.

  **The compliance calendar** is simpler: `POST /compliance-calendar` (`{ obligationName,
  ownerUserId, dueDate }`, 404 unknown owner), `GET /compliance-calendar?ownerUserId=&
  overdueOnly=` + `/:id` (book-wide, capped `COMPLIANCE_CALENDAR_READ_LIMIT = 5000`), `POST
  /compliance-calendar/:id/record-submission` (`{ evidenceOfSubmissionRef, submittedAt? }`
  — **write-once**, a race-safe status-conditional `updateMany({ where: { id,
  submittedAt: null } })`, 409 on a second attempt). Unlike `RetentionCase.close`'s
  idempotent-on-repeat shape, silently accepting a second submission would let a later call
  overwrite the first evidence reference with no audit trail of the original — write-once
  is the correct shape here, not an oversight. `isOverdue`
  (`submittedAt === null && dueDate < now`) is a pure, derived dashboard convenience (the
  `Policy.issuanceComplete` shape), not itself a tracked `SlaTimer` deadline — the backlog
  names no single statutory turnaround for the calendar entries themselves (each
  underlying filing has its own CBJ deadline, which IS the `dueDate` — there's no second,
  separate SLA on top of it to track). A recurring obligation is modelled as a NEW row per
  cycle, not a recurrence field on one row — the bare schema has nothing to express a
  recurrence rule with, and the backlog doesn't ask for one; the same per-instance shape
  `ServiceRequest` (#41) and `RetentionCase` (#46) use.

  **`parseCalendarDate` moved to a new `apps/api/src/common/calendar-date.util.ts`** — it
  was local to `policy.config.ts` (Process 18-19) but already a de facto shared utility via
  `endorsement.service.ts`'s cross-module import; #51 is its third consumer
  (`issuedAt`/`expiresAt`/`dueDate`, all MAY be future dates, unlike
  `parseHistoricalInstant`). `policy.config.ts` re-exports it so every existing import site
  keeps working unchanged — confirmed via `tsc --noEmit` and the full unit suite.

  **No `classification` field on either model** — verified defensible, not a repeat of the
  #49 `WatchlistEntry` BLOCKER pattern (a model shipping with no classification field,
  reasoned only in a code comment, for data that turned out not to be as harmless as
  claimed). Neither `BrokerLicense` nor `ComplianceCalendarItem` contains any content about
  an identifiable natural person beyond an internal staff `ownerUserId` FK — the same kind
  of actor reference (`raisedByUserId`, `assignedToUserId`) that appears unclassified
  throughout this schema; `obligationName`/`evidenceOfSubmissionRef` are Compliance-authored
  internal labels with no customer adjacency.

  `apps/web/` gains a new **"Regulatory compliance"** screen
  (`app/(app)/regulatory-compliance/page.tsx` + `lib/compliance-risk/broker-license-api.ts`
  + `lib/compliance-risk/compliance-calendar-api.ts` + an `AppNav` entry after "Watchlist
  sync") — one page, two sections: the license status (create/renew form, pre-filled from
  the current record; a "Mark lapsed" button) and the compliance calendar (a log form plus
  a table with a per-row evidence-reference input and "Record submission" button).

  **`@code-reviewer` (mandatory — a business-critical issuance-blocking gate + a novel
  global-singleton e2e-testing pattern) → CHANGES REQUESTED → resolved: 3 MAJORs.**

  - **MAJOR 1**: `BrokerLicenseService.create()`'s `findCurrent() === null` pre-check alone
    leaves a real gap — two concurrent `POST /broker-license` calls both pass it before
    either writes, and while the fixed-id `@id` primary key correctly stops a second row
    from ever existing (the data integrity itself always held), the loser's P2002 was
    unhandled, surfacing as a raw 500 instead of the clean 409 every other create-once
    resource in this codebase produces (`policy.service.ts`, `watchlist-sync.service.ts`,
    and a dozen others all catch P2002 and rethrow a `ConflictException`). Fixed by
    wrapping `repo.create()` in the identical `isUniqueViolation` catch-and-rethrow
    pattern, plus two new unit tests (the race itself, and a non-P2002 failure still
    propagating).
  - **MAJOR 2**: both new e2e specs (`test/regulatory-compliance.e2e-spec.ts` and the new
    test appended to `test/policy.e2e-spec.ts`) mutate the real, shared `BrokerLicense`
    singleton — unlike every other fixture in this suite, which is scoped by unique
    generated ids — and rely on a restore-before-finishing step so a leftover lapsed state
    doesn't 422 every later e2e file that places a Policy (`vitest-e2e.config.ts`'s
    `fileParallelism: false` makes "restore before this file ends" sufficient). The
    restore's own success check originally only verified `isCurrentlyLapsed` when the
    renew call itself returned 201 — missing the more likely failure mode (renew returning
    a non-201: a transient hiccup, an expired token, a real regression), which would have
    silently left the singleton lapsed with no signal, cascading into confusing unrelated
    422s across a large fraction of the suite. Fixed by asserting the renew call's status
    unconditionally. Fixing this also surfaced an ESLint `no-unsafe-finally` violation (a
    `throw` inside `finally` would have silently swallowed a genuine test-body failure) —
    both tests were restructured to capture the test body's own error, run the restore
    unconditionally outside any `finally`, and rethrow whichever failed.
  - **MAJOR 3**: the What's New / brain-gap bookkeeping this very section is satisfying
    hadn't been done at review time — closed by this documentation pass.
  - **1 MINOR**: the web form's `renew` action only collected `licenseNumber`/`expiresAt`,
    and since `renew()` fully replaces every field (not a partial merge), using the form
    would silently wipe any previously recorded `scopeOfAuthorization`/`issuedAt` an
    officer had no intention of touching. Fixed by adding both fields to the form,
    pre-filled from the current record — adjusted **during render** (React's own
    recommended pattern for "sync state once a fetch arrives," a `licenseFormInitialized`
    guard so it runs exactly once), not a `useEffect`, so it never fights with an officer's
    in-progress edit triggered by an unrelated reload (the compliance-calendar form
    submitting also reloads the license).

  **Verification**: +33 api unit (`broker-license.config.spec.ts` 7, `broker-license.
  service.spec.ts` 11 incl. the P2002-race fix, `compliance-calendar.config.spec.ts` 4,
  `compliance-calendar.service.spec.ts` 8, `calendar-date.util.spec.ts` 5 — moved from
  `policy.config.spec.ts`, `policy.service.spec.ts` +4 for the license gate: unconfigured /
  active / expired-but-status-still-active / manually-lapsed-but-not-expired) → api unit
  **1651** (114 files, from 1617 pre-#51). New `test/regulatory-compliance.e2e-spec.ts`
  **2/2** — broker-license CRUD + permissions (incl. the concurrent-create-attempt 409);
  compliance-calendar log/filter/write-once-submission (incl. an overdue item, a future
  item, `ownerUserId`/`overdueOnly` filters, a second submission 409). `test/
  policy.e2e-spec.ts` **+1** — the real cross-module block: an active license places
  normally, a manually-lapsed one 422s a NEW placement with no `Policy` row ever created,
  non-Compliance is forbidden on the license routes; both singleton-mutating specs
  restore-and-verify before finishing (confirmed via direct DB query after each isolated
  run: `status: active`, `expiresAt: 2099-01-01`). Full api e2e suite green aside from the
  two pre-existing chronic flakes (rbac/up-sell) plus one transient full-suite-contention
  failure (`audit.e2e-spec.ts`, confirmed passing cleanly in isolation) — no regression.
  New Playwright `regulatory-compliance.spec.ts` 3/3; full Playwright suite **165/165**
  (includes those 3). `npm run typecheck`/`lint`/`build` OK on both api and web.

  **Deferred**: no `BrokerLicense` renewal-history tracking — a renewal overwrites the
  singleton in place, the `AuditLogEntry` UPDATE trail is the only history; no link from a
  `BrokerLicense` row to anything else. No CBJ-integration license-status feed — the
  record is entered manually by Compliance, not pulled from a regulator API (no such feed
  is known to exist). No recurrence/reminder mechanism for the compliance calendar beyond
  the plain `dueDate` + derived `isOverdue` — no notification, no escalation sweep.
  `license.manage`/`compliance-calendar.manage` are role-level (no per-officer queue).

## Deployment

**Not decided.** Docker images build correctly and can run anywhere that accepts a
container; nothing here assumes AWS, Azure, Fly, Render, or any other target. Record the
decision in `ibms-brain/meta/designs/` the day it's made, and update this section in the
same change — including enabling encryption at rest on whatever managed database/object
storage is chosen (see § Security above).
