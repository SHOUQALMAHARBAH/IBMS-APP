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
- **Part C — Domain B has begun: RFQ / Market Submission (#11) + Market Placement (#12) +
  Quotation Management (#13) + Quote Comparison (#14) + Negotiation (#15) + Broker
  Recommendation (#16) + Client Decision Handling (#17) + Policy Placement & Issuance
  (#18–19) + Policy Checking / Quality Control (#20) — built and verified.** A minimal
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
  `ProfessionalIndemnityRiskEvent`, a clean check drives it to `VERIFIED`. Detail below.
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

### Part C · Domain B #11–20 — built, with these deferrals

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

### Not started

- **Domains B–H** — Insurance Operations (#11 RFQ / Market Submission, #12 Market
  Placement, #13 Quotation Management, #14 Quote Comparison, #15 Negotiation, #16 Broker
  Recommendation, #17 Client Decision Handling, #18–19 Policy Placement & Issuance, and
  #20 Policy Checking are **built** — see the Domain B table above; #21 delivery, #22
  endorsement / cancellation remain), Claims
  (#23–30), Finance (billing / collection / commission / reconciliation, #31–40), Customer
  Service (#41–46), Compliance & Risk beyond KYC (AML/CFT monitoring, sanctions batch,
  regulatory calendar, incident management, internal audit, #47–57), Management reporting
  (#58–65), Supporting Operations (HR, procurement, IT, document management, vendor
  management, BCP/DR, knowledge base, #66–74).
- **Part D — PDPL / M-series** — `ConsentRecord` capture/withdrawal at the 7 touchpoints,
  `DataSubjectRequest` handling, retention & disposal (`RetentionScheduleItem` /
  `LegalHold` / `DisposalBatch` / `CertificateOfDestruction`), cross-border transfer
  gating, one-off `DataSharingApproval`, DPIA screening, version-controlled bilingual
  privacy notices, the RoPA register, and the DPO workspace screen. The A.8 SLA registry
  already carries the PDPL timer definitions; nothing consumes them yet.
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
- **Sanctions/PEP/AML screening is simulated, not real** — no such data provider exists
  or is obtainable in this environment (same category of gap as A.1's "no SSO identity
  provider"). `ScreeningService` checks the Customer's `legalName` and any UBO
  `fullName`s against a small fictional fixture list
  (`apps/api/src/modules/customer/sample-watchlist.ts`), hard-gated on `NODE_ENV !==
  'production'` (same convention as `SAMPLE_INSURERS`/`SAMPLE_USERS`) — in production,
  every screening result is CLEAR until a real provider is integrated, never a HIT the
  system can't substantiate. All three `ScreeningType`s check the same fixture list; a
  real integration would call three distinct providers/lists.
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

## Deployment

**Not decided.** Docker images build correctly and can run anywhere that accepts a
container; nothing here assumes AWS, Azure, Fly, Render, or any other target. Record the
decision in `ibms-brain/meta/designs/` the day it's made, and update this section in the
same change — including enabling encryption at rest on whatever managed database/object
storage is chosen (see § Security above).
