@ibms-brain/CLAUDE.md

<!-- The import above pulls in ibms-brain's full rule set (meta/lex/, meta/context/,
     meta/designs/) via the ibms-brain/ git submodule. If that directory is empty, run
     `git submodule update --init --recursive` — see "Cloning this repo" below. Keep
     the import on line 1, same reason ibms-brain's own CLAUDE.md keeps @AGENTS.md on
     line 1: without it this content is dead weight while still read by other tools. -->

# CLAUDE.md — ibms-app

This is the first IBMS engineering repo. **Standards, mandatory rules, domain
knowledge, and architecture decisions live in `ibms-brain` (imported above via git
submodule at `ibms-brain/`), not here** — `ibms-brain/meta/lex/` (mandatory),
`ibms-brain/meta/context/` (domain knowledge), `ibms-brain/meta/designs/` (why decisions
were made). Read the relevant `meta/context/` file before touching an area, and the
`meta/lex/` rules before any non-trivial change — most of them (money-decimal-jod,
workflow-state-transitions, maker-checker-segregation, sensitive-data-handling,
pdpl-sla-timers) apply the moment real domain code lands here, which it has not yet.

## What's New

| Date | Change | Action required |
|------|--------|-----------------|
| 2026-08-26 | Part C #3-4 (Customer Acquisition/Onboarding) landed — `apps/api/src/modules/customer/`: `Customer`/`UltimateBeneficialOwner`/`KYCRecord`/`ScreeningResult`/`RiskRating`/customer-scoped `Document`. First real consumer of A.3's field encryption (`EncryptionService`/`encryptEntityFields`) and A.9's masking/drill-down (`SensitiveFieldRevealService`) for `Customer.nationalIdEnc`/`contactPhoneEnc`/`contactEmailEnc` and UBO `nationalIdEnc`. `KYCRecord`/`Customer` added as the 13th/14th `WorkflowTransitionService` entities (migration `20260826170000_...` also converts `KYCRecord.status`/`ScreeningResult.screeningType`+`.result`/`RiskRating.level` from free-text `String` to real enums, and adds `Document.customerId`). Screening is simulated against a fixture watchlist (`sample-watchlist.ts`) — no real sanctions/PEP/AML data provider exists; two new SLA_REGISTRY entries (`kyc_standard_review`/`kyc_edd_review`) and the re-KYC review cadence are **drafted, unsourced defaults**, not PRIV-SOP-cited figures — see README § Known gaps and the filed `/brain-gap`. `apps/web/app/(app)/customers/`: onboarding wizard, list/profile (masked fields + justified reveal), Compliance KYC queue. Also fixed a latent e2e test-isolation race (`apps/api/test/vitest-e2e.config.ts` now sets `fileParallelism: false` — parallel spec files sharing one test DB could intermittently fail unrelated auth/rbac tests). | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new migration; sample screening-hit names for manual testing are in `apps/api/src/modules/customer/sample-watchlist.ts` (dev/test only) |
| 2026-08-27 | App navigation shell + authenticated home (web only, not a backlog item — infra glue so the built screens are reachable without hand-typing URLs). `apps/web/app/(app)/layout.tsx` now wraps every signed-in screen in a sidebar (`components/app/AppNav.tsx`) linking what exists — Home, Leads, Prospects, Customers, KYC queue, Access recertification, Security — plus the current user and sign-out, and gates the whole `(app)` subtree on a session. New `apps/web/app/(app)/page.tsx` is the post-login landing (`Welcome, {name}` + module cards). The original repo-scaffold `apps/web/app/page.tsx` ("IBMS — scaffold / API status: ok") and its `page.test.tsx` are **deleted**: `/` now resolves to the authenticated home, and login's existing `router.push('/')` lands there. Nav links are not permission-filtered — each destination page still renders its own 403 copy. | None — `npm run dev` now opens `/login` → the home instead of the scaffold placeholder |
| 2026-08-27 | Part C #5 (Needs Assessment) landed. `apps/api/src/modules/needs-assessment/`: `POST /needs-assessments` (captures the fixed risk questionnaire against a Risk Profile, derives `recommendedCoverageLines` via a deterministic rule map in `needs-assessment.config.ts`, starts `DRAFT`), `GET /needs-assessments` (+`/questionnaire`, `/:id`), `PATCH /:id` (re-answer while `DRAFT`), and `POST /:id/{submit,review,approve,return,reject}`. `NeedsAssessment` is the 15th `WorkflowTransitionService` entity — `NeedsAssessmentStatus` (`DRAFT→PENDING_REVIEW→{REVIEWED→APPROVED\|DRAFT\|REJECTED}`, `APPROVED` terminal) was converted from free-text `String` to a real enum, same as #3-4 did for `KycStatus`. Maker/checker (A.5): the `needs-assessment.approve` Manager who reviews/approves/rejects must differ from the new `NeedsAssessment.createdByUserId` — `assertDifferentActors()` + two DB `CHECK`s. New `apps/api/src/modules/risk-profile/` is a **minimal** parent record only (customer + site label + prior-claims summary) — the Process 6 asset survey / Sum Insured derivation is explicitly deferred. Migration `20260827120000_add_needs_assessment_status_enum`; new seeded permissions `needs-assessment.read` + `risk-profile.read`. `apps/web/app/(app)/needs-assessments/`: questionnaire intake (reached from a customer profile) + list + detail/review screen. See README § Known gaps, Part C #5. **Also, in the same session, a second `@code-reviewer` pass on the still-uncommitted Part C #3-4 Customer/KYC code found and fixed 6 issues there** (none in #5): `KycService.decide()` non-atomic double-transition → now resumable from `COMPLIANCE_REVIEW`; `ScreeningService.run()` re-screen silently downgrading `RiskRating`/`isEdd` → now escalate-only + audited; `decide()` could approve a file with no `ScreeningResult` rows → now refused, and `runScreening()` screens before the transition; concurrent-approval race on `Customer` activation → caught; both schedulers abandoning the sweep on the first throw → per-record try/catch; `CreateCustomerDto` not rejecting a CORPORATE body carrying `nationalId` → `CustomerTypeFieldCoherence` validator + service-side field gating. See README § Known gaps, Part C #3-4. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new migration, and `npm run db:seed` (or `db:test:seed`) for the two new permissions |
| 2026-08-27 | Structured API logging (not a backlog item — infra glue; a `logs/` folder was the ask). `apps/api` now uses **pino** via `nestjs-pino`: `apps/api/src/common/logging/logging.module.ts` + `logger.options.ts` (one pure, unit-tested `buildLoggerParams()`), wired first in `AppModule` and via `app.useLogger()` in `main.ts` so existing `new Logger()` calls route through it too. HTTP request logging (method/url/status/duration), an `x-request-id` request/response header + per-line `userId` (id only). **Bodies are never logged** and `Authorization`/`Cookie` + known secret/national-ID keys are redacted — the mandatory `ibms-brain/meta/lex/sensitive-data-handling.md` rule; this channel is separate from the immutable `AuditLogEntry`. Console-only in dev; `NODE_ENV=production` or `LOG_TO_FILE=true` also writes daily-rolling JSON to `LOG_DIR` (default `<repo>/logs`, new git-tracked `logs/` folder with its own README). New env vars `LOG_LEVEL`/`LOG_TO_FILE`/`LOG_DIR` (see `.env.example`); silent under vitest. New deps: `nestjs-pino`/`pino`/`pino-http`/`pino-roll` (+ `pino-pretty` dev). | Run `npm install`. Optionally add `LOG_LEVEL`/`LOG_TO_FILE` to your `.env` (see `.env.example`); nothing breaks without them |
| 2026-08-27 | Part C #6 (Risk Assessment) landed — extends `apps/api/src/modules/risk-profile/` (the minimal parent from #5) with the detailed asset survey. `POST/PATCH/DELETE /risk-profiles/:id/assets` capture `Asset` lines (building/equipment/stock/vehicle/other) under the existing `risk-profile.create`; `GET /risk-profiles/:id` now returns `{ ...profile, assets, sumInsured }` and a new `GET /risk-profiles/consolidated?customerId=` rolls every site's survey into one Sum Insured view. `risk-profile.config.ts` holds a **pure, deterministic** `deriveSumInsured()` (property SI = Σ declared value over building/equipment/stock/other; BI SI = Σ annual gross profit; indemnity period = longest BI window; fleet = Σ vehicle counts) and `consolidateSites()` — every roll-up goes through `money.util.ts` (fils precision, `ibms-brain/meta/lex/money-decimal-jod.md`). Assets carry **no workflow state and no maker/checker** — survey data only. `Asset` fields aren't `-- ENCRYPT`-flagged, so no field encryption. No new permissions (the seeded `risk-profile.create` description already reads "Risk Profile/**Asset**"). Migration `20260827160000_add_asset_risk_profile_index` adds `@@index([riskProfileId])` on `Asset` (the one child table that lacked its parent-FK index). `apps/web/app/(app)/risk-profiles/`: per-site survey screen + consolidated view, reached from a customer's profile and the new "Risk surveys" nav item. Turning the survey into `InsuranceProgramLine` Sum Insured is Process 7 — see README § Known gaps, Part C #6. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new index migration (or `db:migrate:deploy` — no schema type change, so no `db:generate` needed) |

