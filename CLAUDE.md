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
| 2026-08-27 | Part C #6 (Risk Assessment) landed — extends `apps/api/src/modules/risk-profile/` (the minimal parent from #5) with the detailed asset survey. `POST/PATCH/DELETE /risk-profiles/:id/assets` capture `Asset` lines (building/equipment/stock/vehicle/other) under the existing `risk-profile.create`; `GET /risk-profiles/:id` now returns `{ ...profile, assets, sumInsured }` and a new `GET /risk-profiles/consolidated?customerId=` rolls every site's survey into one Sum Insured view. `risk-profile.config.ts` holds a **pure, deterministic** `deriveSumInsured()` (property SI = Σ declared value over building/equipment/stock/other; BI SI = Σ annual gross profit; indemnity period = longest BI window; fleet = Σ vehicle counts) and `consolidateSites()` — every roll-up goes through `money.util.ts` (fils precision, `ibms-brain/meta/lex/money-decimal-jod.md`). Assets carry **no workflow state and no maker/checker** — survey data only. `Asset` fields aren't `-- ENCRYPT`-flagged, so no field encryption. No new permissions (the seeded `risk-profile.create` description already reads "Risk Profile/**Asset**"). Migration `20260827160000_add_asset_risk_profile_index` adds `@@index([riskProfileId])` on `Asset` (the one child table that lacked its parent-FK index). `apps/web/app/(app)/risk-profiles/`: per-site survey screen + consolidated view, reached from a customer's profile and the new "Risk surveys" nav item. Turning the survey into `InsuranceProgramLine` Sum Insured is Process 7 — see README § Known gaps, Part C #6. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new index migration (or `db:migrate:deploy` — no schema type change, so no `db:generate` needed) |
| 2026-08-27 | Part C #7 (Product Recommendation / Program Design) landed — `apps/api/src/modules/insurance-program/`: `POST /insurance-programs` (`{ needsAssessmentId }` — assemble a multi-line `InsuranceProgram`, `program.assemble`/Placement only, starts `DRAFT`), `GET /insurance-programs?customerId=` + `GET /:id` (new seeded `program.read`), `POST /:id/{reassemble,finalize,reopen}`. `insurance-program.config.ts` holds a **pure, deterministic** `assembleProgramLines(coverageLines, sumInsured)`: one line per line in the APPROVED `NeedsAssessment`'s `recommendedCoverageLines` (order-stable), each mapped to a canonical `insuranceLine` string — only **Property All Risks** (← `propertySumInsured`) and **Business Interruption** (← `businessInterruptionSumInsured`) get an asset-derived `sumInsuredBasis` from #6's `deriveSumInsured()`; every other line is `null` (set at RFQ/quotation, Process 11+). No arithmetic here — figures were already fils-quantized by `risk-profile.config.ts`. `InsuranceProgram` is the **16th `WorkflowTransitionService` entity** — `InsuranceProgramStatus` (`DRAFT→FINALIZED→DRAFT`, `SUPERSEDED` terminal & modeled-ahead-of-trigger) converted from free-text `String` (migration `20260827180000_add_insurance_program_status_enum`, also adds `needsAssessmentId`/`assembledByUserId` provenance columns, the parent-FK indexes `InsuranceProgram`/`InsuranceProgramLine` lacked, and a **partial `UNIQUE` index** `riskProfileId WHERE status <> 'SUPERSEDED'` — raw SQL, Prisma can't express the predicate). **One program per `RiskProfile`** (schema has no program↔multi-`RiskProfile` join): a descriptive pre-check 409 plus the partial UNIQUE index (`P2002` → 409) for concurrent assemblies. No maker/checker (the coverage set was maker/checker-approved at #5); visibility inherited from the Risk Profile's Customer. `apps/web/app/(app)/insurance-programs/`: list + detail (lines table + finalize/reopen) + assemble screen, reached from an approved needs assessment; new "Insurance programs" nav item. **`@code-reviewer` (mandatory — workflow + money) returned 1 blocker + 4 minors, all fixed**: the one-live-per-RiskProfile check-then-act got the DB partial UNIQUE backstop; `assemble()` 404-message existence-oracle normalised; `CREATE` audit now written before the lines insert; `reassemble()` re-reads `status` right before the line rewrite; `finalize()` refuses a zero-line program. See README § Known gaps, Part C #7. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new migration, then `npm run db:seed` (or `db:test:seed`) for the new `program.read` permission |
| 2026-08-27 | `ibms-brain` submodule pin bumped `612362e → 4035914` — brings in two new **mandatory** lex rules that now bind `apps/api` PRs: `meta/lex/kyc-aml-sla-timers.md` (KYC/EDD review SLA + re-KYC cadence are tracked deadlines; the four values are draft/unsourced pending a real CBJ AML doc — already consumed by `sla-registry.config.ts`/`kyc.service.ts` since #3-4) and `meta/lex/race-safe-invariants.md` (a "one of these / only once" invariant is a DB constraint or a status-conditional write, never a `findMany().find()` check-then-act — filed via `/brain-gap` off the Part C #7 code-review blocker). | Read both before your next `apps/api` change touching an SLA figure or a uniqueness/"only once" rule |
| 2026-08-27 | Part C #8 (Cross-Selling) landed. `apps/api/src/modules/cross-sell/`: a nightly `@Cron('0 4 * * *')` sweep (`cross-sell-detection.scheduler.ts`) + on-demand `POST /cross-sell-opportunities/detect` (`{ customerId }`) compare a customer's in-force `Policy` lines against a benchmark line list (`cross-sell.config.ts` — pure `findCoverageGaps()` + a deliberately conservative global `BENCHMARK_LINES`) and flag each missing line as a `CrossSellOpportunity`; `GET /cross-sell-opportunities?customerId=&status=` + `GET /:id`; `POST /:id/{convert,dismiss}` (`{ reason }`). `CrossSellOpportunity` is the **17th `WorkflowTransitionService` entity** — `CrossSellStatus` (`OPEN→CONVERTED\|DISMISSED`, both terminal) converted from free-text `String` (4th such conversion after `KycStatus` #3-4, `NeedsAssessmentStatus` #5, `InsuranceProgramStatus` #7). Migration `20260827200000_add_cross_sell_status_enum` also adds `detectedByUserId`/`resolvedByUserId`/`resolvedAt`/`dismissReason`, `@@index([status])`, and **`@@unique([customerId, gapLine])`** — the `race-safe-invariants.md` backstop (≤1 opportunity per customer+line, ever; the sweep inserts one row at a time, catching `P2002`), Prisma-expressible so no raw SQL this time. New seeded permissions `cross-sell.read` (Sales/Manager/Exec) + `cross-sell.detect` (Sales/Manager); existing `cross-sell.convert` (Sales) gates convert/dismiss. No maker/checker (acting on a system nudge is single-actor); visibility inherited from the Customer's owner. **The Policy module (Domain B) is not built, so `Policy` is empty everywhere and the job is a correct no-op until real policies exist** — built ahead of its data source, like the A.8 SLA registry's unwired timers. `apps/web/app/(app)/cross-sell/`: `?customerId=` list + scan + inline convert/dismiss, a detail screen, a "Cross-sell" nav item + customer-profile section. See README § Known gaps, Part C #8. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new migration, then `npm run db:seed` (or `db:test:seed`) for the two new permissions |
| 2026-08-27 | Part C #9 (Up-Selling) landed. `apps/api/src/modules/up-sell/`: a nightly `@Cron('0 5 * * *')` sweep (`up-sell-detection.scheduler.ts`) + on-demand `POST /up-sell-recommendations/detect` (`{ customerId }`) compare a customer's **designed property Sum Insured** (Σ the "Property All Risks" line's `sumInsuredBasis` over their non-SUPERSEDED `InsuranceProgram`s, #7) against the **current value of their surveyed assets** (`deriveSumInsured(...).propertySumInsured` over the whole `RiskProfile` book, #6) and raise an `UpSellRecommendation` when the shortfall clears a **drafted 10%** of Sum Insured (`up-sell.config.ts` — pure `assessUnderinsurance()`, all figures through `money.util.ts`). Both figures are snapshotted onto the row. `GET /up-sell-recommendations?customerId=&status=` + `GET /:id`; `POST /:id/{convert,dismiss}` (`{ reason }`). `UpSellRecommendation` is the **18th `WorkflowTransitionService` entity** — `UpSellStatus` (`OPEN→CONVERTED\|DISMISSED`, both terminal) converted from free-text `String` (5th such conversion). Migration `20260827220000_add_up_sell_status_enum` adds the same provenance/resolution columns as #8, `@@index([customerId])`+`@@index([status])`, and a **partial `UNIQUE` index `customerId WHERE status = 'OPEN'`** (raw SQL — Prisma can't express the predicate). **Unlike #8's full `@@unique`, this is partial**: an up-sell gap is a continuous, growing quantity, so a resolved recommendation frees the slot for a fresh one once assets grow further — plus a pre-check heuristic suppresses an immediate re-flag until `currentAssetValue` exceeds the last resolved one's. New seeded `up-sell.read` (Sales/Manager/Exec) + `up-sell.detect` (Sales/Manager); `up-sell.convert` (Sales) description tightened "Act on…" → "Convert or dismiss…". `InsuranceProgramModule` now `exports: [InsuranceProgramRepository]`. No maker/checker. Comparison is property/asset-value only (BI up-sell deferred); `currentSumInsured` is the *designed* programme line, not an in-force `Policy` (Domain B), so the job catches a survey that grew without a re-assembly/endorsement. `apps/web/app/(app)/up-sell/`: `?customerId=` list + scan + last-scan panel + inline convert/dismiss, a detail screen, an "Up-sell" nav item + customer-profile section. See README § Known gaps, Part C #9. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev` — see below), then `npm run db:seed` (or `db:test:seed`) for the two new permissions |

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

Infrastructure (Part A + Part B), plus Part C **Domain A, Processes 1–9** — Lead
Management (#1), Prospect Management (#2), Customer Acquisition/Onboarding (#3-4, with
*simulated* screening), Needs Assessment (#5), Risk Assessment (#6), Product
Recommendation / Program Design (#7), Cross-Selling (#8, a no-op until the Policy module
lands), Up-Selling (#9, flags a survey that outgrew the designed property Sum Insured).
Everything else —
Domain A #10, Domains B–H, and Parts D–G (PDPL, dashboards, bilingual UI, final
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
