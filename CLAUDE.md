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
| 2026-08-27 | Part C #10 (Relationship Management / CRM) landed — **no migration, no seed change** (`Interaction` + `InteractionChannel` already in the schema; `interaction.log` + `customer.360-view.read` already seeded). `apps/api/src/modules/crm/` (+ `repositories/interaction.repository.ts`): `POST /customers/:customerId/interactions` (`{ channel, summary, occurredAt? }` — `interaction.log`, gated by that permission **alone, not customer ownership**, so a Claims/Finance/Placement officer can log against a customer they don't own; a future `occurredAt` is 422), `GET /customers/:customerId/interactions` + `GET /customers/:customerId/360-view` (`customer.360-view.read`, owner-or-cross-owner visibility like `CustomerService.get()`). The 360 view aggregates interactions + policies + claims + complaints and runs them through `crm.config.ts`'s **pure, deterministic** `buildCustomerTimeline()` (one reverse-chronological list; per-kind representative instant; fixed tie-break). **`Interaction` is NOT a `WorkflowTransitionService` entity** (no status) and has no maker/checker — it's a factual log. **Policy/Claim/Complaint modules (Domains B/C/E) aren't built, so those three collections are always empty and the timeline is interactions-only** — same "built ahead of its data source" shape as #8; the repo's `Policy`/`Claim`/`Complaint` finders live on `InteractionRepository` (like `cross-sell-opportunity.repository.ts`'s `Policy` reads). Claim projection is ids/status/dates only (HIGHLY_CONFIDENTIAL — no `causeOfLoss`/`lossLocation`/money/`isLargeClaim`, `ibms-brain/meta/lex/sensitive-data-handling.md`); the 360 read writes a `READ` `AuditLogEntry` flagged `isSensitiveDataAccess` when a claim is present (closes part of the A.4 read-logging gap). A datetime `occurredAt` must carry an explicit timezone offset (offset-less → parsed server-local → 422); a bare date is fine. Shared `CUSTOMER_CROSS_OWNER_ROLES` moved from `customer.service.ts` to `common/rbac-visibility.util.ts`, plus a new `isCustomerVisibleTo(customer, actor)` helper there (adopted by `crm.service.ts` + `customer.service.ts`). `apps/web/app/(app)/crm/`: `?customerId=` customer-timeline screen (log form — renders even on a 403 view so the log-only roles aren't dead-ended — + merged timeline + counts), "Relationship (CRM)" nav item + customer-profile section. **`@code-reviewer` (mandatory — reads `Claim`/HIGHLY_CONFIDENTIAL) → 5 findings, all fixed** (log-form-on-403, offset-required `occurredAt`, drop `isLargeClaim` from the projection, guard `new Date().toISOString()` on web, extract the visibility helper). See README § Known gaps, Part C #10. | None — no migration, no seed change |
| 2026-08-28 | Part C #11 (RFQ / Market Submission) landed — **first Domain B module**. Two new modules: `apps/api/src/modules/opportunity/` — the minimal parent (like #5's minimal RiskProfile): `POST /opportunities` (`{ insuranceProgramId }`, `opportunity.create`/Placement — creates a `NEEDS_CONFIRMED` `Opportunity` from a **FINALIZED** `InsuranceProgram`, `customerId` resolved server-side), `GET /opportunities?customerId=` + `GET /:id` (`opportunity.read` — Sales/Placement/Manager/Exec). Full Opportunity lifecycle (client decision, renegotiation, close-lost, `targetPremiumThreshold`) is #16-17. `apps/api/src/modules/rfq/` (+ `repositories/{opportunity,rfq}.repository.ts`): `POST /rfqs` (`{ opportunityId, insuranceLine, insurerIds[], followUpThresholdDays? }`, `rfq.create` — one RFQ per line, a SENT `RFQInsurer` per shortlisted insurer; the first RFQ drives the `Opportunity` `NEEDS_CONFIRMED→RFQ_ISSUED` transition, best-effort), `GET /rfqs/selectable-insurers` (`rfq.create` — read-only `Insurer` master data), `GET /rfqs?opportunityId=|customerId=` + `GET /:id` (`rfq.read`), `POST /rfqs/:id/insurers` (broaden the shortlist), `POST /rfq-insurers/:id/transition` (`{ toStatus }`, `rfq.insurer.update` — VIEWED/QUOTED/DECLINED/NO_RESPONSE via `WorkflowTransitionService`; QUOTED/DECLINED stamp `respondedAt`). Nightly `@Cron('0 6 * * *')` `rfq-followup.scheduler.ts` + `RfqService.runFollowUpScan()`: **alert only** — stamps `RFQInsurer.followUpAlertSentAt` (race-safe `updateMany`) + writes an audit row on every still-open submission past its RFQ's `followUpThresholdDays`, counted in **Jordan business days** (`rfq.config.ts` pure `isFollowUpDue()` → `addBusinessDays()`); it does **not** auto-mark `NO_RESPONSE` (that is #12; the inline note in `workflow-transitions.config.ts` to the contrary is a flagged inference — `/brain-gap` candidate). `Opportunity`/`RFQInsurer` were **already** `WorkflowTransitionService` entities (modeled ahead at A.6) — no new engine entity, no enum conversion. Migration `20260828120000_add_rfq_market_submission` adds `Opportunity.createdByUserId`/`RFQ.issuedByUserId` provenance, the missing parent-FK/filter indexes, `@@unique([opportunityId, insuranceLine])` on `RFQ` (one RFQ per line), and a **partial `UNIQUE` index** `Opportunity(insuranceProgramId) WHERE status <> 'CLOSED_LOST'` (raw SQL — one live Opportunity per programme, `race-safe-invariants.md`; a lost placement frees it to re-market). No maker/checker (issuing an RFQ is single-actor Placement work). The RFQ `insuranceLine` is **validated against the designed `InsuranceProgram`'s canonical line set** (422 for a typo / off-programme line), and `addInsurers` refuses to broaden a shortlist once the parent Opportunity has left the market phase (modelled ahead of #16-17). New seeded `opportunity.create`/`opportunity.read`/`rfq.read`; `rfq.create` + `rfq.insurer.update` were already seeded. `apps/web/app/(app)/opportunities/` + `apps/web/app/(app)/rfqs/` (list/detail/new + per-insurer status control + add-insurers), a "Take to market" button on a FINALIZED insurance program, one "RFQ / market" nav item. **`@code-reviewer` (mandatory — workflow logic) → APPROVE WITH MINORS, no blockers; 4 findings fixed** (line-set validation, market-phase guard on `addInsurers`, stale NO_RESPONSE comment reconciled, `Opportunity.status` is not a reliable "has RFQs" signal for #12). See README § Known gaps, Part C #11. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev` — see below), then `npm run db:seed` (or `db:test:seed`) for the three new permissions |
| 2026-08-29 | Part C #12 (Market Placement) landed — extends the `apps/api/src/modules/rfq/` module (no new module). **"Answer insurer queries and supply additional information":** the Process-44 `CommunicationLog` model is **widened** (not a new model — user's call) to also carry broker↔insurer RFQ correspondence — `customerId`/`languageUsed` relaxed to nullable, new `direction CommunicationDirection @default(OUTBOUND)` (new enum `INBOUND\|OUTBOUND`), `rfqId?`/`rfqInsurerId?` FKs, `subject?`/`body?`/`loggedByUserId?`/`createdAt`, 3 indexes (migration `20260829120000_extend_communication_log_for_placement`, hand-applied). `POST /rfqs/:id/communications` (`{ direction, channel, body, subject?, rfqInsurerId?, occurredAt? }`, new perm `rfq.communication.log`/Placement — `rfqInsurerId` must be on the RFQ else 422; `occurredAt` offset-required/no-future) + `GET /rfqs/:id/communications` (`rfq.read`). A factual log — no workflow status, no maker/checker; the CREATE audit row carries **metadata only, never `body`** (Confidential; `sensitive-data-handling.md`), `customerId` backfilled from the RFQ's Opportunity. **"Update each insurer's response status":** `RfqService.runFollowUpScan` now also **auto-advances** a still-open `SENT`/`VIEWED` submission `→ NO_RESPONSE` through `WorkflowTransitionService` once past the business-day threshold (was alert-only in #11 — resolves that `/brain-gap` candidate). Race-safe: a concurrent manual `QUOTED`/`DECLINED` makes the move a no-op (engine `ConflictException` / illegal-move 422) — caught, counted `transitionSkipped`, not `failed`. `findOpenSubmissionsForFollowUp` drops its `followUpAlertSentAt: null` filter (a #11-era alerted row must still become NO_RESPONSE-eligible; idempotent via status + the conditional stamp). `FollowUpScanResult` gains `autoNoResponse`/`transitionSkipped`; the `workflow-transitions.config.ts` RFQInsurer comment is rewritten (auto + manual paths). Shared: `crm.service.ts`'s `parseOccurredAt` extracted to `common/historical-instant.util.ts` (`parseHistoricalInstant`), reused by both. `apps/web/app/(app)/rfqs/[id]/`: a "Correspondence" section (list + Placement-only log form). **`@code-reviewer` (mandatory — system-actor workflow transition + Confidential data) → APPROVE WITH MINORS, no blockers, no lex violations; minors fixed** (brain-gap row wording `followUpThresholdDays`∈`RFQ` not `RFQInsurer`, `CommunicationLog` `rfqId IS NULL` discriminator documented, `FollowUpScanResult` counter-overlap comment + scheduler log guard). Carried follow-up: no `apps/api` e2e for the RFQ module (pre-existing since #11). `/brain-gap` filed + pushed for `policy-lifecycle.md` (RFQ follow-up / non-response). See README § Known gaps, Part C #12. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev`), then `npm run db:seed` (or `db:test:seed`) for the new `rfq.communication.log` permission |
| 2026-09-01 | Part C #13 (Quotation Management) landed — **new module** `apps/api/src/modules/quotation/` (+ `repositories/quotation.repository.ts`). `POST /quotations` (`{ rfqId, insurerId, premium, currency?, deductible?, limits?, biPeriodMonths?, liabilityLimit?, exclusions?, conditions?, commissionRatePercent? }`, `quotation.capture`/Placement) captures an insurer's quote as a **version-1 `Quotation`** — the insurer must be on the RFQ's shortlist (422) and not `DECLINED` (422), and must not already have a current quotation (409 → revise). `POST /quotations/:id/revise` (`quotation.negotiate`/Placement) records a renegotiation round as a **NEW version** linked by `previousVersionId`, `versionNumber+1`, flipping `isCurrentVersion` — the old row is kept verbatim (Part 4.1 / Part 3.3 Controls). `GET /quotations?rfqId=\|opportunityId=\|customerId=` + `GET /:id` (`quotation.read` — **new seeded perm**, Sales/Placement/Manager/Exec) return rows grouped into per-insurer version chains. Every monetary field runs through `money.util.ts` via the pure `normalizeQuotationTerms` (`quotation.config.ts`; fils precision, `money-decimal-jod.md`). Migration `20260901120000_add_quotation_capture` (hand-authored + `migrate deploy` — checksum drift blocks `migrate:dev`, not `deploy`; applied to `db` + `db-test`): `Quotation.capturedByUserId` provenance, `Quotation_insurerId_idx`, and a **partial `UNIQUE` index `Quotation(rfqId, insurerId) WHERE isCurrentVersion = true`** (raw SQL — "one current version per chain", the exact example `race-safe-invariants.md` names; the existing `previousVersionId @unique` serializes concurrent revisions of one node). `revise`'s two writes run in ONE Prisma `$transaction` (`QuotationRepository.reviseChain` — a deliberate local exception to the no-`$transaction` convention): a status-conditional `updateMany` clears the predecessor's `isCurrentVersion` (0 rows → tx returns `null` → 409), then inserts the successor as current; a `P2002` from the insert rolls the whole tx back → 409, so a crash between the two can't leave the chain headless. **`Quotation` is NOT a `WorkflowTransitionService` entity** (`isCurrentVersion` is a boolean, not a status) and has **no maker/checker**. On a successful capture/revise the service **best-effort** advances `RFQInsurer → QUOTED` (stamps `respondedAt`) and `Opportunity RFQ_ISSUED → QUOTES_RECEIVED` through the engine (logged, never thrown — **not authoritative**, derive "has quoted" from the `Quotation` table); `capture` carries a comment recording it is deliberately NOT phase-gated (a factual event, like `transitionInsurer`). The CREATE audit row is **metadata + money only** (`quotationAuditSnapshot` — never `exclusions`/`conditions`/`limits`; Confidential, Part 6.1). `RfqModule` now `exports: [RfqRepository]`; shared `MONEY_STRING` regex added to `common/dto.util.ts`. `apps/web/app/(app)/rfqs/[id]/`: a "Quotations" section (`components/quotation/QuotationsSection.tsx` — per-insurer chain cards + version history + Placement-only capture/revise form); no new nav item. **`@code-reviewer` (mandatory — financial calc + workflow logic) → APPROVE WITH MINORS, no blockers, no lex violations**; minors fixed (`$transaction` for revise, no-phase-gate comment, revise-DTO-replaces-not-patches comment, empty-`{}`-limits→null, `!= null` scope filter, ran the build/contract/security gates). **The reviewer's `/brain-gap` candidate (RFQ follow-up sweep unaware of `Quotation`) was filed AND solved here**: `RfqService.runFollowUpScan` now calls `RfqRepository.findCurrentQuotationKeys(rfqIds)` up front and drops any open submission whose `(rfqId, insurerId)` has a current `Quotation` before the threshold check — an insurer that quoted is never auto-`NO_RESPONSE`d even if its best-effort `→ QUOTED` failed; `FollowUpScanResult` gains a non-overlapping `skippedQuoted` counter; the `workflow-transitions.config.ts` `RFQInsurer` comment + both sweep docstrings updated. `RFQInsurer.status` is not the authoritative "has this insurer quoted?" signal — the `Quotation` table is (`ibms-brain/meta/context/policy-lifecycle.md` § RFQ follow-up, extended). Carried: no `apps/api` e2e for the quotation module (from #11–12). See README § Known gaps, Part C #13. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev`), then `npm run db:seed` (or `db:test:seed`) for the new `quotation.read` permission |
| 2026-09-01 | Part C #14 (Quote Comparison) landed — **new module** `apps/api/src/modules/comparison/` (+ `repositories/comparison.repository.ts`). `POST /comparison-matrices` (`{ rfqId, scores?: [{ insurerId, insurerQualityScore?, serviceScore? }] }`, `comparison.build`/Placement) **(re)builds** the one `ComparisonMatrix` per RFQ (`rfqId @unique`) from every **current-version** `Quotation` on it — one `ComparisonMatrixRow` each; the objective dimensions (premium/deductible/`limits`/BI period/liability limit/exclusions/conditions/commission rate) live on the linked `Quotation`, so the matrix is **never price alone** (`policy-lifecycle.md` § controls), and rows are ordered **by insurer, not premium**. Shortlisted insurers with no current quote and status ≠ `DECLINED` → `ComparisonMatrix.missingInsurers` (insurer ids); a `DECLINED` one is surfaced separately (computed on read, not stored). Optional per-insurer `insurerQualityScore`/`serviceScore` (0–100, 2dp) are **manual inputs** — there is no Insurer-scoring module (Process 61); `planComparison` (`comparison.config.ts`, pure) 422s on nothing-to-compare / a score for an insurer with no current quote / out-of-range / duplicate. `GET /comparison-matrices?rfqId=` (404 friendly when unbuilt) + `GET /:id` (**new seeded perm `comparison.read`**, Sales/Placement/Manager/Exec). `ComparisonRepository.buildOrRebuild` does upsert-matrix + `deleteMany` + `createMany` rows in ONE Prisma `$transaction` (local exception, like `QuotationRepository.reviseChain`); `@@unique([comparisonMatrixId, quotationId])` (migration `20260901160000` — Prisma-expressible, no raw SQL) backstops a doubled row (`race-safe-invariants.md`). Migration also adds `ComparisonMatrix.builtByUserId` + FK/filter indexes. A build **best-effort** advances `Opportunity QUOTES_RECEIVED → COMPARISON_BUILT` (logged, never thrown — not authoritative). **`ComparisonMatrix` is NOT a `WorkflowTransitionService` entity** (no status) and has **no maker/checker** (a derived artefact; the gate is downstream at #16). Audit row = counts only; its `CREATE` (first build) vs `UPDATE` (rebuild) action comes from a flag `buildOrRebuild` computes **inside the transaction**. The `missing`/`declined` flagged-insurer buckets are **recomputed live on every read** from the current shortlist vs. the matrix rows (so they stay disjoint after a post-build status change); `ComparisonMatrix.missingInsurers` stores the build-time snapshot for the audit counts only. `QuotationModule` now `exports: [QuotationRepository]`; `BuildComparisonDto` is the first `@ValidateNested`+`@Type` DTO (needed under `whitelist: true`). `apps/web/app/(app)/rfqs/[id]/`: a "Comparison" section (`components/comparison/ComparisonSection.tsx` — wide scrollable table + missing/declined callouts + a "· superseded" marker on a row whose quote was revised since the build + Placement-only build/rebuild + optional score grid); no new nav item. **`@code-reviewer` (mandatory — workflow logic + "never price alone" controls rule + carries `Quotation` money) → APPROVE WITH MINORS, no blockers, no lex violations**; minors fixed (live-recompute missing/declined buckets, CREATE/UPDATE flag from inside the tx, "· superseded" row marker, drop a redundant cast, `normalizeScore` money-reuse comment). Carried: no `apps/api` e2e for the comparison module (from #11–13). See README § Known gaps, Part C #14. | Run `npm run db:migrate:deploy` (checksum drift blocks `migrate:dev`), then `npm run db:seed` (or `db:test:seed`) for the new `comparison.read` permission |

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