Drop the oldest row once this table exceeds 5 entries (ibms-brain/meta/lex/workspace-updates.md).

## Cloning this repo

```bash
git clone --recurse-submodules https://github.com/SHOUQALMAHARBAH/IBMS-APP.git
# already cloned without it?
git submodule update --init --recursive
```

The submodule pins a specific `ibms-brain` commit — it does not auto-track `main`. Pull
in newer brain rules deliberately:

```bash
cd ibms-brain && git pull origin main && cd ..
git add ibms-brain && git commit -m "ibms-brain: sync to latest"
```

## What's here today

Infrastructure (Part A + Part B), plus Part C **Domain A, Processes 1–6** — Lead
Management (#1), Prospect Management (#2), Customer Acquisition/Onboarding (#3-4, with
*simulated* screening), Needs Assessment (#5), Risk Assessment (#6). Everything else —
Domain A #7–10, Domains B–H, and Parts D–G (PDPL, dashboards, bilingual UI, final
verification) — is not started. See root `README.md` § Scope status for the full picture
and § Known gaps for each built item's deferred edges.

## Common commands

```bash
npm install
cp .env.example .env
docker compose up -d db
npm run db:migrate:dev
npm run db:seed       # 11 roles + full permission grid — RBAC needs these to exist
npm run dev          # web:3000, api:4000
npm run lint
npm run typecheck
npm run test          # vitest, web + api

# api e2e — separate test DB (db-test), never the dev DB above. See README
# § Dev DB vs. test DB.
cp .env.test.example .env.test
docker compose up -d db-test
npm run db:test:migrate:dev
npm run test:e2e

npm run e2e           # playwright + axe-core, web
```

