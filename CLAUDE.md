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
| 2026-08-27 | `ibms-brain` submodule pin bumped `612362e → 4035914` — brings in two new **mandatory** lex rules that now bind `apps/api` PRs: `meta/lex/kyc-aml-sla-timers.md` (KYC/EDD review SLA + re-KYC cadence are tracked deadlines; the four values are draft/unsourced pending a real CBJ AML doc — already consumed by `sla-registry.config.ts`/`kyc.service.ts` since #3-4) and `meta/lex/race-safe-invariants.md` (a "one of these / only once" invariant is a DB constraint or a status-conditional write, never a `findMany().find()` check-then-act — filed via `/brain-gap` off the Part C #7 code-review blocker). | Read both before your next `apps/api` change touching an SLA figure or a uniqueness/"only once" rule |
| 2026-08-27 | Part C #8 (Cross-Selling) landed. `apps/api/src/modules/cross-sell/`: a nightly `@Cron('0 4 * * *')` sweep (`cross-sell-detection.scheduler.ts`) + on-demand `POST /cross-sell-opportunities/detect` (`{ customerId }`) compare a customer's in-force `Policy` lines against a benchmark line list (`cross-sell.config.ts` — pure `findCoverageGaps()` + a deliberately conservative global `BENCHMARK_LINES`) and flag each missing line as a `CrossSellOpportunity`; `GET /cross-sell-opportunities?customerId=&status=` + `GET /:id`; `POST /:id/{convert,dismiss}` (`{ reason }`). `CrossSellOpportunity` is the **17th `WorkflowTransitionService` entity** — `CrossSellStatus` (`OPEN→CONVERTED\|DISMISSED`, both terminal) converted from free-text `String` (4th such conversion after `KycStatus` #3-4, `NeedsAssessmentStatus` #5, `InsuranceProgramStatus` #7). Migration `20260827200000_add_cross_sell_status_enum` also adds `detectedByUserId`/`resolvedByUserId`/`resolvedAt`/`dismissReason`, `@@index([status])`, and **`@@unique([customerId, gapLine])`** — the `race-safe-invariants.md` backstop (≤1 opportunity per customer+line, ever; the sweep inserts one row at a time, catching `P2002`), Prisma-expressible so no raw SQL this time. New seeded permissions `cross-sell.read` (Sales/Manager/Exec) + `cross-sell.detect` (Sales/Manager); existing `cross-sell.convert` (Sales) gates convert/dismiss. No maker/checker (acting on a system nudge is single-actor); visibility inherited from the Customer's owner. **The Policy module (Domain B) is not built, so `Policy` is empty everywhere and the job is a correct no-op until real policies exist** — built ahead of its data source, like the A.8 SLA registry's unwired timers. `apps/web/app/(app)/cross-sell/`: `?customerId=` list + scan + inline convert/dismiss, a detail screen, a "Cross-sell" nav item + customer-profile section. See README § Known gaps, Part C #8. | Run `npm run db:migrate:dev` (or `db:test:migrate:dev`) for the new migration, then `npm run db:seed` (or `db:test:seed`) for the two new permissions |
| 2026-08-27 | Part C #9 (Up-Selling) landed. `apps/api/src/modules/up-sell/`: a nightly `@Cron('0 5 * * *')` sweep (`up-sell-detection.scheduler.ts`) + on-demand `POST /up-sell-recommendations/detect` (`{ customerId }`) compare a customer's **designed property Sum Insured** (Σ the "Property All Risks" line's `sumInsuredBasis` over their non-SUPERSEDED `InsuranceProgram`s, #7) against the **current value of their surveyed assets** (`deriveSumInsured(...).propertySumInsured` over the whole `RiskProfile` book, #6) and raise an `UpSellRecommendation` when the shortfall clears a **drafted 10%** of Sum Insured (`up-sell.config.ts` — pure `assessUnderinsurance()`, all figures through `money.util.ts`). Both figures are snapshotted onto the row. `GET /up-sell-recommendations?customerId=&status=` + `GET /:id`; `POST /:id/{convert,dismiss}` (`{ reason }`). `UpSellRecommendation` is the **18th `WorkflowTransitionService` entity** — `UpSellStatus` (`OPEN→CONVERTED\|DISMISSED`, both terminal) converted from free-text `String` (5th such conversion). Migration `20260827220000_add_up_sell_status_enum` adds the same provenance/resolution columns as #8, `@@index([customerId])`+`@@index([status])`, and a **partial `UNIQUE` index `customerId WHERE status = 'OPEN'`** (raw SQL — Prisma can't express the predicate). **Unlike #8's full `@@unique`, this is partial**: an up-sell gap is a continuous, growing quantity, so a resolved recommendation frees the slot for a fresh one once assets grow further — plus a pre-check heuristic suppresses an immediate re-flag until `currentAssetValue` exceeds the last resolved one's. New seeded `up-sell.read` (Sales/Manager/Exec) + `up-sell.detect` (Sales/Manager); `up-sell.convert` (Sales) description tightened "Act on…" → "Convert or dismiss…". `InsuranceProgramModule` now `exports: [InsuranceProgramRepository]`. No maker/checker. Comparison is property/asset-value only (BI up-sell deferred); `currentSumInsured` is the *designed* programme line, not an in-force `Policy` (Domain B), so the job catches a survey that grew without a re-assembly/endorsement. `apps/web/app/(app)/up-sell/`: `?customerId=` list + scan + last-scan panel + inline convert/dismiss, a detail screen, an "Up-sell" nav item + customer-profile section. See README § Known gaps, Part C #9. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev` — see below), then `npm run db:seed` (or `db:test:seed`) for the two new permissions |
| 2026-08-27 | Part C #10 (Relationship Management / CRM) landed — **no migration, no seed change** (`Interaction` + `InteractionChannel` already in the schema; `interaction.log` + `customer.360-view.read` already seeded). `apps/api/src/modules/crm/` (+ `repositories/interaction.repository.ts`): `POST /customers/:customerId/interactions` (`{ channel, summary, occurredAt? }` — `interaction.log`, gated by that permission **alone, not customer ownership**, so a Claims/Finance/Placement officer can log against a customer they don't own; a future `occurredAt` is 422), `GET /customers/:customerId/interactions` + `GET /customers/:customerId/360-view` (`customer.360-view.read`, owner-or-cross-owner visibility like `CustomerService.get()`). The 360 view aggregates interactions + policies + claims + complaints and runs them through `crm.config.ts`'s **pure, deterministic** `buildCustomerTimeline()` (one reverse-chronological list; per-kind representative instant; fixed tie-break). **`Interaction` is NOT a `WorkflowTransitionService` entity** (no status) and has no maker/checker — it's a factual log. **Policy/Claim/Complaint modules (Domains B/C/E) aren't built, so those three collections are always empty and the timeline is interactions-only** — same "built ahead of its data source" shape as #8; the repo's `Policy`/`Claim`/`Complaint` finders live on `InteractionRepository` (like `cross-sell-opportunity.repository.ts`'s `Policy` reads). Claim projection is ids/status/dates only (HIGHLY_CONFIDENTIAL — no `causeOfLoss`/`lossLocation`/money/`isLargeClaim`, `ibms-brain/meta/lex/sensitive-data-handling.md`); the 360 read writes a `READ` `AuditLogEntry` flagged `isSensitiveDataAccess` when a claim is present (closes part of the A.4 read-logging gap). A datetime `occurredAt` must carry an explicit timezone offset (offset-less → parsed server-local → 422); a bare date is fine. Shared `CUSTOMER_CROSS_OWNER_ROLES` moved from `customer.service.ts` to `common/rbac-visibility.util.ts`, plus a new `isCustomerVisibleTo(customer, actor)` helper there (adopted by `crm.service.ts` + `customer.service.ts`). `apps/web/app/(app)/crm/`: `?customerId=` customer-timeline screen (log form — renders even on a 403 view so the log-only roles aren't dead-ended — + merged timeline + counts), "Relationship (CRM)" nav item + customer-profile section. **`@code-reviewer` (mandatory — reads `Claim`/HIGHLY_CONFIDENTIAL) → 5 findings, all fixed** (log-form-on-403, offset-required `occurredAt`, drop `isLargeClaim` from the projection, guard `new Date().toISOString()` on web, extract the visibility helper). See README § Known gaps, Part C #10. | None — no migration, no seed change |
| 2026-08-28 | Part C #11 (RFQ / Market Submission) landed — **first Domain B module**. Two new modules: `apps/api/src/modules/opportunity/` — the minimal parent (like #5's minimal RiskProfile): `POST /opportunities` (`{ insuranceProgramId }`, `opportunity.create`/Placement — creates a `NEEDS_CONFIRMED` `Opportunity` from a **FINALIZED** `InsuranceProgram`, `customerId` resolved server-side), `GET /opportunities?customerId=` + `GET /:id` (`opportunity.read` — Sales/Placement/Manager/Exec). Full Opportunity lifecycle (client decision, renegotiation, close-lost, `targetPremiumThreshold`) is #16-17. `apps/api/src/modules/rfq/` (+ `repositories/{opportunity,rfq}.repository.ts`): `POST /rfqs` (`{ opportunityId, insuranceLine, insurerIds[], followUpThresholdDays? }`, `rfq.create` — one RFQ per line, a SENT `RFQInsurer` per shortlisted insurer; the first RFQ drives the `Opportunity` `NEEDS_CONFIRMED→RFQ_ISSUED` transition, best-effort), `GET /rfqs/selectable-insurers` (`rfq.create` — read-only `Insurer` master data), `GET /rfqs?opportunityId=|customerId=` + `GET /:id` (`rfq.read`), `POST /rfqs/:id/insurers` (broaden the shortlist), `POST /rfq-insurers/:id/transition` (`{ toStatus }`, `rfq.insurer.update` — VIEWED/QUOTED/DECLINED/NO_RESPONSE via `WorkflowTransitionService`; QUOTED/DECLINED stamp `respondedAt`). Nightly `@Cron('0 6 * * *')` `rfq-followup.scheduler.ts` + `RfqService.runFollowUpScan()`: **alert only** — stamps `RFQInsurer.followUpAlertSentAt` (race-safe `updateMany`) + writes an audit row on every still-open submission past its RFQ's `followUpThresholdDays`, counted in **Jordan business days** (`rfq.config.ts` pure `isFollowUpDue()` → `addBusinessDays()`); it does **not** auto-mark `NO_RESPONSE` (that is #12; the inline note in `workflow-transitions.config.ts` to the contrary is a flagged inference — `/brain-gap` candidate). `Opportunity`/`RFQInsurer` were **already** `WorkflowTransitionService` entities (modeled ahead at A.6) — no new engine entity, no enum conversion. Migration `20260828120000_add_rfq_market_submission` adds `Opportunity.createdByUserId`/`RFQ.issuedByUserId` provenance, the missing parent-FK/filter indexes, `@@unique([opportunityId, insuranceLine])` on `RFQ` (one RFQ per line), and a **partial `UNIQUE` index** `Opportunity(insuranceProgramId) WHERE status <> 'CLOSED_LOST'` (raw SQL — one live Opportunity per programme, `race-safe-invariants.md`; a lost placement frees it to re-market). No maker/checker (issuing an RFQ is single-actor Placement work). The RFQ `insuranceLine` is **validated against the designed `InsuranceProgram`'s canonical line set** (422 for a typo / off-programme line), and `addInsurers` refuses to broaden a shortlist once the parent Opportunity has left the market phase (modelled ahead of #16-17). New seeded `opportunity.create`/`opportunity.read`/`rfq.read`; `rfq.create` + `rfq.insurer.update` were already seeded. `apps/web/app/(app)/opportunities/` + `apps/web/app/(app)/rfqs/` (list/detail/new + per-insurer status control + add-insurers), a "Take to market" button on a FINALIZED insurance program, one "RFQ / market" nav item. **`@code-reviewer` (mandatory — workflow logic) → APPROVE WITH MINORS, no blockers; 4 findings fixed** (line-set validation, market-phase guard on `addInsurers`, stale NO_RESPONSE comment reconciled, `Opportunity.status` is not a reliable "has RFQs" signal for #12). See README § Known gaps, Part C #11. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev` — see below), then `npm run db:seed` (or `db:test:seed`) for the three new permissions |

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

Infrastructure (Part A + Part B), plus Part C **Domain A, Processes 1–10** — Lead
Management (#1), Prospect Management (#2), Customer Acquisition/Onboarding (#3-4, with
*simulated* screening), Needs Assessment (#5), Risk Assessment (#6), Product
Recommendation / Program Design (#7), Cross-Selling (#8, a no-op until the Policy module
lands), Up-Selling (#9, flags a survey that outgrew the designed property Sum Insured),
Relationship Management / CRM (#10, logs every touchpoint as an `Interaction` and serves
the aggregated 360° customer timeline — policies/claims/complaints empty until Domains
B/C/E land). **Domain A is complete.** Part C **Domain B** has begun with RFQ / Market
Submission (#11) — a minimal `Opportunity` parent (created from a FINALIZED Insurance
Program) plus `RFQ`/`RFQInsurer` (one RFQ per line, insurer shortlist, per-insurer
response tracking, a nightly business-day follow-up alert sweep). Everything else —
Domain B #12–22, Domains C–H, and Parts D–G (PDPL, dashboards, bilingual UI, final
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
