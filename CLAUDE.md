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
| 2026-08-27 | Part C #5 (Needs Assessment) landed. `apps/api/src/modules/needs-assessment/`: `POST /needs-assessments` (captures the fixed risk questionnaire against a Risk Profile, derives `recommendedCoverageLines` via a deterministic rule map in `needs-assessment.config.ts`, starts `DRAFT`), `GET /needs-assessments` (+`/questionnaire`, `/:id`), `PATCH /:id` (re-answer while `DRAFT`), and `POST /:id/{submit,review,approve,return,reject}`. `NeedsAssessment` is the 15th `WorkflowTransitionService` entity — `NeedsAssessmentStatus` (`DRAFT→PENDING_REVIEW→{REVIEWED→APPROVED\|DRAFT\|REJECTED}`, `APPROVED` terminal) was converted from free-text `String` to a real enum, same as #3-4 did for `KycStatus`. Maker/checker (A.5): the `needs-assessment.approve` Manager who reviews/approves/rejects must differ from the new `NeedsAssessment.createdByUserId` — `assertDifferentActors()` + two DB `CHECK`s. New `apps/api/src/modules/risk-profile/` is a **minimal** parent record only (customer + site label + prior-claims summary) — the Process 6 asset survey / Sum Insured derivation is explicitly deferred. Migration `20260827120000_add_needs_assessment_status_enum`; new seeded permissions `needs-assessment.read` + `risk-profile.read`. `apps/web/app/(app)/needs-assessments/`: questionnaire intake (reached from a customer profile) + list + detail/review screen. See README § Known gaps, Part C #5. **Also, in the same session, a second `@code-reviewer` pass on the still-uncommitted Part C #3-4 Customer/KYC code found and fixed 6 issues there** (none in #5): `KycService.decide()` non-atomic double-transition → now resumable from `COMPLIANCE_REVIEW`; `ScreeningService.run()` re-screen silently downgrading `RiskRating`/`isEdd` → now escalate-only + audited; `decide()` could approve a file with no `ScreeningResult` rows → now refused, and `runScreening()` screens before the transition; concurrent-approval race on `Customer` activation → caught; both schedulers abandoning the sweep on the first throw → per-record try/catch; `CreateCustomerDto` not rejecting a CORPORATE body carrying `nationalId` → `CustomerTypeFieldCoherence` validator + service-side field gating. See README § Known gaps, Part C #3-4. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new migration, and `npm run db:seed` (or `db:test:seed`) for the two new permissions |
| 2026-08-27 | Structured API logging (not a backlog item — infra glue; a `logs/` folder was the ask). `apps/api` now uses **pino** via `nestjs-pino`: `apps/api/src/common/logging/logging.module.ts` + `logger.options.ts` (one pure, unit-tested `buildLoggerParams()`), wired first in `AppModule` and via `app.useLogger()` in `main.ts` so existing `new Logger()` calls route through it too. HTTP request logging (method/url/status/duration), an `x-request-id` request/response header + per-line `userId` (id only). **Bodies are never logged** and `Authorization`/`Cookie` + known secret/national-ID keys are redacted — the mandatory `ibms-brain/meta/lex/sensitive-data-handling.md` rule; this channel is separate from the immutable `AuditLogEntry`. Daily-rolling JSON goes to `LOG_DIR` (default `<repo>/logs`, new git-tracked `logs/` folder with its own README). New env vars `LOG_LEVEL`/`LOG_TO_FILE`/`LOG_DIR` (see `.env.example`); silent under vitest. New deps: `nestjs-pino`/`pino`/`pino-http`/`pino-roll` (+ `pino-pretty` dev). **Same-day follow-up:** file logging is now **on by default outside vitest** (was `LOG_TO_FILE=true`-only) so `<repo>/logs` mirrors everything the API process prints — HTTP traces, `Logger` output, error stacks, and stray `console.*` + `uncaughtException`/`unhandledRejection`, both now bridged onto the pino pipeline in `main.ts`. The `npm run dev`/turbo/nest-CLI build output is a separate parent process and is deliberately not captured. `LOG_TO_FILE=false` restores console-only. | Run `npm install`. `.env`: file logging is on unless you set `LOG_TO_FILE=false`; `.env.test` now sets `LOG_TO_FILE=false` (smoke.sh boots the real server) — re-copy from `.env.test.example` or add the line |
| 2026-08-27 | Part C #6 (Risk Assessment) landed — extends `apps/api/src/modules/risk-profile/` (the minimal parent from #5) with the detailed asset survey. `POST/PATCH/DELETE /risk-profiles/:id/assets` capture `Asset` lines (building/equipment/stock/vehicle/other) under the existing `risk-profile.create`; `GET /risk-profiles/:id` now returns `{ ...profile, assets, sumInsured }` and a new `GET /risk-profiles/consolidated?customerId=` rolls every site's survey into one Sum Insured view. `risk-profile.config.ts` holds a **pure, deterministic** `deriveSumInsured()` (property SI = Σ declared value over building/equipment/stock/other; BI SI = Σ annual gross profit; indemnity period = longest BI window; fleet = Σ vehicle counts) and `consolidateSites()` — every roll-up goes through `money.util.ts` (fils precision, `ibms-brain/meta/lex/money-decimal-jod.md`). Assets carry **no workflow state and no maker/checker** — survey data only. `Asset` fields aren't `-- ENCRYPT`-flagged, so no field encryption. No new permissions (the seeded `risk-profile.create` description already reads "Risk Profile/**Asset**"). Migration `20260827160000_add_asset_risk_profile_index` adds `@@index([riskProfileId])` on `Asset` (the one child table that lacked its parent-FK index). `apps/web/app/(app)/risk-profiles/`: per-site survey screen + consolidated view, reached from a customer's profile and the new "Risk surveys" nav item. Turning the survey into `InsuranceProgramLine` Sum Insured is Process 7 — see README § Known gaps, Part C #6. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new index migration (or `db:migrate:deploy` — no schema type change, so no `db:generate` needed) |
| 2026-08-27 | Part C #7 (Product Recommendation / Program Design) landed — `apps/api/src/modules/insurance-program/`: `POST /insurance-programs` (`{ needsAssessmentId }` — assemble a multi-line `InsuranceProgram`, `program.assemble`/Placement only, starts `DRAFT`), `GET /insurance-programs?customerId=` + `GET /:id` (new seeded `program.read`), `POST /:id/{reassemble,finalize,reopen}`. `insurance-program.config.ts` holds a **pure, deterministic** `assembleProgramLines(coverageLines, sumInsured)`: one line per line in the APPROVED `NeedsAssessment`'s `recommendedCoverageLines` (order-stable), each mapped to a canonical `insuranceLine` string — only **Property All Risks** (← `propertySumInsured`) and **Business Interruption** (← `businessInterruptionSumInsured`) get an asset-derived `sumInsuredBasis` from #6's `deriveSumInsured()`; every other line is `null` (set at RFQ/quotation, Process 11+). No arithmetic here — figures were already fils-quantized by `risk-profile.config.ts`. `InsuranceProgram` is the **16th `WorkflowTransitionService` entity** — `InsuranceProgramStatus` (`DRAFT→FINALIZED→DRAFT`, `SUPERSEDED` terminal & modeled-ahead-of-trigger) converted from free-text `String` (migration `20260827180000_add_insurance_program_status_enum`, also adds `needsAssessmentId`/`assembledByUserId` provenance columns, the parent-FK indexes `InsuranceProgram`/`InsuranceProgramLine` lacked, and a **partial `UNIQUE` index** `riskProfileId WHERE status <> 'SUPERSEDED'` — raw SQL, Prisma can't express the predicate). **One program per `RiskProfile`** (schema has no program↔multi-`RiskProfile` join): a descriptive pre-check 409 plus the partial UNIQUE index (`P2002` → 409) for concurrent assemblies. No maker/checker (the coverage set was maker/checker-approved at #5); visibility inherited from the Risk Profile's Customer. `apps/web/app/(app)/insurance-programs/`: list + detail (lines table + finalize/reopen) + assemble screen, reached from an approved needs assessment; new "Insurance programs" nav item. **`@code-reviewer` (mandatory — workflow + money) returned 1 blocker + 4 minors, all fixed**: the one-live-per-RiskProfile check-then-act got the DB partial UNIQUE backstop; `assemble()` 404-message existence-oracle normalised; `CREATE` audit now written before the lines insert; `reassemble()` re-reads `status` right before the line rewrite; `finalize()` refuses a zero-line program. See README § Known gaps, Part C #7. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new migration, then `npm run db:seed` (or `db:test:seed`) for the new `program.read` permission |
| 2026-08-27 | `ibms-brain` submodule pin bumped `612362e → 4035914` — brings in two new **mandatory** lex rules that now bind `apps/api` PRs: `meta/lex/kyc-aml-sla-timers.md` (KYC/EDD review SLA + re-KYC cadence are tracked deadlines; the four values are draft/unsourced pending a real CBJ AML doc — already consumed by `sla-registry.config.ts`/`kyc.service.ts` since #3-4) and `meta/lex/race-safe-invariants.md` (a "one of these / only once" invariant is a DB constraint or a status-conditional write, never a `findMany().find()` check-then-act — filed via `/brain-gap` off the Part C #7 code-review blocker). | Read both before your next `apps/api` change touching an SLA figure or a uniqueness/"only once" rule |

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

Infrastructure (Part A + Part B), plus Part C **Domain A, Processes 1–7** — Lead
Management (#1), Prospect Management (#2), Customer Acquisition/Onboarding (#3-4, with
*simulated* screening), Needs Assessment (#5), Risk Assessment (#6), Product
Recommendation / Program Design (#7). Everything else —
Domain A #8–10, Domains B–H, and Parts D–G (PDPL, dashboards, bilingual UI, final
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