## Environment

- Node `20.19.0` — see `.nvmrc`. This satisfies Prisma 7's Node floor (≥20.19/22.12/24)
  but Prisma itself stays pinned at `6.19.3` in `package.json` — Node version no longer
  blocks a Prisma 7 install, so don't bump `prisma`/`@prisma/client` past 6.x without
  doing the driver-adapter (`@prisma/adapter-pg`) + `prisma.config.ts` migration first.
  See the Prisma note in root `README.md`.
- Docker required for Postgres locally and for building `apps/api`/`apps/web` images.

## Repo map

```
apps/web/     Next.js frontend
apps/api/     NestJS backend
packages/db/  Shared Prisma schema + client (@ibms/db)
ibms-brain/   Submodule — standards/rules/context (loaded via the import above)
.claude/      Agents/commands mirrored from ibms-brain + a subset of its hooks — see
              README.md § .claude/ — agents, commands, hooks
```

`@code-reviewer` and `@software-developer` (defined in `ibms-brain/meta/agents/`) and
`/brain-gap` are available in this repo via `.claude/`. Not yet wired here: the `git push`
evidence-gate hook (`enforce-evidence.sh`) and the domain-code hooks — see README.md for why.

## Before you write code

Same rule as ibms-brain: read `meta/context/` for the area, `meta/lex/` for what's
mandatory, cite the source document (PDPL / CBJ / ISO 27001/27701 / a specific
`PRIV-STD-*`/`PRIV-SOP-*`) in the PR when the change touches a regulatory obligation.
